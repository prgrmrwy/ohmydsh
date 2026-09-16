/**
 * Rendering tests for the locus surface.
 *
 * These render the real component against a real snapshot shape and assert what
 * the owner would actually see. The previous surface could only be checked by
 * grepping its source for strings, which cannot tell "one row per entry" from
 * "one card per record" — the exact regression this change exists to fix.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LocusDetails, LocusSurface } from '../src/client/settings.js'
import { collectHandleCodes, groupByWork } from '../src/client/locus-view.js'
import { locusFixture, snapshotOf, surfaceSnapshot } from './fixtures/locus-snapshot.js'
import type { PetLocusManagementView } from '../src/wire.js'

function render(snapshot: PetLocusManagementView): string {
  return renderToStaticMarkup(
    createElement(LocusSurface, {
      snapshot,
      onAction: () => undefined,
      runQuery: async () => undefined,
    }),
  )
}

const count = (markup: string, needle: string): number => markup.split(needle).length - 1

describe('locus surface', () => {
  it('renders one row per entry, not one per record', () => {
    const markup = render(surfaceSnapshot())
    // Four records across two parents, but only two rows: the chat entry owns
    // two generations (folded into one row plus a history toggle) and the entry
    // under the archived parent is filtered out with its parent.
    expect(count(markup, 'class="dshpet-locus-row"')).toBe(2)
    expect(count(markup, '历史 1 代')).toBe(1)
  })

  it('never uses a raw identifier as an entry name', () => {
    const markup = render(surfaceSnapshot())
    expect(markup).toContain('入口 · a27b')
    expect(markup).toContain('话题 · 19cd')
    // The fallback name must not be, or start with, the platform identifier.
    expect(markup).not.toMatch(/dshpet-locus-name[^>]*>\s*(oc_|omt_|session-|locus-)/)
  })

  it('names a provided platform name and keeps the code beside it', () => {
    const named = locusFixture({
      locusId: 'locus-runtime-1789394541339-2f853e76111d38',
      chatId: 'oc_a27b5de7e6a9a57462060eb289ec70ab',
      chatName: '答疑 · DSH',
      parentSessionId: 'session-1',
      parentAvailability: 'available',
      childSessionId: 'session-2',
    })
    const markup = render(snapshotOf([named], [named.locusId]))
    expect(markup).toContain('答疑 · DSH')
    expect(markup).toContain('a27b')
  })

  it('hides an archived parent by default, with the condition on the filter', () => {
    const markup = render(surfaceSnapshot())
    // The entry under the archived parent is not rendered, and the list adds no
    // second "hidden" row for it: the filter control states the condition and
    // its popover counts every bucket, so one disclosure is enough.
    expect(markup).not.toContain('oc_b1fa')
    expect(markup).not.toContain('dshpet-locus-hidden')
    expect(markup).not.toContain('显示全部')
    expect(markup).toContain('父会话：可用 · 入口：在服务')
  })

  it('names the states it shows in words, and keeps the rest out of the list', () => {
    const markup = render(surfaceSnapshot())
    expect(markup).toContain('活跃')
    // States the default condition excludes are named by the filter popover
    // (asserted where it can actually be opened), not smuggled into the list as
    // a second disclosure row.
    expect(markup).not.toContain('已归档')
    expect(markup).not.toContain('dshpet-locus-hidden')
  })

  it('names a generation under construction when it is shown', () => {
    const building = locusFixture({
      locusId: 'locus-runtime-1-aaaa1111',
      chatId: 'oc_build',
      parentSessionId: 'session-1',
      parentAvailability: 'available',
      childSessionId: 'session-2',
      state: 'provisioning',
    })
    const markup = render(snapshotOf([building], [building.locusId]))
    // provision(ing) must read as 准备中 rather than blank or 活跃.
    expect(markup).toContain('准备中')
    expect(markup).not.toContain('>活跃<')
  })

  it('marks the default Q&A entry and the current generation', () => {
    const markup = render(surfaceSnapshot())
    expect(markup).toContain('默认 Q&amp;A')
    expect(markup).toContain('第 2 代')
    expect(markup).toContain('data-current="true"')
  })

  it('offers no control that creates an external resource', () => {
    const markup = render(surfaceSnapshot())
    expect(markup).not.toContain('绑定')
    expect(markup).not.toContain('创建/打开默认 Q&amp;A')
    // A parent that already has a default Q&A says nothing about creating one.
    expect(markup).not.toContain('默认 Q&amp;A 尚未创建')
  })

  it('keeps lifecycle actions reachable behind the row disclosure', () => {
    const markup = render(surfaceSnapshot())
    expect(markup).toContain('更多 ▸')
    expect(markup).toContain('aria-expanded="false"')
    // Folded by default: identifiers are not printed on first paint.
    expect(markup).not.toContain('locus-runtime-1789394541339-2f853e76111d38')
    // Rebuild is legal only on a tombstone, so a served row never renders the
    // control — a permanently disabled button is not an action.
    expect(markup).not.toContain('>重建<')
  })

  it('nests a topic under the chat entry it inherits from', () => {
    const markup = render(surfaceSnapshot())
    expect(markup).toContain('data-nested="true"')
    // The nesting has to be legible as a fact, not only as indentation.
    expect(markup).toContain('继承自 入口 · a27b')
  })

  it('hides a stopped entry by default and points at the filter', () => {
    const stopped = locusFixture({
      locusId: 'locus-runtime-7-cccc3333',
      chatId: 'oc_stopped',
      parentSessionId: 'session-1',
      parentAvailability: 'available',
      childSessionId: 'session-2',
      state: 'stopped',
    })
    const markup = render(snapshotOf([stopped], [stopped.locusId]))
    // The Host refuses this endpoint until an explicit rebuild, so the default
    // list must not show it as live — and the filter, not an extra row, is what
    // says where it went.
    expect(count(markup, 'class="dshpet-locus-row"')).toBe(0)
    expect(markup).not.toContain('dshpet-locus-hidden')
    expect(markup).toContain('父会话：可用 · 入口：在服务')
    // The empty screen names the condition to relax, and no empty work header is
    // left behind for a session with nothing to show.
    expect(markup).toContain('当前筛选下没有关联')
    expect(markup).toContain('已停止的入口要在入口状态里勾上')
    expect(markup).not.toContain('dshpet-work-name')
  })

  it('renders an empty state that points at search and filter, with the lookup fold off', () => {
    const markup = render(snapshotOf([]))
    expect(markup).toContain('没有关联')
    // The reverse-lookup fold is disabled by owner decision: an owner with an ID
    // outside the snapshot has no UI path for now, and nothing claims otherwise.
    expect(markup).not.toContain('dshpet-locus-discovery')
    expect(markup).not.toContain('反查关联')
    expect(markup).not.toContain('Endpoint')
    // What is left to relax is named: with no search running, that is the filter.
    expect(markup).toContain('放宽上面的筛选')
  })

  it('shows a topic-only endpoint without inventing a chat entry', () => {
    const topicOnly = locusFixture({
      locusId: 'locus-runtime-1789397609276-f750f727f1988',
      chatId: 'oc_591324b60afa1d62f3e229104607c586',
      threadId: 'omt_19cd829b840f5bee',
      parentSessionId: 'session-1',
      parentAvailability: 'available',
      childSessionId: 'session-2',
    })
    const markup = render(snapshotOf([topicOnly], [topicOnly.locusId]))
    expect(markup).toContain('话题 · 19cd')
    // No chat-level entry exists, so nothing is claimed to be inherited.
    expect(markup).not.toContain('继承自')
    // A parent without a default Q&A states where creation happens instead of
    // offering a control that creates a real Feishu group.
    expect(markup).toContain('请在目标会话里用 Pet 轮盘的「答疑群」创建')
  })
})

describe('locus execution-root confirmation', () => {
  const ownerMarkup = (input: {
    readonly executionRoot?: string
    readonly anchor?: Parameters<typeof locusFixture>[0]['contextAnchor']
  }): string => {
    const locus = locusFixture({
      locusId: 'locus-runtime-1789543241305-c8db4d8e783e28',
      chatId: 'oc_3c57889c7808eae69b5ad1dd9ddc8ace',
      parentSessionId: 'session-85620d77-e1a8-4d80-b5d9-66a481bda3c5',
      parentAvailability: 'available',
      childSessionId: 'session-f3b5bd15-9e04-40e5-a515-dbce24c3dff7',
      ...(input.executionRoot === undefined ? {} : { executionRoot: input.executionRoot }),
      ...(input.anchor === undefined ? {} : { contextAnchor: input.anchor }),
    })
    const snapshot = snapshotOf([locus], [locus.locusId])
    // The permission controls live inside the collapsed 「更多」 disclosure, so
    // render that block itself rather than an unopened row.
    return renderToStaticMarkup(
      createElement(LocusDetails, {
        family: groupByWork(snapshot)[0]!.families[0]!,
        codes: collectHandleCodes(snapshot),
        busy: false,
        busyKey: undefined,
        onAction: () => undefined,
      }),
    )
  }

  it('shows the Host-resolved root and offers to confirm it', () => {
    const markup = ownerMarkup({ executionRoot: '/Users/prgrmrwy/corp/nexus' })

    expect(markup).toContain('确认执行根')
    expect(markup).toContain('/Users/prgrmrwy/corp/nexus')
    expect(markup).toContain('宿主解析到')
  })

  it('keeps the action when the anchor is confirmed but has no execution root', () => {
    // The regression this change fixes: the button used to disappear on
    // `status === 'confirmed'`, so the root it never sent could never be added.
    const markup = ownerMarkup({
      executionRoot: '/Users/prgrmrwy/corp/nexus',
      anchor: { status: 'confirmed', projectResources: [], constraints: [] },
    })

    expect(markup).toContain('确认执行根')
    expect(markup).toContain('/Users/prgrmrwy/corp/nexus')
  })

  it('drops the action once a root is confirmed', () => {
    const markup = ownerMarkup({
      executionRoot: '/Users/prgrmrwy/corp/nexus',
      anchor: { status: 'confirmed', executionRoot: '/Users/prgrmrwy/corp/nexus' },
    })

    expect(markup).not.toContain('确认执行根')
    expect(markup).toContain('/Users/prgrmrwy/corp/nexus')
  })

  it('states that write means unbounded access shared by the entry', () => {
    // The label is the only place the owner is told what the grant really is;
    // hiding it behind a bare "可写" is the quiet widening this change removes.
    const locus = locusFixture({
      locusId: 'locus-runtime-full',
      chatId: 'oc_full',
      parentSessionId: 'session-parent',
      childSessionId: 'session-child',
      executionRoot: '/Users/prgrmrwy/corp/nexus',
      permission: { desired: 'write', effective: 'write', verifiedAt: 1, grantedBy: 'ou-owner' },
    })
    const snapshot = snapshotOf([locus], [locus.locusId])
    const markup = renderToStaticMarkup(
      createElement(LocusDetails, {
        family: groupByWork(snapshot)[0]!.families[0]!,
        codes: collectHandleCodes(snapshot),
        busy: false,
        busyKey: undefined,
        onAction: () => undefined,
      }),
    )

    expect(markup).toContain('可写（完全访问）')
    expect(markup).toContain('该入口成员共享整机写权限')
    expect(markup).toContain('不再受目录范围限制')
  })

  it('presents the execution root as context, not as an escalation gate', () => {
    const markup = ownerMarkup({ executionRoot: '/Users/prgrmrwy/corp/nexus' })

    expect(markup).toContain('上下文事实')
    expect(markup).toContain('不门控提权')
    // The old wording told the owner escalation was blocked on this; it is not.
    expect(markup).not.toContain('提权到可写需要先有可确认的执行根')
  })

  it('says why nothing can be confirmed when the Host resolved no root', () => {
    const markup = ownerMarkup({})

    expect(markup).toContain('宿主未能解析这个入口的执行根')
    // The control is rendered but inert: no path is invented to confirm.
    expect(markup).toContain('确认执行根')
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>确认执行根/)
  })
})
