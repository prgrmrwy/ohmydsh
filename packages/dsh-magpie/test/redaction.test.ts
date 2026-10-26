import { expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { createGateway, json } from './support/gateway.js'
import { credentialsMock } from './support/credentials.js'
test('catalog redaction handles JSON escaped characters in a valid key',async()=>{
 const key='mk-"quoted\\key';const g=await createGateway();const store=new SettingsStore();store.value.baseUrl=g.baseUrl;const r=new MagpieRuntime(credentialsMock(key).service,store)
 g.handlers.set('GET /v1/models',json({data:[{id:'example',display_name:`reflected ${key}`}]}))
 try{await r.start();expect(r.current.catalog[0]?.info.name).toBe('reflected [redacted]');expect(await(await r.settings()).text()).not.toContain('quoted')}finally{await r.dispose();await g.close()}
})
