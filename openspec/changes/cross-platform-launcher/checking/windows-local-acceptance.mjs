// Native Windows local acceptance, explicitly authorized 2026-10-25.
// Config bodies and subprocess output stay local; print bounded failure diagnostics only.
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import net from 'node:net'
if (process.platform !== 'win32') throw new Error('Requires native Windows Node')
const repo = 'D:\\opensource\\ohmydsh'
const mode = process.argv[2] || 'preflight'
const { loadEnvironment } = await import(pathToFileURL(path.join(repo, 'scripts/launcher/environment.mjs')))
const { default: managers } = await import(pathToFileURL(path.join(repo, 'scripts/lib/package-manager.cjs')))
const { default: YAML } = await import(pathToFileURL(path.join(repo, 'node_modules/yaml/dist/index.js')))
const caller = { ...process.env, DSH_SKIP_UPDATE: '1' }
delete caller.DSH_BIN
const { env, npmEnv, home } = loadEnvironment(repo, caller)
const tools = path.join(repo, 'node_modules/.launcher-tools')
for (const target of [env, npmEnv]) {
  target.DSH_SKIP_UPDATE = '1'
  // Let the shared resolver discover the deliberately local pnpm JS package.
  target.npm_config_prefix = tools
  const pathKeys = Object.keys(target).filter(key => key.toLowerCase() === 'path')
  const inheritedPath = target[pathKeys[0]] || ''
  for (const key of pathKeys) delete target[key]
  target.PATH = [path.dirname(process.execPath), path.join(tools, 'node_modules/.bin'), inheritedPath].join(path.delimiter)
}
if (!path.isAbsolute(home) || home.startsWith('\\\\')) throw new Error('Expected ordinary native Windows local profile')
const profile = path.join(home, 'profiles', env.DSH_PROFILE || 'web')
const policy = path.join(profile, 'pnpm-workspace.yaml')
console.log(JSON.stringify({ mode, platform: process.platform, node: process.version, repo, home, profile }))
function run(label, command, args, { quiet = false, timeout = 1_200_000 } = {}) {
  const r = spawnSync(command, args, { cwd: repo, env: npmEnv, shell: false, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  console.log(JSON.stringify({ label, status: r.status, signal: r.signal, error: r.error?.code }))
  if (r.status !== 0) {
    if (quiet) console.error((r.stderr || '').split(/\r?\n/).filter(line => /ERR_|ERROR|error:|Error:|Cannot|failed|not found/i.test(line)).slice(0, 15).join('\n').slice(0, 5000))
    if (!quiet) {
      const output = (r.stdout || '') + '\n' + (r.stderr || '')
      console.error(output.split(/\r?\n/).filter(line => /ERR_|ERROR|error:|Error:|failed/i.test(line)).slice(0, 12).join('\n').slice(0, 6000))
      console.error((r.stderr || '').slice(-5000))
    }
    throw new Error(`${label} failed; config body is not printed`)
  }
  return r
}
const npm = managers.resolvePackageManager('npm', { env: npmEnv })
if (mode === 'existing-builder-policy') {
  const graph = path.join(repo, 'packages/dsh-pet/compat/subagent/.launcher')
  const pkg = JSON.parse(await fs.readFile(path.join(graph, 'package.json'), 'utf8'))
  console.log(JSON.stringify({ allowScripts: pkg.allowScripts, config: pkg.config, packageManager: pkg.packageManager, corepackHome: npmEnv.COREPACK_HOME, corepackEntry: managers.resolvePackageManager('corepack', { env: npmEnv }) }))
  for (const base of [path.join(process.env.LOCALAPPDATA, 'node/corepack/v1/npm/11.19.0'), path.join(process.env.LOCALAPPDATA, 'node/corepack/v1/npm/11.19.0/node_modules/npm')]) {
    const file = path.join(base, 'docs/lib/content/configuring-npm/package-json.md')
    const text = await fs.readFile(file, 'utf8').catch(() => '')
    console.log(JSON.stringify({ cachedNpmDoc: file, found: text.length > 0 }))
    const start = text.toLowerCase().indexOf('allowscripts')
    if (start >= 0) console.log(text.slice(start, text.indexOf('\n### ', start + 5) < 0 ? start + 9000 : text.indexOf('\n### ', start + 5)))
  }
} else if (mode === 'graph-import-order') {
  const { createRequire } = await import('node:module')
  const graph = path.join(repo, 'packages/dsh-pet/compat/subagent/.launcher')
  const req = createRequire(path.join(graph, 'package.json'))
  await Promise.all(['cordis', 'dsh-agent', 'dsh-session', 'dsh-llm', 'dsh-tools', 'dsh-system-prompt', 'dsh-session-projection', 'dsh-agent-loop'].map(name => import(pathToFileURL(req.resolve('@deepseek-ai/' + name)))))
  const pkg = req.resolve('@deepseek-ai/dsh-subagent/package.json')
  console.log(JSON.stringify({ graph, pkg, physicalPkg: await fs.realpath(pkg), loop: req.resolve('@deepseek-ai/dsh-agent-loop'), nestedLoop: createRequire(pkg).resolve('@deepseek-ai/dsh-agent-loop') }))
} else if (mode === 'graph-verifier-control') {
  const graph = path.join(repo, 'packages/dsh-pet/compat/subagent/.launcher')
  const physical = await fs.realpath(graph)
  for (const [label, base] of [['logical', graph], ['physical', physical]]) {
    const result = spawnSync(process.execPath, [path.join(repo, 'packages/dsh-pet/compat/subagent/verify-isolated-loop.mjs'), '--graph', base], { cwd: repo, env: npmEnv, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
    console.log(JSON.stringify({ label, status: result.status, error: result.error?.code, diagnostics: (result.stderr || '').slice(-6000) }))
    if (result.status !== 0) process.exitCode = 1
  }
} else if (mode === 'graph-diagnostic') {
  const root = path.join(repo, 'packages/dsh-pet/compat/subagent')
  const graph = path.join(root, '.launcher')
  const { realpathSync } = await import('node:fs')
  const { createRequire } = await import('node:module')
  for (const base of [graph, await fs.realpath(graph).catch(() => null)].filter(Boolean)) {
    try {
      const req = createRequire(path.join(base, 'package.json'))
      const pkg = req.resolve('@deepseek-ai/dsh-subagent/package.json')
      const physicalPkg = realpathSync(pkg)
      const loop = realpathSync(req.resolve('@deepseek-ai/dsh-agent-loop'))
      const nestedLoop = realpathSync(createRequire(pkg).resolve('@deepseek-ai/dsh-agent-loop'))
      const physicalNestedLoop = realpathSync(createRequire(physicalPkg).resolve('@deepseek-ai/dsh-agent-loop'))
      console.log(JSON.stringify({ base, pkg, physicalPkg, loop, nestedLoop, physicalNestedLoop, same: loop === nestedLoop, physicalSame: loop === physicalNestedLoop }))
      for (const name of ['cordis', 'dsh-agent', 'dsh-session', 'dsh-llm', 'dsh-tools', 'dsh-system-prompt', 'dsh-session-projection', 'dsh-agent-loop']) await import(pathToFileURL(req.resolve('@deepseek-ai/' + name)))
      const pkgAfterImports = req.resolve('@deepseek-ai/dsh-subagent/package.json')
      console.log(JSON.stringify({ afterImports: true, pkgAfterImports, nestedLoop: realpathSync(createRequire(pkgAfterImports).resolve('@deepseek-ai/dsh-agent-loop')), loop: realpathSync(req.resolve('@deepseek-ai/dsh-agent-loop')) }))
    } catch (error) { console.log(JSON.stringify({ base, error: error.code || error.message })) }
  }
} else if (mode === 'process-diagnostic') {
  const ps = "$items=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe'} | Select-Object ProcessId,ParentProcessId,CommandLine);ConvertTo-Json -InputObject $items -Compress"
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { env: npmEnv, encoding: 'utf8' })
  const all = JSON.parse(result.stdout)
  const own = new Set([34548])
  for (let i = 0; i < all.length; i++) for (const row of all) if (own.has(row.ParentProcessId)) own.add(row.ProcessId)
  for (const row of all.filter(row => own.has(row.ProcessId))) console.log(JSON.stringify({ pid: row.ProcessId, parent: row.ParentProcessId, command: row.CommandLine.replace(/((?:token|password|secret|authorization)[=: ]+)[^ ,]+/gi, '$1[REDACTED]').slice(0, 1200) }))
} else if (mode === 'build-progress') {
  const root = path.join(profile, '.plugin-manager/logs')
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const entries = await Promise.all(dirs.filter(x => x.isDirectory()).map(async x => ({ dir: path.join(root, x.name), mtime: (await fs.stat(path.join(root, x.name))).mtimeMs })))
  for (const item of entries.sort((a, b) => b.mtime - a.mtime).slice(0, 3)) {
    const log = await fs.readFile(path.join(item.dir, 'pnpm.log'), 'utf8').catch(() => '')
    console.log(JSON.stringify({ operation: path.basename(item.dir), modifiedAt: new Date(item.mtime).toISOString(), bytes: log.length, errors: log.split(/\r?\n/).filter(line => /ERR_|ERROR|error:|Error:|Ignored build scripts|ECONN|ETIMEDOUT/.test(line)).slice(-8) }))
  }
} else if (mode === 'path-control') {
  const key = Object.keys(caller).find(key => key.toLowerCase() === 'path')
  const original = spawnSync('node.exe', ['--version'], { cwd: repo, env: caller, encoding: 'utf8', shell: false })
  const fixed = run('fixed-path-node', 'node.exe', ['--version'])
  console.log(JSON.stringify({ originalPathKey: key, originalStatus: original.status, originalError: original.error?.code, fixedVersion: fixed.stdout.trim(), fixedPathKeyCount: Object.keys(npmEnv).filter(key => key.toLowerCase() === 'path').length }))
} else if (mode === 'native-installer-diagnostic') {
  // One diagnostic channel only: expose install-script stderr instead of repeating
  // the opaque launcher -> npx -> pnpm fallback chain. No new script approvals.
  run('npm-cold-cli-foreground-diagnostic', npm.command, [...npm.argsPrefix, 'exec', '--foreground-scripts', '--yes', '--', '@deepseek-ai/dsh@0.2.0-rc.2', '--version'], { timeout: 240_000 })
} else if (mode === 'native-module-inspection') {
  for (const root of [path.join(process.env.LOCALAPPDATA, 'npm-cache/_npx'), path.join(process.env.USERPROFILE, '.npm/_npx'), path.join(process.env.USERPROFILE, '.cache/ohmydsh/dsh-cli')]) {
    const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const dir of dirs.filter(item => item.isDirectory())) {
      const base = path.join(root, dir.name)
      for (const name of ['koffi', 'node-pty', '@deepseek-ai/dsh']) {
        const packageFile = path.join(base, 'node_modules', name, 'package.json')
        const pkg = await fs.readFile(packageFile, 'utf8').then(JSON.parse).catch(() => null)
        if (pkg) console.log(JSON.stringify({ packageFile, name: pkg.name, version: pkg.version, scripts: pkg.scripts, optionalDependencies: pkg.optionalDependencies }))
      }
    }
  }
} else if (mode === 'installer-diagnostics') {
  const file = path.join(process.env.LOCALAPPDATA, 'npm-cache/_logs/2026-10-24T18_03_26_516Z-debug-0.log')
  const log = await fs.readFile(file, 'utf8')
  const lines = log.split(/\r?\n/).slice(-45).map(line => line.replace(/((?:token|password|secret|authorization)[=: ]+)[^ ,]+/gi, '$1[REDACTED]'))
  console.log(lines.join('\n'))
} else if (mode === 'preflight') {
  console.log(JSON.stringify({ npm, profileExists: await fs.stat(path.join(profile, 'package.json')).then(() => true).catch(() => false) }))
} else if (mode === 'scaffold-diagnostic') {
  run('profile-scaffold-diagnostic', process.execPath, [path.join(repo, 'bin/dsh.mjs'), '--profile', env.DSH_PROFILE || 'web', '--dump-default-config'], { quiet: true })
} else if (mode === 'prepare') {
  run('local-pnpm-install', npm.command, [...npm.argsPrefix, 'install', '--prefix', tools, '--no-audit', '--no-fund', '--ignore-scripts', '--registry=https://registry.npmjs.org/', 'pnpm@11.7.0'])
  const pnpmEntry = path.join(tools, 'node_modules/pnpm/bin/pnpm.cjs')
  const pkg = JSON.parse(await fs.readFile(path.join(tools, 'node_modules/pnpm/package.json'), 'utf8'))
  if (pkg.name !== 'pnpm' || pkg.version !== '11.7.0') throw new Error('Unexpected local tool package identity')
  const version = run('pnpm-version', process.execPath, [pnpmEntry, '--version'])
  console.log(JSON.stringify({ localPnpmVersion: version.stdout.trim() }))
  if (version.stdout.trim() !== '11.7.0') throw new Error('Unexpected pnpm version')
  run('profile-scaffold', process.execPath, [path.join(repo, 'bin/dsh.mjs'), '--profile', env.DSH_PROFILE || 'web', '--dump-default-config'], { quiet: true })
  const before = await fs.readFile(policy, 'utf8')
  const doc = YAML.parseDocument(before)
  if (doc.errors.length) throw new Error('Existing pnpm policy is unreadable')
  if (doc.has('dangerouslyAllowAllBuilds') && doc.get('dangerouslyAllowAllBuilds') === true) throw new Error('Existing allow-all policy requires review')
  if (!doc.has('allowBuilds')) doc.set('allowBuilds', doc.createNode({}))
  if (!YAML.isMap(doc.get('allowBuilds'))) throw new Error('Existing allowBuilds is not a map; preserve and review')
  for (const name of ['@google/genai@1.52.0', 'protobufjs@7.6.6']) {
    const old = doc.getIn(['allowBuilds', name])
    if (old === true) throw new Error(`Existing exact allow conflicts: ${name}`)
    doc.setIn(['allowBuilds', name], false)
  }
  const after = String(doc)
  if (after !== before) await fs.writeFile(policy, after)
  console.log(JSON.stringify({ policy, changed: after !== before, exactDenials: { '@google/genai@1.52.0': false, 'protobufjs@7.6.6': false }, existingKeysPreserved: true }))
} else if (mode === 'build-1' || mode === 'build-2' || mode === 'build-noop-diagnostic') {
  const r = run(mode, process.execPath, [path.join(repo, 'bin/dsh.mjs'), 'build', '--no-open'])
  console.log((r.stdout || '').split(/\r?\n/).filter(line => /^\[sync\]/.test(line)).join('\n'))
  if (mode !== 'build-1') {
    const { assertSecondBuildNoop } = await import(new URL('./full-gate-assertions.mjs', import.meta.url))
    assertSecondBuildNoop(r)
    console.log('SECOND_BUILD_NOOP_CONFIRMED')
  }
} else if (mode === 'host-lifecycle') {
  const { probePort, stopServer, sameProcessIdentity } = await import(pathToFileURL(path.join(repo, 'scripts/launcher/process.mjs')))
  const server = net.createServer().listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  if (port === 3080 || (await probePort(port, { env: npmEnv })).state !== 'empty') throw new Error('Unsafe test port')
  console.log(JSON.stringify({ stage: 'host-test-port', port }))
  let owner
  try {
    run('host-start', process.execPath, [path.join(repo, 'bin/dsh.mjs'), '--no-open', '--port', String(port)])
    const before = await probePort(port, { env: npmEnv })
    if (before.state !== 'owned' || before.processes.length !== 1) throw new Error('Host owner not proven')
    owner = before.processes[0]
    await new Promise(resolve => setTimeout(resolve, 2000))
    const after = await probePort(port, { env: npmEnv })
    if (after.state !== 'owned' || !sameProcessIdentity(after.processes[0], owner)) throw new Error('Host did not survive launcher exit')
    console.log(JSON.stringify({ stage: 'host-survives-launcher-exit', pid: owner.pid, state: after.state }))
    run('host-stop', process.execPath, [path.join(repo, 'bin/dsh.mjs'), 'stop', '--port', String(port)])
    if ((await probePort(port, { env: npmEnv })).state !== 'empty') throw new Error('Host stop left listener')
    console.log('NATIVE_FULL_PROFILE_HOST_START_SURVIVE_STOP_PASS')
  } finally {
    const current = await probePort(port, { env: npmEnv })
    if (current.state === 'owned' && owner && current.processes.every(item => sameProcessIdentity(item, owner))) {
      const stopped = await stopServer(port, { env: npmEnv })
      if (!stopped.ok) throw new Error('Owned acceptance Host cleanup failed')
    } else if (current.state !== 'empty') throw new Error('Unknown test listener; refusing cleanup')
  }
} else if (mode === 'console-close') {
  run('real-console-close', process.execPath, ['--test', 'tests/platform/launcher-terminal.test.mjs'], { timeout: 120_000 })
} else if (mode === 'doctor') {
  run('doctor-check', process.execPath, [path.join(repo, 'bin/dsh.mjs'), 'doctor', '--check'])
} else if (mode === 'dump') {
  run('dump', process.execPath, [path.join(repo, 'bin/dsh.mjs'), '--profile', env.DSH_PROFILE || 'web', '--dump-config'], { quiet: true })
} else throw new Error('Unknown stage')
