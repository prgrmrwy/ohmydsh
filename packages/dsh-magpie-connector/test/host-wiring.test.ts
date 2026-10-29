import { expect, test } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, json } from './support/gateway.js'

test('actual host wiring registers one route and authenticated settings fetch; publication uses replace and settings file excludes key',async()=>{
 const g=await createGateway();g.handlers.set('GET /v1/models',json({data:[{id:'example',display_name:'Reflected mk-test-123'}]}))
 const routes:ConnectionFetchRoute[]=[];const disposers:(()=>unknown)[]=[];const credentials=credentialsMock()
 let registered=0,replaced=0,removed=0
 const registration=Object.assign(()=>{removed++},{replace:()=>{replaced++}})
 const ctx={credentials:credentials.service,llm:{registerAdapter:(ids:string[])=>{expect(ids).toEqual(['dsh-magpie-connector-other']);registered++;return registration}},get:()=>undefined,
 on:()=>{},effect:(f:()=>unknown)=>{const dispose=f();if(typeof dispose==='function')disposers.push(dispose as ()=>unknown)},inject:(_deps:string[],f:(ctx:unknown)=>unknown)=>f(ctx),
 connection:{fetch:{register:(route:ConnectionFetchRoute)=>{routes.push(route);return async()=>{}}}},
 }
 const home=mkdtempSync(join(tmpdir(),'magpie-host-'))
 const {runtime,adapter}=apply(ctx as unknown as Context,{home})
 try{
  const route=routes.find(r=>r.path==='/api/dsh-magpie-connector/settings')!;expect(route).toBeDefined()
  const response=await route.fetch(new Request('http://localhost/api/dsh-magpie-connector/settings',{method:'POST',body:JSON.stringify({lines:[{baseUrl:g.baseUrl,accessMode:'direct',key:'mk-test-123'}]})}))
  expect(response.status).toBe(200);expect(await response.text()).not.toContain('mk-test-123')
  expect(registered).toBe(1);expect(await adapter.listModels('dsh-magpie-connector-other')).toHaveLength(1)
  const file=join(home,'plugins/dsh-magpie-connector/settings.json');expect(readFileSync(file,'utf8')).not.toContain('mk-test-123');expect(statSync(file).mode&0o777).toBe(0o600)
 }finally{for(const dispose of disposers.reverse())await dispose();await runtime.dispose();await g.close()}
 expect(removed).toBe(1)
})
