// Explicit isolated macOS candidate stages; no existing checkout/config/3080 mutations.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
if (process.platform !== 'darwin') throw Error('macOS required')
const root = '/private/tmp/ohmydsh-macos-acceptance-sDkoXh8y'
const repo = path.join(root, 'repo')
const env = { ...process.env, HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'), DSH_HOME: path.join(root, 'home/dsh'), DSH_LOCAL_MANIFEST: path.join(root, 'absent-overlay.yaml'), DSH_SKIP_UPDATE: '1', npm_config_cache: path.join(root, 'npm-cache'), npm_config_userconfig: '/dev/null', npm_config_globalconfig: path.join(root, 'absent-global.npmrc'), npm_config_prefix: path.join(root, 'prefix') }
env.PATH = path.join(root, 'prefix/bin') + path.delimiter + process.env.PATH
env.XDG_CACHE_HOME = path.join(root, 'home/cache')
env.XDG_CONFIG_HOME = path.join(root, 'home/config')
env.COREPACK_HOME = path.join(root, 'corepack-cache')
const mode = process.argv[2]
function run(label, args, timeout = 180000, executable = process.execPath) {
 const r = spawnSync(executable, args, { cwd: repo, env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 })
 fs.writeFileSync(path.join(root, 'logs', label + '.log'), (r.stdout || '') + '\n' + (r.stderr || ''))
 console.log(JSON.stringify({ label, status: r.status, signal: r.signal, error: r.error?.code }))
 if (r.status !== 0) { console.log((r.stderr || '').slice(-5000)); throw Error(label + ' failed') }
 return r
}
const { createRequire } = await import('node:module')
const managers = createRequire(import.meta.url)(path.join(repo, 'scripts/lib/package-manager.cjs'))
const npmCommand = managers.resolvePackageManager('npm', { env })
if (mode === 'tests') {
 run('build-collab', [...npmCommand.argsPrefix, 'run', 'build', '--workspace', 'collab-kernel'], 180000, npmCommand.command)
 run('build-openspec', [...npmCommand.argsPrefix, 'run', 'build', '--workspace', 'dsh-openspec'], 180000, npmCommand.command)
 run('mac-focussed', ['--test', 'tests/compat-launcher-policy.test.mjs', 'tests/compat-launcher-publish.test.mjs', 'tests/dsh-host-runtime.test.mjs', 'tests/launcher-install.test.mjs', 'tests/platform/darwin-launcher.test.mjs', 'tests/platform/launcher-terminal.test.mjs'])
 run('mac-root', ['scripts/test.mjs'], 1800000)
} else if(mode==='root') {
 run('mac-root-final', ['scripts/test.mjs'], 1800000)
} else if(mode==='tools-cli') {
 run('local-pnpm', [...npmCommand.argsPrefix, 'install', '--global', '--prefix', path.join(root, 'prefix'), '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', 'pnpm@11.7.0'], 180000, npmCommand.command)
 const { computeNpxCacheKey } = await import(path.join(repo, 'scripts/lib/dsh-cli.mjs'))
 const cache = path.join(root, 'npm-cache/_npx', computeNpxCacheKey(['@deepseek-ai/dsh@0.2.0-rc.2']))
 fs.mkdirSync(cache, { recursive: true })
 const r = spawnSync(npmCommand.command, [...npmCommand.argsPrefix, 'install', '--prefix', cache, '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', '@deepseek-ai/dsh@0.2.0-rc.2'], { cwd: repo, env, encoding: 'utf8', timeout: 600000, maxBuffer: 32*1024*1024 })
 fs.writeFileSync(path.join(root, 'logs/official-cli-install-noscripts.log'), (r.stdout||'')+'\n'+(r.stderr||''))
 console.log(JSON.stringify({ label: 'official-cli-install-noscripts', status: r.status, cache }))
 if(r.status!==0) throw Error('Official CLI no-script install failed')
 run('official-cli-version', [path.join(cache, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--version'])
 run('isolated-profile-scaffold', [path.join(repo, 'bin/dsh.mjs'), '--profile', 'web', '--dump-default-config'])
} else if(mode==='build-pair') {
 const { pathToFileURL } = await import('node:url')
 const { default: YAML } = await import(pathToFileURL(path.join(repo, 'node_modules/yaml/dist/index.js')))
 const file = path.join(env.DSH_HOME, 'profiles/web/pnpm-workspace.yaml')
 const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'))
 if(doc.errors.length || doc.get('dangerouslyAllowAllBuilds')===true) throw Error('Unexpected profile build policy')
 if(!doc.has('allowBuilds'))doc.set('allowBuilds',doc.createNode({}))
 if(!YAML.isMap(doc.get('allowBuilds')))throw Error('Unexpected allowBuilds format')
 for(const name of ['@google/genai@1.52.0','protobufjs@7.6.6']){
  if(doc.getIn(['allowBuilds',name])===true)throw Error('Existing allow conflicts with reviewed denial')
  doc.setIn(['allowBuilds',name],false)
 }
 fs.writeFileSync(file,String(doc))
 console.log(JSON.stringify({isolatedProfilePolicy:'exact-denials-only',rules:['@google/genai@1.52.0','protobufjs@7.6.6']}))
 run('full-build-1',[path.join(repo,'bin/dsh.mjs'),'build','--no-open'],1800000)
 const result=run('full-build-2',[path.join(repo,'bin/dsh.mjs'),'build','--no-open'],1800000)
 const {assertSecondBuildNoop}=await import(path.join(repo,'openspec/changes/cross-platform-launcher/checking/full-gate-assertions.mjs'))
 assertSecondBuildNoop(result)
 console.log('MAC_SECOND_BUILD_NOOP_CONFIRMED')
 run('full-doctor',[path.join(repo,'bin/dsh.mjs'),'doctor','--check'],300000)
 run('full-dump',[path.join(repo,'bin/dsh.mjs'),'--profile','web','--dump-config'])
} else if(mode==='host') {
 const net=await import('node:net')
 const {pathToFileURL}=await import('node:url')
 const {probePort,stopServer,sameProcessIdentity}=await import(pathToFileURL(path.join(repo,'scripts/launcher/process.mjs')))
 const reservation=net.createServer().listen(0,'127.0.0.1');await new Promise(r=>reservation.once('listening',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r))
 if(port===3080||(await probePort(port,{env})).state!=='empty')throw Error('Unsafe Host test port')
 console.log(JSON.stringify({stage:'host-test-port',port}))
 let owner
 try{
  run('full-host-start',[path.join(repo,'bin/dsh.mjs'),'--port',String(port),'--no-open'],1800000)
  const before=await probePort(port,{env})
  if(before.state!=='owned'||before.processes.length!==1)throw Error('Host owner not proven')
  owner=before.processes[0]
  await new Promise(r=>setTimeout(r,2000))
  const after=await probePort(port,{env})
  if(after.state!=='owned'||!sameProcessIdentity(owner,after.processes[0]))throw Error('Host did not survive launcher exit')
  console.log(JSON.stringify({stage:'same-host-after-launcher-exit',port,pid:owner.pid}))
  // --no-open does not suppress macOS stop UI cleanup. Desktop authority is separate.
  const stopped=await stopServer(port,{env})
  if(!stopped.ok)throw Error('Process-only stop failed: '+stopped.error)
  if((await probePort(port,{env})).state!=='empty')throw Error('Stop left listener')
  console.log('MAC_FULL_PROFILE_HOST_START_SURVIVE_PROCESS_ONLY_STOP_PASS')
 }finally{
  const current=await probePort(port,{env})
  if(current.state==='owned'&&owner&&current.processes.every(p=>sameProcessIdentity(p,owner))){if(!(await stopServer(port,{env})).ok)throw Error('Owned cleanup failed')}
  else if(current.state!=='empty')throw Error('Unknown listener; refusing cleanup')
 }
} else throw Error('Unknown stage')
