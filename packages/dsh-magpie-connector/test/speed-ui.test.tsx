// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SpeedSelect, createSpeedLoader, createSpeedSetter, type ModelDirectories, type Tier } from '../src/client/SpeedSelect.js'
import { deferred, fakeApi, flush, ok } from './client-support/fake-api.js'
import type { ApiResponse } from '../src/client/api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const FAST = ['codex/gpt-6.1-sol', 'codex/gpt-6-luna']
function setup(current: { provider: string; model: string } | null, extra: Parameters<typeof fakeApi>[0] = {}) {
  const state = { current, tier: 'fast' as 'standard' | 'fast' }
  const fake = fakeApi({
    'GET speed': () => ok({ tier: state.tier, fastModels: FAST }),
    'POST speed': request => { state.tier = (request.body as { tier: 'standard' | 'fast' }).tier; return ok({ tier: state.tier, fastModels: FAST }) },
    ...extra,
  })
  const models: () => ModelDirectories = () => ({ directoryFor: () => ({ load: async () => ({ current: state.current }) }) })
  const props = { loadSpeed: createSpeedLoader(fake.api, models, 'S'), setSpeed: createSpeedSetter(fake.api, 'S') }
  return { state, fake, props }
}
const control = () => host.querySelector('[data-magpie-speed]')
const trigger = () => control()!.querySelector('button[aria-haspopup]') as HTMLButtonElement
const option = (tier: Tier) => control()!.querySelector(`[role=menuitemradio][data-tier=${tier}]`) as HTMLButtonElement
const label = (tier: Tier) => `速度 · ${tier === 'fast' ? '快速' : '标准'}`
const supported = { provider: 'dsh-magpie-connector', model: 'codex/gpt-6.1-sol' }
const unsupported = { provider: 'dsh-magpie-connector', model: 'deepseek/deepseek-flash' }
async function mount(props: Parameters<typeof SpeedSelect>[0]) {
  await act(async () => root.render(h(SpeedSelect, props)))
  await flush()
}
async function poll() { await act(async () => vi.advanceTimersByTimeAsync(3000)); await flush() }

describe('Codex 速度切换（输入框控件）', () => {
  it('spec Scenario "不支持的模型不显示且不带字段"', async () => {
    vi.useFakeTimers()
    const { state, props, fake } = setup(supported)
    await mount(props)
    expect(control()?.textContent).toContain('速度 · 快速')
    state.current = unsupported
    await act(async () => vi.advanceTimersByTimeAsync(2999))
    expect(control()).not.toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    await flush()
    expect(control()).toBeNull()
    expect(host.innerHTML).toBe('')
    state.current = supported
    await poll()
    expect(control()?.textContent).toContain('速度 · 快速')
    expect(fake.calls.filter(c => c.method === 'GET')).toHaveLength(3)
  })

  it('另一 route 上的同名模型不显示速度控件', async () => {
    const { props } = setup({ provider: 'codex', model: 'codex/gpt-6.1-sol' })
    await act(async () => root.render(h(SpeedSelect, props)))
    await flush()
    expect(control()).toBeNull()
  })

  it('选择标准时 POST {session, tier: "standard"}，标签随之更新', async () => {
    const { fake, props } = setup({ provider: 'dsh-magpie-connector', model: 'codex/gpt-6.1-sol' })
    await act(async () => root.render(h(SpeedSelect, props)))
    await flush()
    await act(async () => (control()!.querySelector('button[aria-haspopup]') as HTMLButtonElement).click())
    await flush()
    await act(async () => (control()!.querySelector('[role=menuitemradio][data-tier=standard]') as HTMLButtonElement).click())
    await flush()
    expect(fake.calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', path: 'speed', body: { session: 'S', tier: 'standard' } }])
    expect(fake.calls.find(c => c.method === 'GET')).toEqual({ method: 'GET', path: 'speed', query: { session: 'S' } })
    expect(control()?.textContent).toContain('速度 · 标准')
  })
})

describe('速度读写竞态（真实 API Promise 与 DOM）', () => {
  it.each([
    ['poll', 'fast', 'standard'], ['menu', 'fast', 'standard'],
    ['poll', 'standard', 'fast'], ['menu', 'standard', 'fast'],
  ] as const)('%s 的旧 GET 晚于 %s → %s POST 成功，不得回滚已确认档位', async (source, before, after) => {
    vi.useFakeTimers()
    const oldRead = deferred<ApiResponse>()
    let reads = 0
    const { props, state, fake } = setup(supported, {
      'GET speed': () => ++reads === 2 ? oldRead.promise : ok({ tier: state.tier, fastModels: FAST }),
    })
    state.tier = before
    await mount(props)
    if (source === 'poll') await poll()
    await act(async () => trigger().click())
    await act(async () => option(after).click())
    expect(fake.calls.filter(c => c.method === 'POST').map(c => c.body)).toEqual([{ session: 'S', tier: after }])
    expect(trigger().textContent).toBe(label(after))
    await act(async () => oldRead.resolve(ok({ tier: before, fastModels: FAST })))
    await flush()
    expect(trigger().textContent).toBe(label(after))
  })

  it('菜单 GET 和轮询共享读版本，后发 GET 先返回后不能被旧 poll 覆盖', async () => {
    vi.useFakeTimers()
    const oldPoll = deferred<ApiResponse>()
    const newMenu = deferred<ApiResponse>()
    let reads = 0
    const { props } = setup(supported, {
      'GET speed': () => ++reads === 1 ? ok({ tier: 'fast', fastModels: FAST }) : reads === 2 ? oldPoll.promise : newMenu.promise,
    })
    await mount(props)
    await poll()
    await act(async () => trigger().click())
    await act(async () => newMenu.resolve(ok({ tier: 'standard', fastModels: FAST })))
    expect(trigger().textContent).toBe(label('standard'))
    await act(async () => oldPoll.resolve(ok({ tier: 'fast', fastModels: FAST })))
    expect(trigger().textContent).toBe(label('standard'))
  })

  it('写开始就使旧 GET 失效，写期间不得显示尚未确认的档位', async () => {
    const oldMenu = deferred<ApiResponse>()
    const save = deferred<ApiResponse>()
    let reads = 0
    const { props, state } = setup(supported, {
      'GET speed': () => ++reads === 2 ? oldMenu.promise : ok({ tier: state.tier, fastModels: FAST }),
      'POST speed': () => save.promise,
    })
    await mount(props)
    await act(async () => trigger().click())
    await act(async () => option('standard').click())
    await act(async () => oldMenu.resolve(ok({ tier: 'standard', fastModels: FAST })))
    expect(trigger().textContent).toBe(label('fast'))
    expect(option('fast').getAttribute('aria-checked')).toBe('true')
    expect(trigger().disabled).toBe(true)
    state.tier = 'standard'
    await act(async () => save.resolve(ok({ tier: 'standard' })))
    expect(trigger().textContent).toBe(label('standard'))
  })

  it('模型在 POST 期间切为不支持，成功不得复活控件，切回后保留新档位', async () => {
    vi.useFakeTimers()
    const save = deferred<ApiResponse>()
    const { props, state, fake } = setup(supported, { 'POST speed': () => save.promise })
    await mount(props)
    await act(async () => trigger().click())
    await act(async () => option('standard').click())
    state.current = unsupported
    await poll()
    expect(control()).toBeNull()
    state.tier = 'standard'
    const readsBeforeSave = fake.calls.filter(c => c.method === 'GET').length
    await act(async () => save.resolve(ok({ tier: 'standard' })))
    await flush()
    expect(control()).toBeNull()
    expect(fake.calls.filter(c => c.method === 'GET').length).toBeGreaterThan(readsBeforeSave)
    state.current = supported
    await poll()
    expect(trigger().textContent).toBe(label('standard'))
    expect(host.querySelector('[role=menu]')).toBeNull()
  })

  it.each(['false', 'rejection'] as const)('保存 %s 保留已确认 tier 并提示重试，重试成功清除提示', async outcome => {
    let saves = 0
    const setSpeed = vi.fn(async () => {
      if (++saves > 1) return true
      if (outcome === 'rejection') throw new Error('SAVE_FAILED')
      return false
    })
    const { props, state } = setup(supported)
    await mount({ ...props, setSpeed })
    await act(async () => trigger().click())
    await act(async () => option('standard').click())
    await flush()
    expect(trigger().textContent).toBe(label('fast'))
    expect(option('fast').getAttribute('aria-checked')).toBe('true')
    expect(trigger().disabled).toBe(false)
    expect(host.querySelector('[role=alert]')?.textContent).toBe('速度未保存，请重试')
    state.tier = 'standard'
    await act(async () => option('standard').click())
    await flush()
    expect(trigger().textContent).toBe(label('standard'))
    expect(host.querySelector('[role=alert]')).toBeNull()
    expect(setSpeed).toHaveBeenCalledTimes(2)
  })

  it.each(['read', 'write'] as const)('卸载后晚到的 %s 不再提交状态或触发新读取', async pending => {
    vi.useFakeTimers()
    const oldRead = deferred<ApiResponse>()
    const save = deferred<ApiResponse>()
    let reads = 0
    const { props, fake } = setup(supported, {
      'GET speed': () => ++reads === 2 ? oldRead.promise : ok({ tier: 'fast', fastModels: FAST }),
      'POST speed': () => save.promise,
    })
    await mount(props)
    await act(async () => trigger().click())
    if (pending === 'write') await act(async () => option('standard').click())
    await act(async () => root.render(null))
    const callCount = fake.calls.length
    await act(async () => { oldRead.resolve(ok({ tier: 'fast', fastModels: FAST })); save.resolve(ok({ tier: 'standard' })) })
    await poll()
    expect(host.innerHTML).toBe('')
    expect(fake.calls).toHaveLength(callCount)
  })
})

describe('client 注册', () => {
  it('apply 注册设置页与 conversation.input.right 速度栏', async () => {
    const { apply } = await import('../src/client/index.js')
    const registered: { name: string; id: string; inject?: (s: string) => any }[] = []
    const ctx = {
      slots: { inject: (_: string, run: () => unknown) => { run() }, register: (r: any) => { registered.push(r); return () => {} } },
      get: () => undefined,
      effect: () => {},
    }
    const fake = fakeApi({ 'GET speed': () => ok({ tier: 'fast', fastModels: FAST }) })
    apply(ctx, fake.api)
    expect(registered.map(r => `${r.name}#${r.id}`)).toEqual(['settings.section#dsh-magpie-connector', 'conversation.input.right#dsh-magpie-connector-speed'])
    // no model-selection service: the control stays hidden
    const state = await registered[1]!.inject!('S').loadSpeed()
    expect(state.visible).toBe(false)
  })
})
