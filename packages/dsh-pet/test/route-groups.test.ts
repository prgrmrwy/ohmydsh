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

async function mountTab(initialTab: 'channel' | 'locus' = 'channel'): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  await act(async () => {
    createRoot(host).render(
      createElement(PetSettingsSection, { initialTab }),
    )
  })
  return host
}

const LOCUS_VIEW = {
  locusId: 'locus-1',
  generation: 1,
  endpoint: { chatId: 'oc_qa', chatType: 'group', chatName: '答疑群' },
  main: { sessionId: 's1', title: '主会话', availability: 'available' },
  child: { sessionId: 'child-1', title: '子会话', availability: 'available' },
  workspace: { workspaceId: 'ws-1', title: '项目A' },
  permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
  state: { state: 'active', busy: false, createdAt: 1, updatedAt: 1 },
  source: 'explicit',
  isDefaultQa: false,
} as const

/** Reply to the owner-facing locus route with one current generation. */
function stubLocus(locus = LOCUS_VIEW): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        data: {
          generation: 1,
          loci: [locus],
          defaultQa: [],
          discovery: { byEndpoint: [], byParent: [], byChild: [] },
        },
      }),
    })),
  )
}

describe('Channel settings use unified onboarding only', () => {
  it('shows main-session placement plus child/read proof', async () => {
    stubChannel()
    const host = await mountTab()

    expect(host.textContent).toContain('自动主会话默认工作区')
    expect(host.textContent).toContain('仅用于 project 群首次建立协作')
    expect(host.textContent).toContain('统一子会话能力')
    expect(host.textContent).toContain('新关联默认权限')
    expect(host.textContent).toContain('只读（read）')
    expect(host.textContent).toContain('只读策略回读')
  })

  it('fails closed when an older Host omits the capability proof', async () => {
    stubChannel(null, false)
    const host = await mountTab()
    const enabled = host.querySelector('input[type="checkbox"]') as HTMLInputElement

    expect(enabled.disabled).toBe(true)
    expect(host.textContent).toContain('Host 未返回完整的统一子会话与默认只读核验证明')
  })

  it('does not render legacy routes, workspace overrides or Invocation backlog', async () => {
    stubChannel()
    const host = await mountTab()

    expect(host.textContent).not.toContain('旧答疑群')
    expect(host.textContent).not.toContain('旧工作区群')
    expect(host.textContent).not.toContain('会话路由')
    expect(host.textContent).not.toContain('排队中的调用')
    expect(host.querySelector('[aria-label="会话路由分类"]')).toBeNull()
  })
})

describe('an archived session is refused before the click, not after', () => {
  it('disables the control and says why', async () => {
    const opened: string[] = []
    const { setSessionOpener } = await import('../src/client/settings.js')
    setSessionOpener(id => opened.push(id))
    // The Host marks the current Locus session: the shell silently lands on
    // the home page for an archived id, so the reason must be visible without
    // clicking. The retired legacy route projection stays absent from UI.
    stubLocus({ ...LOCUS_VIEW, main: { ...LOCUS_VIEW.main, availability: 'archived' as const } })
    const host = await mountTab('locus')

    const button = [...host.querySelectorAll('button')].find(
      item => item.textContent === '主会话已归档',
    ) as HTMLButtonElement | undefined
    expect(button).toBeDefined()
    expect(button?.disabled).toBe(true)
    expect(button?.title).toContain('已归档')

    await act(async () => {
      button?.click()
    })
    // Even if a click reaches it, no navigation is attempted.
    expect(opened).toEqual([])
    setSessionOpener(undefined)
  })

  it('still opens and dismisses the panel when the session is live', async () => {
    const opened: string[] = []
    const closed: number[] = []
    const { setSessionOpener, setSettingsCloser } = await import('../src/client/settings.js')
    setSessionOpener(id => opened.push(id))
    setSettingsCloser(() => closed.push(1))
    stubLocus()
    const host = await mountTab('locus')

    await act(async () => {
      ;([...host.querySelectorAll('button')].find(
        item => item.textContent === '打开主会话',
      ) as HTMLButtonElement | undefined)?.click()
    })

    expect(opened).toEqual(['s1'])
    // Navigating behind the modal panel would leave it covering the target.
    expect(closed).toEqual([1])
    setSessionOpener(undefined)
    setSettingsCloser(undefined)
  })
})
