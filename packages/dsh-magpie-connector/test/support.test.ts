import { expect, test } from 'vitest'
import { createGateway, deferred, json, sse } from './support/gateway.js'
import { GatewayTransport } from '../src/host/transport.js'
import { credentialsMock } from './support/credentials.js'
import { lineCredentialRefs } from '../src/host/runtime.js'
const KEY_REF = lineCredentialRefs('a1b2c3d4').key
test('gateway records method path query body and maximum concurrency, and supports delayed SSE', async () => {
  const g = await createGateway(), t = new GatewayTransport()
  try {
    const entered = deferred(), release = deferred()
    g.handlers.set('POST /v1/responses', async res => { entered.resolve(); await release.promise; sse(['[DONE]'])(res, {} as never) })
    g.handlers.set('GET /v1/models', json({ data: [] }))
    const pending = t.request({ baseUrl:g.baseUrl,key:'placeholder' }, 'POST', '/responses', { body:JSON.stringify({ model:'example' }) })
    await entered.promise
    const read = await t.request({ baseUrl:g.baseUrl,key:'placeholder' }, 'GET', '/models'); await read.text()
    release.resolve(); expect(await (await pending).text()).toContain('[DONE]')
    expect(g.maxConcurrent).toBe(2)
    expect(g.requests[0]).toMatchObject({ method:'POST',path:'/v1/responses',query:'',body:{model:'example'} })
  } finally { await t.dispose(); await g.close() }
})
test('credentials mock can change an effective value with or without an event', async () => {
  const c=credentialsMock('K1');let events=0;c.onChange(()=>events++)
  c.change('K2');expect(events).toBe(0);expect((await c.service.resolve(KEY_REF))?.value).toBe('K2')
  c.change('K3',true);expect(events).toBe(1);await c.service.unset(KEY_REF);expect(await c.service.resolve(KEY_REF)).toBeUndefined()
})

test('plugin source does not rely on CJS require (host runs ESM)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('../src', import.meta.url))
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
  const offenders = walk(root).filter(file => /\brequire\s*\(/.test(readFileSync(file, 'utf8')))
  expect(offenders).toEqual([])
})
