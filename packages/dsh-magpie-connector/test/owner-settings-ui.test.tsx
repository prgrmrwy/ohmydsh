// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { fakeApi, flush, ok, settingsView } from './client-support/fake-api.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.restoreAllMocks() })

async function mount(view: Record<string, unknown>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({ 'GET settings': () => ok(settingsView(view)), 'GET cards': () => ok({ status: 'ok', cards: [] }) })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
  return { host, root }
}
const syncArea = (host: HTMLElement) => host.querySelector('[data-sync]') as HTMLElement | null

test('routeRegistrationError 在同步成功时仍显示，并说明需重启 Host（不回显 key）', async () => {
  const { host, root } = await mount({
    lastSyncAt: '2026-10-25T10:00:00Z',
    routeRegistrationError: { code: 'DUPLICATE_ADAPTER', route: 'dsh-magpie-connector-deepseek' },
  })
  try {
    const area = syncArea(host)!
    expect(area.textContent).toContain('dsh-magpie-connector-deepseek')
    expect(area.textContent).toContain('DUPLICATE_ADAPTER')
    expect(area.textContent).toContain('需重启 Host')
    expect(area.querySelector('.dmg-error')).not.toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})

test('routeRegistrationError 无 route 字段时仍给出重启说明', async () => {
  const { host, root } = await mount({ lastSyncAt: '2026-10-25T10:00:00Z', routeRegistrationError: { code: 'INVARIANT' } })
  try {
    expect(syncArea(host)!.textContent).toContain('INVARIANT')
    expect(syncArea(host)!.textContent).toContain('需重启 Host')
  } finally { act(() => root.unmount()); host.remove() }
})

test('knownOwnersReset 显示重置提示', async () => {
  const { host, root } = await mount({ lastSyncAt: '2026-10-25T10:00:00Z', knownOwnersReset: true })
  try {
    expect(syncArea(host)!.textContent).toContain('归属列表已重置')
  } finally { act(() => root.unmount()); host.remove() }
})

test('ownerLimitReached 显示被拒绝的归属列表', async () => {
  const { host, root } = await mount({ lastSyncAt: '2026-10-25T10:00:00Z', ownerLimitReached: true, rejectedOwners: ['zc', 'zd'] })
  try {
    const text = syncArea(host)!.textContent ?? ''
    expect(text).toContain('归属数量已达上限')
    expect(text).toContain('zc')
    expect(text).toContain('zd')
  } finally { act(() => root.unmount()); host.remove() }
})

test('无诊断字段时同步区域不出现诊断提示', async () => {
  const { host, root } = await mount({ lastSyncAt: '2026-10-25T10:00:00Z' })
  try {
    const text = syncArea(host)!.textContent ?? ''
    expect(text).not.toContain('需重启 Host')
    expect(text).not.toContain('归属数量已达上限')
    expect(text).not.toContain('归属列表已重置')
  } finally { act(() => root.unmount()); host.remove() }
})
