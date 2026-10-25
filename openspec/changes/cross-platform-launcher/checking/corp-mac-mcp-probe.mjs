// Reuse only already-installed isolated candidate packages; no download/config/Host.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const root='/private/tmp/ohmydsh-macos-acceptance-sDkoXh8y'
if(process.platform!=='darwin')throw Error('Isolated macOS probe only')
const repo=path.join(root,'repo'),probe=await fs.mkdtemp(path.join(root,'mcp-seam-'))
await fs.mkdir(path.join(probe,'fixtures'))
await fs.copyFile(path.join(repo,'tests/dsh-mcp-client-seam.test.mjs'),path.join(probe,'seam.test.mjs'))
await fs.copyFile(path.join(repo,'tests/fixtures/mock-typed-mcp-server.mjs'),path.join(probe,'fixtures/mock-typed-mcp-server.mjs'))
await fs.mkdir(path.join(probe,'node_modules/@deepseek-ai'),{recursive:true})
const profile=createRequire(path.join(root,'home/dsh/profiles/web/package.json'))
const fromRepo=createRequire(path.join(repo,'package.json'))
const official=createRequire(path.join(root,'npm-cache/_npx/7eff65a5cfe9d1d1/package.json'))
if(process.argv.includes('--inspect')){
 const bridge=JSON.parse(await fs.readFile(profile.resolve('@deepseek-ai/dsh-mcp-client/package.json'),'utf8'))
 console.log(JSON.stringify({dependencies:bridge.dependencies,peerDependencies:bridge.peerDependencies}))
 for(const name of Object.keys({...bridge.dependencies,...bridge.peerDependencies})){
  for(const [source,r] of [['repo',fromRepo],['official',official]]){try{console.log(JSON.stringify({source,name,file:r.resolve(name+'/package.json')}))}catch(e){console.log(JSON.stringify({source,name,error:e.code}))}}
 }
 process.exit(0)
}
const officialModules=path.join(root,'npm-cache/_npx/7eff65a5cfe9d1d1/node_modules')
for(const entry of await fs.readdir(officialModules,{withFileTypes:true})){
 if(entry.name.startsWith('.'))continue
 if(entry.name.startsWith('@')){
  await fs.mkdir(path.join(probe,'node_modules',entry.name),{recursive:true})
  for(const child of await fs.readdir(path.join(officialModules,entry.name))){
   if(entry.name==='@deepseek-ai'&&child==='dsh-mcp-client')continue
   await fs.symlink(path.join(officialModules,entry.name,child),path.join(probe,'node_modules',entry.name,child),'dir')
  }
 }else await fs.symlink(path.join(officialModules,entry.name),path.join(probe,'node_modules',entry.name),'dir')
}
const bridgeDir=path.dirname(profile.resolve('@deepseek-ai/dsh-mcp-client/package.json'))
await fs.cp(bridgeDir,path.join(probe,'node_modules/@deepseek-ai/dsh-mcp-client'),{recursive:true,dereference:true})
// Preflight import separately: a nested missing peer must not turn into a passing skip.
await import(new URL('./node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js','file://'+probe+'/'))
console.log('BRIDGE_IMPORT_WITH_OFFICIAL_PEERS_OK')
const r=spawnSync(process.execPath,['--test','--test-timeout=20000',path.join(probe,'seam.test.mjs')],{cwd:probe,env:{...process.env,HOME:path.join(root,'home'),DSH_HOME:path.join(root,'home/dsh'),DSH_LOCAL_MANIFEST:path.join(root,'absent-overlay.yaml')},encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024})
await fs.writeFile(path.join(root,'logs/mcp-seam.log'),(r.stdout||'')+'\n'+(r.stderr||''))
console.log(r.stdout);console.error(r.stderr);process.exitCode=r.status??1
