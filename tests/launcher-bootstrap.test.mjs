import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const bootstrap = () => import('../scripts/bootstrap.mjs')

// Version/dependency inspection is builtin-only: the bootstrap must run before
// any workspace modules have been installed.
test('test_minimum_pass_recommended_difference_warns', async () => {
  const { checkToolchain } = await bootstrap()
  const result = checkToolchain({ nodeVersion: '24.20.0', npmVersion: '12.0.2', engines: { node: '>=22.0.0', npm: '>=10.0.0' }, recommended: '24.12.0' })
  assert.equal(result.ok, true)
  assert.match(result.message, /24\.12\.0/)
  assert.match(result.message, /24\.20\.0/)
})

test('test_below_minimum_rejects', async () => {
  const { checkToolchain } = await bootstrap()
  for (const versions of [{ nodeVersion: '21.9.9', npmVersion: '12.0.2' }, { nodeVersion: '24.20.0', npmVersion: '9.9.9' }]) {
    const result = checkToolchain({ ...versions, engines: { node: '>=22.0.0', npm: '>=10.0.0' }, recommended: '24.12.0' })
    assert.equal(result.ok, false)
    assert.match(result.message, /22\.0\.0|10\.0\.0/)
  }
})

test('test_missing_toolchain_is_actionable', async () => {
  const { checkToolchain } = await bootstrap()
  const result = checkToolchain({ nodeVersion: '24.20.0', npmVersion: '', engines: { node: '>=22.0.0', npm: '>=10.0.0' }, recommended: '24.12.0' })
  assert.equal(result.ok, false)
  assert.match(result.message, /npm/)
})

test('test_engines_recommendation_and_docs_agree', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.packageManager, undefined)
  const source = await readFile(path.join(root, 'scripts/bootstrap.mjs'), 'utf8')
  assert.match(source, /engines/)
  assert.match(source, /\.nvmrc/)
  assert.doesNotMatch(source, /from ['"](?:zx|semver)['"]/, 'bootstrap must work with no installed modules')
})

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(),'ohmydsh bootstrap 中文 '))
  t.after(() => rm(dir,{recursive:true,force:true}))
  await mkdir(path.join(dir,'scripts/lib'),{recursive:true})
  await cp(path.join(root,'scripts/bootstrap.mjs'),path.join(dir,'scripts/bootstrap.mjs'))
  await cp(path.join(root,'scripts/lib/package-manager.cjs'),path.join(dir,'scripts/lib/package-manager.cjs'))
  await cp(path.join(root,'scripts/lib/child-process.mjs'),path.join(dir,'scripts/lib/child-process.mjs'))
  await writeFile(path.join(dir,'package.json'),JSON.stringify({private:true,type:'module',engines:{node:'>=22.0.0',npm:'>=10.0.0'}}))
  await writeFile(path.join(dir,'.nvmrc'),'24.12.0\n')
  const packages = Object.fromEntries(['zx','js-yaml','yaml','semver','typescript'].map(name=>['node_modules/'+name,{version:'1.2.3'}]))
  await writeFile(path.join(dir,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages}))
  const npm = path.join(dir,'npm.cjs')
  await writeFile(npm, `const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);fs.appendFileSync(path.join(process.cwd(),'npm-calls'),JSON.stringify(args)+'\\n');if(args[0]==='--version'){console.log('11.6.2');process.exit(0)}if(process.env.FAIL_CI==='1')process.exit(7);const lock=JSON.parse(fs.readFileSync('package-lock.json'));for(const [key,pkg]of Object.entries(lock.packages)){fs.mkdirSync(key,{recursive:true});fs.writeFileSync(path.join(key,'package.json'),JSON.stringify({name:path.basename(key),version:pkg.version,main:'index.js'}));fs.writeFileSync(path.join(key,'index.js'),'module.exports={}')} `)
  return {dir,npm}
}

test('test_bootstrap_repeat_and_install_failure', async t => {
  const { bootstrap: run } = await bootstrap()
  const healthy = await fixture(t)
  const command = {command:process.execPath,argsPrefix:[healthy.npm]}
  assert.equal(run({repo:healthy.dir,npmCommand:command,quiet:true}).status,0)
  assert.equal(run({repo:healthy.dir,npmCommand:command,quiet:true}).status,0)
  let calls = (await readFile(path.join(healthy.dir,'npm-calls'),'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(calls.filter(args=>args[0]==='ci').length,1)
  assert.equal(calls.some(args=>args[0]==='link'),false)
  await writeFile(path.join(healthy.dir,'node_modules/zx/package.json'),JSON.stringify({name:'zx',version:'9.9.9',main:'index.js'}))
  assert.equal(run({repo:healthy.dir,npmCommand:command,quiet:true}).status,0)
  calls = (await readFile(path.join(healthy.dir,'npm-calls'),'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(calls.filter(args=>args[0]==='ci').length,2,'wrong actual lock version must reinstall')
  await rm(path.join(healthy.dir,'node_modules/yaml/index.js'))
  assert.equal(run({repo:healthy.dir,npmCommand:command,quiet:true}).status,0,'missing resolvable entry must reinstall')
  assert.equal(run({repo:healthy.dir,npmCommand:command,quiet:true,force:true}).status,0)
  calls = (await readFile(path.join(healthy.dir,'npm-calls'),'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(calls.filter(args=>args[0]==='ci').length,4,'missing entry and force each require one ci')
  const failure = await fixture(t)
  const result = run({repo:failure.dir,npmCommand:{command:process.execPath,argsPrefix:[failure.npm]},env:{...process.env,FAIL_CI:'1'},quiet:true})
  assert.equal(result.status,7)
  assert.doesNotMatch(result.message,/初始化完成/)
})

// The compatibility wrapper is a POSIX artifact, not Windows bootstrap evidence.
if (process.platform !== 'win32') test('bootstrap wrapper diagnoses missing Node before exec without a second installer', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'ohmydsh missing-node '))
  t.after(() => rm(dir,{recursive:true,force:true}))
  const wrapper = path.join(root,'scripts/bootstrap.sh')
  const result = spawnSync('/bin/bash',[wrapper],{env:{PATH:dir},encoding:'utf8'})
  assert.notEqual(result.status,0)
  assert.match(result.stderr,/Node|node/)
  assert.match(result.stderr,/nodejs.org/)
  const pkg = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'))
  assert.ok(result.stderr.includes(pkg.engines.node))
  assert.ok(result.stderr.includes(pkg.engines.npm))
})
