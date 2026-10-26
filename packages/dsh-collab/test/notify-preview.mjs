// Real official Host + Web app, fresh isolated home, no external model/provider.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, cp, symlink, writeFile, readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as pause } from 'node:timers/promises'
import { resolveCliBin } from '../../../scripts/lib/dsh-cli.mjs'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const resolved = resolveCliBin({ spec: '@deepseek-ai/dsh@0.2.0-rc.2', version: '0.2.0-rc.2' })
assert.ok(resolved, 'exact official CLI must be available')
const bin = resolved.bin
const modules = dirname(dirname(dirname(dirname(bin))))
assert.equal(basename(modules), 'node_modules')
const require = createRequire(bin)
const cliManifest = JSON.parse(await readFile(join(dirname(dirname(bin)), 'package.json'), 'utf8'))
assert.equal(cliManifest.version, '0.2.0-rc.2')
for (const name of ['dsh-base', 'dsh-web-app', 'dsh-api-session-controller', 'dsh-credentials-local']) assert.ok(require.resolve(`@deepseek-ai/${name}`).startsWith(modules + '/'))
await mkdir(join(repo, 'spike/collab-notify-preview'), { recursive: true })
const root = await mkdtemp(join(repo, 'spike/collab-notify-preview/run-'))
const home = join(root, 'home'), profile = join(home, 'profiles/notify-acceptance'), deployment = join(root, 'deployment')
const ledger = join(home, 'ledger'), first = join(root, 'first.json')
await mkdir(profile, { recursive: true })
await cp(new URL('../lib/', import.meta.url), join(deployment, 'lib'), { recursive: true })
await writeFile(join(deployment, 'package.json'), '{"type":"module"}')
await symlink(modules, join(deployment, 'node_modules'), 'dir')
await symlink(modules, join(profile, 'node_modules'), 'dir')
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }))
// Pick a free loopback port without touching any existing listener.
const listener = createServer()
await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
const port = listener.address().port
await new Promise(resolve => listener.close(resolve))
assert.notEqual(port, 3080)
const url = `http://127.0.0.1:${port}`
const env = { PATH: process.env.PATH, HOME: home, DSH_HOME: home, XDG_DATA_HOME: join(home, 'xdg-data'), DSH_TELEMETRY_DISABLED: '1', DSH_COLLAB_DEPENDENCY_ROOT: dirname(modules) }
const help = spawnSync(process.execPath, [bin, '--profile', 'notify-acceptance', '--help'], { cwd: root, env, encoding: 'utf8', timeout: 15000 })
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /--port/)
const hostArgs = [bin, '--profile', 'notify-acceptance', '--port', String(port), '--no-open', ...(help.stdout.includes('--host') ? ['--host', '127.0.0.1'] : [])]
const outcomes = []
let originalLogs
const logHashes = async () => {
  const names = (await readdir(ledger)).filter(name => name.endsWith('.jsonl')).sort()
  const entries = await Promise.all(names.map(async name => [name, createHash('sha256').update(await readFile(join(ledger, name))).digest('hex')]))
  return Object.fromEntries(entries)
}
for (const replay of [false, true]) {
  const ready = join(root, replay ? 'replay.json' : 'ready.json'), failed = join(root, replay ? 'replay-failed.txt' : 'failed.txt')
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([
    { id: 'agent-default-model', config: { provider: 'scripted', model: 'scripted' } },
    { insert: [
      { id: 'dsh-collab', name: pathToFileURL(join(deployment, 'lib/index.js')).href, config: { dataDir: ledger, admission: 'allowlist', allowedSessionIds: ['notify-preview-sender', 'notify-preview-target'], memberTrust: true } },
      { id: 'notify-check', name: new URL('./support/notify-preview-check.mjs', import.meta.url).href, config: { root: home, first, ready, failed, replay } },
    ] },
  ]))
  const child = spawn(process.execPath, hostArgs, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes })
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) })
  try {
    const deadline = Date.now() + 45000
    let observed
    while (Date.now() < deadline) {
      try { throw new Error(await readFile(failed, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      try { observed = JSON.parse(await readFile(ready, 'utf8')); break } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`official Host exited before acceptance: ${JSON.stringify(await exit)}`)
      await pause(50)
    }
    assert.ok(observed, 'official Host acceptance deadline exceeded')
    const anonymous = await fetch(url, { signal: AbortSignal.timeout(5000) })
    assert.equal(anonymous.status, 401, 'fresh native Web entry requires authentication')
    const bootstrapUrl = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0]
    assert.ok(bootstrapUrl, 'native CLI must publish its own temporary login entry')
    const bootstrap = await fetch(bootstrapUrl, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    assert.ok([200, 302, 303].includes(bootstrap.status), `temporary Web login failed: ${bootstrap.status}`)
    const cookie = bootstrap.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const response = bootstrap.status === 200 ? bootstrap : await fetch(url, { headers: { cookie }, signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /__DSH_BOOT__/)
    assert.ok(!html.includes('PRIVATE_RESULT_BODY'))
    outcomes.push({ phase: replay ? 'restart' : 'first', ...observed, httpStatus: response.status, nativeBootPresent: true })
    if (!replay) originalLogs = await logHashes()
    else assert.deepEqual(await logHashes(), originalLogs, 'replaying original receipt after Host restart must preserve ledger bytes')
  } catch (error) {
    await writeFile(join(root, 'host-output.txt'), output.replace(/([?&](?:token|key|auth)[^=]*=)[^&\s]+/gi, '$1[redacted]'))
    console.error(`Isolated evidence: ${root}`)
    // No account/provider is configured, but keep even local bootstrap tokens out of tool output.
    console.error(output.slice(-10000).replace(/([?&](?:token|key|auth)[^=]*=)[^&\s]+/gi, '$1[redacted]'))
    throw error
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    let timer
    try {
      const stopped = await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('isolated Host did not stop within 15s')), 15000) })])
      assert.deepEqual(stopped, { code: 0, signal: null })
    } finally {
      clearTimeout(timer)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exit
    }
  }
  assert.equal((await readdir(ledger)).filter(name => name.endsWith('.lock')).length, 0, 'graceful Host shutdown releases ledger locks')
}
const report = { officialVersion: cliManifest.version, cliSha256: createHash('sha256').update(await readFile(bin)).digest('hex'), consumerSha256: createHash('sha256').update(await readFile(join(deployment, 'lib/index.js'))).digest('hex'), url, root, outcomes, logBytesStableAcrossRestart: true, gracefulStops: 2, productionTouched: false }
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
