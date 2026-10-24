// Run with native Windows Node; copies public candidate files only to TEMP.
// Never invokes npm installation, a browser, or a production Host.
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('This runner requires native Windows Node')
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-native-'))
const tests = ['package-manager.test.mjs', 'launcher-bootstrap.test.mjs', 'launcher-exec.test.mjs', 'launcher-env-local.test.mjs', 'launcher-environment.test.mjs', 'launcher-args.test.mjs', 'launcher-process.test.mjs', 'launcher-ui.test.mjs', 'launcher-runner.test.mjs', 'launcher-install.test.mjs', 'platform/windows-launcher.test.mjs']
const files = ['package.json', 'package-lock.json', 'bin/dsh.mjs', 'tests/launcher-lifecycle.test.mjs', '.nvmrc', 'scripts/bootstrap.mjs', 'scripts/lib/package-manager.cjs', 'scripts/lib/env-local.mjs', ...['process', 'ui', 'environment', 'args'].map(name => `scripts/launcher/${name}.mjs`), ...tests.map(name => `tests/${name}`)]
const hashes = {}
for (const file of files) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await cp(path.join(source, file), path.join(root, file))
  hashes[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')
}
await cp(path.join(source, 'scripts'), path.join(root, 'scripts'), { recursive: true })
for (const name of ['zx', 'js-yaml', 'yaml', 'semver', 'typescript']) {
  await mkdir(path.join(root, 'node_modules'), { recursive: true })
  await cp(path.join(source, 'node_modules', name), path.join(root, 'node_modules', name), { recursive: true, dereference: true })
}
const home = path.join(root, 'isolated-home')
await mkdir(home)
await writeFile(path.join(home, 'user.npmrc'), '')
await writeFile(path.join(home, 'global.npmrc'), '')
const windir = process.env.SystemRoot || 'C:\\Windows'
const nativeTools = path.join(root, 'native-tools')
await mkdir(nativeTools)
// System32 contains the Windows WSL bash.exe shim on this host. Expose only
// required native tools, not that whole directory, to prove no shell fallback.
for (const tool of ['taskkill.exe', 'where.exe', 'cmd.exe']) await cp(path.join(windir, 'System32', tool), path.join(nativeTools, tool))
const env = {
  SystemRoot: windir, WINDIR: windir, ComSpec: path.join(windir, 'System32/cmd.exe'),
  TEMP: os.tmpdir(), TMP: os.tmpdir(), PATHEXT: '.COM;.EXE;.BAT;.CMD',
  PATH: [path.dirname(process.execPath), 'D:\\Software\\Git\\cmd', nativeTools, path.join(windir, 'System32/WindowsPowerShell/v1.0')].join(';'),
  HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
  npm_config_userconfig: path.join(home, 'user.npmrc'), npm_config_globalconfig: path.join(home, 'global.npmrc'), npm_config_prefix: path.join(root, 'isolated-prefix'),
  DSH_HOME: path.join(home, 'dsh-home'), DSH_LOCAL_MANIFEST: path.join(root, 'absent-overlay.yaml'),
}
for (const command of ['bash', 'sh']) {
  const lookup = spawnSync(path.join(windir, 'System32/where.exe'), [command], { cwd: root, env, encoding: 'utf8' })
  if (lookup.status === 0) throw new Error(`Sanitized PATH unexpectedly resolves ${command}`)
}
const { createRequire } = await import('node:module')
const resolver = createRequire(import.meta.url)(path.join(root, 'scripts/lib/package-manager.cjs'))
let npm
try {
  const command = resolver.resolvePackageManager('npm', { nodePath: process.execPath, platform: 'win32', env })
  npm = spawnSync(command.command, [...command.argsPrefix, '--version'], { cwd: root, env, encoding: 'utf8' })
  console.log(JSON.stringify({ npmCommand: command, npmStatus: npm.status, npmError: npm.stderr }))
} catch (error) { npm = { stdout: '', stderr: error.message }; console.log(JSON.stringify({ npmResolveError: error.message })) }
const git = spawnSync('git.exe', ['--version'], { cwd: root, env, encoding: 'utf8' })
console.log(JSON.stringify({ root, source, platform: process.platform, node: process.version, npm: npm.stdout.trim(), git: git.stdout.trim(), path: env.PATH, hashes }, null, 2))
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => path.join('tests', name))], { cwd: root, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
console.log(result.stdout)
console.error(result.stderr)
await writeFile(path.join(root, 'native-result.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, hashes }, null, 2))
console.log(`NATIVE_RESULT_ROOT=${root}`)
process.exitCode = result.status ?? 1
if (result.status === 0) {
  const { probePort, stopServer } = await import(pathToFileURL(path.join(root, 'scripts/launcher/process.mjs')))
  const runtime = path.join(root, 'owned 中文 space/node_modules/@deepseek-ai/dsh')
  await mkdir(path.join(runtime, 'lib'), { recursive: true })
  await writeFile(path.join(runtime, 'package.json'), '{"name":"@deepseek-ai/dsh","type":"module"}')
  await writeFile(path.join(runtime, 'lib/bin.js'), `import net from 'node:net';net.createServer(c=>c.end()).listen(0,'127.0.0.1',function(){console.log(this.address().port)});`)
  const child = spawn(process.execPath, [path.join(runtime, 'lib/bin.js'), 'web', '--port', '0'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let actualPort
  try {
    const [data] = await once(child.stdout, 'data')
    actualPort = Number(data.toString().trim())
    // First listener deliberately advertises port 0: identity must be refused.
    const mismatch = await probePort(actualPort, { env })
    assert.equal(mismatch.state, 'unknown', mismatch.error)
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const closed = once(child, 'close'); child.kill(); await closed }
  }
  // Reserve then close an ephemeral port before spawning an argv-matching Host.
  const net = await import('node:net')
  const reservation = net.createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  await writeFile(path.join(runtime, 'lib/bin.js'), `import net from 'node:net';net.createServer(c=>c.end()).listen(Number(process.argv.at(-1)),'127.0.0.1',()=>console.log('READY'));`)
  const own = spawn(process.execPath, [path.join(runtime, 'lib/bin.js'), 'web', '--port', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await once(own.stdout, 'data')
    const before = await probePort(port, { env })
    console.log('NATIVE_OWNED_PROBE=' + JSON.stringify(before))
    assert.equal(before.state, 'owned', before.error)
    assert.equal(before.processes[0].pid, own.pid)
    const stopped = await stopServer(port, { env, warn: message => console.log('NATIVE_STOP_WARNING=' + message) })
    console.log('NATIVE_STOP=' + JSON.stringify(stopped))
    assert.equal(stopped.ok, true, stopped.error)
    assert.equal((await probePort(port, { env })).state, 'empty')
  } finally {
    if (own.exitCode === null && own.signalCode === null) { const closed = once(own, 'close'); own.kill(); await closed }
  }
  const lifecycle = spawnSync(process.execPath, ['--test', 'tests/launcher-lifecycle.test.mjs'], { cwd: root, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  console.log('NATIVE_LIFECYCLE_STATUS=' + lifecycle.status)
  console.log(lifecycle.stdout)
  console.error(lifecycle.stderr)
  if (lifecycle.status !== 0) process.exitCode = lifecycle.status ?? 1
  const treeFile = path.join(root, 'tree-pids.json')
  const treeScript = path.join(root, 'owned-tree.cjs')
  await writeFile(treeScript, `const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[2],JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000);`)
  const bounded = spawnSync(process.execPath, ['scripts/lib/run-bounded.mjs'], {
    cwd: root, env, encoding: 'utf8', timeout: 15_000,
    input: JSON.stringify({ command: process.execPath, args: [treeScript, treeFile], cwd: root, timeoutMs: 800, killGraceMs: 1_000 }),
  })
  const pids = JSON.parse(await readFile(treeFile, 'utf8'))
  const alive = pids.filter(pid => { try { process.kill(pid, 0); return true } catch { return false } })
  console.log('NATIVE_BOUNDED=' + JSON.stringify({ status: bounded.status, pids, alive, stderr: bounded.stderr }))
  try { assert.equal(bounded.status, 124); assert.deepEqual(alive, []) }
  finally { for (const pid of alive) { try { process.kill(pid) } catch {} } }
}
