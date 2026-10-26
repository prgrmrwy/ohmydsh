import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadEnvironment } from '../scripts/launcher/environment.mjs'
async function fixture(t, text='') {
  const dir=await mkdtemp(path.join(os.tmpdir(),'launcher-env-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  await writeFile(path.join(dir,'.env.local'),text)
  await writeFile(path.join(dir,'.npmrc'),'registry=https://repository.invalid/\n')
  return dir
}
test('test_npm_case_variants_do_not_leak',async t=>{
  const repo=await fixture(t)
  const input={Path:'tools',NpM_CoMmAnD:'exec',NPM_CONFIG_REGISTRY:'https://baked.invalid/',npm_lifecycle_event:'dsh',NPM_PACKAGE_NAME:'x',npm_execpath:'npm.js',FIXTURE_USER:'kept'}
  const result=loadEnvironment(repo,input,{platform:'win32'})
  assert.deepEqual(result.hostEnv,{Path:'tools',FIXTURE_USER:'kept'})
  assert.equal(result.npmEnv.npm_config_registry,'https://repository.invalid/')
  assert.deepEqual(input.NPM_CONFIG_REGISTRY,'https://baked.invalid/')
})
test('file registry attribution wins even under npm and explicit DSH_BIN remains caller owned',async t=>{
  const repo=await fixture(t,"npm_config_registry='https://file.invalid/'\nDSH_BIN='local.mjs'\n")
  const result=loadEnvironment(repo,{DSH_BIN:'caller.mjs',npm_command:'exec'})
  assert.equal(result.env.DSH_BIN,'caller.mjs')
  assert.equal(result.hostEnv.npm_config_registry,'https://file.invalid/')
})
test('strict environment validates entire file before publishing any value',async t=>{
  const repo=await fixture(t,'SAFE=changed\nBAD=$HOME\n')
  const input={SAFE:'original'}
  assert.throws(()=>loadEnvironment(repo,input))
  assert.deepEqual(input,{SAFE:'original'})
})
test('literal OPENROUTER_API_KEY in env.local reaches hostEnv',async t=>{
  const repo=await fixture(t,'export OPENROUTER_API_KEY=sk-or-fixture-value\n')
  const result=loadEnvironment(repo,{})
  assert.equal(result.hostEnv.OPENROUTER_API_KEY,'sk-or-fixture-value')
})
test('shell-expanded credential line is rejected without echoing value',async t=>{
  const repo=await fixture(t,'export OPENROUTER_API_KEY=$SECRET_SOURCE\n')
  assert.throws(()=>loadEnvironment(repo,{}),error=>{
    assert.match(error.message,/shell expansion/)
    assert.doesNotMatch(error.message,/SECRET_SOURCE/)
    return true
  })
})
