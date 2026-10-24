import test from 'node:test'
import assert from 'node:assert/strict'
import {run} from '../scripts/launcher/runner.mjs'

test('runner timeout reclaims its own child and descendant instead of leaving capture pipes alive',{timeout:5000},async t=>{
 const descendant=`setInterval(()=>{},1000)`
 const parent=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});console.log('CHILD='+c.pid);setInterval(()=>{},1000)`
 let pid
 t.after(()=>{if(pid)try{process.kill(pid,'SIGKILL')}catch{}})
 const result=await run(process.execPath,['-e',parent],{capture:true,timeoutMs:300})
 pid=Number(/CHILD=(\d+)/.exec(result.stdout)?.[1]);assert.ok(pid>0)
 assert.equal(result.status,124)
 // A POSIX zombie is no longer executing. kill(0) cannot distinguish it.
 if(process.platform==='linux'){
  const fs=await import('node:fs/promises')
  const stat=await fs.readFile(`/proc/${pid}/stat`,'utf8').catch(()=>null)
  if(stat)assert.match(stat,/\) Z /)
 }else assert.throws(()=>process.kill(pid,0))
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
