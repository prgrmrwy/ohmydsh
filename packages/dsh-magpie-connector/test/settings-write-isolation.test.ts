import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime, lineCredentialRefs } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import type { LineSettings } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { LINE_ID, LINE_ID_2, line } from './support/line.js'
import { createGateway, json, unreachableBaseUrl } from './support/gateway.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })
const refs = (id: string) => lineCredentialRefs(id)
const direct = (id: string, baseUrl: string): LineSettings => line(baseUrl, id, 'direct')

async function setup(lines: LineSettings[], seed: (credentials: ReturnType<typeof credentialsMock>) => void) {
  const credentials = credentialsMock(undefined, true)
  seed(credentials)
  const store = new SettingsStore()
  store.value.lines = lines;
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { probe: async () => true })
  cleanup.push(() => runtime.dispose())
  return { runtime, credentials, store }
}

test('test_settings_write_01 spec Scenario "删除线路凭据清理失败时不提交删除"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const other = await unreachableBaseUrl()
  const { runtime, credentials, store } = await setup([direct(LINE_ID, gateway.baseUrl), direct(LINE_ID_2, other)], seeded => {
    seeded.change('K1'); seeded.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  })
  credentials.failOn('unset', refs(LINE_ID_2).key as unknown as string)
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }] })
  expect(response.status).toBe(500)
  expect((await response.json() as { error: string }).error).toContain('MAGPIE_SETTINGS_WRITE_FAILED')
  const view = await (await runtime.settings()).json() as { lines: { id: string }[]; pending: { lineId: string; field: string }[] }
  expect(view.lines.map(entry => entry.id)).toEqual([LINE_ID, LINE_ID_2])
  expect(view.pending).toContainEqual({ lineId: LINE_ID_2, field: 'key' })
  const restarted = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => restarted.dispose())
  await expect(restarted.beginOperation()).rejects.toThrow('MAGPIE_SETTINGS_WRITE_FAILED')
})

test('test_settings_write_02 spec Scenario "切回直连清 Access 失败时接入方式不变"', async () => {
  const { runtime, credentials } = await setup([{ id: LINE_ID, baseUrl: 'https://line.test/v1', accessMode: 'cloudflare' }], seeded => {
    seeded.change('K1')
    seeded.setRef(refs(LINE_ID).accessClientId as unknown as string, 'cf-id')
    seeded.setRef(refs(LINE_ID).accessClientSecret as unknown as string, 'cf-secret')
  })
  credentials.failOn('unset', refs(LINE_ID).accessClientSecret as unknown as string)
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: 'https://line.test/v1', accessMode: 'direct', accessClientId: null, accessClientSecret: null }] })
  expect(response.status).toBe(500)
  const view = await (await runtime.settings()).json() as { lines: { accessMode: string }[]; pending: { lineId: string; field: string }[] }
  expect(view.lines[0]?.accessMode).toBe('cloudflare')
  expect(view.pending).toContainEqual({ lineId: LINE_ID, field: 'accessClientId' })
  expect(view.pending).toContainEqual({ lineId: LINE_ID, field: 'accessClientSecret' })
})

test('test_settings_write_03 spec Scenario "删除线路凭据清理成功后提交删除"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const other = await unreachableBaseUrl()
  const { runtime, credentials } = await setup([direct(LINE_ID, gateway.baseUrl), direct(LINE_ID_2, other)], seeded => {
    seeded.change('K1'); seeded.setRef(refs(LINE_ID_2).key as unknown as string, 'K2')
  })
  const response = await runtime.settings({ lines: [{ id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' }] })
  expect(response.status).toBe(200)
  const view = await response.json() as { lines: { id: string }[]; pending: unknown[]; retainedCredentials: unknown[] }
  expect(view.lines.map(entry => entry.id)).toEqual([LINE_ID])
  expect(view.pending).toEqual([])
  expect(view.retainedCredentials).toEqual([])
  expect(credentials.values.get(refs(LINE_ID_2).key as unknown as string)).toBeUndefined()
  const op = await runtime.beginOperation(); op.release()
})
