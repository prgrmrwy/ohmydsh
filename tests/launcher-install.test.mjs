import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,cp,symlink,writeFile,readFile,rm} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import managers from '../scripts/lib/package-manager.cjs'
const ROOT=path.resolve(import.meta.dirname,'..')

test('test_missing_dependencies_do_not_install',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ohmydsh missing dependencies '));t.after(()=>rm(root,{recursive:true,force:true}))
 await mkdir(path.join(root,'bin'),{recursive:true});await cp(path.join(ROOT,'bin/dsh.mjs'),path.join(root,'bin/dsh.mjs'));await cp(path.join(ROOT,'scripts/bootstrap.mjs'),path.join(root,'scripts/bootstrap.mjs')).catch(async()=>{await mkdir(path.join(root,'scripts'));await cp(path.join(ROOT,'scripts/bootstrap.mjs'),path.join(root,'scripts/bootstrap.mjs'))})
 await mkdir(path.join(root,'scripts/lib'),{recursive:true});await cp(path.join(ROOT,'scripts/lib/package-manager.cjs'),path.join(root,'scripts/lib/package-manager.cjs'))
 const home=path.join(root,'home');const result=spawnSync(process.execPath,[path.join(root,'bin/dsh.mjs'),'build'],{encoding:'utf8',env:{...process.env,DSH_HOME:home}})
 assert.notEqual(result.status,0);assert.match(result.stderr,/bootstrap\.mjs/)
 await assert.rejects(readFile(path.join(home,'dsh-startup.log')))
})

test('test_link_from_external_cwd',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ohmydsh link 中文 '));t.after(()=>rm(root,{recursive:true,force:true}))
 const repo=path.join(root,'repo with space'),prefix=path.join(root,'prefix'),cwd=path.join(root,'external')
 await mkdir(repo,{recursive:true});await mkdir(cwd)
 await cp(path.join(ROOT,'bin'),path.join(repo,'bin'),{recursive:true});await cp(path.join(ROOT,'scripts'),path.join(repo,'scripts'),{recursive:true})
 await cp(path.join(ROOT,'package-lock.json'),path.join(repo,'package-lock.json'))
 await writeFile(path.join(repo,'package.json'),JSON.stringify({name:'ohmydsh-link-fixture',version:'0.0.0',private:true,type:'module',bin:{dsh:'bin/dsh.mjs'}}))
 await symlink(path.join(ROOT,'node_modules'),path.join(repo,'node_modules'),process.platform==='win32'?'junction':'dir')
 const env={...process.env,npm_config_prefix:prefix,npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false',DSH_HOME:path.join(root,'home')}
 const npm=managers.resolvePackageManager('npm',{env})
 const before=await readFile(path.join(repo,'package-lock.json'),'utf8')
 const linked=spawnSync(npm.command,[...npm.argsPrefix,'link','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:repo,env,encoding:'utf8',timeout:30000})
 assert.equal(linked.status,0,linked.stdout+linked.stderr)
 const command=process.platform==='win32'?path.join(prefix,'dsh.cmd'):path.join(prefix,'bin/dsh')
 const result=process.platform==='win32'?spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`""${command}" --help"`],{cwd,env,encoding:'utf8',windowsVerbatimArguments:true}):spawnSync(command,['--help'],{cwd,env,encoding:'utf8'})
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/plugin-update/);assert.match(result.stdout,/doctor/)
 if(process.platform==='win32'){
  const ps=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from('& $env:FIXTURE_LINK_SHIM --help; exit $LASTEXITCODE','utf16le').toString('base64')],{cwd,env:{...env,FIXTURE_LINK_SHIM:path.join(prefix,'dsh.ps1')},encoding:'utf8',timeout:10000})
  assert.equal(ps.status,0,ps.stderr);assert.match(ps.stdout,/plugin-update/);assert.match(ps.stdout,/doctor/)
 }
 assert.equal(await readFile(path.join(repo,'package-lock.json'),'utf8'),before)
 const unlinked=spawnSync(npm.command,[...npm.argsPrefix,'unlink','--global','ohmydsh-link-fixture','--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd,env,encoding:'utf8',timeout:30000})
 assert.equal(unlinked.status,0,unlinked.stderr)
})
