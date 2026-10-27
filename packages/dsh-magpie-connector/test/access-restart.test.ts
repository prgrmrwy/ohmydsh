import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { SettingsStore } from '../src/host/settings.js'
import { MagpieRuntime, KEY_REF, ACCESS_CLIENT_ID_REF, ACCESS_CLIENT_SECRET_REF, type Credentials } from '../src/host/runtime.js'

test('incomplete credential update survives restart and requires explicit complete retry', async () => {
 const dir=mkdtempSync(join(tmpdir(),'magpie-access-restart-'));const path=join(dir,'settings.json')
 const values=new Map([[KEY_REF,'gateway'],[ACCESS_CLIENT_ID_REF,'old-id'],[ACCESS_CLIENT_SECRET_REF,'old-secret']]);let fail=true
 const credentials:Credentials={describe:async ref=>({configured:values.has(ref),writable:true}),resolve:async ref=>values.has(ref)?{value:values.get(ref)!,source:'file'}:undefined,set:async(ref,value)=>{if(fail&&ref===ACCESS_CLIENT_SECRET_REF)throw Error('write failed');values.set(ref,value)},unset:async ref=>{values.delete(ref)}}
 const store=new SettingsStore(path);store.save({...store.value,baseUrl:'https://gateway.test/v1'})
 const runtime=new MagpieRuntime(credentials,store)
 let restarted:MagpieRuntime|undefined
 try{
  const response=await runtime.settings({accessClientId:'new-id',accessClientSecret:'new-secret'})
  expect(response.status).toBe(500);expect(values.get(ACCESS_CLIENT_ID_REF)).toBe('new-id');expect(values.get(ACCESS_CLIENT_SECRET_REF)).toBe('old-secret')
  const disk=readFileSync(path,'utf8');expect(disk).toContain('credentialUpdatePending');for(const secret of values.values())expect(disk).not.toContain(secret==='gateway'?'"gateway"':secret)
  await runtime.dispose();restarted=new MagpieRuntime(credentials,new SettingsStore(path))
  const request=vi.spyOn(restarted.transport,'request').mockResolvedValue(Response.json({data:[]}))
  await expect(restarted.beginOperation()).rejects.toThrow('MAGPIE_SETTINGS_WRITE_FAILED');expect(request).not.toHaveBeenCalled()
  expect((await restarted.settings({resync:true})).status).toBe(409)
  expect((await restarted.settings({accessClientSecret:'new-secret'})).status).toBe(409)
  fail=false
  expect((await restarted.settings({accessClientId:'new-id',accessClientSecret:'new-secret'})).status).toBe(200)
  expect(JSON.parse(readFileSync(path,'utf8')).credentialUpdatePending).toBeUndefined()
  const op=await restarted.beginOperation();expect(op.accessClientSecret).toBe('new-secret');op.release()
 }finally{await runtime.dispose();await restarted?.dispose();rmSync(dir,{recursive:true,force:true})}
})

test('failure to persist quarantine never starts credential writes', async()=>{
 const store=new SettingsStore();store.value.baseUrl='https://gateway.test/v1'
 const set=vi.fn();const credentials:Credentials={describe:async()=>({configured:false,writable:true}),resolve:async()=>undefined,set,unset:vi.fn()}
 const runtime=new MagpieRuntime(credentials,store);vi.spyOn(store,'save').mockImplementation(()=>{throw Error('disk unavailable')})
 try{expect((await runtime.settings({accessClientId:'id',accessClientSecret:'secret'})).status).toBe(500);expect(set).not.toHaveBeenCalled()}finally{await runtime.dispose()}
})
