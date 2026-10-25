import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { overlayFixture } from './helpers/overlay-fixture.mjs'

async function fixture(t,{fail=false}={}) {
  const fx=await overlayFixture({manifest:'dshVersion: 0.2.0-rc.2\ncustomizations: []\n'})
  t.after(()=>rm(fx.root,{recursive:true,force:true}))
  await fx.writeOverlay("customizations:\n  - id: q\n    type: package\n    source: local\n    version: 1.0.0\n    enabled: true\n")
  await fx.putOverlay('packages/q/package.json',JSON.stringify({name:'@fixture/q',version:'1.0.0',type:'module',main:'lib/index.js',files:['lib'],scripts:{build:'fixture-only'}}))
  await fx.putOverlay('packages/q/src/index.js','export const fixture = true\n')
  const log=path.join(fx.root,'npm-boundary.jsonl')
  const npm=await fx.putPublic('fixture-npm.cjs',`const fs=require('node:fs');const path=require('node:path');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({argv:a,cwd:process.cwd()})+'\\n');if(a[0]==='config'){console.log('https://scope.invalid/');process.exit(0)}if(${JSON.stringify(fail)})process.exit(9);fs.mkdirSync('packages/q/lib',{recursive:true});fs.writeFileSync('packages/q/lib/index.js','export const fixture=true');`)
  await fx.putPublic('scripts/lib/package-manager.cjs',`module.exports={...require(${JSON.stringify(path.resolve(import.meta.dirname,'../scripts/lib/package-manager.cjs'))}),resolveExecutable:(command,args)=>command==='npm'?{command:process.execPath,args:[${JSON.stringify(npm)},...args]}:{command,args}};`)
  return {...fx,log}
}

test('sync local npm build resolves argv in external sourceRoot before deployment and is idempotent',async t=>{
  const fx=await fixture(t)
  const first=fx.sync()
  assert.equal(first.status,0,first.stderr)
  const calls=(await readFile(fx.log,'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(calls,[{argv:['run','build','--workspace','@fixture/q'],cwd:fx.overlayRoot}])
  assert.match(await fx.actionLog(),/plugin --profile web add file:/)
  const second=fx.sync()
  assert.equal(second.status,0,second.stderr)
  assert.equal((await readFile(fx.log,'utf8')).trim().split('\n').length,1,'unchanged package must not rebuild')
})

test('sync failed resolved npm build never installs or removes the package',async t=>{
  const fx=await fixture(t,{fail:true})
  const result=fx.sync()
  assert.notEqual(result.status,0)
  assert.match(result.stderr,/failed before deployment/)
  assert.doesNotMatch(await fx.actionLog(),/plugin --profile web (add|remove)/)
})
