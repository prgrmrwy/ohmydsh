// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { buttonByText, fakeApi, flush, ok, settingsView, text } from './client-support/fake-api.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const future = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
const card = (overrides: Record<string, unknown> = {}) => ({
  provider: 'codex', user: 'u@example.com', readAt: '2026-11-03T10:00:00Z',
  windows: [{ name: '7 days', used: 85, resetsAt: future(3) }],
  resets: { count: 2, redeemable: true, each: [{ until: future(2) }, { until: future(20) }] }, ...overrides,
})
const cardsOk = (cards: unknown[]) => ok({ status: 'ok', cards })
const group = () => host.querySelector('[data-provider="codex"]')!
const useButton = () => group().querySelector('[data-reset-use]') as HTMLButtonElement | null
const dialog = () => host.querySelector('[data-reset-dialog]')
const confirmButton = () => host.querySelector('[data-reset-confirm]') as HTMLButtonElement | null
const acknowledge = () => host.querySelector('[data-reset-acknowledge]') as HTMLInputElement | null
const statusLine = () => host.querySelector('[data-reset-status]')

async function render(handlers: Parameters<typeof fakeApi>[0]) {
  const fake = fakeApi({ 'GET settings': () => ok(settingsView()), 'GET cards': () => cardsOk([card()]), ...handlers })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api })))
  await flush()
  return fake
}
const click = async (element: HTMLElement | null) => { expect(element).not.toBeNull(); await act(async () => element!.click()) }

describe('使用 Codex 重置卡（确认流程）', () => {
  it('spec Scenario "完整两段确认并成功"', async () => {
    const fake = await render({
      'POST reset': request => {
        const body = request.body as { action: string; ticket?: string }
        if (body.action === 'prepare') return ok({ ticket: 'tk1', expiresAt: future(0), weeklyUsedPercent: 85, creditExpiresAt: future(2) })
        return ok({ outcome: 'reset', code: 'reset', windows: 2, cards: [card({ readAt: '2026-11-03T11:00:00Z', windows: [{ name: '7 days', used: 0, resetsAt: future(7) }] })] })
      },
    })
    await click(useButton())
    // 确认框：账号、周用量、到期时间、警告
    expect(dialog()).not.toBeNull()
    expect(text(dialog())).toContain('确认完整重置')
    expect(text(dialog())).toContain('u@example.com')
    expect(text(dialog())).toContain('85%')
    expect(text(dialog())).toContain('无法撤销')
    // 勾选前确认按钮不可用
    expect(confirmButton()!.disabled).toBe(true)
    const confirmCallsBefore = fake.calls.filter(call => call.path === 'reset').length
    await click(confirmButton())
    expect(fake.calls.filter(call => call.path === 'reset')).toHaveLength(confirmCallsBefore)

    await act(async () => {
      acknowledge()!.click()
    })
    expect(confirmButton()!.disabled).toBe(false)
    await click(confirmButton())
    await flush()

    expect(fake.calls.filter(call => call.path === 'reset').map(call => (call.body as { action: string }).action)).toEqual(['prepare', 'consume'])
    expect(fake.calls.at(-1)?.body).toEqual({ action: 'consume', ticket: 'tk1' })
    expect(dialog()).toBeNull()
    // 结果写回卡片，并用响应里的卡片更新读数
    expect(text(statusLine())).toContain('重置已确认')
    expect(text(statusLine())).toContain('2 个窗口已重置')
    expect(group().querySelector('[data-field="readAt"] time')?.getAttribute('datetime')).toBe('2026-11-03T11:00:00Z')
    expect(statusLine()?.getAttribute('data-reset-status')).toBe('ok')
  })

  it('取消不发消费请求', async () => {
    const fake = await render({ 'POST reset': () => ok({ ticket: 'tk1', weeklyUsedPercent: 85 }) })
    await click(useButton())
    await click(buttonByText(dialog()!, '取消')!)
    await flush()
    expect(dialog()).toBeNull()
    expect(fake.calls.filter(call => call.path === 'reset').map(call => (call.body as { action: string }).action)).toEqual(['prepare'])
  })

  it('门槛未达时使用按钮不可点，且不发请求', async () => {
    const fake = await render({
      'GET cards': () => cardsOk([card({ windows: [{ name: '7 days', used: 49, resetsAt: future(3) }] })]),
      'POST reset': () => ok({ ticket: 'tk1' }),
    })
    const button = useButton()!
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.title).toContain('80%')
    await click(button)
    expect(fake.calls.filter(call => call.path === 'reset')).toHaveLength(0)
    expect(dialog()).toBeNull()
  })

  it('spec Scenario "结果不确定时锁定"（host 报 uncertain）', async () => {
    const fake = await render({
      'POST reset': request => (request.body as { action: string }).action === 'prepare'
        ? ok({ ticket: 'tk1', weeklyUsedPercent: 85 })
        : { status: 502, body: { outcome: 'uncertain', error: 'MAGPIE_RESET_UNCERTAIN: socket hang up' } },
    })
    await click(useButton())
    await act(async () => { acknowledge()!.click() })
    await click(confirmButton())
    await flush()
    expect(text(statusLine())).toContain('结果无法确认')
    expect(text(statusLine())).toContain('不要')
    expect(statusLine()?.getAttribute('data-reset-status')).toBe('warn')
    // 不自动重试
    expect(fake.calls.filter(call => call.path === 'reset').map(call => (call.body as { action: string }).action)).toEqual(['prepare', 'consume'])
  })

  it('已有重置在进行时提示等待', async () => {
    await render({ 'POST reset': () => ({ status: 409, body: { error: 'MAGPIE_RESET_BUSY' } }) })
    await click(useButton())
    await flush()
    expect(text(statusLine())).toContain('已有重置操作在进行')
    expect(dialog()).toBeNull()
  })

  it('确认过期时提示重新开始', async () => {
    await render({
      'POST reset': request => (request.body as { action: string }).action === 'prepare'
        ? ok({ ticket: 'tk1', weeklyUsedPercent: 85 })
        : { status: 409, body: { error: 'MAGPIE_RESET_TICKET_EXPIRED' } },
    })
    await click(useButton())
    await act(async () => { acknowledge()!.click() })
    await click(confirmButton())
    await flush()
    expect(text(statusLine())).toContain('确认已过期')
  })

  it('网关明确拒绝时显示原因并允许重来', async () => {
    let consumed = 0
    const fake = await render({
      'POST reset': request => {
        const body = request.body as { action: string }
        if (body.action === 'prepare') return ok({ ticket: 'tk1', weeklyUsedPercent: 85 })
        consumed += 1
        return ok({ outcome: 'unconsumed', error: 'HTTP 401: gateway key is read-only' })
      },
    })
    await click(useButton())
    await act(async () => { acknowledge()!.click() })
    await click(confirmButton())
    await flush()
    expect(text(statusLine())).toContain('401')
    expect(text(statusLine())).toContain('没有执行重置')
    // 4xx 未消耗：可以再次准备
    await click(useButton())
    await flush()
    expect(dialog()).not.toBeNull()
    expect(fake.calls.filter(call => call.path === 'reset').map(call => (call.body as { action: string }).action)).toEqual(['prepare', 'consume', 'prepare'])
    expect(consumed).toBe(1)
  })

  it('prepared 失败时把原因写在卡片上', async () => {
    await render({ 'POST reset': () => ({ status: 502, body: { error: 'MAGPIE_RESET_READ_FAILED: bad gateway' } }) })
    await click(useButton())
    await flush()
    expect(text(statusLine())).toContain('无法读取最新用量')
    expect(dialog()).toBeNull()
  })

  it('没有可用重置的卡片没有使用按钮', async () => {
    await render({ 'GET cards': () => cardsOk([card({ resets: { count: 1, each: [{ until: future(2) }] } })]) })
    expect(useButton()).toBeNull()
  })
})

/** The dialog is a plain element, so nothing about it depends on the shell's modal service. */
describe('确认框是可渲染的 dialog 元素', () => {
  it('渲染为 <dialog open>，不依赖 showModal', async () => {
    await render({ 'POST reset': () => ok({ ticket: 'tk1', weeklyUsedPercent: 85 }) })
    await click(useButton())
    const element = dialog()!.querySelector('dialog')
    expect(element?.hasAttribute('open')).toBe(true)
    expect(typeof (element as unknown as { showModal?: unknown }).showModal).toBe('undefined')
  })
})
