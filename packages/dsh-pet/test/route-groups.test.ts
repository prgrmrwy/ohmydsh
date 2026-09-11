/**
 * Client boundary for the retired chat→workspace route UI.
 *
 * Legacy route helpers remain on the shared wire until Host persistence is
 * removed, but the Channel settings page must ignore that projection entirely.
 *
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatAppLink, routeGroupOf } from '../src/wire.js'
import { PetSettingsSection } from '../src/client/settings.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('legacy route helpers stay compatible while Host cutover finishes', () => {
  it('still classifies persisted legacy rows without making them current UI', () => {
    expect(routeGroupOf({ kind: 'qa', chatType: 'group' })).toBe('qa')
    expect(routeGroupOf({ kind: 'workspace', chatType: 'group' })).toBe('workspace')
    expect(routeGroupOf({ kind: 'workspace', chatType: 'p2p' })).toBe('direct')
  })

  it('keeps the safe Lark AppLink helper for non-route views', () => {
    expect(chatAppLink('oc_a b&c')).toBe(
      'https://applink.feishu.cn/client/chat/open?openChatId=oc_a%20b%26c',
    )
    expect(chatAppLink('ou_not_a_chat')).toBeUndefined()
  })
})

const READY_LOCUS = {
  childSession: 'verified',
  defaultPermission: 'read',
  readVerification: 'verified',
} as const

/** Reply to every Pet route with one channel payload. */
function stubChannel(unifiedLocus: unknown = READY_LOCUS, enabled = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          ok: true,
          data: {
            onboarding: {
              steps: [
                { id: 'workspace', label: '选择自动主会话的默认工作区', complete: true },
                { id: 'locus', label: '核验统一子会话与默认只读策略', complete: true },
              ],
              ready: true,
              blockers: [],
            },
            bot: { appId: 'cli_x', openId: 'ou_bot' },
            allowOpenIds: ['ou_owner'],
            knownNames: {},
            defaultWorkspaceId: 'ws-1',
            unifiedLocus,
            connection: { phase: enabled ? 'connected' : 'stopped', queueDepth: 99 },
            enabled,
            // Deliberately include every legacy row shape. A new client must
            // not render any of them or expose their mutation controls.
            routes: [
              {
                chatId: 'oc_qa',
                chatName: '旧答疑群',
                chatType: 'group',
                kind: 'qa',
                qaParentSessionId: 's1',
                boundBy: 'user',
                boundAt: 1,
              },
              {
                chatId: 'oc_grp',
                chatName: '旧工作区群',
                chatType: 'group',
                kind: 'workspace',
                workspaceId: 'ws-1',
                activeExecutorSessionId: 'exec-9',
                boundBy: 'auto',
                boundAt: 1,
              },
            ],
            entries: [],
            workspaces: [{ id: 'ws-1', title: '项目A' }],
          },
        }),
    })),
  )
}

async function mountChannel(): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      createElement(PetSettingsSection, { initialTab: 'channel' as const }),
    )
  })
  return host
}

describe('Channel settings use unified onboarding only', () => {
  it('shows main-session placement plus child/read proof', async () => {
    stubChannel()
    const host = await mountChannel()

    expect(host.textContent).toContain('自动主会话默认工作区')
    expect(host.textContent).toContain('仅用于 project 群首次建立协作')
    expect(host.textContent).toContain('统一子会话能力')
    expect(host.textContent).toContain('新关联默认权限')
    expect(host.textContent).toContain('只读（read）')
    expect(host.textContent).toContain('只读策略回读')
  })

  it('fails closed when an older Host omits the capability proof', async () => {
    stubChannel(null, false)
    const host = await mountChannel()
    const enabled = host.querySelector('input[type="checkbox"]') as HTMLInputElement

    expect(enabled.disabled).toBe(true)
    expect(host.textContent).toContain('Host 未返回完整的统一子会话与默认只读核验证明')
  })

  it('does not render legacy routes, workspace overrides or Invocation backlog', async () => {
    stubChannel()
    const host = await mountChannel()

    expect(host.textContent).not.toContain('旧答疑群')
    expect(host.textContent).not.toContain('旧工作区群')
    expect(host.textContent).not.toContain('会话路由')
    expect(host.textContent).not.toContain('排队中的调用')
    expect(host.querySelector('[aria-label="会话路由分类"]')).toBeNull()
  })
})
