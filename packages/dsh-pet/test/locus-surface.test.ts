/**
 * The v20 locus management surface, rendered in a DOM against a fake Host
 * (pet-locus-isomorphic-entries D10). Every case drives the real
 * `PetSettingsSection` → `LocusTab` → `petApi` path and asserts on what the
 * owner sees and what the browser actually sends.
 *
 * @vitest-environment jsdom
 */

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCUS_ACTION_FIELDS } from '../src/host/routes.js'
import { PetSettingsSection, setSessionOpener } from '../src/client/settings.js'
import { LOCUS_ACCESS_RECEIPT } from '../src/host/locus/management.js'
import { PET_CSS } from '../src/client/styles.js'
import type { PetLocusManagementViewV20 } from '../src/wire.js'
import { chatView, entryView, snapshotV20, workView } from './support/mgmt-snapshot.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

interface FakeHost {
  readonly actions: Record<string, unknown>[]
  snapshot: PetLocusManagementViewV20
}

type Reply = { ok: true; data: unknown } | { ok: false; error: string; message: string }

/**
 * A fake Host: the view route serves `host.snapshot`; the action route records
 * the body and answers with `respond` (a refusal leaves the snapshot alone).
 */
function stubHost(
  initial: PetLocusManagementViewV20,
  respond: (body: Record<string, unknown>, host: FakeHost) => Reply = () => ({ ok: true, data: { action: 'stop', chat: {} } }),
): FakeHost {
  const host: FakeHost = { actions: [], snapshot: initial }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: { body?: string }) => {
    const body = init?.body === undefined ? {} : JSON.parse(init.body) as Record<string, unknown>
    let payload: Reply
    if (path === '/dsh-pet/api/locus') payload = { ok: true, data: host.snapshot }
    else if (path === '/dsh-pet/api/locus-todos') payload = { ok: true, data: { ledgers: [] } }
    else if (path === '/dsh-pet/api/locus-action') {
      host.actions.push(body)
      payload = respond(body, host)
    } else payload = { ok: true, data: {} }
    return { status: payload.ok ? 200 : 409, text: async () => JSON.stringify(payload) }
  }))
  return host
}

async function expandAll(root: HTMLElement): Promise<void> {
  for (const toggle of [...root.querySelectorAll('button.dshpet-work-expand[aria-expanded="false"]')] as HTMLButtonElement[]) {
    await act(async () => { toggle.click() })
  }
}

/** The filter popover's checkbox for one bucket label. */
function filterBox(root: ParentNode, label: string): HTMLInputElement {
  const row = [...root.querySelectorAll('.dshpet-locus-filter-row')].find(item => item.textContent?.startsWith(label))
  const box = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null | undefined
  if (box === undefined || box === null) throw new Error(`no filter box 「${label}」`)
  return box
}

async function openFilter(root: HTMLElement): Promise<void> {
  if (root.querySelector('.dshpet-locus-filter') !== null) return
  const toggle = root.querySelector('.dshpet-locus-filter-anchor > button') as HTMLButtonElement
  await act(async () => { toggle.click() })
}

async function mount(options: { showArchived?: boolean } = {}): Promise<HTMLElement> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  await act(async () => {
    createRoot(root).render(createElement(PetSettingsSection, { initialTab: 'locus' }))
  })
  if (options.showArchived === true) {
    // Archived work sessions are hidden by default: tick 已归档 as an owner would.
    await openFilter(root)
    await act(async () => { filterBox(root, '已归档').click() })
  }
  // Sessions open collapsed: expand them as an owner would.
  await expandAll(root)
  return root
}

function buttons(root: ParentNode, text: string): HTMLButtonElement[] {
  return ([...root.querySelectorAll('button')] as HTMLButtonElement[]).filter(item => item.textContent?.trim() === text)
}

function button(root: ParentNode, text: string): HTMLButtonElement {
  const found = buttons(root, text)[0]
  if (found === undefined) throw new Error(`no button 「${text}」`)
  return found
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => { target.click() })
}

/** Open the 更多 disclosure of the n-th row. */
async function openDetails(root: HTMLElement, index = 0): Promise<void> {
  const more = buttons(root, '更多 ▸')[index]
  if (more === undefined) throw new Error('no 更多 toggle')
  await click(more)
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function rebindInput(root: ParentNode): HTMLInputElement | null {
  return root.querySelector('input[aria-label="目标工作会话 sessionId"]')
}

const ARCHIVED = { availability: 'archived' as const, sessionId: 'session-old-w', title: '旧工作' }

describe('spec Requirement "管理面的变更动作只有停止、访问模式与改绑，且以 locusId 加 revision 为围栏"', () => {
  it('spec Scenario "停止请求以 locusId 与 revision 为围栏"', async () => {
    const host = stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', locusId: 'L1', revision: 5 }))])]))
    const root = await mount()
    await openDetails(root)
    await click(button(root, '停止'))
    expect(host.actions).toEqual([{ action: 'stop', endpoint: { chatId: 'oc_A' }, expectedLocusId: 'L1', expectedRevision: 5 }])
  })

  it('spec Scenario "修改访问模式提交目标值"', async () => {
    const host = stubHost(
      snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', locusId: 'L1', revision: 2 }))])], { writeEnabled: true }),
      () => ({ ok: true, data: { action: 'access', chat: {}, receipt: LOCUS_ACCESS_RECEIPT } }),
    )
    const root = await mount()
    await openDetails(root)
    await click(button(root, '完全访问'))
    expect(host.actions).toEqual([{
      action: 'access', endpoint: { chatId: 'oc_A' }, accessMode: 'danger-full-access', expectedLocusId: 'L1', expectedRevision: 2,
    }])
  })

  it('spec Scenario "回执不声称已应用"', async () => {
    const before = entryView({ chatId: 'oc_A', locusId: 'L1' })
    stubHost(
      snapshotV20([workView([chatView(before)])], { writeEnabled: true }),
      (_body, fake) => {
        fake.snapshot = snapshotV20([workView([chatView({ ...before, accessMode: 'danger-full-access', revision: 2 })])], { writeEnabled: true })
        return { ok: true, data: { action: 'access', chat: {}, receipt: LOCUS_ACCESS_RECEIPT } }
      },
    )
    const root = await mount()
    await openDetails(root)
    await click(button(root, '完全访问'))
    expect(root.textContent).toContain('已更新，下次唤醒时应用并核验；核验失败将拒绝服务')
    expect(root.textContent).toContain('活跃 · 完全访问')
    expect(root.textContent).not.toContain('待应用')
  })

  it('spec Scenario "写开关关闭时完全访问不可选"', async () => {
    const host = stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', accessMode: 'danger-full-access' }))])], { writeEnabled: false }))
    const root = await mount()
    await openDetails(root)
    const full = button(root, '完全访问')
    expect(full.disabled).toBe(true)
    expect(root.textContent).toContain('全局写开关已关闭')
    await click(full)
    expect(host.actions).toEqual([])
    const read = button(root, '只读')
    expect(read.disabled).toBe(false)
    await click(read)
    expect(host.actions).toMatchObject([{ action: 'access', accessMode: 'read-only' }])
  })

  it('spec Scenario "投递中时访问模式与停止都置灰"', async () => {
    const host = stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', inFlight: true }))])], { writeEnabled: true }))
    const root = await mount()
    expect(root.textContent).toContain('投递中')
    await openDetails(root)
    for (const label of ['只读', '完全访问', '停止']) expect(button(root, label).disabled).toBe(true)
    expect(root.textContent).toContain('该入口正在投递，待其结束后再修改访问模式')
    expect(root.textContent).toContain('该入口正在投递，待其结束后再停止')
    await click(button(root, '停止'))
    await click(button(root, '完全访问'))
    expect(host.actions).toEqual([])
  })

  it('spec Scenario "围栏过期时拒绝而不乐观改写"', async () => {
    stubHost(
      snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', locusId: 'L1', revision: 5 }))])]),
      () => ({ ok: false, error: 'LOCUS_CONFLICT', message: '执行 locus stop：入口已变化，请刷新后重试' }),
    )
    const root = await mount()
    await openDetails(root)
    await click(button(root, '停止'))
    expect(root.textContent).toContain('入口已变化，请刷新后重试')
    expect(root.textContent).toContain('活跃 · 只读')
    expect(root.textContent).not.toContain('已停止 ·')
  })

  it('fits every action payload inside the route field list', async () => {
    const host = stubHost(
      snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }), [entryView({ chatId: 'oc_A', threadId: 'omt_1' })])], ARCHIVED)], { writeEnabled: true }),
    )
    const root = await mount({ showArchived: true })
    await openDetails(root)
    await click(button(root, '完全访问'))
    await click(button(root, '停止'))
    await click(button(root, '改绑到其他会话'))
    await type(rebindInput(root)!, 'session-new')
    await click(button(root, '确认'))
    expect(host.actions.map(body => body['action']).sort()).toEqual(['access', 'rebind', 'stop'])
    for (const body of host.actions) {
      const allowed = LOCUS_ACTION_FIELDS[body['action'] as keyof typeof LOCUS_ACTION_FIELDS]
      expect(Object.keys(body).filter(key => !allowed.includes(key))).toEqual([])
    }
  })
})

describe('spec Requirement "管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用"', () => {
  it('spec Scenario "原 W 已归档时提交改绑"', async () => {
    const host = stubHost(
      snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', locusId: 'L1', revision: 4 }))], ARCHIVED)]),
      (_body, fake) => {
        fake.snapshot = snapshotV20([workView(
          [chatView(entryView({ chatId: 'oc_A', locusId: 'L1', revision: 5, state: 'not-created' }), [], { reboundFrom: { sessionId: 'session-old-w', title: '旧工作' } })],
          { sessionId: 'S_NEW', title: '新工作' },
        )])
        return { ok: true, data: { action: 'rebind', chat: {}, receipt: '已改绑到 新工作（S_NEW）；各入口将在新会话下按首条消息重新创建子会话，不保留上下文。' } }
      },
    )
    const root = await mount({ showArchived: true })
    expect(root.textContent).toContain('来源会话已归档，可改绑')
    // Directly on the row: no 更多 disclosure was opened.
    await click(button(root, '改绑到其他会话'))
    expect(root.textContent).toContain('不保留上下文')
    await type(rebindInput(root)!, 'S_NEW')
    await click(button(root, '确认'))
    expect(host.actions).toEqual([{ action: 'rebind', chatId: 'oc_A', workSessionId: 'S_NEW', expectedLocusId: 'L1', expectedRevision: 4 }])
    expect(root.textContent).toContain('已改绑到 新工作')
    await expandAll(root)
    expect(root.querySelector('.dshpet-work-name')?.textContent).toContain('新工作')
    expect(root.textContent).toContain('改绑自 旧工作')
  })

  it('原 W 未归档时不显示改绑控件', async () => {
    const host = stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }))], { availability: 'available' })]))
    const root = await mount()
    expect(buttons(root, '改绑到其他会话')).toEqual([])
    expect(root.textContent).not.toContain('当前来源会话未归档，仅在其归档后可改绑')
    expect(root.textContent).not.toContain('来源会话已归档，可改绑')
    expect(rebindInput(root)).toBeNull()
    expect(host.actions).toEqual([])
  })

  it('无法证明归档时同样不显示改绑控件', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }))], { availability: 'unknown' })]))
    const root = await mount()
    expect(buttons(root, '改绑到其他会话')).toEqual([])
    expect(root.textContent).not.toContain('当前来源会话未归档')
    expect(root.textContent).not.toContain('来源会话已归档，可改绑')
  })

  it('spec Scenario "有入口在投递时置灰"', async () => {
    const host = stubHost(snapshotV20([workView([chatView(
      entryView({ chatId: 'oc_A' }),
      [entryView({ chatId: 'oc_A', threadId: 'omt_1', inFlight: true, hasCurrentDelivery: true })],
    )], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    expect(button(root, '改绑到其他会话').disabled).toBe(true)
    expect(root.textContent).toContain('该群有入口正在投递，待其结束后再改绑')
    expect(root.textContent).toContain('来源会话已归档，可改绑')
    expect(host.actions).toEqual([])
  })

  it('only a current delivery greys rebind; an in-flight backlog does not', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', inFlight: true, hasCurrentDelivery: false }))], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    expect(button(root, '改绑到其他会话').disabled).toBe(false)
  })

  it('spec Scenario "话题行与评论行没有改绑控件"', async () => {
    stubHost(snapshotV20([workView([
      chatView(entryView({ chatId: 'oc_A' }), [entryView({ chatId: 'oc_A', threadId: 'omt_1' })]),
      chatView(entryView({ chatId: 'doc:docx:D' }), [entryView({ chatId: 'doc:docx:D', threadId: '11' })]),
    ], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    const nested = [...root.querySelectorAll('.dshpet-locus-row')].filter(row => row.getAttribute('data-nested') === 'true')
    expect(nested).toHaveLength(2)
    for (const row of nested) expect(buttons(row, '改绑到其他会话')).toEqual([])
    expect(buttons(root, '改绑到其他会话')).toHaveLength(2)
  })

  it('spec Scenario "Host 拒绝目标时不乐观改写"', async () => {
    stubHost(
      snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', locusId: 'L1', revision: 4 }))], ARCHIVED)]),
      () => ({ ok: false, error: 'INVALID_REQUEST', message: '执行 locus rebind：目标是 locus 主会话，不能作为工作会话' }),
    )
    const root = await mount({ showArchived: true })
    await click(button(root, '改绑到其他会话'))
    await type(rebindInput(root)!, 'session-some-m')
    await click(button(root, '确认'))
    expect(root.textContent).toContain('目标是 locus 主会话，不能作为工作会话')
    expect(rebindInput(root)?.value).toBe('session-some-m')
    expect(root.querySelector('.dshpet-work-name')?.textContent).toContain('旧工作')
    expect(root.textContent).toContain('活跃 · 只读')
  })

  it('spec Scenario "空输入不可提交"', async () => {
    const host = stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }))], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    await click(button(root, '改绑到其他会话'))
    expect(button(root, '确认').disabled).toBe(true)
    await type(rebindInput(root)!, '   ')
    expect(button(root, '确认').disabled).toBe(true)
    await click(button(root, '确认'))
    expect(host.actions).toEqual([])
  })
})

describe('spec Requirement "管理面不提供新建外部资源的入口"', () => {
  it('spec Scenario "管理面无绑定控件"', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }), [entryView({ chatId: 'oc_A', threadId: 'omt_1' })])], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    // With no dialog open, the only text input is the search box.
    const inputs = [...root.querySelectorAll('input')].filter(input => input.type !== 'checkbox')
    expect(inputs.map(input => input.getAttribute('aria-label'))).toEqual(['搜索关联'])
    await click(button(root, '改绑到其他会话'))
    // The form is its own block right after the group row, never inside it.
    const form = rebindInput(root)!.closest('.dshpet-locus-rebind-form')!
    expect(form.closest('.dshpet-locus-row')).toBeNull()
    expect(form.previousElementSibling?.getAttribute('data-nested')).toBe('false')
  })

  it('spec Scenario "生命周期动作仍可用"', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }))])], { writeEnabled: true }))
    const root = await mount()
    await openDetails(root)
    const ops = root.querySelector('.dshpet-locus-ops')!
    expect(([...ops.querySelectorAll('button')] as HTMLButtonElement[]).map(item => item.textContent?.trim())).toEqual(['只读', '完全访问', '停止'])
    const labels = ([...root.querySelectorAll('button')] as HTMLButtonElement[]).map(item => item.textContent?.trim() ?? '')
    for (const removed of ['解绑', '归档', '重建', '重新启用', '工具档位', '确认执行根', '用新的主会话接替']) {
      expect(labels.filter(label => label.includes(removed))).toEqual([])
    }
    expect(root.textContent).not.toContain('文件权限')
    // W is live here: no rebind control at all (it appears only for an archived W).
    expect(buttons(root, '改绑到其他会话')).toEqual([])
  })

  it('spec Scenario "话题行不接受会话标识输入"', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }), [entryView({ chatId: 'oc_A', threadId: 'omt_1' })])], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    await openDetails(root, 1)
    const topic = [...root.querySelectorAll('.dshpet-locus-row')].find(row => row.getAttribute('data-nested') === 'true')!
    expect(buttons(topic, '改绑到其他会话')).toEqual([])
    expect(topic.querySelectorAll('input')).toHaveLength(0)
    const details = topic.nextElementSibling
    expect(details?.classList.contains('dshpet-locus-details')).toBe(true)
    expect(details?.querySelectorAll('input')).toHaveLength(0)
  })
})

describe('spec Requirement "管理面如实呈现全部生命周期状态" (surface half)', () => {
  it('spec Scenario "含未创建入口的快照可加载"', async () => {
    stubHost(snapshotV20([workView([chatView(
      entryView({ chatId: 'oc_A', state: 'not-created' }),
      [entryView({ chatId: 'oc_A', threadId: 'omt_1', state: 'not-created' })],
    )])]))
    const root = await mount()
    expect(root.textContent).not.toContain('快照不完整')
    expect(root.textContent?.match(/未创建 · 只读/g)).toHaveLength(2)
    // 未创建 is said once on line 2; the child jump carries 尚未创建 as its reason.
    expect(root.textContent).not.toContain('子会话 尚未创建')
    expect(button(root, '子会话 ↗').title).toBe('尚未创建')
    expect(root.textContent).not.toMatch(/会话不可用|缺失/)
  })

  it('spec Scenario "未知状态值不伪装成活跃"', async () => {
    stubHost(snapshotV20([workView([chatView({ ...entryView({ chatId: 'oc_A' }), state: 'retired' as never })])]))
    const root = await mount()
    // Shown, not hidden: the default filter only hides stopped / invalid.
    expect(root.textContent).toContain('未知状态 · 只读')
    expect(root.textContent).not.toContain('活跃 ·')
    await openDetails(root)
    expect(button(root, '只读').disabled).toBe(true)
    expect(button(root, '完全访问').disabled).toBe(true)
  })

  it('refuses a snapshot of the removed pre-v20 shape rather than guessing', async () => {
    stubHost({ generation: 1, loci: [], defaultQa: [], discovery: { byEndpoint: [], byParent: [], byChild: [] } } as never)
    const root = await mount()
    expect(root.textContent).toContain('快照不完整或字段无效')
  })
})

describe('the locus surface reads title, condition, description, controls', () => {
  it('puts the filter condition on the title row and the counts under it', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }))])]))
    const root = await mount()
    expect(root.querySelector('.dshpet-locus-headline')?.textContent).toContain('入口：在服务')
    expect(root.querySelector('.dshpet-locus-lead > .dshpet-meta')?.textContent).toContain('1 个入口 · 1 个飞书入口 · 1 个工作会话')
    expect(root.textContent).not.toMatch(/历史|第 \d+ 代/)
  })
})

describe('the filter popover (owner-approved v20 UI)', () => {
  it('says 工作会话 everywhere the owner reads, never 干活', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }))], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    await click(button(root, '改绑到其他会话'))
    expect(button(root, '按工作会话').getAttribute('role')).toBe('tab')
    expect(rebindInput(root)?.placeholder).toContain('目标工作会话')
    expect(root.innerHTML).not.toContain('干活')
  })

  it('offers exactly three checkboxes with counts over the whole snapshot', async () => {
    stubHost(snapshotV20([
      workView([chatView(entryView({ chatId: 'oc_A' }), [entryView({ chatId: 'oc_A', threadId: 'omt_1', state: 'stopped' })])]),
      workView([chatView(entryView({ chatId: 'oc_B', state: 'invalid' }))], ARCHIVED),
    ]))
    const root = await mount()
    await openFilter(root)
    const rows = [...root.querySelectorAll('.dshpet-locus-filter-row')]
    expect(rows.map(row => [row.textContent, (row.querySelector('input') as HTMLInputElement).checked])).toEqual([
      ['在服务1', true], ['已停止 / 已失效1', false], ['已归档1', false],
    ])
    expect(root.querySelector('.dshpet-locus-filter')?.textContent).not.toContain('未知状态')
  })

  it('hides an archived W by default and shows it, with the rebind button, once 已归档 is ticked', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }))], ARCHIVED)]))
    const root = await mount()
    expect(buttons(root, '改绑到其他会话')).toEqual([])
    expect(root.textContent).not.toContain('旧工作')
    expect(root.querySelector('.dshpet-locus-headline')?.textContent).toContain('入口：在服务')
    await openFilter(root)
    await act(async () => { filterBox(root, '已归档').click() })
    await expandAll(root)
    expect(root.querySelector('.dshpet-locus-headline')?.textContent).toContain('入口：在服务、已归档')
    expect(button(root, '改绑到其他会话').disabled).toBe(false)
    expect(root.textContent).toContain('来源会话已归档，可改绑')
  })

  it('draws the popover opaque: solid background, solid border and a shadow', () => {
    const rule = PET_CSS.match(/\.dshpet-locus-filter\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('background:var(--dsw-alias-bg-layer-1,#ffffff)')
    expect(rule).toMatch(/border:1px solid/)
    expect(rule).toContain('box-shadow:')
    expect(rule).toContain('backdrop-filter:none')
    expect(rule).toContain('opacity:1')
    expect(rule).not.toContain('--dsw-specific-menu')
  })
})

describe('the rebind form never squeezes the row text (owner acceptance layout bug)', () => {
  it('renders the open form as a full-width block after the row, outside the text column and the tail', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', state: 'not-created' }))], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    await click(button(root, '改绑到其他会话'))
    const input = rebindInput(root)!
    expect(input.closest('.dshpet-locus-row-body')).toBeNull()
    expect(input.closest('.dshpet-locus-row-tail')).toBeNull()
    expect(input.closest('.dshpet-locus-row')).toBeNull()
    const form = input.closest('.dshpet-locus-rebind-form')!
    expect(form.parentElement?.classList.contains('dshpet-locus-chat')).toBe(true)
    // The row keeps its own text intact while the form is open.
    const row = form.previousElementSibling!
    expect(row.querySelector('.dshpet-locus-row-body')?.textContent).toContain('未创建 · 只读')
    expect(row.querySelector('.dshpet-locus-row-body')?.textContent).toContain('来源会话已归档，可改绑')
  })

  it('keeps the long greyed reason out of the auto-sized tail column', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', inFlight: true, hasCurrentDelivery: true }))], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    const reason = root.querySelector('[data-reason="rebind"]')!
    expect(reason.textContent).toBe('该群有入口正在投递，待其结束后再改绑')
    expect(reason.closest('.dshpet-locus-row-tail')).toBeNull()
    expect(reason.closest('.dshpet-locus-row-body')).not.toBeNull()
  })

  it('renders every tail control in the one jump style', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', state: 'not-created' }), [entryView({ chatId: 'oc_A', threadId: 'omt_1' })])], ARCHIVED)]))
    const root = await mount({ showArchived: true })
    const tails = [...root.querySelectorAll('.dshpet-locus-row-tail')]
    expect(tails.length).toBe(2)
    for (const tail of tails) {
      const controls = [...tail.children]
      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) expect(control.classList.contains('dshpet-jump'), control.textContent ?? '').toBe(true)
    }
    expect(tails[0]!.textContent).toContain('改绑到其他会话')
  })

  it('keeps the 改绑自 code chip on the same line as its text', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A' }), [], { reboundFrom: { sessionId: 'session-17bd88a3', title: '旧工作' } })])]))
    const root = await mount()
    const line = root.querySelector('.dshpet-locus-rebound')!
    expect(line.textContent).toContain('改绑自 旧工作')
    expect(line.querySelector('.dshpet-handle')).not.toBeNull()
  })

  it('never says 兜底显示: an unnamed entry reads 入口 · <code> / 话题 · <code>', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_bb0e1111' }), [entryView({ chatId: 'oc_bb0e1111', threadId: 'omt_198f2222' })])])]))
    const root = await mount()
    expect(root.textContent).not.toContain('兜底')
    const names = [...root.querySelectorAll('.dshpet-locus-name')].map(item => item.textContent)
    expect(names).toEqual(['入口 · bb0e', '话题 · 198f'])
  })

  it('styles the text column with a real minimum width and lets the tail wrap instead of growing', () => {
    const rule = (selector: string): string =>
      PET_CSS.match(new RegExp(`\\.dshpet-settings ${selector.replace(/\./g, '\\.')}\\{[^}]*\\}`))?.[0] ?? ''
    expect(rule('.dshpet-locus-row')).not.toMatch(/grid-template-columns:minmax\(0,/)
    expect(rule('.dshpet-locus-row')).toMatch(/grid-template-columns:minmax\(12em,1fr\)/)
    expect(rule('.dshpet-locus-row-body')).not.toMatch(/min-width:0[;}]/)
    // A long title ellipsises inside its column instead of running under the tail's buttons.
    expect(rule('.dshpet-locus-name')).toContain('flex:0 1 auto')
    // One right-aligned action row, not a ragged stack.
    const tail = rule('.dshpet-locus-row-tail')
    expect(tail).toContain('flex-wrap:nowrap')
    expect(tail).toContain('justify-content:flex-end')
    // A disabled jump keeps its border: same shape as an enabled one, only dimmer.
    const disabledJump = PET_CSS.match(/\.dshpet-jump\[data-disabled="true"\][^{]*\{[^}]*\}/)?.[0] ?? ''
    expect(disabledJump).toContain('cursor:not-allowed')
    expect(disabledJump).not.toContain('border-color:transparent')
    // The 改绑自 line keeps its code chip beside the text.
    expect(rule('.dshpet-locus-rebound')).toContain('white-space:nowrap')
    // The form is a block with a solid background, not a translucent flex sibling.
    const form = rule('.dshpet-locus-rebind-form')
    expect(form).toContain('display:flex')
    expect(form).toContain('background:var(--dsw-alias-bg-layer-1,#ffffff)')
    expect(form).not.toContain('flex-basis')
    expect(PET_CSS).not.toContain('dshpet-locus-rebind-dialog')
  })
})

describe('a locus child opens through its locus main address', () => {
  it('addresses the child by its M, never by bare session id', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', sessionId: 'child-1' }))])]))
    const opened: unknown[] = []
    setSessionOpener(target => { opened.push(target) })
    try {
      const root = await mount()
      await click(button(root, '子会话 ↗'))
      expect(opened).toEqual([{ kind: 'subagent', parentSessionId: 'session-main-1', childSessionId: 'child-1' }])
    } finally {
      setSessionOpener(undefined)
    }
  })

  it('offers no child jump for a not-created entry', async () => {
    stubHost(snapshotV20([workView([chatView(entryView({ chatId: 'oc_A', state: 'not-created' }))])]))
    setSessionOpener(() => undefined)
    try {
      const root = await mount()
      const jump = button(root, '子会话 ↗')
      expect(jump.disabled).toBe(true)
      expect(jump.title).toBe('尚未创建')
    } finally {
      setSessionOpener(undefined)
    }
  })
})
