import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, cp, symlink, rm, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { probePort, stopServer } from '../scripts/launcher/process.mjs'
import { runLauncher } from '../scripts/launcher/main.mjs'
const ROOT=path.resolve(import.meta.dirname,'..')
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port))})})
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'ohmydsh lifecycle 中文 ')); const home=path.join(root,'home')
  const port=await freePort()
  await mkdir(path.join(root,'bin'),{recursive:true})
  await cp(path.join(ROOT,'bin/dsh.mjs'),path.join(root,'bin/dsh.mjs'))
  await cp(path.join(ROOT,'scripts'),path.join(root,'scripts'),{recursive:true})
  await writeFile(path.join(root,'package.json'),'{"type":"module"}')
  await cp(path.join(ROOT,'package-lock.json'),path.join(root,'package-lock.json'))
  await symlink(path.join(ROOT,'node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir')
  await writeFile(path.join(root,'dsh.yaml'),'dshVersion: 0.2.0-rc.2\nautoUpdate:\n  enabled: false\nweb:\n  open: false\ncustomizations: []\n')
  const pkg=path.join(root,'runtime/node_modules/@deepseek-ai/dsh'); const bin=path.join(pkg,'lib/bin.js')
  await mkdir(path.dirname(bin),{recursive:true})
  await writeFile(path.join(pkg,'package.json'),'{"name":"@deepseek-ai/dsh","version":"0.2.0-rc.2","type":"module"}')
  await writeFile(bin,`import net from 'node:net';import fs from 'node:fs';const args=process.argv.slice(2);const port=Number(args[args.indexOf('--port')+1]);if(process.env.FIXTURE_EARLY_EXIT==='1')process.exit(9);if(process.env.FIXTURE_FOREIGN_TITLE==='1'){process.on('SIGTERM',()=>{});process.title='foreign-fixture';}const server=net.createServer(s=>s.end());server.listen(port,'127.0.0.1');if(process.env.FIXTURE_EXIT_AFTER_READY==='1')setTimeout(()=>process.exit(9),800);`)
  await cp(bin,path.join(path.dirname(bin),'foreign.js'))
  await writeFile(path.join(root,'scripts/dsh-server-bin.mjs'),`if(process.env.FIXTURE_FAIL_PREPARE==='1')process.exit(7);console.log('installer-noise');console.log('DSH_SERVER_BIN='+(process.env.FIXTURE_FOREIGN_TITLE==='1'?${JSON.stringify(path.join(path.dirname(bin),'foreign.js'))}:${JSON.stringify(bin)}));console.log('DSH_RUNTIME_KIND=npx-cache');`)
  await writeFile(path.join(root,'scripts/check-update.mjs'),`console.log(JSON.stringify({enabled:false,status:'no-update'}))`)
  await writeFile(path.join(root,'scripts/host-prerequisites.mjs'),'process.exit(0)')
  await writeFile(path.join(root,'scripts/plugin-list.mjs'),"console.log('fixture-plugin')")
  const run=(args,extra={})=>new Promise(resolve=>{
    const c=spawn(process.execPath,[path.join(root,'bin/dsh.mjs'),'--port',String(port),...args],{cwd:root,env:{...process.env,DSH_HOME:home,DSH_SKIP_UPDATE:'1',DSH_SKIP_HOST_PREREQUISITES:'1',DSH_BIN:undefined,DSH_LOCAL_MANIFEST:path.join(root,'absent'),...extra},stdio:['ignore','pipe','pipe']})
    let stdout='',stderr='';c.stdout.on('data',x=>stdout+=x);c.stderr.on('data',x=>stderr+=x)
    const timer=setTimeout(()=>c.kill('SIGKILL'),12000)
    c.once('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,stdout,stderr})})
  })
  t.after(async()=>{const status=await probePort(port);if(status.state==='owned')await stopServer(port);await rm(root,{recursive:true,force:true})})
  return {root,home,port,run}
}

test('test_missing_owner_probe_fails_before_effects',async t=>{
  const f=await fixture(t)
  const calls=[]
  await assert.rejects(()=>runLauncher(['--port',String(f.port)],{repo:f.root,env:{DSH_HOME:f.home},probe:async()=>({state:'probe-error',processes:[],error:'missing ownership probe: install lsof'}),run:async(...args)=>{calls.push(args);return {status:0,stdout:'',stderr:''}}}),/lsof/)
  assert.deepEqual(calls,[])
})

test('test_detached_host_outlives_launcher',async t=>{
  const f=await fixture(t)
  const started=await f.run(['--no-open'])
  assert.equal(started.status,0,started.stderr)
  assert.equal((await probePort(f.port)).state,'owned')
  const reused=await f.run(['--no-open'])
  assert.equal(reused.status,0,reused.stderr)
  assert.match(reused.stdout,/已在运行/)
  const log=await readFile(path.join(f.home,'dsh-startup.log'),'utf8')
  assert.equal(log.split('\n').filter(l=>l.includes('dshVersion=')).length,1)
  assert.match(log,/plugins=\[fixture-plugin\]/)
  assert.match(started.stdout,/Host runtime: npx-cache/)
  assert.match(started.stdout,/  - fixture-plugin/)
  const stopped=await f.run(['stop'])
  assert.equal(stopped.status,0,stopped.stderr)
  assert.equal((await probePort(f.port)).state,'empty')
})

test('test_foreign_port_and_early_exit_fail',async t=>{
  const f=await fixture(t)
  const foreign=net.createServer(s=>s.end())
  await new Promise(resolve=>foreign.listen(f.port,'127.0.0.1',resolve))
  try { const result=await f.run(['--no-open']);assert.notEqual(result.status,0);assert.equal(foreign.listening,true);assert.match(result.stderr,/provably|refus|归属/i) }
  finally {await new Promise(resolve=>foreign.close(resolve))}
  const failed=await f.run(['--no-open'],{FIXTURE_EARLY_EXIT:'1'})
  assert.notEqual(failed.status,0)
  assert.match(failed.stderr,/exited early/)
  assert.equal((await probePort(f.port)).state,'empty')
})

test('test_failed_replacement_keeps_healthy_host',async t=>{
  const f=await fixture(t)
  assert.equal((await f.run(['--no-open'])).status,0)
  const before=await probePort(f.port)
  const result=await f.run(['restart','--no-open'],{FIXTURE_FAIL_PREPARE:'1'})
  assert.notEqual(result.status,0)
  const after=await probePort(f.port)
  assert.equal(after.state,'owned')
  assert.equal(after.processes[0].pid,before.processes[0].pid)
})

test('simultaneous starts reuse the verified winner instead of reporting a failed launch',async t=>{
  const f=await fixture(t)
  const results=await Promise.all([f.run(['--no-open']),f.run(['--no-open'])])
  for(const result of results)assert.equal(result.status,0,result.stderr)
  assert.equal((await probePort(f.port)).state,'owned')
})

test('readiness ownership failure reclaims a child that ignores TERM',{timeout:15000},async t=>{
  const f=await fixture(t)
  const result=await f.run(['--no-open'],{FIXTURE_FOREIGN_TITLE:'1'})
  assert.notEqual(result.status,0)
  assert.equal(result.signal,null,'launcher must return, not hit fixture kill deadline')
  assert.equal((await probePort(f.port)).state,'empty')
})

test('Windows failed readiness releases its child handle even when taskkill fails',async t=>{
  const f=await fixture(t)
  const {default:childProcess}=await import('node:child_process')
  const {syncBuiltinESMExports}=await import('node:module')
  const {EventEmitter}=await import('node:events')
  const original=childProcess.spawn
  const child=new EventEmitter();child.pid=424242;child.exitCode=null;child.signalCode=null
  let released=false;child.unref=()=>{released=true}
  const listener=net.createServer(socket=>socket.end())
  await new Promise(resolve=>listener.listen(f.port,'127.0.0.1',resolve))
  let probes=0;const kills=[]
  childProcess.spawn=()=>child;syncBuiltinESMExports()
  try{
    const result=await runLauncher(['--port',String(f.port),'--no-open'],{
      repo:f.root,platform:'win32',env:{...process.env,DSH_HOME:f.home,DSH_SKIP_HOST_PREREQUISITES:'1'},
      probe:async()=>({state:++probes===1?'empty':'unknown',processes:[]}),log:()=>{},warn:()=>{},
      run:async(command,args)=>{
        if(command==='taskkill.exe'){kills.push(args);return {status:1,stdout:'',stderr:'access denied'}}
        if(args[0].endsWith('dsh-server-bin.mjs'))return {status:0,stdout:'DSH_SERVER_BIN=fixture.js\nDSH_RUNTIME_KIND=fixture\n',stderr:''}
        return {status:0,stdout:'{"enabled":false}',stderr:''}
      },
    })
    assert.notEqual(result,0)
    assert.deepEqual(kills,[['/PID','424242','/T','/F']])
    assert.equal(released,true,'still-live detached handle must not keep launcher running after cleanup failure')
  }finally{
    childProcess.spawn=original;syncBuiltinESMExports()
    await new Promise(resolve=>listener.close(resolve))
  }
})

test('foreground Host nonzero exit is propagated',async t=>{
  const f=await fixture(t)
  const result=await f.run(['--foreground','--no-open'],{FIXTURE_EXIT_AFTER_READY:'1'})
  assert.equal(result.status,9,result.stderr)
  assert.equal((await probePort(f.port)).state,'empty')
})
