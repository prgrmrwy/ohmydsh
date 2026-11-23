// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { en, zh } from '../src/client/locales.js'
import { buttonByText, fakeApi, flush, ok, settingsView, text } from './client-support/fake-api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const cards = (list: unknown[] = []) => ok({ status: 'ok', cards: list })
async function render(view: Record<string, unknown>, cardList: unknown[] = [], post?: (body: unknown) => Record<string, unknown>) {
  let current = view
  const fake = fakeApi({
    'GET settings': () => ok(settingsView(current)),
    'GET cards': () => cards(cardList),
    'POST settings': request => { if (post) current = post(request.body); return ok(settingsView(current)) },
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api })))
  await flush()
  return fake
}
const panels = () => [...host.querySelectorAll('section.dmg-panel[data-provider]')].map(el => el.getAttribute('data-provider'))
const panel = (provider: string) => host.querySelector(`section.dmg-panel[data-provider="${provider}"]`)!
const rows = (provider: string) => [...panel(provider).querySelectorAll('[data-model]')].map(el => el.getAttribute('data-model'))

const routing = (models: unknown[]) => ({ provider: 'routing', models })

test('test_routing_settings_01 spec Scenario "路由组只受 routing 键控制"', async () => {
  await render({ visibleModels: { 'opencode-go': ['opencode-go/kimi-k3'] }, groups: [
    { provider: 'opencode-go', models: [{ id: 'opencode-go/kimi-k3', visible: true }] },
    routing([{ id: 'group/ds', name: 'ds', routingKind: 'custom', visible: true }, { id: 'auto/glm-5', name: 'GLM-5', routingKind: 'auto', visible: true }]),
  ] })
  expect(panels()).toEqual(['routing', 'opencode-go'])
  expect(rows('routing')).toEqual(['group/ds', 'auto/glm-5'])
  expect(rows('opencode-go')).toEqual(['opencode-go/kimi-k3'])
  expect(text(panel('routing').querySelector('[data-model="group/ds"]'))).toContain(zh.routingKindCustom)
  expect(text(panel('routing').querySelector('[data-model="auto/glm-5"]'))).toContain(zh.routingKindAuto)
  for (const id of ['group/ds', 'auto/glm-5']) expect((panel('routing').querySelector(`[data-model="${id}"] input[type="checkbox"]`) as HTMLInputElement).checked).toBe(true)
})

test('test_routing_settings_02 spec Scenario "只有路由组时仍能恢复跟随网关"', async () => {
  const view = { visibleModels: { routing: ['group/solo'], claude: [] }, groups: [routing([
    { id: 'group/solo', routingKind: 'custom', visible: true },
    { id: 'group/new', routingKind: 'custom', visible: false },
  ])] }
  const fake = await render(view, [], body => ({ ...view, visibleModels: (body as { visibleModels: Record<string, string[]> }).visibleModels }))
  expect((panel('routing').querySelector('[data-model="group/new"] input') as HTMLInputElement).checked).toBe(false)
  const follow = buttonByText(panel('routing'), zh.followCatalog)!
  expect(follow).toBeTruthy()
  await act(async () => { follow.click() })
  await flush()
  const posted = fake.calls.find(c => c.method === 'POST' && c.path === 'settings')!.body as { visibleModels: Record<string, string[]> }
  expect(posted.visibleModels).toEqual({ claude: [] })
})

test('test_routing_settings_03 spec Scenario "provider 只剩路由入口时不留空分区"', async () => {
  await render({ groups: [routing([{ id: 'group/ds', routingKind: 'custom', visible: true }]), { provider: 'claude', models: [{ id: 'claude/claude-fable-5-2', visible: true }] }] })
  expect(panels()).toEqual(['routing', 'claude'])
  expect(host.querySelector('[data-provider="opencode-go"]')).toBeNull()
})

test('test_routing_settings_04 spec Scenario "provider 只剩路由入口但有用量卡片时保留分区"', async () => {
  await render({ groups: [routing([{ id: 'group/ds', routingKind: 'custom', visible: true }])] }, [{ provider: 'opencode-go', windows: [{ name: '7 days', used: 23 }] }])
  expect(panels()).toEqual(['routing', 'opencode-go'])
  expect(rows('opencode-go')).toEqual([])
  expect(panel('opencode-go').querySelector('.dmg-cards')).not.toBeNull()
  expect(rows('routing')).toEqual(['group/ds'])
})

test('test_routing_settings_05 spec Scenario "路由组分区说明与无编辑控件"', async () => {
  await render({ visibleModels: { routing: ['group/ds'] }, groups: [routing([{ id: 'group/ds', routingKind: 'custom', efforts: ['low', 'high'], visible: true }])] })
  const p = panel('routing')
  expect(text(p.querySelector('h3'))).toBe(zh.routingGroupsTitle)
  expect(text(p)).toContain(zh.routingGroupsHint)
  expect(zh.routingGroupsHint).toBe('在 Magpie 中新建和编辑路由组；这里决定是否在 DSH 显示及默认推理强度')
  expect(en.routingGroupsHint).toBeTruthy()
  const controls = [...p.querySelectorAll('input, select, button, a, textarea')]
  expect(controls.map(c => c.tagName.toLowerCase()).sort()).toEqual(['button', 'input', 'select'])
  expect(text(p.querySelector('button'))).toBe(zh.followCatalog)
})

test('test_routing_settings_06 spec Scenario "下拉文案与路由入口"', async () => {
  expect(zh.defaultEffortNone).toBe('默认：不指定')
  expect(en.defaultEffortNone).toBe('Default: not set')
  await render({ defaultEfforts: { 'claude/claude-fable-5-2': 'high' }, groups: [
    routing([{ id: 'group/cheap-first', routingKind: 'custom', efforts: ['low', 'high', 'max'], visible: true }]),
    { provider: 'claude', models: [{ id: 'claude/claude-fable-5-2', efforts: ['low', 'high'], visible: true }] },
  ] })
  const sel = (id: string) => host.querySelector(`[data-model="${id}"] select`) as HTMLSelectElement
  expect(sel('group/cheap-first').selectedOptions[0]!.textContent).toBe('默认：不指定')
  expect([...sel('group/cheap-first').options].map(o => o.value)).toEqual(['', 'low', 'high', 'max'])
  expect(sel('claude/claude-fable-5-2').selectedOptions[0]!.textContent).toBe('high')
})
