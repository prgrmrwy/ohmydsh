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
    setSessionOpener(target => opened.push(JSON.stringify(target)))
    // The Host marks the current Locus session: the shell silently lands on
    // the home page for an archived id, so the reason must be visible without
    // clicking. The retired legacy route projection stays absent from UI.
    stubLocus({ ...LOCUS_VIEW, main: { ...LOCUS_VIEW.main, availability: 'archived' as const } })
    const host = await mountTab('locus')

    // An archived parent is hidden by default, so what the owner sees first is
    // the reason and a way back — not a control that looks live but refuses.
    expect(host.textContent).toContain('已隐藏 1 个父会话（已归档）')
    expect(host.querySelector('.dshpet-work-name')).toBeNull()

    const reveal = [...host.querySelectorAll('button')].find(
      item => item.textContent?.startsWith('显示全部'),
    ) as HTMLButtonElement | undefined
    expect(reveal).toBeDefined()
    await act(async () => {
      reveal?.click()
    })

    // Revealed, the parent session still is not offered as a control: the title
    // becomes a static label carrying the reason, and the availability is stated
    // in words beside it, so the reason needs no hover either.
    const name = host.querySelector('.dshpet-work-name') as HTMLElement | undefined
    expect(name).toBeDefined()
    expect(name?.dataset.static).toBe('true')
    expect(name?.title).toContain('已归档')
    expect([...host.querySelectorAll('.dshpet-meta')].some(node => node.textContent === '已归档')).toBe(true)
    // Nothing navigated, and no click can: there is no button for it.
    expect(opened).toEqual([])
    setSessionOpener(undefined)
  })

    it('still opens and dismisses the panel when the session is live', async () => {
    const opened: string[] = []
    const closed: number[] = []
    const { setSessionOpener, setSettingsCloser } = await import('../src/client/settings.js')
    setSessionOpener(target => opened.push(JSON.stringify(target)))
    setSettingsCloser(() => closed.push(1))
    stubLocus()
    const host = await mountTab('locus')

    await act(async () => {
      ;([...host.querySelectorAll('button')].find(
        item => item.classList.contains('dshpet-work-name'),
      ) as HTMLButtonElement | undefined)?.click()
    })

    expect(opened).toEqual([JSON.stringify({ kind: 'session', sessionId: 's1' })])
    // Navigating behind the modal panel would leave it covering the target.
    expect(closed).toEqual([1])
    setSessionOpener(undefined)
    setSettingsCloser(undefined)
  })
})

describe('a stopped entry is hidden by default yet recoverable', () => {
  it('reveals the tombstone with a rebuild control on its row', async () => {
    // The Host refuses a stopped endpoint until an explicit rebuild
    // (`repository.ts`), so the default list must not show it as live. It must
    // also not read as deleted: 显示全部 is the only way to the row, and 重建 —
    // the only way out — has to be on that row rather than two disclosures deep.
    const bodies: string[] = []
    const stopped = {
      ...LOCUS_VIEW,
      endpoint: { ...LOCUS_VIEW.endpoint, chatId: 'oc_stopped' },
      state: { state: 'stopped', busy: false, createdAt: 1, updatedAt: 2, stoppedAt: 2 },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: { readonly body?: string }) => {
        if (init?.body !== undefined) bodies.push(init.body)
        return {
          status: 200,
          text: async () => JSON.stringify({
            ok: true,
            data: {
              generation: 1,
              loci: [stopped],
              defaultQa: [],
              discovery: { byEndpoint: [], byParent: [], byChild: [] },
            },
          }),
        }
      }),
    )
    const host = await mountTab('locus')

    expect(host.textContent).toContain('已隐藏 1 个入口')
    expect(host.textContent).toContain('（按状态：已停止 1）')
    expect(host.querySelector('.dshpet-locus-row')).toBeNull()
    // The filter button states the condition even while the popover is shut, so
    // a missing entry is explained without opening anything.
    expect(host.textContent).toContain('入口：在服务')

    const reveal = [...host.querySelectorAll('button')].find(
      item => item.textContent?.startsWith('显示全部'),
    ) as HTMLButtonElement | undefined
    expect(reveal).toBeDefined()
    await act(async () => {
      reveal?.click()
    })

    expect(host.querySelector('.dshpet-locus-row')).not.toBeNull()
    const rebuild = [...host.querySelectorAll('button')].find(
      item => item.textContent === '重建',
    ) as HTMLButtonElement | undefined
    expect(rebuild).toBeDefined()
    expect(rebuild?.disabled).toBe(false)

    await act(async () => {
      rebuild?.click()
    })

    const sent = bodies.map(body => JSON.parse(body) as Record<string, unknown>).find(
      body => body['action'] === 'rebuild',
    )
    // The fence addresses the generation on screen: a rebuild that hit a
    // different one would be a silent replacement.
    expect(sent).toMatchObject({
      action: 'rebuild',
      locusId: 'locus-1',
      expectedGeneration: 1,
      expectedUpdatedAt: 2,
      parentSessionId: 's1',
    })
  })
})

describe('a locus child opens through its durable parent address', () => {
  it('addresses the subagent child by parent, never by bare session id', async () => {
    // The Host refuses `origin === 'subagent'` addressed by bare session id
    // (`session/agent-busy`: owned by subagent routing). Opening a locus child
    // by its own id therefore always failed, and the management view was the
    // only way in — so the owner could not reach the child at all.
    const opened: unknown[] = []
    const { setSessionOpener, setSettingsCloser } = await import('../src/client/settings.js')
    setSessionOpener(target => opened.push(target))
    setSettingsCloser(() => undefined)
    stubLocus()
    const host = await mountTab('locus')

    await act(async () => {
      ;([...host.querySelectorAll('button')].find(
        item => item.textContent?.startsWith('会话') && item.classList.contains('dshpet-jump'),
      ) as HTMLButtonElement | undefined)?.click()
    })

    expect(opened).toEqual([{
      kind: 'subagent',
      parentSessionId: 's1',
      childSessionId: 'child-1',
    }])
    setSessionOpener(undefined)
    setSettingsCloser(undefined)
  })

  it('refuses rather than falling back to a bare id when the parent is unknown', async () => {
    // A missing parent makes the child unaddressable. Falling back to the bare
    // id would only reproduce the Host refusal as a confusing runtime error.
    const opened: unknown[] = []
    const { setSessionOpener, setSettingsCloser } = await import('../src/client/settings.js')
    setSessionOpener(target => opened.push(target))
    setSettingsCloser(() => undefined)
    stubLocus({ ...LOCUS_VIEW, main: { ...LOCUS_VIEW.main, sessionId: '' } })
    const host = await mountTab('locus')

    await act(async () => {
      ;([...host.querySelectorAll('button')].find(
        item => item.textContent?.startsWith('会话') && item.classList.contains('dshpet-jump'),
      ) as HTMLButtonElement | undefined)?.click()
    })

    expect(opened).toEqual([])
    setSessionOpener(undefined)
    setSettingsCloser(undefined)
  })
})
