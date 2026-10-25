import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {autoUpdate} from '../scripts/launcher/maintenance.mjs'

test('auto-update refuses unrelated drift after sync before committing manifest',async t=>{
 const repo=await mkdtemp(path.join(os.tmpdir(),'launcher-update-drift-'));t.after(()=>rm(repo,{recursive:true,force:true}))
 await writeFile(path.join(repo,'dsh.yaml'),'dshVersion: 0.2.0-rc.2\n')
 const calls=[]
 const run=async(command,args)=>{calls.push(args);return {status:0,stdout:args.includes('status')?(calls.filter(x=>x.includes('status')).length===1?'':' M dsh.yaml\n M unrelated.txt\n'):'',stderr:''}}
 const runScript=async(name,args=[])=>{
  if(name==='check-update.mjs'&&!args.length)return {status:0,stdout:JSON.stringify({enabled:true,status:'update',current:'0.2.0-rc.2',latest:'0.2.0-rc.3',channel:'latest'})}
  if(name==='check-update.mjs'){await writeFile(path.join(repo,'dsh.yaml.bak'),await readFile(path.join(repo,'dsh.yaml')));await writeFile(path.join(repo,'dsh.yaml'),'dshVersion: 0.2.0-rc.3\n');return {status:0,stdout:'wrote dsh.yaml'}}
  return {status:0,stdout:''}
 }
 await assert.rejects(()=>autoUpdate({repo,home:repo,npmEnv:{},run,runScript,log:()=>{},warn:()=>{}}),/changed|改动|commit|工作区/)
 assert.equal(calls.some(x=>x.includes('commit')),false)
})
