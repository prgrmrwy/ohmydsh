// Explicit prepare/execute gate. Preparation snapshots only public files and
// probes tools; execution requires the exact prepared root as a CLI argument.
import { cp, mkdir, mkdtemp, readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertSecondBuildNoop } from './full-gate-assertions.mjs'

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const [mode = 'prepare', value, extra] = process.argv.slice(2)
const allowed = ['bin', 'scripts', 'packages', 'patches', 'skills', 'presets', 'instructions', 'dsh.yaml', 'package.json', 'package-lock.json', '.nvmrc', '.npmrc', 'README.md', 'LICENSE']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const command = (exe, args, options) => spawnSync(exe, args, { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 * 1024, ...options })
function assertRoot(root) {
  if (!path.isAbsolute(root) || !path.basename(root).startsWith('ohmydsh-full-gate-')) throw new Error('Expected exact absolute prepared gate root')
}
function toolchain(env, cwd) {
  const managers = createRequire(import.meta.url)(path.join(source, 'scripts/lib/package-manager.cjs'))
  const found = { node: { command: process.execPath, version: process.version } }
  for (const name of ['npm', 'corepack', 'pnpm']) {
    try {
      const tool = managers.resolvePackageManager(name, { env, cwd })
      if (name === 'pnpm' && tool.argsPrefix.includes('pnpm')) {
        found[name] = { ...tool, note: 'Corepack fallback resolved; do not invoke an unpinned default download during preparation' }
      } else {
        const result = command(tool.command, [...tool.argsPrefix, '--version'], { env, cwd })
        found[name] = { ...tool, status: result.status, version: result.stdout?.trim(), error: result.stderr?.trim() }
      }
    } catch (error) { found[name] = { error: error.message } }
  }
  for (const name of ['git', 'tar']) {
    const result = command(name, ['--version'], { env, cwd })
    found[name] = { status: result.status, version: result.stdout?.split(/\r?\n/)[0], error: result.error?.code }
  }
  return found
}

if (mode === 'prepare') {
  let paths
  if (value) paths = (await readFile(value)).toString().split('\0').filter(Boolean)
  else {
    const result = command('git', ['-C', source, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...allowed])
    if (result.status !== 0) throw new Error('Public source inventory failed')
    paths = result.stdout.split('\0').filter(Boolean)
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-full-gate-'))
  const repo = path.join(root, 'repo')
  const home = path.join(root, 'home')
  for (const dir of [repo, home, path.join(root, 'tools'), path.join(root, 'logs')]) await mkdir(dir, { recursive: true })
  const hashes = {}
  for (const relative of [...new Set(paths)]) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || !allowed.some(item => relative === item || relative.startsWith(item + '/'))) throw new Error('Snapshot file outside public allowlist')
    if (/(^|\/)(?:\.env(?:\.|$)|credentials|secrets|node_modules|\.launcher[^/]*|\.upstream)(\/|$)/i.test(relative)) throw new Error('Excluded local/generated path in snapshot')
    const input = path.join(source, relative)
    if (!existsSync(input)) continue // tracked deletion belongs to the candidate
    if (!(await stat(input)).isFile()) throw new Error('Snapshot requires regular source files')
    const bytes = await readFile(input)
    hashes[relative] = hash(bytes)
    await mkdir(path.dirname(path.join(repo, relative)), { recursive: true })
    await cp(input, path.join(repo, relative))
  }
  const userConfig = path.join(home, 'user.npmrc'); const globalConfig = path.join(home, 'global.npmrc')
  await writeFile(userConfig, ''); await writeFile(globalConfig, '')
  let executablePath
  const env = {
    HOME: home, USERPROFILE: home, DSH_HOME: path.join(home, 'dsh'), DSH_PROFILE: 'web', DSH_LOCAL_MANIFEST: '',
    XDG_DATA_HOME: path.join(home, 'xdg-data'), XDG_CONFIG_HOME: path.join(home, 'xdg-config'), XDG_CACHE_HOME: path.join(home, 'xdg-cache'),
    APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
    TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TMPDIR: path.join(root, 'tmp'),
    npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig, npm_config_prefix: path.join(root, 'tool-prefix'), npm_config_cache: path.join(root, 'npm-cache'),
    COREPACK_HOME: path.join(root, 'corepack-cache'), DSH_SKIP_UPDATE: '1', CI: 'true',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'empty.gitconfig'), GIT_TERMINAL_PROMPT: '0',
  }
  await writeFile(env.GIT_CONFIG_GLOBAL, '')
  await mkdir(env.TEMP)
  if (process.platform === 'win32') {
    const windir = process.env.SystemRoot || 'C:\\Windows'
    env.SystemRoot = windir; env.WINDIR = windir; env.ComSpec = path.join(root, 'tools/cmd.exe'); env.PATHEXT = '.COM;.EXE;.BAT;.CMD'
    for (const name of ['cmd.exe', 'taskkill.exe', 'where.exe', 'tar.exe']) await cp(path.join(windir, 'System32', name), path.join(root, 'tools', name))
    executablePath = [path.dirname(process.execPath), 'D:\\Software\\Git\\cmd', path.join(root, 'tools'), path.join(windir, 'System32/WindowsPowerShell/v1.0')].join(';')
    for (const name of ['bash', 'sh']) if (command(path.join(root, 'tools/where.exe'), [name], { cwd: repo, env: { ...env, PATH: executablePath } }).status === 0) throw new Error('No-Bash preflight failed')
  } else executablePath = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(':')
  env.PATH = executablePath
  const server = net.createServer().listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  if (port === 3080) throw new Error('Reserved production port is forbidden')
  const plan = { root, repo, source, platform: process.platform, port, env, hashes, manifestHash: hashes['dsh.yaml'], lockHash: hashes['package-lock.json'], tools: toolchain(env, repo), preparedAt: new Date().toISOString() }
  await writeFile(path.join(root, 'gate-plan.json'), JSON.stringify(plan, null, 2))
  console.log(JSON.stringify({ ...plan, hashes: { count: Object.keys(hashes).length, manifest: plan.manifestHash, lock: plan.lockHash } }, null, 2))
  console.log(`PREPARED_GATE_ROOT=${root}`)
} else if (mode === 'refresh-final-launcher') {
  assertRoot(value)
  const plan = JSON.parse(await readFile(path.join(value, 'gate-plan.json'), 'utf8'))
  if (extra !== '--approved-exact-root' || plan.root !== value || process.platform !== 'win32') throw new Error('Expected approved Windows root')
  const updated = {}
  for (const name of ['runner', 'main', 'ui', 'process']) {
    const relative = `scripts/launcher/${name}.mjs`
    await cp(path.join(source, relative), path.join(plan.repo, relative))
    updated[relative] = hash(await readFile(path.join(plan.repo, relative)))
    plan.hashes[relative] = updated[relative]
  }
  await writeFile(path.join(value, 'gate-plan.json'), JSON.stringify(plan, null, 2))
  console.log(JSON.stringify({ updated, note: 'Upgraded launcher candidate; existing isolated profile reused, not clean acceptance' }, null, 2))
} else if (mode === 'diagnose-build-once') {
  assertRoot(value)
  const plan = JSON.parse(await readFile(path.join(value, 'gate-plan.json'), 'utf8'))
  if (extra !== '--approved-exact-root' || plan.root !== value || plan.platform !== process.platform) throw new Error('Diagnostic run requires the exact approved root')
  delete plan.env.DSH_SKIP_HOST_PREREQUISITES
  const prefixBin = process.platform === 'win32' ? plan.env.npm_config_prefix : path.join(plan.env.npm_config_prefix, 'bin')
  plan.env.PATH = prefixBin + path.delimiter + plan.env.PATH
  if (hash(await readFile(path.join(plan.repo, 'dsh.yaml'))) !== plan.manifestHash) throw new Error('Public manifest changed')
  const result = command(process.execPath, [path.join(plan.repo, 'bin/dsh.mjs'), 'build', '--no-open'], { cwd: plan.repo, env: plan.env, timeout: 1_200_000 })
  console.log(JSON.stringify({ stage: 'approved-build-1-diagnostic-once', status: result.status, signal: result.signal, error: result.error?.code }))
  const errorLines = ((result.stdout || '') + (result.stderr || '')).split(/\r?\n/).filter(line => /ERROR|ERR_|Error:|error:|error code/i.test(line)).slice(0, 20)
  console.log('FIRST_ERROR_CHAIN\n' + errorLines.join('\n').slice(0, 12_000))
  console.log('STDOUT_TAIL\n' + (result.stdout || '').slice(-16_000))
  console.log('STDERR_TAIL\n' + (result.stderr || '').slice(-12_000))
  process.exitCode = result.status ?? 1
} else if (mode === 'diagnose-win-clean') {
  assertRoot(value)
  const plan = JSON.parse(await readFile(path.join(value, 'gate-plan.json'), 'utf8'))
  if (process.platform !== 'win32' || extra !== '--approved-exact-root') throw new Error('Expected approved Windows root')
  const root = await mkdtemp(path.join(plan.root, 'clean 中文 '))
  for (const name of ['sidebar-session-provider-icon', 'worktree-session', 'cockpit-memex-browse-shim', 'session-title-copy', 'sidebar-session-resources', 'home-network-model-guard', 'system-clock', 'dsh-openspec', 'dsh-memex', 'cockpit-worktree-open-shim', 'dsh-pet']) {
    const cwd = path.join(root, name)
    await mkdir(path.join(cwd, 'lib/nested'), { recursive: true })
    await writeFile(path.join(cwd, 'lib/nested/file'), 'fixture')
    const pkg = JSON.parse(await readFile(path.join(plan.repo, 'packages', name, 'package.json'), 'utf8'))
    const program = /^node -e "((?:\\"|[^"])*)"$/.exec(pkg.scripts.clean)?.[1].replace(/\\"/g, '"')
    const observed = command(process.execPath, ['-e', 'console.log(JSON.stringify({cwd:process.cwd(),before:require("node:fs").existsSync("lib")}));' + program + ';console.log(JSON.stringify({after:require("node:fs").existsSync("lib")}))'], { cwd, env: plan.env })
    console.log(JSON.stringify({ name, cwd, program, status: observed.status, actual: observed.stdout, error: observed.stderr, outerExists: existsSync(path.join(cwd, 'lib')) }))
  }
  for (const label of ['ascii', '中文']) for (const variant of ['relative-force', 'absolute-force', 'relative-no-force', 'absolute-no-force']) {
    const cwd = path.join(root, label, variant)
    await mkdir(path.join(cwd, 'lib/nested'), { recursive: true })
    await writeFile(path.join(cwd, 'lib/nested/file'), 'fixture')
    const program = `const fs=require('node:fs'),path=require('node:path');try{fs.rmSync(${variant.startsWith('absolute') ? "path.resolve('lib')" : "'lib'"},{recursive:true,force:${variant.endsWith('no-force') ? 'false' : 'true'}});console.log(JSON.stringify({exists:fs.existsSync('lib')}))}catch(error){console.log(JSON.stringify({code:error.code,message:error.message}))}`
    const result = command(process.execPath, ['-e', program], { cwd, env: plan.env })
    console.log(JSON.stringify({ label, variant, status: result.status, stdout: result.stdout, stderr: result.stderr }))
  }
  const control = await mkdtemp(path.join(plan.root, 'clean-ascii-'))
  const controlScript = path.join(control, 'control.cjs')
  await writeFile(controlScript, `const fs=require('node:fs'),path=require('node:path');console.log('implementation='+String(fs.rmSync));console.log('node='+process.version);for(const kind of ['rm-file','unlink-file','rmdir-empty','rm-dir','rm-dir-async']){fs.mkdirSync(kind,{recursive:true});if(kind.includes('file'))fs.writeFileSync(path.join(kind,'file'),'x');else if(kind.includes('dir')&&!kind.includes('empty')){fs.mkdirSync(path.join(kind,'nested'));fs.writeFileSync(path.join(kind,'nested/file'),'x')}try{if(kind==='rm-file')fs.rmSync(path.join(kind,'file'));if(kind==='unlink-file')fs.unlinkSync(path.join(kind,'file'));if(kind==='rmdir-empty')fs.rmdirSync(kind);if(kind==='rm-dir')fs.rmSync(kind,{recursive:true});if(kind==='rm-dir-async'){fs.promises.rm(kind,{recursive:true}).then(()=>console.log(kind+':'+fs.existsSync(kind)));continue}console.log(kind+':'+fs.existsSync(kind.includes('file')?path.join(kind,'file'):kind))}catch(e){console.log(kind+':'+e.code+':'+e.message)}}`)
  const controls = command(process.execPath, [controlScript], { cwd: control, env: plan.env })
  console.log(controls.stdout); console.error(controls.stderr)
  const unicodeControl = path.join(control, '中文')
  await mkdir(unicodeControl)
  await cp(controlScript, path.join(unicodeControl, 'control.cjs'))
  const unicodeResult = command(process.execPath, [path.join(unicodeControl, 'control.cjs')], { cwd: unicodeControl, env: plan.env })
  console.log('UNICODE_FILE_CONTROL\\n' + unicodeResult.stdout); console.error(unicodeResult.stderr)
} else if (mode === 'inspect-pnpm-policy') {
  assertRoot(value)
  const plan = JSON.parse(await readFile(path.join(value, 'gate-plan.json'), 'utf8'))
  if (extra !== '--approved-exact-root' || plan.root !== value) throw new Error('Metadata inspection requires approved root')
  const managers = createRequire(import.meta.url)(path.join(plan.repo, 'scripts/lib/package-manager.cjs'))
  const npm = managers.resolvePackageManager('npm', { env: plan.env })
  for (const spec of ['@google/genai@1.52.0', 'protobufjs@7.6.6', 'dsh-magpie-connect@0.4.1', '@earendil-works/pi-ai@0.82.1']) {
    const result = command(npm.command, [...npm.argsPrefix, 'view', spec, 'scripts', 'dependencies', '--json', '--registry=https://registry.npmjs.org/'], { cwd: plan.repo, env: plan.env })
    console.log(JSON.stringify({ spec, status: result.status })); console.log(result.stdout); console.error(result.stderr)
    if (result.status !== 0) process.exitCode = 1
  }
  const npx = path.join(plan.env.npm_config_cache, '_npx')
  const files = []
  async function inspect(dir, depth = 0) {
    if (depth > 12 || !existsSync(dir)) return
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await inspect(file, depth + 1)
      else if (/\\.(?:js|cjs|mjs|json|yaml|yml)$/.test(entry.name) && file.includes('@deepseek-ai') && /plugin|pnpm|package\\.json/.test(file)) {
        if ((await stat(file)).size > 2_000_000) continue
        const text = await readFile(file, 'utf8')
        const lines = text.split(/\\r?\\n/).flatMap((line, index) => /onlyBuiltDependencies|ignoredBuiltDependencies|allowBuilds|approve-builds|dangerouslyAllowAllBuilds|pnpm.*not found/.test(line) ? [`${index + 1}: ${line.slice(0, 1500)}`] : [])
        if (lines.length) files.push({ file: path.relative(npx, file), lines })
      }
    }
  }
  await inspect(npx)
  console.log('OFFICIAL_PLUGIN_POLICY=' + JSON.stringify(files))
} else if (mode === 'refresh-workspace-win') {
  assertRoot(value)
  const plan = JSON.parse(await readFile(path.join(value, 'gate-plan.json'), 'utf8'))
  if (extra !== '--approved-exact-root' || plan.root !== value || process.platform !== 'win32') throw new Error('Workspace refresh requires exact approved Windows root')
  const packages = ['cockpit-memex-browse-shim', 'cockpit-worktree-open-shim', 'collab-kernel', 'dsh-memex', 'dsh-openspec', 'dsh-pet', 'home-network-model-guard', 'session-title-copy', 'sidebar-session-provider-icon', 'sidebar-session-resources', 'system-clock', 'worktree-session']
  const files = [...packages.map(name => `packages/${name}/package.json`), 'packages/collab-kernel/scripts/copy-convention.mjs', 'tests/workspace-lifecycle.test.mjs']
  const refreshed = {}
  for (const relative of files) {
    await mkdir(path.dirname(path.join(plan.repo, relative)), { recursive: true })
    const bytes = await readFile(path.join(source, relative))
    await cp(path.join(source, relative), path.join(plan.repo, relative))
    refreshed[relative] = hash(bytes)
    plan.hashes[relative] = refreshed[relative]
  }
  await writeFile(path.join(value, 'gate-plan.json'), JSON.stringify(plan, null, 2))
  delete plan.env.DSH_SKIP_HOST_PREREQUISITES
  plan.env.PATH = plan.env.npm_config_prefix + ';' + plan.env.PATH
  const test = command(process.execPath, ['--test', 'tests/workspace-lifecycle.test.mjs'], { cwd: plan.repo, env: plan.env })
  console.log(JSON.stringify({ refreshed, manifest: hash(await readFile(path.join(plan.repo, 'dsh.yaml'))), lock: hash(await readFile(path.join(plan.repo, 'package-lock.json'))), testStatus: test.status }, null, 2))
  console.log(test.stdout); console.error(test.stderr)
  process.exitCode = test.status ?? 1
} else if (mode === 'execute' || mode === 'resume-build-with-pnpm' || mode === 'execute-win-refreshed') {
  assertRoot(value)
  const plan = JSON.parse(await readFile(path.join(value, 'gate-plan.json'), 'utf8'))
  if (plan.root !== value || plan.platform !== process.platform || extra !== '--approved-exact-root') throw new Error('Execution requires --approved-exact-root and the matching platform/root')
  // These exact prepared roots were approved with scratch-prefix healing enabled.
  delete plan.env.DSH_SKIP_HOST_PREREQUISITES
  const prefixBin = process.platform === 'win32' ? plan.env.npm_config_prefix : path.join(plan.env.npm_config_prefix, 'bin')
  plan.env.PATH = prefixBin + path.delimiter + plan.env.PATH
  const manifest = path.join(plan.repo, 'dsh.yaml')
  if (hash(await readFile(manifest)) !== plan.manifestHash) throw new Error('Manifest changed after preparation')
  const managers = createRequire(import.meta.url)(path.join(plan.repo, 'scripts/lib/package-manager.cjs'))
  const npm = managers.resolvePackageManager('npm', { env: plan.env })
  const results = []
  const stage = async (name, exe, args, timeout = 1_800_000) => {
    const result = command(exe, args, { cwd: plan.repo, env: plan.env, timeout })
    await writeFile(path.join(value, 'logs', `${name}.log`), (result.stdout || '') + (result.stderr || ''))
    results.push({ name, status: result.status, signal: result.signal, error: result.error?.code })
    await writeFile(path.join(value, 'gate-results.json'), JSON.stringify(results, null, 2))
    console.log(JSON.stringify(results.at(-1)))
    if (result.status !== 0) {
      const output = (result.stdout || '') + (result.stderr || '')
      const firstErrors = output.split(/\r?\n/).filter(line => /ERROR|ERR_|Error:|error:|error code/i.test(line)).slice(0, 15)
      console.error('FIRST_ERROR_CHAIN\n' + firstErrors.join('\n').slice(0, 8_000))
      console.error('BOUNDED_OUTPUT_TAIL\n' + output.slice(-16_000))
      throw new Error(`Gate stopped at ${name}; inspect its temp-only log`)
    }
    if (hash(await readFile(manifest)) !== plan.manifestHash) throw new Error('Public manifest changed during gate')
    return result
  }
  if (mode === 'resume-build-with-pnpm' || mode === 'execute-win-refreshed') {
    await stage('scratch-pnpm-install', npm.command, [...npm.argsPrefix, 'install', '--global', '--prefix', plan.env.npm_config_prefix, '--registry', 'https://registry.npmjs.org/', 'pnpm@11.7.0'])
    const pnpm = managers.resolvePackageManager('pnpm', { env: plan.env })
    await stage('scratch-pnpm-version', pnpm.command, [...pnpm.argsPrefix, '--version'], 30_000)
  }
  if (mode !== 'resume-build-with-pnpm') await stage('root-ci', npm.command, [...npm.argsPrefix, 'ci'])
  const bin = path.join(plan.repo, 'bin/dsh.mjs')
  await stage('build-1', process.execPath, [bin, 'build', '--no-open'])
  assertSecondBuildNoop(await stage('build-2', process.execPath, [bin, 'build', '--no-open']))
  await stage('doctor-check', process.execPath, [bin, 'doctor', '--check'])
  await stage('dump', process.execPath, [bin, '--profile', 'web', '--dump-config'])
  try { await stage('host-start', process.execPath, [bin, '--port', String(plan.port), '--no-open']) }
  finally { await stage('host-stop', process.execPath, [bin, 'stop', '--port', String(plan.port), '--no-open'], 30_000) }
} else throw new Error('Usage: full-manifest-gate.mjs prepare [public-file-list] | execute <exact-root> --approved-exact-root')
