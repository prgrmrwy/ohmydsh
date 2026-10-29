import test from 'node:test'
import assert from 'node:assert/strict'
import {run} from '../scripts/launcher/runner.mjs'
import childProcess from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'

async function assertStopped(pid, timeoutMs = 2000) {
 const deadline = Date.now() + timeoutMs
 let state
 do {
  if (process.platform === 'win32') {
   try { process.kill(pid, 0); state = 'running' }
   catch (error) { if (error.code === 'ESRCH') return; throw error }
  } else {
   // Both macOS and Linux can retain a dead descendant as a zombie.
   const result = childProcess.spawnSync('ps', ['-p', String(pid), '-o', 'stat='], {encoding:'utf8', timeout:1000})
   assert.ifError(result.error)
   state = result.stdout.trim()
   if (result.status === 1 && state === '' && result.stderr.trim() === '') return
   assert.equal(result.status, 0, result.stderr)
   assert.match(state, /^[A-Z]/, 'ps must report a process state')
   if (state.startsWith('Z')) return
  }
  if (Date.now() >= deadline) break
  await delay(25)
 } while (true)
 assert.fail(`process ${pid} is still executing (state=${state})`)
}

test('runner timeout reclaims its own child and descendant instead of leaving capture pipes alive',{timeout:10000},async t=>{
 const descendant=`setInterval(()=>{},1000)`
 const parent=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});console.log('CHILD='+c.pid);setInterval(()=>{},1000)`
 let pid
 t.after(()=>{if(pid)try{process.kill(pid,'SIGKILL')}catch{}})
 const result=await run(process.execPath,['-e',parent],{capture:true,timeoutMs:1000})
 pid=Number(/CHILD=(\d+)/.exec(result.stdout)?.[1]);assert.ok(pid>0)
 assert.equal(result.status,124)
 await assertStopped(pid)
 pid = undefined
})

test('stopped-process assertion rejects a live process', async () => {
 await assert.rejects(assertStopped(process.pid, 0), /still executing/)
})

test('POSIX stopped-process assertion accepts reaping but rejects broken probes', {skip:process.platform==='win32'}, async t => {
 const probe = t.mock.method(childProcess, 'spawnSync')
 for (const state of ['Z', 'Z+']) {
  probe.mock.mockImplementation(() => ({status:0, stdout:state+'\n', stderr:''}))
  await assertStopped(12345, 0)
 }
 let reads = 0
 probe.mock.mockImplementation(() => ++reads === 1
  ? {status:0, stdout:'R\n', stderr:''}
  : {status:1, stdout:'', stderr:''})
 await assertStopped(12345)
 assert.equal(reads, 2)
 for (const result of [
  {status:0, stdout:'', stderr:''},
  {status:1, stdout:'', stderr:'ps failed'},
  {status:2, stdout:'', stderr:'bad arguments'},
  {error:Object.assign(new Error('ps missing'), {code:'ENOENT'})},
 ]) {
  probe.mock.mockImplementation(() => result)
  await assert.rejects(assertStopped(12345, 0))
 }
})

test('interactive commands have no implicit timer, including Infinity',{timeout:5000},async()=>{
 const original=globalThis.setTimeout
 const deadlines=[]
 globalThis.setTimeout=(...args)=>{deadlines.push(args[1]);return original(...args)}
 try{
  for(const options of [{},{timeoutMs:Infinity}]){
   const result=await run(process.execPath,['-e','process.exit(9)'],{capture:true,...options})
   assert.equal(result.status,9)
  }
 }finally{globalThis.setTimeout=original}
 assert.deepEqual(deadlines,[])
})
