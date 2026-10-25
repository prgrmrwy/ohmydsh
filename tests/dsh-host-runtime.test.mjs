import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, copyFile, symlink } from 'node:fs/promises'
import { mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
import {
  assertHostRuntimeSources,
  declaredHostRuntimeFromManifest,
  loadDeclaredHostRuntime,
  prepareDeclaredHostRuntime,
} from '../scripts/lib/dsh-host-runtime.mjs'

const VERSION = '0.1.2-rc.1'

async function fixture(t, declaration = { kind: 'pet-unified-locus-v1', supportedDshVersion: VERSION }) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-host-runtime-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  const compat = path.join(repo, 'packages/dsh-pet/compat/subagent')
  await mkdir(compat, { recursive: true })
  await writeFile(path.join(compat, 'build-launcher.cjs'), '')
  await copyFile(new URL('../packages/dsh-pet/compat/subagent/compat-build-lock.cjs', import.meta.url), path.join(compat, 'compat-build-lock.cjs'))
  await writeFile(path.join(repo, 'dsh.yaml'), [
    `dshVersion: ${VERSION}`,
    'customizations:',
    '  - id: dsh-pet',
    '    type: package',
    '    source: local',
    '    version: 0.1.0',
    '    enabled: true',
    '    hostRuntimeCompatibility:',
    `      kind: ${declaration.kind}`,
    `      supportedDshVersion: ${declaration.supportedDshVersion}`,
    '',
  ].join('\n'))
  return { repo, compat }
}

function manifest(overrides = {}) {
  return {
    dshVersion: overrides.dshVersion ?? VERSION,
    customizations: [{
      id: 'dsh-pet', type: 'package', source: 'local', enabled: overrides.enabled ?? true,
      enabledEnv: overrides.enabledEnv,
      hostRuntimeCompatibility: overrides.declaration ?? {
        kind: 'pet-unified-locus-v1', supportedDshVersion: VERSION,
      },
    }],
  }
}

test('损坏 manifest 不得冒充合法无声明并回退官方 Host', async t => {
  const { repo } = await fixture(t)
  assert.throws(() => declaredHostRuntimeFromManifest(null, { repo, env: {} }), /root must be a mapping/)
  assert.throws(() => declaredHostRuntimeFromManifest({ dshVersion: VERSION }, { repo, env: {} }), /customizations must be a list/)
  assert.throws(() => declaredHostRuntimeFromManifest({ dshVersion: VERSION, customizations: {} }, { repo, env: {} }), /customizations must be a list/)
})

test('只接受 dsh-pet 固定 compatibility kind，不开放 manifest 执行路径', async t => {
  const { repo } = await fixture(t)
  const parsed = declaredHostRuntimeFromManifest(manifest(), { repo, env: {} })
  assert.equal(parsed.kind, 'pet-unified-locus-v1')
  assert.match(parsed.builder.replaceAll('\\', '/'), /packages\/dsh-pet\/compat\/subagent\/build-launcher\.cjs$/)
  assert.match(parsed.serverBin.replaceAll('\\', '/'), /\.launcher\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js$/)
  assert.throws(
    () => declaredHostRuntimeFromManifest(manifest({ declaration: {
      kind: 'pet-unified-locus-v1', supportedDshVersion: VERSION, builder: '/tmp/evil',
    } }), { repo, env: {} }),
    /\.builder is unknown/,
  )
})

test('启用 Pet 时版本 mismatch fail closed；effective disabled 时不阻止升级', async t => {
  const { repo } = await fixture(t)
  assert.throws(
    () => declaredHostRuntimeFromManifest(manifest({ dshVersion: '0.1.2' }), { repo, env: {} }),
    /re-audit or remove/,
  )
  assert.equal(declaredHostRuntimeFromManifest(manifest({ dshVersion: '0.1.2', enabled: false }), { repo, env: {} }), null)
  assert.equal(declaredHostRuntimeFromManifest(manifest({
    dshVersion: '0.1.2', enabledEnv: 'DSH_PET_ENABLED',
  }), { repo, env: { DSH_PET_ENABLED: 'false' } }), null)
})

test('builder 缺失：声明解析不读源码，Host 启动与源码检查仍 fail closed', async t => {
  const { repo, compat } = await fixture(t)
  await rm(path.join(compat, 'build-launcher.cjs'))
  // Declaration parsing is a load-stage check and must not read sources, so
  // `sync --reset` can undo deployment while the builder is gone.
  const parsed = declaredHostRuntimeFromManifest(manifest(), { repo, env: {} })
  assert.match(parsed.builder, /build-launcher\.cjs$/)
  // The source check itself still refuses, and Host startup still runs it.
  assert.throws(() => assertHostRuntimeSources(parsed), /builder is missing from dsh-pet/)
  assert.throws(() => loadDeclaredHostRuntime({ repo, env: { DSH_LOCAL_MANIFEST: path.join(repo, 'none.yaml') } }), /builder is missing from dsh-pet/)
  assert.throws(() => prepareDeclaredHostRuntime({
    repo,
    env: { DSH_LOCAL_MANIFEST: path.join(repo, 'none.yaml') },
    runner: () => { throw new Error('builder must not run when it is missing') },
  }), /builder is missing from dsh-pet/)
})

test('builder 失败时 Host fail closed，不回退官方 runtime', async t => {
  const { repo } = await fixture(t)
  assert.throws(() => prepareDeclaredHostRuntime({
    repo,
    runner: () => ({ ok: false, timedOut: false, status: 17 }),
  }), /exited 17.*refusing official-runtime fallback/)
})

test('builder 成功后要求真实 bin 和精确版本', async t => {
  const { repo, compat } = await fixture(t)
  let calls = 0
  const runner = (command, args) => {
    calls += 1
    if (calls === 1) {
      const bin = path.join(compat, '.launcher/node_modules/@deepseek-ai/dsh/lib/bin.js')
      mkdirSync(path.dirname(bin), { recursive: true })
      writeFileSync(bin, '')
      writeFileSync(path.join(compat, '.launcher/.fingerprint'), 'a'.repeat(64))
      return { ok: true, status: 0, stdout: '' }
    }
    return { ok: true, status: 0, stdout: `${VERSION}\n` }
  }
  const resolved = prepareDeclaredHostRuntime({ repo, runner })
  assert.equal(resolved.kind, 'customization-host-runtime')
  assert.equal(resolved.ownerId, 'dsh-pet')
  assert.equal(resolved.fingerprint, 'a'.repeat(64))
  assert.equal(calls, 2)
})

test('prepared Host pins physical generation under shared lock', async t => {
  const { repo, compat } = await fixture(t)
  const generation = path.join(compat, '.launcher-builds', 'generation-one')
  const bin = path.join(generation, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
  await mkdir(path.dirname(bin), { recursive: true })
  await writeFile(bin, '')
  await writeFile(path.join(generation, '.fingerprint'), 'b'.repeat(64))
  await symlink(generation, path.join(compat, '.launcher'), 'dir')
  const env = { ...process.env }
  delete env.DSH_PET_COMPAT_BUILD_TOKEN
  const resolved = prepareDeclaredHostRuntime({ repo, env, runner(command, args, options) {
    assert.equal(existsSync(path.join(compat, '.compat-build.lock/owner.json')), true)
    const owner = JSON.parse(readFileSync(path.join(compat, '.compat-build.lock/owner.json'), 'utf8'))
    assert.equal(options.env.DSH_PET_COMPAT_BUILD_TOKEN, owner.token)
    if (args[0].endsWith('build-launcher.cjs')) return { ok: true, status: 0 }
    assert.equal(args[0], realpathSync(bin))
    return { ok: true, status: 0, stdout: VERSION }
  } })
  assert.equal(resolved.bin, realpathSync(bin))
  assert.equal(resolved.fingerprint, 'b'.repeat(64))
  assert.equal(existsSync(path.join(compat, '.compat-build.lock')), false)
  assert.equal(env.DSH_PET_COMPAT_BUILD_TOKEN, undefined)
})

test('real supervisor and nested builders inherit owned token from explicit env without deadlock', async t => {
  const { repo, compat } = await fixture(t)
  const lockPath = path.join(compat, 'compat-build-lock.cjs')
  const { acquireCompatBuildLock } = require(lockPath)
  const previous = process.env.DSH_PET_COMPAT_BUILD_TOKEN
  const copied = { ...process.env }
  delete copied.DSH_PET_COMPAT_BUILD_TOKEN
  const owner = acquireCompatBuildLock({ allowInherited: false })
  try {
    const body = `const {spawnSync}=require('node:child_process');const {acquireCompatBuildLock}=require(${JSON.stringify(lockPath)});const h=acquireCompatBuildLock({waitMs:500});if(h.owned)throw Error('did not inherit');const r=spawnSync(process.execPath,['-e',${JSON.stringify(`const h=require(${JSON.stringify(lockPath)}).acquireCompatBuildLock({waitMs:500});if(h.owned)throw Error('nested did not inherit');console.log('NESTED_LOCK_OK');h.release()`)}],{env:process.env,encoding:'utf8',timeout:1500});h.release();process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(r.status??1)`
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/lib/run-bounded.mjs', import.meta.url))], { env: { ...copied, DSH_PET_COMPAT_BUILD_TOKEN: owner.token }, input: JSON.stringify({ command: process.execPath, args: ['-e', body], cwd: repo, timeoutMs: 3000, killGraceMs: 500 }), encoding: 'utf8', timeout: 5000 })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /NESTED_LOCK_OK/)
    const competitor = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(lockPath)}).acquireCompatBuildLock({waitMs:100,allowInherited:false})`], { env: copied, encoding: 'utf8', timeout: 1500 })
    assert.notEqual(competitor.status, 0)
    assert.match(competitor.stderr, /timed out/)
    assert.equal(existsSync(path.join(compat, '.compat-build.lock/owner.json')), true)
  } finally {
    owner.release()
    if (previous === undefined) delete process.env.DSH_PET_COMPAT_BUILD_TOKEN
    else process.env.DSH_PET_COMPAT_BUILD_TOKEN = previous
  }
  assert.equal(existsSync(path.join(compat, '.compat-build.lock')), false)
})

test('default preparation chain retains ownership through final reads and releases on all failures', async t => {
  for (const outcome of ['success', 'builder-failure', 'probe-failure', 'fingerprint-failure']) {
    const { repo, compat } = await fixture(t)
    const lockFile = path.join(compat, 'compat-build-lock.cjs')
    const generation = path.join(compat, '.launcher-builds', outcome)
    const bin = path.join(generation, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const probeMarker = path.join(repo, 'probe-held-lock')
    const versionScript = `if(process.argv.includes('--usability-probe')){console.log('PHYSICAL_GENERATION_USABLE');process.exit(0)}const fs=require('node:fs');const {spawnSync}=require('node:child_process');const lockFile=${JSON.stringify(lockFile)};if(!fs.existsSync(${JSON.stringify(path.join(compat, '.compat-build.lock/owner.json'))}))throw Error('lock missing at version probe');const env={...process.env};delete env.DSH_PET_COMPAT_BUILD_TOKEN;const r=spawnSync(process.execPath,['-e','require('+JSON.stringify(lockFile)+').acquireCompatBuildLock({waitMs:100,allowInherited:false})'],{env,encoding:'utf8',timeout:1500});if(r.status===0||!/timed out/.test(r.stderr))throw Error('competitor was not excluded');fs.writeFileSync(${JSON.stringify(probeMarker)},'held');console.log(${JSON.stringify(outcome === 'probe-failure' ? '9.9.9' : VERSION)})`
    const nested = `const h=require(${JSON.stringify(lockFile)}).acquireCompatBuildLock({waitMs:300});if(h.owned)throw Error('nested must inherit outer lock');h.release()`
    const builder = `const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');const h=require(${JSON.stringify(lockFile)}).acquireCompatBuildLock({waitMs:300});if(h.owned)throw Error('builder must inherit');const r=spawnSync(process.execPath,['-e',${JSON.stringify(nested)}],{env:process.env,encoding:'utf8',timeout:1500});if(r.status!==0)throw Error(r.stderr);${outcome === 'builder-failure' ? 'process.exit(17);' : ''}fs.mkdirSync(${JSON.stringify(path.dirname(bin))},{recursive:true});fs.writeFileSync(${JSON.stringify(bin)},${JSON.stringify(versionScript)});fs.writeFileSync(${JSON.stringify(path.join(generation, '.fingerprint'))},${JSON.stringify(outcome === 'fingerprint-failure' ? 'invalid' : 'c'.repeat(64))});fs.symlinkSync(${JSON.stringify(generation)},${JSON.stringify(path.join(compat, '.launcher'))},'dir');h.release()`
    await writeFile(path.join(compat, 'build-launcher.cjs'), builder)
    const oldToken = process.env.DSH_PET_COMPAT_BUILD_TOKEN
    process.env.DSH_PET_COMPAT_BUILD_TOKEN = 'untrusted-caller-token'
    const env = { ...process.env, DSH_LOCAL_MANIFEST: path.join(repo, 'none.yaml') }
    const fsBuiltin = require('node:fs')
    const originalRead = fsBuiltin.readFileSync
    let finalReadObserved = false
    fsBuiltin.readFileSync = function(file, ...args) {
      if (path.basename(String(file)) === '.fingerprint' && path.resolve(String(file)) === path.join(realpathSync(generation), '.fingerprint')) {
        finalReadObserved = true
        assert.equal(existsSync(path.join(compat, '.compat-build.lock/owner.json')), true)
        const competitorEnv = { ...process.env }; delete competitorEnv.DSH_PET_COMPAT_BUILD_TOKEN
        const competitor = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(lockFile)}).acquireCompatBuildLock({waitMs:100,allowInherited:false})`], { env: competitorEnv, encoding: 'utf8', timeout: 1500 })
        assert.notEqual(competitor.status, 0)
        assert.match(competitor.stderr, /timed out/)
      }
      return originalRead.call(this, file, ...args)
    }
    syncBuiltinESMExports()
    try {
      const prepare = () => prepareDeclaredHostRuntime({ repo, env, timeoutMs: 5000 })
      if (outcome === 'success') {
        const result = prepare()
        assert.equal(result.bin, realpathSync(bin))
        assert.equal(result.fingerprint, 'c'.repeat(64))
        const alternate = path.join(compat, '.launcher-builds', 'later')
        mkdirSync(alternate, { recursive: true })
        require('node:fs').unlinkSync(path.join(compat, '.launcher'))
        require('node:fs').symlinkSync(alternate, path.join(compat, '.launcher'), 'dir')
        const physical = spawnSync(process.execPath, [result.bin, '--usability-probe'], { encoding: 'utf8', timeout: 3000 })
        assert.equal(physical.status, 0, physical.stderr)
        assert.match(physical.stdout, /PHYSICAL_GENERATION_USABLE/)
      } else assert.throws(prepare, outcome === 'builder-failure' ? /exited 17/ : outcome === 'probe-failure' ? /reports 9/ : /fingerprint/)
      assert.equal(finalReadObserved, ['success', 'fingerprint-failure'].includes(outcome))
      assert.equal(process.env.DSH_PET_COMPAT_BUILD_TOKEN, 'untrusted-caller-token')
      assert.equal(env.DSH_PET_COMPAT_BUILD_TOKEN, 'untrusted-caller-token')
      assert.equal(existsSync(path.join(compat, '.compat-build.lock')), false)
      if (outcome !== 'builder-failure') assert.equal(readFileSync(probeMarker, 'utf8'), 'held')
    } finally {
      fsBuiltin.readFileSync = originalRead
      syncBuiltinESMExports()
      if (oldToken === undefined) delete process.env.DSH_PET_COMPAT_BUILD_TOKEN
      else process.env.DSH_PET_COMPAT_BUILD_TOKEN = oldToken
    }
  }
})

test('preparation removes case-variant inherited tokens without mutating caller env', async t => {
  const { repo } = await fixture(t)
  const env = { ...process.env, dsh_pet_compat_build_token: 'untrusted-lowercase', Dsh_Pet_Compat_Build_Token: 'untrusted-mixed' }
  assert.throws(() => prepareDeclaredHostRuntime({ repo, env, runner(command, args, options) {
    const keys = Object.keys(options.env).filter(key => key.toUpperCase() === 'DSH_PET_COMPAT_BUILD_TOKEN')
    assert.deepEqual(keys, ['DSH_PET_COMPAT_BUILD_TOKEN'])
    assert.notEqual(options.env[keys[0]], 'untrusted-lowercase')
    return { ok: false, status: 17 }
  } }), /exited 17/)
  assert.equal(env.dsh_pet_compat_build_token, 'untrusted-lowercase')
  assert.equal(env.Dsh_Pet_Compat_Build_Token, 'untrusted-mixed')
})

test('preparation restores prior token even when lock release reports failure', async t => {
  const { repo, compat } = await fixture(t)
  const lockModule = require(path.join(compat, 'compat-build-lock.cjs'))
  const acquire = lockModule.acquireCompatBuildLock
  const prior = process.env.DSH_PET_COMPAT_BUILD_TOKEN
  process.env.DSH_PET_COMPAT_BUILD_TOKEN = 'prior-token-to-restore'
  lockModule.acquireCompatBuildLock = options => {
    const lock = acquire(options)
    return { ...lock, release() { lock.release(); throw Error('injected release failure') } }
  }
  try {
    assert.throws(() => prepareDeclaredHostRuntime({ repo, runner: () => ({ ok: false, status: 17 }) }), /injected release failure/)
    assert.equal(process.env.DSH_PET_COMPAT_BUILD_TOKEN, 'prior-token-to-restore')
    assert.equal(existsSync(path.join(compat, '.compat-build.lock')), false)
  } finally {
    lockModule.acquireCompatBuildLock = acquire
    if (prior === undefined) delete process.env.DSH_PET_COMPAT_BUILD_TOKEN
    else process.env.DSH_PET_COMPAT_BUILD_TOKEN = prior
  }
})

test('版本探针错误时拒绝发布给 Host', async t => {
  const { repo, compat } = await fixture(t)
  let calls = 0
  assert.throws(() => prepareDeclaredHostRuntime({
    repo,
    runner: () => {
      calls += 1
      if (calls === 1) {
        const bin = path.join(compat, '.launcher/node_modules/@deepseek-ai/dsh/lib/bin.js')
        mkdirSync(path.dirname(bin), { recursive: true })
        writeFileSync(bin, '')
        return { ok: true, status: 0, stdout: '' }
      }
      return { ok: true, status: 0, stdout: '9.9.9\n' }
    },
  }), /reports 9\.9\.9, expected/)
})
