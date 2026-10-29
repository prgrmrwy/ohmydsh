import { afterEach, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collect, mountRealHost } from './support/host.js'
import { createGateway, json } from './support/gateway.js'
import { credentialsMock } from './support/credentials.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const LEGACY_REFS = ['MAGPIE_API_KEY', 'MAGPIE_ACCESS_CLIENT_ID', 'MAGPIE_ACCESS_CLIENT_SECRET']
const file = (home: string) => join(home, 'plugins/dsh-magpie-connector/settings.json')

async function legacyHost(baseUrl: string) {
  const credentials = credentialsMock(undefined)
  for (const ref of LEGACY_REFS) credentials.setRef(ref, `legacy-${ref}`)
  const resolved: string[] = []
  const resolve = credentials.service.resolve.bind(credentials.service)
  credentials.service.resolve = async ref => { resolved.push(String(ref)); return resolve(ref) }
  const host = await mountRealHost({ credentials, settings: { baseUrl, visibleModels: {}, defaultEfforts: {} } })
  cleanup.push(() => host.dispose())
  return { host, credentials, resolved }
}

test('test_owner_legacy_upgrade_01 spec Scenario "升级后旧配置被忽略且不删除"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'claude/m', owned_by: 'claude' }] }))
  const { host, credentials, resolved } = await legacyHost(gateway.baseUrl)
  const bytes = readFileSync(file(host.home))
  const view = await (await host.call('settings')).json() as { lines: unknown[]; activeLineId: unknown }
  expect(view.lines).toEqual([])
  expect(view.activeLineId).toBeNull()
  expect(host.ownRoutes()).toEqual([])
  await expect(host.llm.prepareCall({ provider: 'dsh-magpie-connector-claude', model: 'claude/m' })).rejects.toMatchObject({ code: 'NO_ADAPTER' })
  const chunks = await collect(host.plugin.adapter.stream({ provider: 'dsh-magpie-connector-claude', model: 'claude/m', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } as never))
  expect(JSON.stringify(chunks.at(-1))).toContain('MAGPIE_NOT_CONFIGURED')
  expect(gateway.requests).toHaveLength(0)
  expect(resolved.filter(ref => LEGACY_REFS.includes(ref))).toEqual([])
  expect(credentials.writes).toEqual([])
  expect(readFileSync(file(host.home)).equals(bytes)).toBe(true)
  const text = JSON.stringify(view)
  expect(text).not.toContain(gateway.baseUrl)
  expect(text).not.toContain('legacy-')
})

test('test_owner_legacy_upgrade_02 spec Scenario "旧格式升级后配置线路即恢复"', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'claude/m', owned_by: 'claude' }] }))
  const { host, resolved } = await legacyHost(gateway.baseUrl)
  const response = await host.call('settings', { lines: [{ baseUrl: gateway.baseUrl, key: 'mk-new' }], resync: true })
  expect(response.status).toBe(200)
  expect(host.ownRoutes()).toEqual(['dsh-magpie-connector-claude'])
  const saved = JSON.parse(readFileSync(file(host.home), 'utf8'))
  expect(saved).not.toHaveProperty('baseUrl')
  expect(saved.knownOwners).toEqual(['claude'])
  expect(resolved.filter(ref => LEGACY_REFS.includes(ref))).toEqual([])
})
