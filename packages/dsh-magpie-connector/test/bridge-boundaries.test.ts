import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { SettingsStore } from '../src/host/settings.js'
import { createGateway, json } from './support/gateway.js'
import { models } from './support/wire.js'
import { credentialsMock } from './support/credentials.js'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { line } from './support/line.js'
const cleanup:(()=>Promise<unknown>)[]=[]
afterEach(async()=>{for(const f of cleanup.splice(0).reverse())await f()})
async function collect(a:MagpieAdapter){const chunks:StreamChunk[]=[];for await(const c of a.stream({provider:'dsh-magpie-connector',model:'codex/gpt-6.1-sol',messages:[]}))chunks.push(c);return chunks}
test('unconfigured real adapter finishes with MAGPIE_NOT_CONFIGURED and zero network requests',async()=>{
 const g=await createGateway();const store=new SettingsStore();store.value.lines = [line(g.baseUrl)];const r=new MagpieRuntime(credentialsMock().service,store);cleanup.push(g.close,()=>r.dispose());await r.start()
 const a=new MagpieAdapter(r);expect(await a.listModels('dsh-magpie-connector-other')).toEqual([]);expect((await collect(a)).at(-1)).toMatchObject({reason:{kind:'error',failure:{message:'MAGPIE_NOT_CONFIGURED'}}});expect(g.requests).toHaveLength(0)
})
test('real pi-ai fetch rejects same-origin and cross-origin redirects and redacts reflected HTTP errors',async()=>{
 const g=await createGateway(),other=await createGateway();const store=new SettingsStore();store.value.lines = [line(g.baseUrl)];const r=new MagpieRuntime(credentialsMock('mk-test-123').service,store);cleanup.push(g.close,other.close,()=>r.dispose());g.handlers.set('GET /v1/models',json(models));await r.start();const a=new MagpieAdapter(r)
 for(const location of [other.baseUrl,'/api/usage']){g.handlers.set('POST /v1/responses',res=>{res.writeHead(307,{location});res.end()});expect((await collect(a)).at(-1)).toMatchObject({reason:{kind:'error'}})}
 expect(other.requests).toHaveLength(0);expect(g.requests.some(req=>req.path.startsWith('/api/'))).toBe(false)
 g.handlers.set('POST /v1/responses',json({error:{message:'invalid Bearer mk-test-123'}},401));const chunks=await collect(a);expect(JSON.stringify(chunks)).not.toContain('mk-test-123');expect(JSON.stringify(chunks)).toContain('[redacted]')
})
