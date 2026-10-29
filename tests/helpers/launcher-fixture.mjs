// P2 command fixture: copy the frozen oracle unchanged; replace only explicit
// subprocess entrypoints with independent Node recorders, never source text.
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile, chmod, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const BASH_BASELINE = path.join(ROOT, 'tests/fixtures/launcher-bash-baseline')

// This dispatcher belongs to the fixture, not the product. Config comes from a
// file so Host npm-env stripping cannot accidentally disable test isolation.
const RECORDER = `import fs from 'node:fs'
import path from 'node:path'
const root = path.dirname(path.dirname(process.argv[1]))
const scenario = JSON.parse(fs.readFileSync(path.join(root, 'scenario.json'), 'utf8'))
const command = path.basename(process.argv[1]).replace(/\\.mjs$/, '')
const argv = process.argv.slice(2)
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(DSH_|npm_|NPM_|FIXTURE_USER)/.test(key)))
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify({command,argv,cwd:process.cwd(),env})+'\\n')
if (command === 'check-update') {
  if (argv[0] === '--rewrite-to') {
    const manifest = path.join(root,'dsh.yaml')
    const source = fs.readFileSync(manifest,'utf8')
    fs.writeFileSync(manifest+'.bak',source)
    fs.writeFileSync(manifest,source.replace(/^dshVersion:.*$/m,'dshVersion: '+argv[1]))
    console.log('wrote dsh.yaml')
  } else console.log(JSON.stringify(scenario.update ?? {enabled:false,status:'no-update',current:'0.2.0-rc.2',latest:'0.2.0-rc.2',channel:'latest'}))
} else if (command === 'dsh-server-bin') {
  if (scenario.resolveNoise) console.log('fixture installer output: not a path')
  console.log('DSH_SERVER_BIN='+path.join(root,'scripts','runtime.mjs'))
  console.log('DSH_RUNTIME_KIND=fixture')
  console.log('DSH_RUNTIME_OWNER=fixture-owner')
  console.log('DSH_RUNTIME_COMPAT=fixture-compat')
  console.log('DSH_RUNTIME_FINGERPRINT=fixture-fingerprint')
} else if (command === 'plugin-list') console.log('fixture-plugin')
else if (command === 'git' && argv.includes('status') && scenario.dirty) console.log(' M fixture-dirty')
else if (command === 'git' && argv.includes('commit') && scenario.gitCommitExit) process.exit(scenario.gitCommitExit)
else if (command === 'nc') process.exit(scenario.portUp ? 0 : 1)
else if (command === 'lsof' || command === 'pgrep' || command === 'lsappinfo') process.exit(1)
else if (['npm','npx','pnpm','corepack'].includes(command)) {console.error('fixture refuses real package-manager execution');process.exit(91)}
process.exit(scenario.exit?.[command] ?? 0)
`

export async function createLauncherFixture(t, { scenario = {}, manifest, adapter = 'node' } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ohmydsh contract 中文 ')))
  const repo = root
  const home = path.join(root, 'home')
  const tools = path.join(root, 'tools')
  const userCwd = path.join(root, 'external cwd')
  const scenarioFile = path.join(root, 'scenario.json')
  const logFile = path.join(root, 'calls.jsonl')
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(BASH_BASELINE, repo, { recursive: true })
  if (adapter === 'node') {
    await cp(path.join(ROOT, 'scripts/launcher'), path.join(repo, 'scripts/launcher'), { recursive: true, filter: source => !source.endsWith('.sh') })
    await cp(path.join(ROOT, 'scripts/lib'), path.join(repo, 'scripts/lib'), { recursive: true })
    await writeFile(path.join(repo, 'node-harness.mjs'), `import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';\nconst repo=path.dirname(fileURLToPath(import.meta.url));const {runLauncher}=await import(new URL('./scripts/launcher/main.mjs',import.meta.url));\nconst get=()=>JSON.parse(fs.readFileSync(path.join(repo,'scenario.json'),'utf8'));const probe=async()=>({state:get().portUp?'owned':'empty',processes:[]});const stop=async()=>{fs.appendFileSync(path.join(repo,'calls.jsonl'),JSON.stringify({command:'lsof',argv:[],cwd:process.cwd(),env:{}})+'\\n');return {ok:true,state:'empty'}};\ntry{process.exitCode=await runLauncher(process.argv.slice(2),{repo,probe,stop,platform:'linux',sessionContext:'external'})}catch(e){console.error('error: '+e.message);process.exitCode=1}\n`)
  }
  for (const dir of [home, tools, userCwd]) await mkdir(dir, { recursive: true })
  await writeFile(path.join(repo, 'package.json'), '{"name":"launcher-contract-fixture","private":true,"type":"module"}\n')
  await writeFile(path.join(repo, 'dsh.yaml'), manifest ?? 'dshVersion: 0.2.0-rc.2\nautoUpdate:\n  enabled: false\nweb:\n  open: false\ncustomizations: []\n')
  await writeFile(path.join(repo, '.npmrc'), 'registry=https://fixture.registry.invalid/\n')
  await writeFile(scenarioFile, JSON.stringify(scenario))
  await symlink(path.join(ROOT, 'node_modules'), path.join(repo, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  for (const command of ['sync','host-prerequisites','check-update','plugin-update','plugin-list','dsh-server-bin','dsh-cli','runtime']) {
    await writeFile(path.join(repo, 'scripts', command + '.mjs'), RECORDER)
  }
  // POSIX shebangs are only the historical Bash oracle's tool boundary. Native
  // Windows contracts must use a Node adapter, not these executable fixtures.
  for (const tool of ['git','nc','lsof','ps','pgrep','lsappinfo','osascript','open','xdg-open','npm','npx','pnpm','corepack']) {
    const file = path.join(tools, tool)
    await writeFile(file, `#!${process.execPath}\n${RECORDER}`)
    await chmod(file, 0o755)
  }
  await symlink(process.execPath, path.join(tools, 'node'))
  const env = (extra = {}) => ({
    PATH: tools + path.delimiter + process.env.PATH,
    HOME: home,
    DSH_HOME: home,
    DSH_LOCAL_MANIFEST: path.join(root, 'absent-overlay.yaml'),
    FIXTURE_USER: 'kept',
    ...extra,
  })
  async function execute(command, args, { env: extra = {}, cwd = userCwd, timeoutMs = 5_000 } = {}) {
    await writeFile(logFile, '')
    const result = await new Promise(resolve => {
      const child = spawn(command, args, { cwd, env: env(extra), stdio: ['ignore','pipe','pipe'] })
      let stdout = ''; let stderr = ''; let error
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
      child.once('error', value => { error = value })
      child.once('close', (status, signal) => { clearTimeout(timer); resolve({status,signal,stdout,stderr,error}) })
    })
    const calls = (await readFile(logFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
    return { ...result, calls }
  }
  return {
    root, repo, home, tools, userCwd, scenarioFile, logFile, env,
    run: (argv, options) => adapter === 'bash' ? execute('bash', [path.join(repo, 'bin/dsh'), ...argv], options) : execute(process.execPath, [path.join(repo, 'node-harness.mjs'), ...argv], options),
    bash: (script, args = [], options) => execute('bash', ['--noprofile','--norc','-c', 'REPO="$1"; shift; '+script, 'fixture', repo, ...args], options),
    configure: async patch => {
      scenario = { ...scenario, ...patch }
      await writeFile(scenarioFile, JSON.stringify(scenario))
    },
    read: relative => readFile(path.join(repo, relative), 'utf8'),
    write: async (relative, content) => {
      const file = path.join(repo, relative)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, content)
    },
    exists: relative => existsSync(path.join(repo, relative)),
  }
}
