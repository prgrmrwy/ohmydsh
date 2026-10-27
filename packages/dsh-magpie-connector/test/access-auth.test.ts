import { afterEach, expect, test, vi } from 'vitest'
import type { MockAgent } from 'undici'
vi.mock('undici', async original => { const actual = await original<typeof import('undici')>(); return {...actual, Agent: class extends actual.MockAgent { override async destroy() { await this.close() } }} })
import { ACCESS_CLIENT_ID_REF, ACCESS_CLIENT_SECRET_REF, KEY_REF, MagpieRuntime, type Credentials } from '../src/host/runtime.js'
import { GatewayTransport } from '../src/host/transport.js'
import { SettingsStore } from '../src/host/settings.js'
import { CardsController } from '../src/host/cards.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { chatText, responseText } from './support/wire.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
function setup(access = true, catalog = true) {
  const values = new Map<string, string>([[KEY_REF, 'gateway-key']])
  if (access) { values.set(ACCESS_CLIENT_ID_REF,'access-id'); values.set(ACCESS_CLIENT_SECRET_REF,'access-secret') }
  const readonly = new Set<string>(), writes: string[] = []
  let fail = '', listener = () => {}
  const credentials: Credentials = {
    describe: async ref => ({configured:values.has(ref),writable:!readonly.has(ref)}),
    resolve: async ref => values.has(ref) ? {value:values.get(ref)!,source:readonly.has(ref)?'env':'file'} : undefined,
    set: async (ref, value) => { if (ref === fail) throw new Error(value); writes.push(ref); values.set(ref,value); listener() },
    unset: async ref => { writes.push(ref); values.delete(ref); listener() },
  }
  const store = new SettingsStore(); store.value.baseUrl = access ? 'https://gateway.test/v1' : 'http://gateway.test/v1'
  const runtime = new MagpieRuntime(credentials, store)
  listener = () => runtime.invalidateCredential()
  const agent = (runtime.transport as unknown as {agent:MockAgent}).agent
  agent.disableNetConnect()
  cleanups.push(() => runtime.dispose())
  const pool = agent.get(access ? 'https://gateway.test' : 'http://gateway.test')
  if (catalog) pool.intercept({path:'/v1/models',method:'GET'}).reply(200,{data:[{id:'chat'},{id:'responses',native_endpoints:['/v1/responses']}]}).persist()
  return {runtime, values, readonly, writes, pool, fail(ref:string) {fail=ref}}
}

test('all five endpoints use captured Access headers and retain bearer; caller headers cannot override identity', async () => {
  const {runtime,pool} = setup(true, false)
  const seen: string[] = []
  for (const [method,path] of [['GET','/v1/models'],['GET','/v1/magpie/quotas/cards'],['POST','/v1/magpie/quotas/refresh'],['POST','/v1/chat/completions'],['POST','/v1/responses']]) {
    pool.intercept({method:method!,path:path!,headers: headers => {
      expect(headers.authorization).toBe('Bearer gateway-key')
      expect(headers['cf-access-client-id']).toBe('access-id')
      expect(headers['cf-access-client-secret']).toBe('access-secret')
      seen.push(path!); return true
    }}).reply(200,{data:[]})
  }
  // Use the transport directly to exercise the complete endpoint allowlist.
  const identity={baseUrl:'https://gateway.test/v1',key:'gateway-key',accessClientId:'access-id',accessClientSecret:'access-secret'}
  for (const [method,path] of [['GET','/models'],['GET','/magpie/quotas/cards'],['POST','/magpie/quotas/refresh'],['POST','/chat/completions'],['POST','/responses']]) await runtime.transport.request(identity,method!,path!,{headers:{'CF-Access-Client-Secret':'override'}})
  expect(new Set(seen).size).toBe(5)
})

test('LAN omits Access headers even if supplied by the caller', async () => {
  const {runtime,pool}=setup(false)
  pool.intercept({path:'/v1/magpie/quotas/cards',headers:headers=>{expect(headers['cf-access-client-id']).toBeUndefined();expect(headers['cf-access-client-secret']).toBeUndefined();return true}}).reply(200,{data:[]})
  await runtime.transport.request({baseUrl:runtime.store.value.baseUrl,key:'gateway-key'},'GET','/magpie/quotas/cards',{headers:{'CF-Access-Client-Id':'foreign','CF-Access-Client-Secret':'foreign'}})
})

test.each([{accessClientId:'only'}, {accessClientId:'id',accessClientSecret:'bad\r\nheader'}, {baseUrl:'http://gateway.test/v1',accessClientId:'id',accessClientSecret:'secret'}])('invalid whole update has no writes: %j', async update => {
  const {runtime,writes}=setup(false)
  expect((await runtime.settings(update)).status).toBe(400)
  expect(writes).toEqual([])
  expect(runtime.store.value.baseUrl).toBe('http://gateway.test/v1')
})

test('mixed env/file writable preflight rejects before any write; independent clear is rejected', async () => {
  const {runtime,readonly,writes}=setup()
  readonly.add(ACCESS_CLIENT_SECRET_REF)
  expect((await runtime.settings({baseUrl:'https://other.test/v1',key:'replacement',accessClientId:'next',accessClientSecret:'next-secret'})).status).toBe(409)
  expect(writes).toEqual([])
  expect(runtime.store.value.baseUrl).toBe('https://gateway.test/v1')
  expect((await runtime.settings({accessClientId:null})).status).toBe(400)
})

test('status never reveals secrets; complete clearing permits LAN', async () => {
  const {runtime}=setup()
  const response=await runtime.settings()
  expect(await response.json()).toMatchObject({access:{clientId:{configured:true,writable:true},clientSecret:{configured:true,writable:true}}})
  const cleared=await runtime.settings({accessClientId:null,accessClientSecret:null,baseUrl:'http://gateway.test/v1',key:null})
  expect(cleared.status).toBe(200)
  expect(await cleared.text()).not.toContain('access-secret')
})

test('write failure is explicit, invalidates catalog, preserves URL and does not claim rollback', async () => {
  const {runtime,fail,values}=setup()
  await runtime.start(); const generation=runtime.current
  fail(ACCESS_CLIENT_SECRET_REF)
  const response=await runtime.settings({baseUrl:'https://other.test/v1',accessClientId:'new-id',accessClientSecret:'new-secret'})
  expect(response.status).toBe(500)
  expect(await response.text()).toContain('partially updated')
  expect(runtime.current).not.toBe(generation)
  expect(runtime.current.catalog).toEqual([])
  expect(runtime.store.value.baseUrl).toBe('https://gateway.test/v1')
  expect(values.get(ACCESS_CLIENT_ID_REF)).toBe('new-id')
  await expect(runtime.beginOperation()).rejects.toThrow('MAGPIE_SETTINGS_WRITE_FAILED')
  expect((await runtime.settings({resync:true})).status).toBe(409)
  fail('')
  expect((await runtime.settings({key:'gateway-key',accessClientId:'access-id',accessClientSecret:'access-secret'})).status).toBe(200)
})

test('prepared and active operations retain all old secrets and capture all identity fields', async () => {
  const {runtime,values,pool}=setup()
  await runtime.start()
  const adapter=new MagpieAdapter(runtime)
  const prepared=await adapter.prepareCall('dsh-magpie-connector','chat')
  const active=await runtime.beginOperation()
  values.set(KEY_REF,'new-key'); values.set(ACCESS_CLIENT_ID_REF,'new-id'); values.set(ACCESS_CLIENT_SECRET_REF,'new-secret')
  runtime.invalidateCredential()
  const next=await runtime.beginOperation();next.release()
  expect(runtime.redact('gateway-key access-id access-secret new-key new-id new-secret')).toBe('[redacted] [redacted] [redacted] [redacted] [redacted] [redacted]')
  pool.intercept({path:'/v1/chat/completions',method:'POST',headers:headers=>{
    expect(headers.authorization).toBe('Bearer gateway-key')
    expect(headers['cf-access-client-id']).toBe('access-id')
    expect(headers['cf-access-client-secret']).toBe('access-secret');return true
  }}).reply(401,{'access-secret':'gateway-key access-id'})
  const fetchFor=vi.spyOn(runtime.transport,'fetchFor')
  const chunks=[]
  for await (const chunk of prepared.stream({provider:'dsh-magpie-connector',model:'chat',messages:[]})) chunks.push(chunk)
  for (const secret of ['gateway-key','access-id','access-secret']) expect(JSON.stringify(chunks)).not.toContain(secret)
  expect(fetchFor.mock.calls[0]?.[0]).toMatchObject({key:'gateway-key',accessClientId:'access-id',accessClientSecret:'access-secret',baseUrl:'https://gateway.test/v1'})
  expect(runtime.formatErrorBody(JSON.stringify({'access-secret':'gateway-key access-id'}))).toBe('{"[redacted]":"[redacted] [redacted]"}')
  active.release()
})

test('cards and catalog forward full operation identity; invalid external pair cannot send', async () => {
  const {runtime,values,pool}=setup()
  const request=vi.spyOn(runtime.transport,'request')
  await runtime.start()
  pool.intercept({path:'/v1/magpie/quotas/cards'}).reply(200,{data:[{provider:'p',error:'access-id access-secret'}]})
  pool.intercept({path:'/v1/magpie/quotas/refresh',method:'POST'}).reply(200,{data:[]})
  const cards=new CardsController(runtime)
  expect(await (await cards.get()).text()).not.toContain('access-secret')
  await cards.refresh({all:true})
  expect(request.mock.calls.every(([identity])=>identity.accessClientId==='access-id'&&identity.accessClientSecret==='access-secret')).toBe(true)
  values.delete(ACCESS_CLIENT_SECRET_REF)
  runtime.invalidateCredential()
  await expect(runtime.beginOperation()).rejects.toThrow('MAGPIE_ACCESS_PAIR_REQUIRED')
  expect(runtime.current.catalog).toEqual([])
})

test.each([['chat','/v1/chat/completions',chatText()],['responses','/v1/responses',responseText()]])('Access-enabled %s SSE completes through the real adapter and transport', async (model,path,events) => {
  const {runtime,pool}=setup()
  await runtime.start()
  pool.intercept({path:path as string,method:'POST',headers:headers=>{
    expect(headers.authorization).toBe('Bearer gateway-key')
    expect(headers['cf-access-client-id']).toBe('access-id')
    expect(headers['cf-access-client-secret']).toBe('access-secret');return true
  }}).reply(200,(events as unknown[]).map(event=>`data: ${typeof event==='string'?event:JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}})
  const chunks=[]
  for await(const chunk of new MagpieAdapter(runtime).stream({provider:'dsh-magpie-connector',model:model as string,messages:[]}))chunks.push(chunk)
  expect(chunks).toContainEqual(expect.objectContaining({type:'text-delta',text:'hi'}))
  expect(chunks.at(-1)).toMatchObject({type:'finish',reason:{kind:'stop'}})
})

test('Access rotation drops delayed discovery even when transport ignores abort', async () => {
  const {runtime,values}=setup()
  await runtime.start()
  let finish!: (response:Response)=>void
  const delayed=new Promise<Response>(resolve=>{finish=resolve})
  const request=vi.spyOn(runtime.transport,'request').mockImplementationOnce(()=>delayed)
  const pending=runtime.syncCatalog()
  await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1))
  const old=runtime.current
  values.set(ACCESS_CLIENT_SECRET_REF,'rotated-secret')
  runtime.invalidateCredential()
  await runtime.syncCatalog()
  finish(Response.json({data:[{id:'stale-model'}]}))
  await pending
  expect(old.bgAbort.signal.aborted).toBe(true)
  expect(runtime.current.catalog.map(model=>model.info.id)).toEqual(['chat','responses'])
  expect(request.mock.calls.at(-1)?.[0].accessClientSecret).toBe('rotated-secret')
})

test('HTTPS, endpoint/query and redirect guards remain closed', async () => {
  const transport=new GatewayTransport();cleanups.push(()=>transport.dispose())
  const identity={baseUrl:'https://gateway.test/v1',key:'key',accessClientId:'id',accessClientSecret:'secret'}
  const agent=(transport as unknown as {agent:MockAgent}).agent; agent.disableNetConnect()
  agent.get('https://gateway.test').intercept({path:'/v1/models'}).reply(307,'',{headers:{location:'https://foreign.test/v1/models'}})
  await expect(transport.request(identity,'GET','/models')).rejects.toThrow()
  await expect(transport.request(identity,'GET','https://foreign.test/v1/models')).rejects.toThrow('MAGPIE_ENDPOINT_FORBIDDEN')
  await expect(transport.request(identity,'GET','/models?secret=x')).rejects.toThrow('MAGPIE_QUERY_FORBIDDEN')
  await expect(transport.request({...identity,baseUrl:'http://gateway.test/v1'},'GET','/models')).rejects.toThrow('MAGPIE_ACCESS_HTTPS_REQUIRED')
})
