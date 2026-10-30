// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { buttonByText, deferred, expandLine, fakeApi, flush, inputValue, ok, settingsView, type Call } from './client-support/fake-api.js'
import type { ApiResponse } from '../src/client/api.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const savedLine = (id: string, baseUrl: string, overrides: Record<string, unknown> = {}) => ({
  id, baseUrl, accessMode: 'direct', complete: true,
  key: { configured: true, writable: true },
  access: { clientId: { configured: false, writable: true }, clientSecret: { configured: false, writable: true } },
  ...overrides,
})

interface Mounted { host: HTMLElement; root: ReturnType<typeof createRoot>; calls: Call[] }
async function mount(view: Record<string, unknown>, latency: () => ApiResponse | Promise<ApiResponse>): Promise<Mounted> {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({
    'GET settings': () => ok(settingsView(view)),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': latency,
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
  return { host, root, calls: fake.calls }
}
const cleanup = (mounted: Mounted) => { act(() => mounted.root.unmount()); mounted.host.remove() }
const row = (host: HTMLElement, id: string) => host.querySelector(`[data-line-id="${id}"]`)!
const latencyOf = (host: HTMLElement, id: string) => row(host, id).querySelector('[data-latency]') as HTMLElement
const latencyCalls = (calls: Call[]) => calls.filter(call => call.path === 'latency')
const fourLines = {
  lines: [
    savedLine('11111111', 'http://one.test/v1'),
    savedLine('22222222', 'http://two.test/v1'),
    savedLine('33333333', 'http://three.test/v1'),
    savedLine('44444444', 'http://four.test/v1'),
  ],
  activeLineId: '11111111',
}

test('test_line_latency_levels spec Scenario "打开面板后展示四条线路的延迟档位"', async () => {
  const mounted = await mount(fourLines, () => ok({ lines: [
    { id: '11111111', ms: 90 }, { id: '22222222', ms: 240 }, { id: '33333333', ms: 440 }, { id: '44444444', ms: 600 },
  ] }))
  try {
    for (const [id, level, ms] of [['11111111', '4', '90'], ['22222222', '3', '240'], ['33333333', '2', '440'], ['44444444', '1', '600']] as const) {
      const latency = latencyOf(mounted.host, id)
      expect(latency.getAttribute('data-latency-state')).toBe('done')
      expect(latency.getAttribute('data-latency-level')).toBe(level)
      expect(latency.getAttribute('data-latency-ms')).toBe(ms)
      expect(latency.textContent).toContain(`${ms} ms`)
      expect(latency.getAttribute('title')).toContain('TCP 建连耗时')
      expect(latency.querySelectorAll('.dmg-bars i[data-on=true]')).toHaveLength(Number(level))
    }
  } finally { cleanup(mounted) }
})

test('test_line_latency_measuring_idle spec Scenario "测速中占位与无地址行留空"', async () => {
  const gate = deferred<ApiResponse>()
  const view = {
    lines: [savedLine('11111111', 'http://one.test/v1'), savedLine('22222222', '')],
    activeLineId: '11111111',
  }
  const mounted = await mount(view, () => gate.promise)
  try {
    expect(latencyOf(mounted.host, '11111111').getAttribute('data-latency-state')).toBe('measuring')
    expect(mounted.host.textContent).toContain('测速中…')
    expect(latencyOf(mounted.host, '22222222').getAttribute('data-latency-state')).toBe('idle')
    act(() => buttonByText(mounted.host, '添加备用线路')!.click())
    const draft = mounted.host.querySelector('[data-draft] [data-latency]') as HTMLElement
    expect(draft.getAttribute('data-latency-state')).toBe('idle')
    expect(draft.textContent).toBe('')
    act(() => gate.resolve(ok({ lines: [{ id: '11111111', ms: 42 }] })))
    await flush()
    expect(latencyOf(mounted.host, '11111111').getAttribute('data-latency-ms')).toBe('42')
  } finally { cleanup(mounted) }
})

test('test_line_latency_timeout spec Scenario "超时显示"', async () => {
  const mounted = await mount({ lines: [savedLine('22222222', 'http://two.test/v1')], activeLineId: '22222222' }, () => ok({ lines: [{ id: '22222222', ms: null }] }))
  try {
    const latency = latencyOf(mounted.host, '22222222')
    expect(latency.getAttribute('data-latency-state')).toBe('done')
    expect(latency.getAttribute('data-latency-level')).toBe('0')
    expect(latency.getAttribute('data-latency-ms')).toBe('')
    expect(latency.textContent).toContain('超时')
    expect(latency.querySelectorAll('.dmg-bars i[data-on=true]')).toHaveLength(0)
  } finally { cleanup(mounted) }
})

test('test_line_latency_failed spec Scenario "测速请求失败静默降级为破折号"', async () => {
  const view = { lines: [savedLine('11111111', 'http://one.test/v1'), savedLine('22222222', '')], activeLineId: '11111111' }
  const mounted = await mount(view, () => ({ status: 500, body: { error: 'boom' } }))
  try {
    const latency = latencyOf(mounted.host, '11111111')
    expect(latency.getAttribute('data-latency-state')).toBe('failed')
    expect(latency.textContent).toBe('—')
    expect(latencyOf(mounted.host, '22222222').getAttribute('data-latency-state')).toBe('idle')
    expect(latencyOf(mounted.host, '22222222').textContent).toBe('')
    expect(mounted.host.querySelectorAll('[role="alert"]')).toHaveLength(0)
    expect(mounted.host.querySelector('[aria-live]')).toBeNull()
    expect(mounted.host.querySelectorAll('[data-line-id]')).toHaveLength(2)
    const usage = mounted.host.querySelector('[aria-label="用量"]') as HTMLElement
    expect(usage).not.toBeNull()
    expect(usage.getAttribute('data-usage-state')).toBe('empty')
  } finally { cleanup(mounted) }
})

test('test_line_latency_404 spec Scenario "旧 host 没有 latency 资源时静默降级"', async () => {
  const view = { lines: [savedLine('11111111', 'http://one.test/v1'), savedLine('22222222', '')], activeLineId: '11111111' }
  const mounted = await mount(view, () => ({ status: 404, body: { error: 'not found' } }))
  try {
    expect(latencyOf(mounted.host, '11111111').getAttribute('data-latency-state')).toBe('failed')
    expect(latencyOf(mounted.host, '22222222').getAttribute('data-latency-state')).toBe('idle')
    expect(mounted.host.querySelectorAll('[data-line-id]')).toHaveLength(2)
    expect(buttonByText(mounted.host, '添加备用线路')).not.toBeNull()
    expect(mounted.host.querySelectorAll('[role="alert"]')).toHaveLength(0)
  } finally { cleanup(mounted) }
})

test('test_line_latency_scope_ui spec Scenario "打开面板对每条已保存且地址可解析的线路测一次"', async () => {
  const view = {
    lines: [
      savedLine('11111111', 'http://one.test/v1'),
      savedLine('22222222', 'http://keyless.test/v1', { complete: false, key: { configured: false, writable: true } }),
    ],
    activeLineId: '11111111',
  }
  const mounted = await mount(view, () => ok({ lines: [{ id: '11111111', ms: 20 }, { id: '22222222', ms: 40 }] }))
  try {
    expect(latencyCalls(mounted.calls)).toHaveLength(1)
    expect(latencyOf(mounted.host, '11111111').getAttribute('data-latency-state')).toBe('done')
    expect(latencyOf(mounted.host, '22222222').getAttribute('data-latency-state')).toBe('done')
    expect(latencyOf(mounted.host, '22222222').textContent).toContain('40 ms')
  } finally { cleanup(mounted) }
})

test('test_line_latency_no_polling spec Scenario "不轮询且不改变线路选择"', async () => {
  const mounted = await mount({ lines: [savedLine('11111111', 'http://one.test/v1')], activeLineId: '11111111' }, () => ok({ lines: [{ id: '11111111', ms: 15 }] }))
  try {
    const before = latencyCalls(mounted.calls).length
    await new Promise(resolve => setTimeout(resolve, 20))
    await flush()
    expect(latencyCalls(mounted.calls)).toHaveLength(before)
    expect(mounted.calls.filter(call => call.method === 'POST')).toHaveLength(0)
  } finally { cleanup(mounted) }
})

test('test_line_latency_remeasure_on_save spec Scenario "保存线路后重新测速"', async () => {
  let round = 0
  const updated = { lines: [savedLine('11111111', 'http://moved.test/v1')], activeLineId: '11111111' }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ lines: [savedLine('11111111', 'http://one.test/v1')], activeLineId: '11111111' })),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => ok({ lines: [{ id: '11111111', ms: round++ === 0 ? 30 : 80 }] }),
    'POST settings': () => ok(settingsView(updated)),
  })
  try {
    await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
    expect(latencyOf(host, '11111111').textContent).toContain('30 ms')
    act(() => expandLine(host, '11111111'))
    act(() => inputValue(row(host, '11111111').querySelector('input:not([type=password])') as HTMLInputElement, 'http://moved.test/v1'))
    await act(async () => buttonByText(host, '保存')!.click()); await flush()
    expect(latencyCalls(fake.calls)).toHaveLength(2)
    expect(latencyOf(host, '11111111').textContent).toContain('80 ms')
  } finally { act(() => root.unmount()); host.remove() }
})

test('test_line_latency_no_remeasure_on_resync spec Scenario "刷新模型列表不重新测速"', async () => {
  const view = { lines: [savedLine('11111111', 'http://one.test/v1')], activeLineId: '11111111' }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({
    'GET settings': () => ok(settingsView(view)),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => ok({ lines: [{ id: '11111111', ms: 25 }] }),
    'POST settings': () => ok(settingsView(view)),
  })
  try {
    await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
    await act(async () => buttonByText(host, '刷新模型列表')!.click()); await flush()
    expect(latencyCalls(fake.calls)).toHaveLength(1)
    expect(latencyOf(host, '11111111').textContent).toContain('25 ms')
  } finally { act(() => root.unmount()); host.remove() }
})

test('test_line_latency_silence spec Scenario "延迟变化与测速失败不产生提示"', async () => {
  let failing = false
  const updated = { lines: [savedLine('11111111', 'http://moved.test/v1')], activeLineId: '11111111' }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({
    'GET settings': () => ok(settingsView({ lines: [savedLine('11111111', 'http://one.test/v1')], activeLineId: '11111111' })),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'GET latency': () => failing ? { status: 502, body: { error: 'bad gateway' } } : ok({ lines: [{ id: '11111111', ms: 30 }] }),
    'POST settings': () => ok(settingsView(updated)),
  })
  try {
    await act(async () => root.render(h(MagpieSettings, { api: fake.api }))); await flush()
    failing = true
    act(() => expandLine(host, '11111111'))
    act(() => inputValue(row(host, '11111111').querySelector('input:not([type=password])') as HTMLInputElement, 'http://moved.test/v1'))
    await act(async () => buttonByText(host, '保存')!.click()); await flush()
    expect(latencyOf(host, '11111111').getAttribute('data-latency-state')).toBe('failed')
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0)
    expect(host.querySelector('[aria-live]')).toBeNull()
    // The save banner and the usage re-read keep their existing status roles.
    expect(host.textContent).toContain('已保存')
  } finally { act(() => root.unmount()); host.remove() }
})
