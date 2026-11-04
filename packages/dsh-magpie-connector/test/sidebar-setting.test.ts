import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { SettingsController } from '../src/host/routes.js'
import { credentialsMock } from './support/credentials.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

const mount = (path: string) => {
  const runtime = new MagpieRuntime(credentialsMock().service, new SettingsStore(path))
  cleanup.push(() => runtime.dispose())
  return runtime
}
const readView = async (controller: SettingsController): Promise<Record<string, unknown>> =>
  (await (await controller.handle()).json()) as Record<string, unknown>

test('sidebarUsage 默认关闭、可持久化、拒绝非布尔', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'magpie-sidebar-')), 'settings.json')
  const controller = new SettingsController(mount(path))

  expect((await readView(controller)).sidebarUsage).toBe(false)
  expect((await readView(controller)).sidebarRefreshMinutes).toBe(5)

  const write = await controller.handle({ sidebarUsage: true })
  expect(write.status).toBe(200)
  expect((await readView(controller)).sidebarUsage).toBe(true)

  const rejected = await controller.handle({ sidebarUsage: 'yes' })
  expect(rejected.status).toBe(400)
  expect((await readView(controller)).sidebarUsage).toBe(true)

  // Auto refresh: integer minutes, 0 = off, out of range and fractions are rejected.
  expect((await (await controller.handle({ sidebarRefreshMinutes: 10 })).json() as { sidebarRefreshMinutes: number }).sidebarRefreshMinutes).toBe(10)
  expect((await readView(controller)).sidebarRefreshMinutes).toBe(10)
  expect((await controller.handle({ sidebarRefreshMinutes: 0 })).status).toBe(200)
  expect((await readView(controller)).sidebarRefreshMinutes).toBe(0)
  for (const invalid of [-1, 1441, 1.5, '5', null]) {
    expect((await controller.handle({ sidebarRefreshMinutes: invalid })).status).toBe(400)
    expect((await readView(controller)).sidebarRefreshMinutes).toBe(0)
  }

  const restarted = new SettingsController(mount(path))
  expect((await readView(restarted)).sidebarUsage).toBe(true)
  expect((await readView(restarted)).sidebarRefreshMinutes).toBe(0)

  // Turning it back off is a normal boolean write and survives another restart.
  expect((await (await restarted.handle({ sidebarUsage: false })).json() as { sidebarUsage: boolean }).sidebarUsage).toBe(false)
  expect((await readView(new SettingsController(mount(path)))).sidebarUsage).toBe(false)
})

test('sidebarWindows 默认周窗口、可多选、非法值拒绝', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'magpie-sidebar-windows-')), 'settings.json')
  const controller = new SettingsController(mount(path))
  expect((await readView(controller)).sidebarWindows).toEqual(['weekly'])

  expect((await controller.handle({ sidebarWindows: ['fiveHour'] })).status).toBe(200)
  expect((await readView(controller)).sidebarWindows).toEqual(['fiveHour'])

  // A stored list is canonicalised: known kinds only, deduplicated, canonical order.
  expect((await controller.handle({ sidebarWindows: ['monthly', 'weekly', 'fiveHour', 'weekly'] })).status).toBe(200)
  expect((await readView(controller)).sidebarWindows).toEqual(['fiveHour', 'weekly', 'monthly'])

  expect((await controller.handle({ sidebarWindows: ['monthly'] })).status).toBe(200)
  expect((await readView(controller)).sidebarWindows).toEqual(['monthly'])
  expect((await controller.handle({ sidebarWindows: ['fiveHour', 'weekly'] })).status).toBe(200)

  for (const invalid of [[], ['7d'], 'weekly', null, 5, { fiveHour: true }]) {
    expect((await controller.handle({ sidebarWindows: invalid })).status).toBe(400)
    expect((await readView(controller)).sidebarWindows).toEqual(['fiveHour', 'weekly'])
  }

  expect((await readView(new SettingsController(mount(path)))).sidebarWindows).toEqual(['fiveHour', 'weekly'])
})

test('0.6.7 的单值 sidebarWindow 在读取时迁移为多选', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'magpie-sidebar-legacy-')), 'settings.json')
  writeFileSync(path, JSON.stringify({ lines: [], visibleModels: {}, defaultEfforts: {}, sidebarWindow: 'fiveHour' }))
  const controller = new SettingsController(mount(path))
  expect((await readView(controller)).sidebarWindows).toEqual(['fiveHour'])

  // Any later preference write persists the new key and drops the legacy one.
  expect((await controller.handle({ sidebarUsage: true })).status).toBe(200)
  const stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  expect(stored.sidebarWindows).toEqual(['fiveHour'])
  expect('sidebarWindow' in stored).toBe(false)
})
