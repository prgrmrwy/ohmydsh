import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import {
  dshBinOf,
  provisionOrderFor,
  resolveCliBin,
  runBoundedProvision,
} from '../scripts/lib/dsh-cli.mjs'

const RC2_SPEC = '@deepseek-ai/dsh@0.1.1-rc.2'
const FUTURE_SPEC = '@deepseek-ai/dsh@0.1.2'

async function temp(t, prefix = 'ohmydsh-runtime-') {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function fakeBin(root, version) {
  const bin = dshBinOf(path.join(root, version))
  await mkdir(path.dirname(bin), { recursive: true })
  await writeFile(bin, '#!/usr/bin/env node\n')
  return bin
}

function materializingRunner(calls, body = {}) {
  return (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd })
    if (command === 'pnpm' && body.pnpm !== 'fail') {
      const bin = dshBinOf(options.cwd)
      mkdir(path.dirname(bin), { recursive: true }).then(() => writeFile(bin, '#!/usr/bin/env node\n'))
      // Runner API is synchronous; test fixture materializes synchronously below.
      const result = spawnSync(process.execPath, ['-e', `const fs=require('fs'),p=require('path');const b=${JSON.stringify(bin)};fs.mkdirSync(p.dirname(b),{recursive:true});fs.writeFileSync(b,'#!/usr/bin/env node\\n')`])
      assert.equal(result.status, 0)
    }
    if (command === 'npx' && body.npxCacheBin) {
      const result = spawnSync(process.execPath, ['-e', `const fs=require('fs'),p=require('path');const b=${JSON.stringify(body.npxCacheBin)};fs.mkdirSync(p.dirname(b),{recursive:true});fs.writeFileSync(b,'#!/usr/bin/env node\\n')`])
      assert.equal(result.status, 0)
    }
    return body[command] === 'fail'
      ? { ok: false, timedOut: false, status: 7 }
      : { ok: true, timedOut: false, status: 0 }
  }
}

test('rc.2 临时策略默认仅 pnpm，逃生门恢复 npx-first', () => {
  assert.deepEqual(provisionOrderFor(RC2_SPEC, {}).channels, ['pnpm'])
  const escaped = provisionOrderFor(RC2_SPEC, { DSH_ALLOW_NPX_PROVISION: '1' })
  assert.deepEqual(escaped.channels, ['npx', 'pnpm'])
  assert.equal(escaped.override, true)
  assert.deepEqual(provisionOrderFor(FUTURE_SPEC, {}).channels, ['npx', 'pnpm'])
})

test('rc.2 双缓存 miss 默认不调用 npx，pnpm staging 成功后原子复用', async t => {
  const cache = await temp(t)
  const pnpmBase = await temp(t)
  const calls = []
  const resolved = resolveCliBin({
    spec: RC2_SPEC,
    version: '0.1.1-rc.2',
    npxCacheDir: cache,
    pnpmCacheBase: pnpmBase,
    env: {},
    provisionRunner: materializingRunner(calls),
    diagnose: false,
  })
  assert.equal(resolved?.kind, 'pnpm-cache')
  assert.ok(existsSync(resolved.bin))
  assert.deepEqual(calls.map(call => call.command), ['pnpm'])
  assert.match(calls[0].cwd, /0\.1\.1-rc\.2\.staging-/)
  assert.equal(existsSync(path.join(pnpmBase, '0.1.1-rc.2.lock')), false)

  const again = resolveCliBin({
    spec: RC2_SPEC,
    version: '0.1.1-rc.2',
    npxCacheDir: cache,
    pnpmCacheBase: pnpmBase,
    env: {},
    provisionRunner: () => { throw new Error('cache hit must not provision') },
    diagnose: false,
  })
  assert.deepEqual(again, resolved)
})

test('失败的 pnpm staging 不破坏既有目录且可重试', async t => {
  const cache = await temp(t)
  const pnpmBase = await temp(t)
  const finalDir = path.join(pnpmBase, '0.1.1-rc.2')
  await mkdir(finalDir)
  await writeFile(path.join(finalDir, 'marker'), 'keep')
  const failed = resolveCliBin({
    spec: RC2_SPEC,
    version: '0.1.1-rc.2',
    npxCacheDir: cache,
    pnpmCacheBase: pnpmBase,
    env: {},
    provisionRunner: materializingRunner([], { pnpm: 'fail' }),
    diagnose: false,
    lockWaitMs: 20,
  })
  assert.equal(failed, null)
  assert.equal(await readFile(path.join(finalDir, 'marker'), 'utf8'), 'keep')
  assert.equal((await stat(finalDir)).isDirectory(), true)

  const retried = resolveCliBin({
    spec: RC2_SPEC,
    version: '0.1.1-rc.2',
    npxCacheDir: cache,
    pnpmCacheBase: pnpmBase,
    env: {},
    provisionRunner: materializingRunner([]),
    diagnose: false,
  })
  assert.equal(retried?.kind, 'pnpm-cache')
  assert.ok(existsSync(retried.bin))
})

test('逃生门与未来版本均保持 npx-first，并在 npx 成功后复用其缓存', async t => {
  for (const [spec, version, env] of [
    [RC2_SPEC, '0.1.1-rc.2', { DSH_ALLOW_NPX_PROVISION: 'true' }],
    [FUTURE_SPEC, '0.1.2', {}],
  ]) {
    const cache = await temp(t)
    const pnpmBase = await temp(t)
    const { npxBinPathOf } = await import('../scripts/lib/dsh-cli.mjs')
    const expected = npxBinPathOf(spec, cache)
    const calls = []
    const resolved = resolveCliBin({
      spec, version, env, npxCacheDir: cache, pnpmCacheBase: pnpmBase,
      provisionRunner: materializingRunner(calls, { npxCacheBin: expected }),
      diagnose: false,
    })
    assert.equal(resolved?.kind, 'npx-cache')
    assert.deepEqual(calls.map(call => call.command), ['npx'])
  }
})

test('bounded provision reports success and non-zero exit', async t => {
  const cwd = await temp(t)
  const ok = runBoundedProvision(process.execPath, ['-e', 'process.exit(0)'], {
    cwd, timeoutMs: 2_000, killGraceMs: 50, stdout: 'pipe', stderr: 'pipe',
  })
  assert.equal(ok.ok, true)
  const bad = runBoundedProvision(process.execPath, ['-e', 'process.exit(7)'], {
    cwd, timeoutMs: 2_000, killGraceMs: 50, stdout: 'pipe', stderr: 'pipe',
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.status, 7)
})

test('bounded provision 超时终止完整进程组', async t => {
  const cwd = await temp(t)
  const marker = path.join(cwd, 'descendant-survived')
  const script = [
    "const {spawn}=require('child_process')",
    `spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'bad'),500)`) }],{stdio:'ignore'})`,
    'setInterval(()=>{},1000)',
  ].join(';')
  const result = runBoundedProvision(process.execPath, ['-e', script], {
    cwd, timeoutMs: 80, killGraceMs: 60, stdout: 'pipe', stderr: 'pipe',
  })
  assert.equal(result.ok, false)
  assert.equal(result.timedOut, true)
  await new Promise(resolve => setTimeout(resolve, 650))
  assert.equal(existsSync(marker), false, 'descendant must not survive the timeout process-group kill')
})

test('活跃 provision lock 的等待是有界的，且不会启动第二个 installer', async t => {
  const cache = await temp(t)
  const pnpmBase = await temp(t)
  const lockDir = path.join(pnpmBase, '0.1.1-rc.2.lock')
  await mkdir(lockDir)
  await writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
  const calls = []
  const started = Date.now()
  const resolved = resolveCliBin({
    spec: RC2_SPEC,
    version: '0.1.1-rc.2',
    npxCacheDir: cache,
    pnpmCacheBase: pnpmBase,
    env: {},
    provisionRunner: materializingRunner(calls),
    lockWaitMs: 30,
    diagnose: false,
  })
  assert.equal(resolved, null)
  assert.deepEqual(calls, [])
  assert.ok(Date.now() - started < 1_000)
})

test('并发 rc.2 provision 只有一个 pnpm owner，等待者复用成品', async t => {
  const root = await temp(t)
  const cache = path.join(root, 'npm-cache')
  const pnpmBase = path.join(root, 'pnpm-cache')
  const tools = path.join(root, 'tools')
  const log = path.join(root, 'calls')
  await mkdir(tools, { recursive: true })
  const pnpm = path.join(tools, 'pnpm')
  await writeFile(pnpm, `#!/usr/bin/env bash\nset -euo pipefail\necho pnpm >> "${log}"\nsleep 0.25\nmkdir -p node_modules/@deepseek-ai/dsh/lib\nprintf '#!/usr/bin/env node\\n' > node_modules/@deepseek-ai/dsh/lib/bin.js\n`)
  await import('node:fs/promises').then(fs => fs.chmod(pnpm, 0o755))
  const code = `import {resolveCliBin} from ${JSON.stringify(new URL('../scripts/lib/dsh-cli.mjs', import.meta.url).href)}; const r=resolveCliBin({spec:${JSON.stringify(RC2_SPEC)},version:'0.1.1-rc.2',npxCacheDir:${JSON.stringify(cache)},pnpmCacheBase:${JSON.stringify(pnpmBase)},env:process.env,provisionTimeoutMs:5000,lockWaitMs:5000,diagnose:false}); if(!r) process.exit(2); console.log(r.bin)`
  const env = { ...process.env, PATH: `${tools}:${process.env.PATH}` }
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', status => resolve({ status, stdout, stderr }))
  })
  const [a, b] = await Promise.all([run(), run()])
  assert.equal(a.status, 0, a.stderr)
  assert.equal(b.status, 0, b.stderr)
  assert.equal(a.stdout.trim(), b.stdout.trim())
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1)
})
