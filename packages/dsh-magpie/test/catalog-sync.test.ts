import { afterEach, expect, test, vi } from 'vitest'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { createGateway, json, deferred } from './support/gateway.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.useRealTimers(); for (const f of cleanup.splice(0).reverse()) await f() })
async function setup() {
 const g = await createGateway(); const c = credentialsMock('mk-placeholder'); const store = new SettingsStore(); let published = 0
 const r = new MagpieRuntime(c.service, store, () => published++); cleanup.push(g.close, () => r.dispose()); g.handlers.set('GET /v1/models', json({ data: Array.from({ length: 13 }, (_, i) => ({ id: `model-${i}` })) }))
 return { g, r, store, get published() { return published } }
}
test('spec Scenario "保存地址后自动同步并发布"', async () => { const s = await setup(); await s.r.settings({ baseUrl: s.g.baseUrl }); expect(s.g.requests).toHaveLength(1); expect(s.r.current.catalog).toHaveLength(13); expect(s.published).toBeGreaterThan(0) })
test('spec Scenario "同步失败保留当前代目录"', async () => { const { r,g } = await setup(); await r.settings({ baseUrl: g.baseUrl }); const at = r.current.lastSyncAt; g.handlers.set('GET /v1/models', json({},503)); await r.syncCatalog(); expect(r.current.catalog).toHaveLength(13); expect(r.current.lastSyncErrorKind).toBe('http'); expect(r.current.lastSyncAt).toBe(at) })
test('spec Scenario "同代重复触发只发一次请求"', async () => {
 const {r,g,store} = await setup(); store.value.baseUrl = g.baseUrl; const gate=deferred(); const entered=deferred(); g.handlers.set('GET /v1/models', async res => { entered.resolve(); await gate.promise; json({data: []})(res, {} as never) })
 const first=r.start(); await entered.promise; const others=[r.syncCatalog(),r.syncCatalog()]; gate.resolve(); await Promise.all([first,...others]); expect(g.requests).toHaveLength(1)
})
test('spec Scenario "同步超时"', async () => {
 const {r,g}=await setup(); await r.settings({baseUrl:g.baseUrl}); const entered=deferred(); g.handlers.set('GET /v1/models', () => entered.resolve()); vi.useFakeTimers({toFake:['setTimeout','clearTimeout']}); const sync=r.syncCatalog(); await entered.promise; await vi.advanceTimersByTimeAsync(15000); await sync; expect(r.current.lastSyncErrorKind).toBe('unreachable'); expect(r.current.catalog).toHaveLength(13)
})
test('spec Scenario "key 无效的分类"', async () => { const {r,g}=await setup(); g.handlers.set('GET /v1/models',json({},401)); await r.settings({baseUrl:g.baseUrl}); expect(r.current.lastSyncErrorKind).toBe('unauthorized') })
