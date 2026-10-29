// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SpeedSelect, createSpeedLoader, createSpeedSetter, isMagpieRoute, type ModelDirectories } from '../src/client/SpeedSelect.js'
import { fakeApi, flush, ok } from './client-support/fake-api.js'
import { MagpieAdapter } from '../src/host/adapter.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { SpeedController } from '../src/host/speed.js'
import { registerRoutes, type FetchRegistration } from '../src/host/routes.js'
import { createGateway, json, sse, type RecordedRequest } from './support/gateway.js'
import { credentialsMock } from './support/credentials.js'
import { models, responseText, chatText } from './support/wire.js'
import { LINE_ID, line } from './support/line.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---- UI (SpeedSelect) -------------------------------------------------------

let root: Root
let host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const OWNER = 'dsh-magpie-connector-codex'
const FAST = ['codex/gpt-6.1-sol']
function uiSetup(current: { provider: string; model: string } | null) {
  const state = { current, tier: 'fast' as 'standard' | 'fast' }
  const fake = fakeApi({
    'GET speed': () => ok({ tier: state.tier, fastModels: FAST }),
    'POST speed': request => { state.tier = (request.body as { tier: 'standard' | 'fast' }).tier; return ok({ tier: state.tier, fastModels: FAST }) },
  })
  const models: () => ModelDirectories = () => ({ directoryFor: () => ({ load: async () => ({ current: state.current }) }) })
  return { state, fake, props: { loadSpeed: createSpeedLoader(fake.api, models, 'S'), setSpeed: createSpeedSetter(fake.api, 'S') } }
}
const control = () => host.querySelector('[data-magpie-speed]')
async function mount(props: Parameters<typeof SpeedSelect>[0]) {
  await act(async () => root.render(h(SpeedSelect, props)))
  await flush()
}

describe('Codex 速度切换 UI（归属 route）', () => {
  it('test_owner_speed_02 spec Scenario "归属 route 上显示速度控件"', async () => {
    vi.useFakeTimers()
    const { state, props } = uiSetup({ provider: OWNER, model: 'codex/gpt-6.1-sol' })
    await mount(props)
    expect(control()).not.toBeNull()
    expect(control()?.textContent).toContain('速度 · 快速')
    // the same-named model on a route this plugin does not own: no control
    state.current = { provider: 'codex', model: 'codex/gpt-6.1-sol' }
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    await flush()
    expect(control()).toBeNull()
  })

  it('test_owner_speed_04 spec Scenario "不支持的模型不显示且不带字段"（UI 部分）', async () => {
    const { props } = uiSetup({ provider: OWNER, model: 'deepseek/deepseek-flash' })
    await mount(props)
    expect(control()).toBeNull()
    expect(host.innerHTML).toBe('')
  })

  it('isMagpieRoute 与宿主正则一致：归属 route 通过，裸 route 与越界键被拒', () => {
    for (const id of [OWNER, 'dsh-magpie-connector-a', 'dsh-magpie-connector-claude', 'dsh-magpie-connector-x.y_z-1', `dsh-magpie-connector-${'a'.repeat(48)}`])
      expect(isMagpieRoute(id)).toBe(true)
    for (const id of ['dsh-magpie-connector', 'dsh-magpie-connector-', 'dsh-magpie-connector-Codex', 'dsh-magpie-connector--x', `dsh-magpie-connector-${'a'.repeat(49)}`, 'codex', 'xdsh-magpie-connector-codex'])
      expect(isMagpieRoute(id)).toBe(false)
  })
})

// ---- Host (adapter request body, through the real runtime + gateway) --------

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f() })
const CHAT_PRIORITY = { id: 'codex/gpt-6-luna', owned_by: 'codex', service_tiers: [{ id: 'priority' }] }
const catalog = { data: [...models.data, CHAT_PRIORITY] }
const RESPONSES = 'codex/gpt-6.1-sol'
const DEEPSEEK = 'deepseek/deepseek-flash'

async function hostFixture() {
  const gateway = await createGateway()
  cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json(catalog))
  gateway.handlers.set('POST /v1/responses', sse(responseText()))
  gateway.handlers.set('POST /v1/chat/completions', sse(chatText()))
  const store = new SettingsStore()
  store.value.lines = [line(gateway.baseUrl)]
  const runtime = new MagpieRuntime(credentialsMock('mk-test-123').service, store)
  await runtime.start()
  gateway.requests.length = 0
  cleanup.push(() => runtime.dispose())
  const speed = new SpeedController()
  const adapter = new MagpieAdapter(runtime, undefined, session => speed.get(session).tier === 'fast')
  return { gateway, runtime, speed, adapter }
}
const collect = async (stream: AsyncIterable<StreamChunk>) => { for await (const _ of stream) { /* drain */ } }
const send = (adapter: MagpieAdapter, sessionId: string, model: string, provider = OWNER) =>
  collect(adapter.stream({ provider, model, sessionId: sessionId as never, messages: [{ role: 'user', content: [{ type: 'text', text: 'U' }] }] }))
const bodyOf = (request: RecordedRequest | undefined) => request?.body as Record<string, unknown>

describe('Codex 速度切换（请求体）', () => {
  it('test_owner_speed_01 spec Scenario "快速模式请求带 priority（两种协议）"', async () => {
    const { gateway, speed, adapter } = await hostFixture()
    speed.set('S', 'fast')
    await send(adapter, 'S', RESPONSES)
    await send(adapter, 'S', 'codex/gpt-6-luna')
    const responses = gateway.requests.find(r => r.path === '/v1/responses')
    const chat = gateway.requests.find(r => r.path === '/v1/chat/completions')
    expect(bodyOf(responses)).toMatchObject({ service_tier: 'priority' })
    expect(bodyOf(chat)).toMatchObject({ service_tier: 'priority' })
  })

  it('test_owner_speed_03 spec Scenario "标准模式与其它会话不带字段"', async () => {
    const { gateway, speed, adapter } = await hostFixture()
    speed.set('A', 'fast')
    await send(adapter, 'B', RESPONSES)
    speed.set('A', 'standard')
    await send(adapter, 'A', RESPONSES)
    const [first, second] = gateway.requests.filter(r => r.path === '/v1/responses')
    expect(bodyOf(first)).not.toHaveProperty('service_tier')
    expect(bodyOf(second)).not.toHaveProperty('service_tier')
  })

  it('test_owner_speed_04 spec Scenario "不支持的模型不显示且不带字段"（请求部分）', async () => {
    const { gateway, speed, adapter } = await hostFixture()
    speed.set('S', 'fast')
    await send(adapter, 'S', DEEPSEEK)
    expect(bodyOf(gateway.requests.find(r => r.path === '/v1/chat/completions'))).not.toHaveProperty('service_tier')
  })

  it('test_owner_speed_05 spec Scenario "host 重启后回到标准"', async () => {
    const { gateway, speed, adapter } = await hostFixture()
    speed.set('S', 'fast')
    // simulated restart: a fresh controller and adapter over the same runtime
    const restarted = new SpeedController()
    const after = new MagpieAdapter(adapter.runtime, undefined, session => restarted.get(session).tier === 'fast')
    expect(restarted.get('S').tier).toBe('standard')
    await send(after, 'S', RESPONSES)
    expect(bodyOf(gateway.requests.find(r => r.path === '/v1/responses'))).not.toHaveProperty('service_tier')
  })

  it('test_owner_speed_06 spec Scenario "非法 tier 被拒绝"', async () => {
    const { runtime, speed } = await hostFixture()
    const registrations: FetchRegistration[] = []
    registerRoutes({ register: route => { registrations.push(route); return () => {} } }, runtime, speed)
    const speedRoute = registrations.find(r => r.path === '/api/dsh-magpie-connector/speed')!
    const response = await speedRoute.fetch(new Request('http://localhost/api/dsh-magpie-connector/speed', {
      method: 'POST', body: JSON.stringify({ session: 'S', tier: 'turbo' }),
    }))
    expect(response.status).toBe(400)
    expect(speed.get('S').tier).toBe('standard')
  })
})
