import { expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { SettingsStore } from '../src/host/settings.js'
import { createGateway, json, sse } from './support/gateway.js'
import { models, responseText } from './support/wire.js'
import { credentialsMock } from './support/credentials.js'
test('limited retries only on pre-event 429/5xx responses; 401 is not retried',async()=>{
 const g=await createGateway();const store=new SettingsStore();store.value.baseUrl=g.baseUrl;const r=new MagpieRuntime(credentialsMock('placeholder').service,store);g.handlers.set('GET /v1/models',json(models));await r.start();const a=new MagpieAdapter(r)
 try{for(const status of [429,503,401]){let attempts=0;g.handlers.set('POST /v1/responses',res=>{attempts++;if(attempts===1)json({error:{message:'temporary'}},status)(res,{} as never);else sse(responseText())(res,{} as never)});const chunks=[];for await(const c of a.stream({provider:'dsh-magpie',model:'codex/gpt-6.1-sol',messages:[]}))chunks.push(c);expect(attempts).toBe(status===401?1:2);expect(chunks.at(-1)).toMatchObject({reason:{kind:status===401?'error':'stop'}})}}finally{await r.dispose();await g.close()}
})
