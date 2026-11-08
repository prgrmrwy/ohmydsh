/**
 * The shared serviceability policy (v20 rows).
 *
 * The policy used to be restated in six places across four files, so teaching
 * the channel to recover a Host-invalidated row took three rounds of fixes.
 * The full state table is pinned here so a future state cannot be added
 * without an explicit decision, and every delivery-path layer can be checked
 * against ONE source. Spec: "换绑与归档按层处理".
 */
import { describe, expect, it } from 'vitest'
import { LOCUS_STATES_V20, type LocusStateV20 } from '../src/host/locus/contract-v20.js'
import { dispositionOf, isOwnerExit } from '../src/host/locus/serviceability.js'

const ALL_STATES = LOCUS_STATES_V20

describe('locus serviceability policy', () => {
  it('serves an active row and lets a not-created row take its first message', () => {
    expect(dispositionOf({ state: 'active' })).toEqual({ kind: 'serve' })
    expect(dispositionOf({ state: 'not-created' })).toEqual({ kind: 'create' })
  })

  // The distinction the whole three-round bug hinged on: an owner exit is
  // terminal, a Host judgement is replaceable.
  it('treats an owner stop as terminal and a Host invalidation as replaceable in place', () => {
    expect(dispositionOf({ state: 'stopped' })).toMatchObject({ kind: 'terminal', workArchived: false })
    expect(dispositionOf({ state: 'invalid', invalidReason: '子会话已不存在' })).toMatchObject({
      kind: 'replace',
      why: 'child-unusable',
      reason: expect.stringContaining('子会话已不存在'),
    })
  })

  it('carries the stored reason into the Host-invalidation diagnosis', () => {
    expect(dispositionOf({ state: 'invalid' })).toMatchObject({
      kind: 'replace',
      why: 'child-unusable',
      reason: expect.stringContaining('Host'),
    })
  })

  // Adding a state must be a deliberate act: this table forces it to be recorded.
  it('classifies every known state exactly once', () => {
    const expected: Record<LocusStateV20, 'serve' | 'replace' | 'terminal' | 'create'> = {
      active: 'serve',
      'not-created': 'create',
      invalid: 'replace',
      stopped: 'terminal',
    }
    for (const state of ALL_STATES) expect(dispositionOf({ state }).kind).toBe(expected[state])
    expect(Object.keys(expected).sort()).toEqual([...ALL_STATES].sort())
    expect(ALL_STATES.filter(isOwnerExit)).toEqual(['stopped'])
  })

  it('rejects states the v20 model no longer has: they are terminal, never served', () => {
    for (const state of ['provisioning', 'switching', 'retired']) {
      expect(dispositionOf({ state })).toMatchObject({ kind: 'terminal', workArchived: false })
    }
  })

  // 工作主会话归档: the W is archived, the row's own state is not touched.
  it('never serves, creates or replaces an entry whose work session is archived', () => {
    for (const state of ALL_STATES) {
      expect(dispositionOf({ state, workArchived: true })).toMatchObject({ kind: 'terminal', workArchived: true })
    }
    // The fact decides, not the state: unarchived is unchanged.
    expect(dispositionOf({ state: 'active', workArchived: false }).kind).toBe('serve')
    expect(dispositionOf({ state: 'invalid', workArchived: false }).kind).toBe('replace')
  })

  it('an archived W outranks an unavailable M: no migration while W is archived', () => {
    expect(dispositionOf({ state: 'active', workArchived: true, mainUnavailable: true }))
      .toMatchObject({ kind: 'terminal', workArchived: true })
  })

  it('an unavailable M with a live W is repaired by whole-W migration, but a stopped entry is never revived', () => {
    expect(dispositionOf({ state: 'active', mainUnavailable: true }))
      .toMatchObject({ kind: 'replace', why: 'locus-main-unavailable' })
    expect(dispositionOf({ state: 'not-created', mainUnavailable: true }))
      .toMatchObject({ kind: 'replace', why: 'locus-main-unavailable' })
    expect(dispositionOf({ state: 'stopped', mainUnavailable: true })).toMatchObject({ kind: 'terminal' })
  })
})
