/** @vitest-environment jsdom */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetSettingsSection } from '../src/client/settings.js'
import { ROUTES, type PetChannelView } from '../src/wire.js'

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const baseView: PetChannelView = {
  enabled: false,
  bot: { appId: 'cli_pet', openId: 'ou_petbot', name: 'Pet Bot' },
  allowOpenIds: [],
  knownNames: {},
  routes: [],
  onboarding: {
    ready: false,
    steps: [
      { id: 'bot', label: '绑定 Bot', complete: true },
      { id: 'identity', label: '确认 Bot 身份', complete: true },
      { id: 'allowlist', label: '配置允许成员', complete: false },
      { id: 'workspace', label: '选择默认工作区', complete: false },
      { id: 'subscription', label: '启用并连接', complete: false },
    ],
    blockers: [
      { code: 'allowlist-empty', message: '请先添加至少一位允许触发的成员。' },
      { code: 'default-workspace-missing', message: '请选择默认工作区。' },
    ],
  },
  connection: { phase: 'stopped', queueDepth: 0 },
}

function response(data: unknown) {
  return { status: 200, text: async () => JSON.stringify({ ok: true, data }) }
}

async function mount(view: PetChannelView, mutateView = view) {
  const bodies: unknown[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const path = String(input)
    if (path === ROUTES.petEnv) return response({ entries: [], workspaces: [] })
    if (path === ROUTES.channelMutate) {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      return response(mutateView)
    }
    return response(view)
  }))
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(PetSettingsSection, { initialTab: 'channel' as const }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return { host, bodies }
}

function button(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
}

describe('allowlist pairing settings', () => {
  it('makes pairing primary and keeps manual open_id entry in a disclosure', async () => {
    const { host } = await mount(baseView)
    expect(button(host, '生成配对码')).toBeDefined()
    const disclosure = [...host.querySelectorAll('summary')].find(item =>
      item.textContent?.includes('手动添加 open_id'),
    )
    expect(disclosure).toBeDefined()
    expect(host.textContent).toContain('第一个正确发送者')
  })

  it('starts pairing without selecting a workspace or enabling the channel', async () => {
    const waiting: PetChannelView = {
      ...baseView,
      pairing: { phase: 'waiting', command: '/pair 2345-6789', expiresAt: Date.now() + 300_000 },
    }
    const { host, bodies } = await mount(baseView, waiting)
    await act(async () => button(host, '生成配对码')?.click())

    expect(bodies).toEqual([{ action: 'pair-start' }])
    expect(host.textContent).toContain('/pair 2345-6789')
    expect(host.textContent).toContain('选择默认工作区')
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false)
  })

  it('copies the full command and reports clipboard failure accessibly', async () => {
    const view: PetChannelView = {
      ...baseView,
      pairing: { phase: 'waiting', command: '/pair 2345-6789', expiresAt: Date.now() + 300_000 },
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new Error('denied') }) },
    })
    const { host } = await mount(view)
    await act(async () => {
      button(host, '复制命令')?.click()
      await Promise.resolve()
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/pair 2345-6789')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('复制失败')
  })

  it('reports clipboard API absence instead of failing silently', async () => {
    const view: PetChannelView = {
      ...baseView,
      pairing: { phase: 'waiting', command: '/pair 2345-6789', expiresAt: Date.now() + 300_000 },
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const { host } = await mount(view)
    await act(async () => button(host, '复制命令')?.click())
    expect(host.querySelector('[role="status"]')?.textContent).toContain('复制失败')
  })

  it.each([
    [{ phase: 'starting' as const }, '正在连接飞书事件通道'],
    [{ phase: 'claiming' as const, expiresAt: Date.now() + 10_000 }, '正在安全写入允许成员'],
    [{ phase: 'succeeded' as const, openId: 'ou_owner', name: '张三' }, '配对成功'],
    [{ phase: 'expired' as const }, '配对码已过期'],
    [{ phase: 'failed' as const, diagnostic: '保存失败' }, '保存失败'],
  ])('renders pairing state $phase', async (pairing, expected) => {
    const { host } = await mount({ ...baseView, pairing })
    expect(host.textContent).toContain(expected)
  })
})
