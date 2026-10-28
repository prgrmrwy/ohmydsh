import { afterEach, expect, test } from 'vitest'
import { createGateway, json } from './support/gateway.js'
import { credentialsMock } from './support/credentials.js'
import { SettingsStore } from '../src/host/settings.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

test('test_legacy_upgrade_01 spec Scenario "升级后旧配置被忽略且不删除"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magpie-legacy-'))
  cleanup.push(async () => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'settings.json')
  const legacy = { baseUrl: 'http://114.114.114.223:3425/v1', visibleModels: {}, defaultEfforts: {} }
  writeFileSync(path, JSON.stringify(legacy))
  const before = readFileSync(path)
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'a' }] }))
  const credentials = credentialsMock(undefined)
  credentials.setRef('MAGPIE_API_KEY', 'legacy-key')
  credentials.setRef('MAGPIE_ACCESS_CLIENT_ID', 'legacy-id')
  credentials.setRef('MAGPIE_ACCESS_CLIENT_SECRET', 'legacy-secret')
  const resolve = credentials.service.resolve.bind(credentials.service)
  const resolved: string[] = []
  credentials.service.resolve = async ref => { resolved.push(String(ref)); return resolve(ref) }
  const store = new SettingsStore(path)
  const runtime = new MagpieRuntime(credentials.service, store)
  cleanup.push(() => runtime.dispose())
  const view = await (await runtime.settings()).json() as { lines: unknown[]; activeLineId: string | null }
  expect(view.lines).toEqual([])
  expect(view.activeLineId).toBeNull()
  expect(await new MagpieRuntime(credentials.service, store, () => {}, {}).settings().then(r => r.json()).then((v: { lines: unknown[] }) => v.lines)).toEqual([])
  expect(resolved.some(ref => ref === 'MAGPIE_API_KEY')).toBe(false)
  expect(gateway.requests).toHaveLength(0)
  expect(credentials.writes).toEqual([])
  expect(readFileSync(path).equals(before)).toBe(true)
})
