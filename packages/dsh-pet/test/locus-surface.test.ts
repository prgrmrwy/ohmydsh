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
import { LocusSurface } from '../src/client/settings.js'
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

  it('hides an archived parent by default and says so in the list', () => {
    const markup = render(surfaceSnapshot())
    // The entry under the archived parent is not rendered...
    expect(markup).not.toContain('oc_b1fa')
    // ...but it is not silently gone either.
    expect(markup).toContain('已隐藏 1 个父会话（已归档）')
    expect(markup).toContain('显示全部')
  })

  it('states every lifecycle state in words', () => {
    const markup = render(surfaceSnapshot())
    expect(markup).toContain('活跃')
    // The archived parent is named, not just counted.
    expect(markup).toContain('已归档')
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
  })

  it('nests a topic under the chat entry it inherits from', () => {
    const markup = render(surfaceSnapshot())
    expect(markup).toContain('data-nested="true"')
    // The nesting has to be legible as a fact, not only as indentation.
    expect(markup).toContain('继承自 入口 · a27b')
  })

  it('renders an empty state that points at the manual lookup', () => {
    const markup = render(snapshotOf([]))
    expect(markup).toContain('没有关联')
    expect(markup).toContain('发现关联')
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
