import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(import.meta.dirname,'..')
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(),'ohmydsh closure 中文 '))
  t.after(()=>rm(root,{recursive:true,force:true}))
  await cp(path.join(ROOT,'scripts'),path.join(root,'scripts'),{recursive:true})
  await writeFile(path.join(root,'package.json'),'{"type":"module","private":true}')
  const log = path.join(root,'resolved.jsonl')
  const fake = path.join(root,'npm.cjs')
  await writeFile(fake,`const fs=require('node:fs');const path=require('node:path');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(path.join(root,'executed.jsonl'))},JSON.stringify({argv:a,cwd:process.cwd(),marker:process.env.CLOSURE_MARKER})+'\\n');if(a[0]==='root')console.log(${JSON.stringify(path.join(root,'global'))});else if(a[0]==='config')console.log('https://scope.invalid/');else if(a[0]==='view')console.log(JSON.stringify(a.includes('dist.integrity')?'sha512-fixture':{'dist-tags':{latest:'1.0.0'},time:{},peerDependencies:{}}));`)
  await writeFile(path.join(root,'scripts/lib/package-manager.cjs'),`const fs=require('node:fs');module.exports.resolveExecutable=(command,args,options={})=>{fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({command,args,cwd:options.cwd,marker:options.env?.CLOSURE_MARKER})+'\\n');return command==='npm'||command==='corepack'?{command:process.execPath,args:[${JSON.stringify(fake)},...args]}:{command,args}};`)
  return {root,log, fake,
    records:async()=>JSON.parse('['+(await readFile(log,'utf8')).trim().split('\n').join(',')+']'),
    executed:async()=>JSON.parse('['+(await readFile(path.join(root,'executed.jsonl'),'utf8')).trim().split('\n').join(',')+']'),
  }
}

test('third-party integrity resolves npm to a real argv executable before spawning',async t=>{
  const fx=await fixture(t)
  const {resolveNpmIntegrity}=await import(pathToFileURL(path.join(fx.root,'scripts/lib/third-party-resources.mjs')))
  const calls=[]
  assert.equal(resolveNpmIntegrity({spec:'@example/a@1.0.0'},{spawn:(command,args)=>{calls.push({command,args});return {status:0,stdout:'"sha512-fixture"'}}}),'sha512-fixture')
  assert.deepEqual(calls,[{command:process.execPath,args:[fx.fake,'view','@example/a@1.0.0','dist.integrity','--json']}])
  assert.deepEqual((await fx.records()).map(({command,args})=>({command,args})),[{command:'npm',args:['view','@example/a@1.0.0','dist.integrity','--json']}])
})

test('scoped plugin metadata keeps asynchronous npm execution in authenticated profile cwd',async t=>{
  const fx=await fixture(t)
  // Only manifest-overlay needs YAML; copy the installed parser, not config.
  await cp(path.join(ROOT,'node_modules/js-yaml'),path.join(fx.root,'node_modules/js-yaml'),{recursive:true})
  const profile=path.join(fx.root,'profile space')
  await mkdir(profile)
  await writeFile(path.join(fx.root,'dsh.yaml'),"dshVersion: 0.2.0-rc.2\ncustomizations:\n  - id: a\n    type: package\n    source: remote\n    spec: '@example/a@1.0.0'\n    version: 1.0.0\n    enabled: true\n")
  const {detectRemotePluginUpdates}=await import(pathToFileURL(path.join(fx.root,'scripts/lib/plugin-updates.mjs')))
  const result=await detectRemotePluginUpdates({manifestPath:path.join(fx.root,'dsh.yaml'),repo:fx.root,profileDir:profile,env:{...process.env,DSH_LOCAL_MANIFEST:'',CLOSURE_MARKER:'scope'}})
  assert.equal(result.rows[0].status,'up-to-date')
  const resolved=await fx.records()
  assert.equal(resolved.length,2)
  assert.ok(resolved.every(call=>call.cwd===profile&&call.marker==='scope'))
  assert.ok((await fx.executed()).every(call=>call.cwd===profile&&call.marker==='scope'))
})

test('host prerequisites global probe uses shared argv resolver and never a shim',async t=>{
  const fx=await fixture(t)
  await cp(path.join(ROOT,'node_modules/js-yaml'),path.join(fx.root,'node_modules/js-yaml'),{recursive:true})
  await mkdir(path.join(fx.root,'global/@example/kernel'),{recursive:true})
  await writeFile(path.join(fx.root,'global/@example/kernel/package.json'),'{"name":"@example/kernel","version":"1.0.0"}')
  await writeFile(path.join(fx.root,'dsh.yaml'),"dshVersion: 0.2.0-rc.2\ncustomizations:\n  - id: kernel\n    type: package\n    source: remote\n    spec: '@example/plugin@1.0.0'\n    version: 1.0.0\n    enabled: true\n    hostPrerequisites:\n      - kind: npm-global\n        package: '@example/kernel'\n        version: 1.0.0\n")
  const result=spawnSync(process.execPath,[path.join(fx.root,'scripts/host-prerequisites.mjs'),'--check','--repo',fx.root],{encoding:'utf8',env:{...process.env,DSH_LOCAL_MANIFEST:'',CLOSURE_MARKER:'prereq'}})
  assert.equal(result.status,0,result.stderr)
  assert.ok((await fx.records()).some(call=>call.command==='npm'&&call.args.join(' ')==='root -g'))
})

test('host prerequisite install resolution failure is diagnostic rather than an uncaught stack',async t=>{
  const fx=await fixture(t)
  await cp(path.join(ROOT,'node_modules/js-yaml'),path.join(fx.root,'node_modules/js-yaml'),{recursive:true})
  await writeFile(path.join(fx.root,'scripts/lib/package-manager.cjs'),`module.exports.resolveExecutable=(command,args)=>{if(args[0]==='install')throw new Error('fixture unsupported npm layout');return {command:process.execPath,args:[${JSON.stringify(fx.fake)},...args]}}`)
  await writeFile(path.join(fx.root,'dsh.yaml'),"dshVersion: 0.2.0-rc.2\ncustomizations:\n  - id: kernel\n    type: package\n    source: remote\n    spec: '@example/plugin@1.0.0'\n    version: 1.0.0\n    enabled: true\n    hostPrerequisites:\n      - kind: npm-global\n        package: '@example/kernel'\n        version: 1.0.0\n")
  const result=spawnSync(process.execPath,[path.join(fx.root,'scripts/host-prerequisites.mjs'),'--repo',fx.root],{encoding:'utf8',env:{...process.env,DSH_LOCAL_MANIFEST:''}})
  assert.equal(result.status,1)
  assert.match(result.stderr,/fixture unsupported npm layout/)
  assert.doesNotMatch(result.stderr,/at resolveExecutable|file:\/\//)
})

test('compat CJS resolves Corepack while preserving pins supervisor wire capture and scoped env',async t=>{
  const fx=await fixture(t)
  const compat=path.join(fx.root,'packages/dsh-pet/compat/subagent')
  await mkdir(compat,{recursive:true})
  await cp(path.join(ROOT,'packages/dsh-pet/compat/subagent/compat-run.cjs'),path.join(compat,'compat-run.cjs'))
  await writeFile(path.join(fx.root,'scripts/lib/run-bounded.mjs'),"import fs from 'node:fs';const request=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(request))")
  const require=createRequire(import.meta.url)
  const {runCompatCommand}=require(path.join(compat,'compat-run.cjs'))
  const request=JSON.parse(runCompatCommand('corepack',['npm@11.19.0','install','two words'],fx.root,{capture:true,timeoutMs:1234,env:{CLOSURE_MARKER:'compat'}}))
  assert.equal(request.command,process.execPath)
  assert.deepEqual(request.args,[fx.fake,'npm@11.19.0','install','two words'])
  assert.equal(request.cwd,fx.root)
  assert.equal(request.timeoutMs,1234)
  assert.equal(request.killGraceMs,2000)
  assert.deepEqual(request.env,{CLOSURE_MARKER:'compat'})
})
