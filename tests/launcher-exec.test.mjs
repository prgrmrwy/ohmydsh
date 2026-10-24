import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
const require = createRequire(import.meta.url)
const resolver = require('../scripts/lib/package-manager.cjs')
const values = ['', 'two words', '中文', 'a"b', '$HOME', 'x;y', 'a&b', '(c)', 'C:\\end\\']

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(),'ohmydsh exec 中文 ')))
  t.after(() => rm(root,{recursive:true,force:true}))
  return root
}

test('test_argv_metacharacters_remain_data', async t => {
  const root = await fixture(t)
  const command = resolver.resolveExecutable(process.execPath, ['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)));process.stderr.write("err");process.exitCode=9',...values])
  const result = spawnSync(command.command, command.args, {cwd:root,encoding:'utf8',shell:false})
  assert.equal(result.status,9)
  assert.deepEqual(JSON.parse(result.stdout), values)
  assert.equal(result.stderr,'err')
  const npmRoot = path.join(root,'node_modules/npm')
  await mkdir(path.join(npmRoot,'bin'),{recursive:true})
  await writeFile(path.join(npmRoot,'package.json'),JSON.stringify({name:'npm',version:'1.0.0'}))
  await writeFile(path.join(npmRoot,'bin/npm-cli.js'),'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  const nodePath = path.join(root,'isolated-node.exe')
  const npm = resolver.resolveExecutable('npm',values,{platform:'win32',nodePath,env:{PATH:'',npm_execpath:path.join(npmRoot,'bin/npm-cli.js')}})
  assert.equal(npm.command,nodePath)
  const observed = spawnSync(process.execPath,npm.args,{encoding:'utf8',shell:false})
  assert.equal(observed.status,0,observed.stderr)
  assert.deepEqual(JSON.parse(observed.stdout),values)
})

test('native Git config preserves quoted and empty values without shell alias', async t => {
  const root = await fixture(t)
  const file = path.join(root,'git config 中文')
  for (const [index,value] of values.entries()) {
    let command = resolver.resolveExecutable('git',['config','--file',file,`fixture.value${index}`,value])
    let result = spawnSync(command.command,command.args,{cwd:root,encoding:'utf8',shell:false})
    assert.equal(result.status,0,result.stderr)
    command = resolver.resolveExecutable('git',['config','--file',file,'--null','--get',`fixture.value${index}`])
    result = spawnSync(command.command,command.args,{cwd:root,encoding:'utf8',shell:false})
    assert.equal(result.status,0,result.stderr)
    assert.equal(result.stdout,value+'\0')
  }
})

test('Windows explicit DSH_BIN uses JS or exe and refuses shim before execution', () => {
  for (const extension of ['js','mjs','cjs']) assert.deepEqual(resolver.resolveDshCommand(`C:\\custom dir\\dsh.${extension}`,values,{platform:'win32',nodePath:'C:\\Node\\node.exe'}),{command:'C:\\Node\\node.exe',args:[`C:\\custom dir\\dsh.${extension}`,...values]})
  assert.deepEqual(resolver.resolveDshCommand('C:\\custom\\dsh.exe',values,{platform:'win32'}),{command:'C:\\custom\\dsh.exe',args:values})
  for (const extension of ['cmd','bat','ps1','unknown']) assert.throws(() => resolver.resolveDshCommand('C:\\custom\\dsh.'+extension,[],{platform:'win32'}),/JS|exe/)
  assert.deepEqual(resolver.resolveDshCommand('/custom/executable',values,{platform:'linux'}),{command:'/custom/executable',args:values})
  assert.deepEqual(resolver.resolveDshCommand('/managed/lib/bin.js',values,{platform:'linux',managed:true,nodePath:'/current/node'}),{command:'/current/node',args:['/managed/lib/bin.js',...values]})
})
