import { afterEach, expect, test, vi } from 'vitest'
import { MagpieRuntime, lineCredentialRefs } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import type { LineSettings } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { LINE_ID, LINE_ID_2, line } from './support/line.js'
import { createGateway, unreachableBaseUrl } from './support/gateway.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })
const refs = (id: string) => lineCredentialRefs(id)
const direct = (id: string, baseUrl: string): LineSettings => line(baseUrl, id, 'direct')

async function setup(lines: LineSettings[], seed: (credentials: ReturnType<typeof credentialsMock>) => void, runtimeOptions: { newId?: (existing: readonly string[]) => string } = {}) {
  const credentials = credentialsMock(undefined, true)
  seed(credentials)
  const store = new SettingsStore()
  store.value.lines = lines;
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true, ...runtimeOptions })
  cleanup.push(() => runtime.dispose())
  return { runtime, credentials, store }
}
/** Force the delete of line 2 to fail mid-way, leaving the persisted pending marker. */
async function failingDelete() {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const other = await unreachableBaseUrl()
  const context = await setup([direct(LINE_ID, gateway.baseUrl), direct(LINE_ID_2, other)], seeded => {
    seeded.change('K1'); seeded.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  })
  context.credentials.failOn('unset', refs(LINE_ID_2).key as unknown as string)
  expect((await context.runtime.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }] })).status).toBe(500)
  return { ...context, gateway, other }
}

test('test_pending_recovery_01 spec Scenario "重启后设置读取仍可用并返回 pending"', async () => {
  const { credentials, store } = await failingDelete()
  const restarted = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => restarted.dispose())
  const request = vi.spyOn(restarted.transport, 'request')
  const response = await restarted.settings()
  expect(response.status).toBe(200)
  const view = await response.json() as { pending: { lineId: string; field: string }[] }
  expect(view.pending).toContainEqual({ lineId: LINE_ID_2, field: 'key' })
  expect(JSON.stringify(view)).not.toContain('K2')
  expect(request).not.toHaveBeenCalled()
  await expect(restarted.beginOperation()).rejects.toThrow('MAGPIE_SETTINGS_WRITE_FAILED')
})

test('test_pending_recovery_02 spec Scenario "完整重试清空 pending 后恢复"', async () => {
  const { credentials, store, gateway } = await failingDelete()
  credentials.clearFailure()
  const restarted = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => restarted.dispose())
  const retried = await restarted.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }] })
  expect(retried.status).toBe(200)
  const view = await restarted.settings()
  expect((await view.json() as { pending: unknown[] }).pending).toEqual([])
  const op = await restarted.beginOperation(); op.release()
})

test('test_pending_recovery_03 spec Scenario "新建线路提交失败后按 pending 清理 orphan"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const other = await unreachableBaseUrl()
  const { runtime, credentials, store } = await setup([direct(LINE_ID, gateway.baseUrl)], seeded => seeded.change('K1'), { newId: () => LINE_ID_2 })
  const originalSave = store.save.bind(store)
  let saves = 0
  vi.spyOn(store, 'save').mockImplementation(value => {
    saves += 1
    if (saves === 2) throw new Error('disk full')
    originalSave(value)
  })
  const failed = await runtime.settings({ lines: [
    { id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' },
    { baseUrl: other, accessMode: 'direct', key: 'orphan-secret' },
  ] })
  expect(failed.status).toBe(500)
  const restarted = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => restarted.dispose())
  const pendingView = await (await restarted.settings()).json() as { pending: { lineId: string; field: string }[] }
  expect(pendingView.pending).toContainEqual({ lineId: LINE_ID_2, field: 'key' })
  await expect(restarted.beginOperation()).rejects.toThrow('MAGPIE_SETTINGS_WRITE_FAILED')
  const retried = await restarted.settings({ lines: [
    { id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' },
  ] })
  expect(retried.status).toBe(200)
  const view = await retried.json() as { lines: { id: string; key: { configured: boolean } }[]; pending: unknown[] }
  expect(view.pending).toEqual([])
  expect(view.lines.find(entry => entry.id === LINE_ID_2)).toBeUndefined()
  expect(credentials.values.get(refs(LINE_ID_2).key as unknown as string)).toBeUndefined()
})
