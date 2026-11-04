import { afterEach, expect, test } from 'vitest'
import { mkdtempSync } from 'node:fs'
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

test('sidebarWindow 默认 weekly、可持久化、拒绝未知档位', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'magpie-sidebar-window-')), 'settings.json')
  const controller = new SettingsController(mount(path))
  expect((await readView(controller)).sidebarWindow).toBe('weekly')

  expect((await controller.handle({ sidebarWindow: 'fiveHour' })).status).toBe(200)
  expect((await readView(controller)).sidebarWindow).toBe('fiveHour')

  for (const invalid of ['7d', '', null, 5, true]) {
    expect((await controller.handle({ sidebarWindow: invalid })).status).toBe(400)
    expect((await readView(controller)).sidebarWindow).toBe('fiveHour')
  }

  // The chosen tier survives a restart with the rest of the preferences.
  expect((await readView(new SettingsController(mount(path)))).sidebarWindow).toBe('fiveHour')
  expect((await controller.handle({ sidebarWindow: 'tightest' })).status).toBe(200)
  expect((await readView(new SettingsController(mount(path)))).sidebarWindow).toBe('tightest')
})
