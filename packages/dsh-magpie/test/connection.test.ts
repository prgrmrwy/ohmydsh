import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, json } from './support/gateway.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f() })
export async function setup(key: string | undefined = 'mk-test-123', writable = true) {
 const gateway = await createGateway(); const credentials = credentialsMock(key, writable); const store = new SettingsStore(); store.value.baseUrl = gateway.baseUrl
 const runtime = new MagpieRuntime(credentials.service, store); cleanup.push(gateway.close, () => runtime.dispose()); credentials.onChange(() => runtime.invalidateCredential())
 gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] })); return { gateway, credentials, store, runtime }
}
test('spec Scenario "保存 key 后不回显"', async () => {
 const { runtime, credentials, store } = await setup(undefined); await runtime.settings({ key: 'mk-test-123' })
 const body = await (await runtime.settings()).json(); expect(body.key).toEqual({ configured: true, writable: true }); expect(credentials.writes).toEqual(['mk-test-123']); expect(JSON.stringify([body, store.value])).not.toContain('mk-test-123')
})
test('spec Scenario "网关反射的 key 被脱敏"', async () => {
 const { runtime } = await setup(); const op = await runtime.beginOperation(); expect(runtime.redact('invalid Bearer mk-test-123')).toBe('invalid Bearer [redacted]'); op.release()
})
test('spec Scenario "环境提供的 key 拒绝修改"', async () => {
 const { runtime, credentials } = await setup('env-key', false)
 for (const key of ['new-key', null]) expect((await runtime.settings({ key })).status).toBe(409)
 expect(credentials.writes).toHaveLength(0)
})
test('spec Scenario "非法设置输入被拒绝"', async () => {
 const { runtime, credentials, store } = await setup(); const before = store.value.baseUrl
 for (const body of [{ key: '' }, { key: 'bad key' }, { key: 'x'.repeat(513) }, { baseUrl: 'ftp://host/v1' }, { baseUrl: 'http://u:p@host/v1' }, { baseUrl: 'http://host/v1?k=x' }]) expect((await runtime.settings(body)).status).toBe(400)
 expect(credentials.writes).toHaveLength(0); expect(store.value.baseUrl).toBe(before)
})
test('spec Scenario "未配置时不提供模型且不发请求"', async () => {
 const { runtime, gateway, credentials } = await setup(); credentials.change(undefined); await runtime.start(); expect(runtime.current.catalog).toHaveLength(0); const op = await runtime.beginOperation(); expect(op.key).toBe(''); op.release(); expect(gateway.requests).toHaveLength(0)
})
