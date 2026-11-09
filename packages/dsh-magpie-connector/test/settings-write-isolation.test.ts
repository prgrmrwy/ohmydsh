import { afterEach, expect, test } from 'vitest'
import { MagpieRuntime, WRITE_CAUSE_MAX, lineCredentialRefs } from '../src/host/runtime.js'
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

test('test_settings_write_04 spec Scenario "写入失败的错误响应带出底层原因"', async () => {
  // Issue #1: the credentials provider refused to write because ~/.dsh/.credentials.yaml was world
  // readable. Its message names the file and the exact fix; the generic "may be partially updated"
  // text alone left the user guessing.
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const other = await unreachableBaseUrl()
  const { runtime, credentials } = await setup([direct(LINE_ID, gateway.baseUrl), direct(LINE_ID_2, other)], seeded => { seeded.change('K1') })
  const guard = 'credentials-local: /home/u/.dsh/.credentials.yaml is readable beyond its owner (mode 644); run "chmod 600 /home/u/.dsh/.credentials.yaml" before starting again'
  credentials.failOn('set', refs(LINE_ID_2).key as unknown as string, guard)
  // The failing request also changes line 1's address: a failed write must not commit anything.
  const response = await runtime.settings({ lines: [
    { id: LINE_ID, baseUrl: 'https://changed.example/v1', accessMode: 'direct' },
    { id: LINE_ID_2, baseUrl: other, accessMode: 'direct', key: 'K2' },
  ] })
  expect(response.status).toBe(500)
  const error = (await response.json() as { error: string }).error
  // The stable code and the quarantine contract stay unchanged; only the actionable cause is added.
  expect(error).toContain('MAGPIE_SETTINGS_WRITE_FAILED')
  expect(error).toContain('retry the complete connection')
  expect(error).toContain('is readable beyond its owner (mode 644)')
  expect(error).toContain('chmod 600 /home/u/.dsh/.credentials.yaml')
  const view = await (await runtime.settings()).json() as { lines: { id: string; baseUrl: string }[]; pending: { lineId: string; field: string }[] }
  expect(view.lines.map(entry => entry.id)).toEqual([LINE_ID, LINE_ID_2])
  expect(view.lines[0]!.baseUrl).toBe(gateway.baseUrl)
  expect(view.pending).toContainEqual({ lineId: LINE_ID_2, field: 'key' })
})

test('无法字符串化的抛出值仍返回 500 并保留 pending', async () => {
  // A throwable without a primitive conversion (e.g. Object.create(null)) must not escape the catch
  // and reach the generic settings() handler, which would report 400 and hide the quarantine.
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const other = await unreachableBaseUrl()
  const { runtime, credentials } = await setup([direct(LINE_ID, gateway.baseUrl), direct(LINE_ID_2, other)], seeded => { seeded.change('K1') })
  credentials.service.set = async () => { throw Object.create(null) }
  const response = await runtime.settings({ lines: [
    { id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' },
    { id: LINE_ID_2, baseUrl: other, accessMode: 'direct', key: 'K2' },
  ] })
  expect(response.status).toBe(500)
  const error = (await response.json() as { error: string }).error
  expect(error).toContain('MAGPIE_SETTINGS_WRITE_FAILED')
  expect(error).not.toContain('cause:')
  const view = await (await runtime.settings()).json() as { pending: { lineId: string; field: string }[] }
  expect(view.pending).toContainEqual({ lineId: LINE_ID_2, field: 'key' })
})

test('test_settings_write_05 spec Scenario "错误原因先脱敏再截断"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  const other = await unreachableBaseUrl()
  const { runtime, credentials } = await setup([direct(LINE_ID, gateway.baseUrl), direct(LINE_ID_2, other)], seeded => {
    seeded.setRef(refs(LINE_ID_2).key as unknown as string, 'OLD-SECRET-123')
  })
  await runtime.settings() // resolves every line, so the saved secret is in the redaction set
  const attempted = 'NEW-SECRET-456'
  // The attempted value straddles the truncation boundary: truncating before redacting would keep a
  // recognizable prefix of it in the response.
  const boundary = 'y'.repeat(WRITE_CAUSE_MAX - 5)
  credentials.failOn('set', refs(LINE_ID_2).key as unknown as string, `${boundary}${attempted} echoes OLD-SECRET-123`)
  const response = await runtime.settings({ lines: [
    { id: LINE_ID, baseUrl: gateway.baseUrl, accessMode: 'direct' },
    { id: LINE_ID_2, baseUrl: other, accessMode: 'direct', key: attempted },
  ] })
  expect(response.status).toBe(500)
  const error = (await response.json() as { error: string }).error
  expect(error).not.toContain('OLD-SECRET-123')
  const cause = error.split('; cause: ')[1] ?? ''
  // 'NEW' alone proves the order: truncating first would leave the value's prefix `NEW-S…` instead
  // of the placeholder's prefix `[redac…` at the 300-character boundary.
  expect(cause).not.toContain('NEW')
  expect(cause.startsWith(boundary)).toBe(true)
  expect(cause.slice(boundary.length)).toBe('[reda')
  expect(cause).toHaveLength(WRITE_CAUSE_MAX)
})
