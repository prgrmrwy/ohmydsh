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
import {
  describeActionReceipt,
  LocusDetails,
  LocusSurface,
  WorkSection,
} from '../src/client/settings.js'
import { collectHandleCodes, groupByWork } from '../src/client/locus-view.js'
import { LOCUS_WRITE_ENABLED } from '../src/host/locus/policy-verification.js'
import { locusFixture, snapshotOf, surfaceSnapshot } from './fixtures/locus-snapshot.js'
import type { PetLocusManagementView } from '../src/wire.js'

function render(snapshot: PetLocusManagementView): string {
  return renderToStaticMarkup(
    createElement(LocusSurface, {
      snapshot,
      onAction: () => undefined,
      runQuery: async () => undefined,
      // These cases assert how ENTRY ROWS render (nesting, naming, state
      // wording); the list now collapses each session by default, so they
      // expand it rather than re-testing the collapse behaviour, which
      // `ledger-panel-render.test.ts` owns.
      initialWorksExpanded: true,
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

describe('the execution-root surface is retired from the panel', () => {
  // ADR-0005 demoted the anchor to a context fact that no longer gates
  // escalation, and the write switch is off, so the row and the confirm
  // control are gone. The RULES they enforced are not gone: they live in
  // `locus-view.ts` and stay covered by `locus-view.test.ts`
  // (`locusNeedsExecutionRoot`, `locusConfirmCandidate`,
  // `locusAnchorConfirmRequest`), which is what makes restoring this surface a
  // rendering change rather than a re-derivation.
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

  it('renders neither the execution-root row nor a confirm control', () => {
    const markup = ownerMarkup({ executionRoot: '/Users/prgrmrwy/corp/nexus' })

    expect(markup).not.toContain('确认执行根')
    expect(markup).not.toContain('<dt>执行根</dt>')
  })

  it('removing that row leaves its neighbours intact', () => {
    // A deletion that quietly takes the surrounding facts with it is the
    // failure mode worth pinning: 权限 and 操作 sat either side of where the
    // row used to be. 询问 is asserted separately — it is now conditional on
    // the Host actually projecting owner facts.
    const markup = ownerMarkup({ executionRoot: '/Users/prgrmrwy/corp/nexus' })

    expect(markup).toContain('<dt>来源</dt>')
    expect(markup).toContain('<dt>权限</dt>')
    expect(markup).toContain('<dt>操作</dt>')
  })

  it('shows the permission mode without a verification suffix', () => {
    // `verifiedAt` is written ONLY by an owner permission change. With the
    // write switch off and the permission control retired, nothing can set it,
    // so the old 「· 未核验」 suffix was true on every single entry and
    // distinguished nothing.
    const markup = ownerMarkup({ executionRoot: '/Users/prgrmrwy/corp/nexus' })

    expect(markup).toContain('<dt>权限</dt><dd>只读</dd>')
    expect(markup).not.toContain('未核验')
  })

  it('omits the owner-facts row entirely when the Host projects nothing', () => {
    // The projection is an optional dependency that is not composed today, so
    // an unconditional row printed the same 「no data」 sentence everywhere —
    // an absence dressed up as content.
    const markup = ownerMarkup({ executionRoot: '/Users/prgrmrwy/corp/nexus' })

    expect(markup).not.toContain('<dt>询问</dt>')
    expect(markup).not.toContain('Host 未提供 owner 投影')
  })

  it('still shows the effective permission as a fact', () => {
    // The control is gone; the current mode must remain visible, otherwise the
    // owner has no way to read what this entry is actually serving as.
    const markup = ownerMarkup({ executionRoot: '/Users/prgrmrwy/corp/nexus' })

    expect(markup).toContain('只读')
  })

  it('offers no permission control while the write switch is off', () => {
    const markup = ownerMarkup({ executionRoot: '/Users/prgrmrwy/corp/nexus' })

    expect(LOCUS_WRITE_ENABLED).toBe(false)
    expect(markup).not.toContain('dshpet-locus-perm')
  })
})

/**
 * What an archived main session tells its owner.
 *
 * All three cases below were reported from the panel as "the button vanished
 * and nothing happened": the action's absence, the row's advice, and a finished
 * migration were each rendered as silence, so a correct outcome and a broken
 * one looked identical.
 */
describe('an archived main session explains itself', () => {
  const archivedGroup = (state: 'active' | 'stopped'): string => {
    const locus = locusFixture({
      locusId: 'locus-runtime-1789543241305-c8db4d8e783e28',
      chatId: 'oc_7d5a25d55cfc1109fa1facac0a6d8bc9',
      parentSessionId: 'session-230c15fb-55c3-4e2a-ad47-e4e2bd921ad8',
      parentAvailability: 'archived',
      childSessionId: 'session-43a3f4bd-b59c-4369-a997-23b82c774a6a',
      state,
    })
    const snapshot = snapshotOf([locus], [locus.locusId])
    return renderToStaticMarkup(
      createElement(WorkSection, {
        work: groupByWork(snapshot)[0]!,
        reading: 'work' as const,
        codes: collectHandleCodes(snapshot),
        busyKey: undefined,
        onAction: () => undefined,
        openKeys: [],
        onToggle: () => undefined,
        historyKeys: [],
        onToggleHistory: () => undefined,
        sharedEntryCount: () => 1,
        hasDefaultQa: true,
      }),
    )
  }

  it('offers the replacement, and the matching advice, while an entry can still move', () => {
    const markup = archivedGroup('active')
    expect(markup).toContain('用新的主会话接替')
    expect(markup).toContain('恢复该主会话后本入口即恢复服务')
  })

  it('does not advertise repairs that cannot reach a stopped entry', () => {
    // The entry was stopped by its owner: the session-level replacement skips
    // it on purpose, and restoring the session does not revive it either. The
    // earlier text named both anyway and sent the owner down a dead end.
    const markup = archivedGroup('stopped')
    expect(markup).not.toContain('用新的主会话接替')
    expect(markup).not.toContain('恢复该主会话后本入口即恢复服务')
    expect(markup).toContain('迁移不会搬走它')
    expect(markup).toContain('需要恢复该主会话后再显式重建本入口')
  })

  it('says why no replacement is offered instead of rendering nothing', () => {
    const markup = archivedGroup('stopped')
    expect(markup).toContain('本会话名下已无在服务的入口')
    // Names where the history went, so a completed migration is distinguishable
    // from a group that never had anything.
    expect(markup).toContain('已停止 / 已失效')
  })

  it('keeps that sentence out of the single-line header', () => {
    // `dshpet-work-tail` is a `flex:none` strip sized for chips and one button.
    // A sentence placed there stretched the title line and was clipped at the
    // panel edge; `dshpet-work-note` is the block this session already uses for
    // prose, so the note must render there instead.
    const markup = archivedGroup('stopped')
    const header = markup.slice(
      markup.indexOf('dshpet-work-tail'),
      markup.indexOf('dshpet-work-sub'),
    )
    expect(header).not.toContain('本会话名下已无在服务的入口')
    expect(markup).toMatch(/dshpet-work-note[^>]*>本会话名下已无在服务的入口/)
  })
})

/**
 * The receipt for an action whose effect leaves the surface it was taken on.
 *
 * A session-level replacement moves its entries into a DIFFERENT group, stops
 * rendering its own button (nothing is left to move) and leaves retired
 * generations the default filter hides. Without a receipt, that complete
 * success is indistinguishable from a no-op.
 */
describe('completed action receipts', () => {
  it('states how many entries moved and where they went', () => {
    expect(describeActionReceipt({
      action: 'replace-parent',
      parentSessionId: 'session-b843540f-1111-2222-3333-444455556666',
      replaced: ['locus-a', 'locus-b'],
      skipped: [],
    })).toBe('已把 2 个入口迁到新主会话 …556666；原主会话保持归档不动，旧代际作为历史保留。')
  })

  it('names every refusal, because the owner has to act on each one', () => {
    const receipt = describeActionReceipt({
      action: 'replace-parent',
      parentSessionId: 'session-b843540f-1111-2222-3333-444455556666',
      replaced: ['locus-a'],
      skipped: [{ locusId: 'locus-stale-000042', reason: '入口当前代际已变化，请刷新后重试。' }],
    })
    expect(receipt).toContain('已把 1 个入口迁到新主会话')
    expect(receipt).toContain('未迁移 1 个')
    expect(receipt).toContain('入口当前代际已变化')
  })

  it('stays silent for a per-entry action, whose own row already shows it', () => {
    expect(describeActionReceipt({ action: 'rebuild', locus: {} })).toBeUndefined()
    expect(describeActionReceipt({ action: 'stop', locus: {} })).toBeUndefined()
    // A malformed result must not produce a confident-looking sentence.
    expect(describeActionReceipt({ action: 'replace-parent' })).toBeUndefined()
  })
})
