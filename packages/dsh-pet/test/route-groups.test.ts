/**
 * Chat route grouping and the Lark AppLink.
 *
 * The classifier is pure and covered directly; the tab strip is exercised
 * through a real mount, because a filter that silently drops rows is exactly
 * the failure source-level assertions cannot see.
 *
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatAppLink, routeGroupOf } from '../src/wire.js'
import { PetSettingsSection } from '../src/client/settings.js'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('a route belongs to exactly one group', () => {
  it('routes a qa binding to the qa group regardless of chat shape', () => {
    // `kind` wins: a qa binding targets a fork child, not a workspace, so it
    // must not be filed by its conversation shape.
    expect(routeGroupOf({ kind: 'qa', chatType: 'group' })).toBe('qa')
    expect(routeGroupOf({ kind: 'qa', chatType: 'p2p' })).toBe('qa')
  })

  it('splits the remainder by conversation shape', () => {
    expect(routeGroupOf({ kind: 'workspace', chatType: 'group' })).toBe('workspace')
    expect(routeGroupOf({ kind: 'workspace', chatType: 'p2p' })).toBe('direct')
  })
})

describe('the AppLink opens a conversation without a share-link call', () => {
  it('builds the documented client protocol from the chat id', () => {
    expect(chatAppLink('oc_abc123')).toBe(
      'https://applink.feishu.cn/client/chat/open?openChatId=oc_abc123',
    )
  })

  it('serves a p2p chat, which the share-link API refuses outright', () => {
    // The reason this is an AppLink and not `im chats link`: that API
    // documents "单聊、密聊、团队群不支持分享群链接".
    expect(chatAppLink('oc_p2p_conversation')).toContain('openChatId=oc_p2p_conversation')
  })

  it('refuses an id that is not a chat, instead of linking to nothing', () => {
    expect(chatAppLink('')).toBeUndefined()
    expect(chatAppLink('   ')).toBeUndefined()
    expect(chatAppLink('ou_a_user_not_a_chat')).toBeUndefined()
  })

  it('escapes the id rather than interpolating it raw', () => {
    expect(chatAppLink('oc_a b&c')).toBe(
      'https://applink.feishu.cn/client/chat/open?openChatId=oc_a%20b%26c',
    )
  })
})

/** Reply to every Pet route with one channel payload. */
function stubChannel(routes: unknown[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          ok: true,
          data: {
            onboarding: { steps: [], ready: true, blockers: [] },
            bot: { appId: 'cli_x', openId: 'ou_bot' },
            allowOpenIds: [],
            knownNames: {},
            connection: { phase: 'connected', queueDepth: 0 },
            enabled: true,
            routes,
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

function subtab(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('.dshpet-subtab')].find(item =>
    item.textContent?.startsWith(label),
  ) as HTMLButtonElement | undefined
}

const ROUTES = [
  { chatId: 'oc_qa', chatName: '答疑一群', chatType: 'group', kind: 'qa',
    qaParentSessionId: 's1', boundBy: 'user', boundAt: 1 },
  { chatId: 'oc_grp', chatName: '研发群', chatType: 'group', kind: 'workspace',
    workspaceId: 'ws-1', boundBy: 'auto', boundAt: 1 },
  { chatId: 'oc_dm', chatName: '张三', chatType: 'p2p', kind: 'workspace',
    workspaceId: 'ws-1', boundBy: 'auto', boundAt: 1 },
]

describe('the route section separates the three kinds', () => {
  it('shows only the selected group', async () => {
    stubChannel(ROUTES)
    const host = await mountChannel()

    // Opens on qa, the first group holding routes.
    expect(host.textContent).toContain('答疑一群')
    expect(host.textContent).not.toContain('研发群')

    await act(async () => {
      subtab(host, '工作区群')?.click()
    })
    expect(host.textContent).toContain('研发群')
    expect(host.textContent).not.toContain('答疑一群')

    await act(async () => {
      subtab(host, '单聊')?.click()
    })
    expect(host.textContent).toContain('张三')
    expect(host.textContent).not.toContain('研发群')
  })

  it('counts every group, including the ones not selected', async () => {
    stubChannel(ROUTES)
    const host = await mountChannel()

    for (const label of ['答疑群', '工作区群', '单聊']) {
      expect(subtab(host, label)?.textContent).toContain('1')
    }
  })

  it('opens on a group that has routes rather than an empty one', async () => {
    // A deployment using only direct chats must not open on an empty QA tab
    // and read as "no routes at all".
    stubChannel([ROUTES[2]])
    const host = await mountChannel()

    expect(subtab(host, '单聊')?.getAttribute('aria-selected')).toBe('true')
    expect(host.textContent).toContain('张三')
  })

  it('explains an empty group in its own terms', async () => {
    stubChannel([ROUTES[0]])
    const host = await mountChannel()

    await act(async () => {
      subtab(host, '单聊')?.click()
    })
    expect(host.textContent).toContain('无需 @')
  })
})

describe('every chat offers a way into Lark', () => {
  it('links a group and a direct chat alike', async () => {
    stubChannel(ROUTES)
    const host = await mountChannel()

    const qaLink = host.querySelector('a.dshpet-action') as HTMLAnchorElement
    expect(qaLink?.getAttribute('href')).toBe(
      'https://applink.feishu.cn/client/chat/open?openChatId=oc_qa',
    )

    await act(async () => {
      subtab(host, '单聊')?.click()
    })
    const dmLink = host.querySelector('a.dshpet-action') as HTMLAnchorElement
    expect(dmLink?.getAttribute('href')).toContain('openChatId=oc_dm')
  })

  it('opens outside the app without leaking the referrer', async () => {
    stubChannel(ROUTES)
    const host = await mountChannel()

    const link = host.querySelector('a.dshpet-action') as HTMLAnchorElement
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noreferrer')
  })
})
