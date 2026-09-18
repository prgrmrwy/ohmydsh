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
import { LOCUS_ACTION_FIELDS } from '../src/host/routes.js'
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

/**
 * Open every collapsed parent-session block.
 *
 * The locus list collapses each session by default, so entry-row controls are
 * not in the DOM until the owner expands one. These cases are about what the
 * controls DO once reached, so they take the same first step a person would
 * rather than assuming the rows are already open.
 */
async function expandSessions(host: HTMLElement): Promise<void> {
  const toggles = [...host.querySelectorAll('button.dshpet-work-expand')] as HTMLButtonElement[]
  for (const toggle of toggles) {
    await act(async () => { toggle.click() })
  }
}

const LOCUS_VIEW = {
  locusId: 'locus-1',
  generation: 1,
  endpoint: { chatId: 'oc_qa', chatType: 'group', chatName: '答疑群' },
  main: { sessionId: 's1', title: '主会话', availability: 'available' },
  child: { sessionId: 'child-1', title: '子会话', availability: 'available' },
  // The execution-root candidate the Host resolves from the child session's
  // working boundary. Without it the confirm control is deliberately inert, so
  // this fixture carries the production shape rather than an empty one.
  workspace: { workspaceId: 'ws-1', title: '项目A', executionRoot: '/repo/nexus' },
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
  it('disables the control and says why, once the filter is told to show it', async () => {
    const opened: string[] = []
    const { setSessionOpener } = await import('../src/client/settings.js')
    setSessionOpener(target => opened.push(JSON.stringify(target)))
    // The Host marks the current Locus session: the shell silently lands on
    // the home page for an archived id, so the reason must be visible without
    // clicking. The retired legacy route projection stays absent from UI.
    stubLocus({ ...LOCUS_VIEW, main: { ...LOCUS_VIEW.main, availability: 'archived' as const } })
    const host = await mountTab('locus')
    await expandSessions(host)

    // An archived parent is hidden by default. The list adds no second row for
    // that: the filter control states the condition, and its popover is where
    // the reason and the count live.
    expect(host.querySelector('.dshpet-work-name')).toBeNull()
    expect(host.textContent).not.toContain('dshpet-locus-hidden')

    const filter = [...host.querySelectorAll('button')].find(
      item => item.textContent?.startsWith('父会话：'),
    ) as HTMLButtonElement | undefined
    expect(filter).toBeDefined()
    await act(async () => {
      filter?.click()
    })
    expect(host.textContent).toContain('父会话状态')
    expect(host.textContent).toContain('已归档')

    // Checking the bucket is the way back — the only one.
    const bucket = [...host.querySelectorAll('.dshpet-locus-filter-row')].find(
      row => row.textContent?.startsWith('已归档'),
    ) as HTMLLabelElement | undefined
    expect(bucket).toBeDefined()
    await act(async () => {
      bucket?.querySelector('input')?.click()
    })

    // Shown, the parent session still is not offered as a control: the title
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
    await expandSessions(host)

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

describe('the locus header reads title, condition, description, controls', () => {
  it('puts the filter on the title row and the counts under it', async () => {
    stubLocus()
    const host = await mountTab('locus')
    await expandSessions(host)

    // The control that changes the reading belongs with the title; the counts
    // describe the snapshot, so they get their own line instead of competing
    // with the title for the same row.
    const headline = host.querySelector('.dshpet-locus-headline') as HTMLElement | undefined
    expect(headline?.textContent).toContain('父会话：可用 · 入口：在服务')
    expect(headline?.textContent).not.toContain('个入口')
    const lead = host.querySelector('.dshpet-locus-lead') as HTMLElement | undefined
    expect(lead?.textContent).toContain('个入口')
    expect(lead?.querySelector('.dshpet-locus-headline')).not.toBeNull()

    // Tools stay a separate row, so neither the counts nor the filter can push
    // the reading tabs or the search box around.
    const tools = host.querySelector('.dshpet-locus-tools') as HTMLElement | undefined
    expect(tools?.querySelector('.dshpet-locus-filter-anchor')).toBeNull()
    expect(tools?.querySelector('.dshpet-locus-search')).not.toBeNull()
  })
})

describe('the panel sends only fields its route accepts', () => {
  it('fits every action payload inside the route field list', async () => {
    // `strictBody` rejects unknown fields, and TypeScript cannot catch this for
    // us: spreading an object literal into a payload is not excess-checked. A
    // shared fence spread into rebuild shipped `locusId` to a route that does
    // not accept it, and the owner saw `Unknown request field 'locusId'` after
    // clicking 重建. This walks every action the panel can send in one place.
    const bodies: string[] = []
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
              loci: [LOCUS_VIEW],
              defaultQa: [],
              discovery: { byEndpoint: [], byParent: [], byChild: [] },
            },
          }),
        }
      }),
    )
    const host = await mountTab('locus')
    await expandSessions(host)

    await act(async () => {
      ;(host.querySelector('.dshpet-locus-more') as HTMLButtonElement | null)?.click()
    })
    // `scope` is absent from this walk while the write master switch is off:
    // the `可写` control is disabled by the switch, and `只读` is disabled
    // because this fixture is ALREADY read — so neither scope button can post.
    // Re-add '可写' here together with the switch; the payload-shape rule it
    // covers has not changed, only the reachability of the control.
    for (const label of ['确认执行根', '停止关联']) {
      const button = [...host.querySelectorAll('button')].find(
        item => item.textContent === label,
      ) as HTMLButtonElement | undefined
      expect(button, `${label} must be reachable`).toBeDefined()
      await act(async () => {
        button?.click()
      })
    }

    const actions = bodies
      .map(body => JSON.parse(body) as Record<string, unknown>)
      .filter(body => typeof body['action'] === 'string' && body['action'] in LOCUS_ACTION_FIELDS)
    expect(actions.map(body => body['action']).sort()).toEqual(
      ['confirm-anchor', 'stop'],
    )
    // `scope`'s payload shape still matters even though no control can post
    // it right now, so assert it statically rather than losing the rule.
    expect(LOCUS_ACTION_FIELDS.scope).toContain('mode')
    expect(LOCUS_ACTION_FIELDS.scope).toContain('locusId')
    for (const body of actions) {
      const action = body['action'] as string
      const allowed = LOCUS_ACTION_FIELDS[action as keyof typeof LOCUS_ACTION_FIELDS]
      const unknown = Object.keys(body).filter(key => !allowed.includes(key))
      expect(unknown, `${action} sent fields the route rejects`).toEqual([])
    }
  })
})

describe('a stopped entry is hidden by default yet recoverable', () => {
  it('reveals the tombstone with a rebuild control on its row', async () => {
    // The Host refuses a stopped endpoint until an explicit rebuild
    // (`repository.ts`), so the default list must not show it as live. It must
    // also not read as deleted: the filter states the condition, and its
    // 入口状态 bucket is the way back — and 重建, the only way out, has to be on
    // the row itself rather than two disclosures deep.
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
    await expandSessions(host)

    expect(host.querySelector('.dshpet-locus-row')).toBeNull()
    // The filter button states the condition even while the popover is shut, so
    // a missing entry is explained without opening anything.
    expect(host.textContent).toContain('入口：在服务')
    // The empty screen names the bucket to check instead of leaving the entry
    // looking deleted.
    expect(host.textContent).toContain('已停止的入口要在入口状态里勾上')

    const filter = [...host.querySelectorAll('button')].find(
      item => item.textContent?.startsWith('父会话：'),
    ) as HTMLButtonElement | undefined
    expect(filter).toBeDefined()
    await act(async () => {
      filter?.click()
    })
    const bucket = [...host.querySelectorAll('.dshpet-locus-filter-row')].find(
      row => row.textContent?.startsWith('已停止 / 已失效'),
    ) as HTMLLabelElement | undefined
    expect(bucket).toBeDefined()
    await act(async () => {
      bucket?.querySelector('input')?.click()
    })
    // Widening the filter surfaces a session that was not in the list before,
    // and it arrives collapsed like any other.
    await expandSessions(host)

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
      expectedLocusId: 'locus-1',
      expectedGeneration: 1,
      expectedUpdatedAt: 2,
      parentSessionId: 's1',
    })
    // …and it must carry nothing the route does not accept. `locusId` here was
    // rejected with `Unknown request field 'locusId'`: rebuild addresses its
    // generation through `expectedLocusId`, and a spread is not excess-checked.
    expect(Object.keys(sent ?? {}).filter(key => !LOCUS_ACTION_FIELDS.rebuild.includes(key))).toEqual([])
    expect(sent?.['locusId']).toBeUndefined()
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
    await expandSessions(host)

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
    await expandSessions(host)

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
