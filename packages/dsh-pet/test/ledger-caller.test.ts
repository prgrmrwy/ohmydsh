import { describe, expect, it } from 'vitest'
import {
  LedgerCallerUnavailableError,
  resolveLedgerCaller,
  reverifyLedgerCaller,
  type LedgerCallerLocusLookup,
} from '../src/host/ledger/caller.js'
import type { LocusRecord } from '../src/host/locus/aggregate.js'

function locus(overrides: Partial<LocusRecord> = {}): LocusRecord {
  return {
    id: 'locus-1',
    generation: 2,
    endpoint: { chatId: 'oc-project' },
    parentSessionId: 'main-1',
    childSessionId: 'child-1',
    workspaceId: 'workspace-1',
    source: 'auto',
    state: 'active',
    permission: { desired: 'read', effective: 'read' },
    busy: false,
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  }
}

function lookup(rows: readonly LocusRecord[]): LedgerCallerLocusLookup {
  return {
    findByChildSessionId: (childSessionId: string) => rows.filter(r => r.childSessionId === childSessionId),
  }
}

describe('resolveLedgerCaller', () => {
  it('resolves a valid active locus child to its identity facts', () => {
    const caller = resolveLedgerCaller('child-1', lookup([locus()]))
    expect(caller).toEqual({
      childSessionId: 'child-1',
      parentSessionId: 'main-1',
      locusId: 'locus-1',
      generation: 2,
      endpoint: { chatId: 'oc-project' },
    })
  })

  it('preserves threadId when the endpoint has one', () => {
    const caller = resolveLedgerCaller('child-1', lookup([
      locus({ endpoint: { chatId: 'oc-project', threadId: 'omt-x' } }),
    ]))
    expect(caller.endpoint).toEqual({ chatId: 'oc-project', threadId: 'omt-x' })
  })

  it('rejects a session with no matching locus row — an ordinary session, not a locus child', () => {
    expect(() => resolveLedgerCaller('not-a-child', lookup([locus()]))).toThrow(LedgerCallerUnavailableError)
  })

  it('rejects an AMBIGUOUS caller — more than one row for the same child session id — rather than picking one', () => {
    const rows = [locus({ id: 'locus-1', generation: 1 }), locus({ id: 'locus-2', generation: 1 })]
    expect(() => resolveLedgerCaller('child-1', lookup(rows))).toThrow(LedgerCallerUnavailableError)
  })

  it('rejects a RETIRED locus — spec: 已失效关联统一拒绝', () => {
    expect(() => resolveLedgerCaller('child-1', lookup([locus({ state: 'retired' })])))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('rejects an INVALID locus', () => {
    expect(() => resolveLedgerCaller('child-1', lookup([locus({ state: 'invalid' })])))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('rejects a STOPPED locus', () => {
    expect(() => resolveLedgerCaller('child-1', lookup([locus({ state: 'stopped' })])))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('rejects a PROVISIONING locus — not yet an active child', () => {
    expect(() => resolveLedgerCaller('child-1', lookup([locus({ state: 'provisioning' })])))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('rejects an empty/whitespace childSessionId — matches the "临时 subagent" no-identity case', () => {
    expect(() => resolveLedgerCaller('', lookup([locus()]))).toThrow(LedgerCallerUnavailableError)
    expect(() => resolveLedgerCaller('   ', lookup([locus()]))).toThrow(LedgerCallerUnavailableError)
  })

  it('rejects a row whose parentSessionId is missing/blank even if otherwise well-formed', () => {
    expect(() => resolveLedgerCaller('child-1', lookup([locus({ parentSessionId: '' })])))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('rejects a row with an invalid generation (zero, negative, non-integer)', () => {
    for (const generation of [0, -1, 1.5]) {
      expect(() => resolveLedgerCaller('child-1', lookup([locus({ generation })])))
        .toThrow(LedgerCallerUnavailableError)
    }
  })

  it('every refusal is the SAME error shape — spec: 不因目标存在与否产生可区分差异', () => {
    const cases = [
      () => resolveLedgerCaller('nonexistent', lookup([])),
      () => resolveLedgerCaller('child-1', lookup([locus({ state: 'retired' })])),
      () => resolveLedgerCaller('child-1', lookup([locus(), locus({ id: 'locus-2' })])),
    ]
    const messages = new Set<string>()
    const codes = new Set<string>()
    for (const attempt of cases) {
      try {
        attempt()
        throw new Error('expected a throw')
      } catch (error) {
        expect(error).toBeInstanceOf(LedgerCallerUnavailableError)
        messages.add((error as Error).message)
        codes.add((error as LedgerCallerUnavailableError).code)
      }
    }
    // All three structurally different failure causes collapse to ONE
    // message and ONE code — a caller cannot distinguish "no such session"
    // from "retired" from "ambiguous" by inspecting the refusal.
    expect(messages.size).toBe(1)
    expect(codes.size).toBe(1)
  })

  it('the refusal message never echoes a locus id, parent session id or generation', () => {
    let thrown: unknown
    try {
      resolveLedgerCaller('nonexistent-child', lookup([locus({ id: 'secret-locus-id', parentSessionId: 'secret-main' })]))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(LedgerCallerUnavailableError)
    expect((thrown as Error).message).not.toContain('secret-locus-id')
    expect((thrown as Error).message).not.toContain('secret-main')
  })
})

describe('reverifyLedgerCaller (cross-await re-verification for the write path)', () => {
  it('succeeds when nothing changed between the first resolution and the write', () => {
    const rows = [locus()]
    const first = resolveLedgerCaller('child-1', lookup(rows))
    const second = reverifyLedgerCaller('child-1', lookup(rows), first)
    expect(second).toEqual(first)
  })

  it('spec 3.3: rejects when the locus retired in the gap between resolution and write', () => {
    const first = resolveLedgerCaller('child-1', lookup([locus()]))
    // Simulate the association changing state during the async gap.
    const retiredNow = lookup([locus({ state: 'retired' })])
    expect(() => reverifyLedgerCaller('child-1', retiredNow, first)).toThrow(LedgerCallerUnavailableError)
  })

  it('spec 3.3: rejects when the generation advanced (source switched / explicit rebuild) in the gap', () => {
    const first = resolveLedgerCaller('child-1', lookup([locus({ generation: 2 })]))
    // A rebuild would normally also change childSessionId, but even if this
    // exact child session id somehow persisted with a bumped generation, the
    // stale first-resolution generation must not be trusted for the write.
    const rebuilt = lookup([locus({ generation: 3 })])
    expect(() => reverifyLedgerCaller('child-1', rebuilt, first)).toThrow(LedgerCallerUnavailableError)
  })

  it('spec 3.3: rejects when the parentSessionId changed in the gap (should not happen for a stable locusId, but must not be trusted if it did)', () => {
    const first = resolveLedgerCaller('child-1', lookup([locus()]))
    const switchedParent = lookup([locus({ parentSessionId: 'main-2' })])
    expect(() => reverifyLedgerCaller('child-1', switchedParent, first)).toThrow(LedgerCallerUnavailableError)
  })

  it('rejects when the child session was replaced by a wholly different locus association in the gap', () => {
    const first = resolveLedgerCaller('child-1', lookup([locus({ locusId: 'locus-1' } as Partial<LocusRecord>)]))
    const differentAssociation = lookup([locus({ id: 'locus-9', parentSessionId: 'main-9' })])
    expect(() => reverifyLedgerCaller('child-1', differentAssociation, first)).toThrow(LedgerCallerUnavailableError)
  })
})
