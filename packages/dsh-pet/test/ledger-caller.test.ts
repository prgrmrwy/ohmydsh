import { describe, expect, it } from 'vitest'
import {
  LedgerCallerUnavailableError,
  resolveLedgerCaller,
  reverifyLedgerCaller,
  type LedgerCallerLocusLookup,
} from '../src/host/ledger/caller.js'
import type { LocusResolvedRowV20, LocusRowV20 } from '../src/host/locus/contract-v20.js'

type Overrides = Partial<LocusRowV20> & { locusMainSessionId?: string }

/** A resolved v20 row (the shape `findBySessionId` returns): topic rows take M from their group. */
function resolved(overrides: Overrides = {}): LocusResolvedRowV20 {
  const { locusMainSessionId = 'main-1', ...row } = overrides
  return {
    row: {
      endpoint: { chatId: 'oc-project' },
      locusId: 'locus-1',
      sessionId: 'child-1',
      state: 'active',
      accessMode: 'read-only',
      revision: 2,
      createdAt: 10,
      updatedAt: 10,
      locusMainSessionId,
      workspaceId: 'workspace-1',
      ...row,
    } as LocusRowV20,
    locusMainSessionId,
    workspaceId: 'workspace-1',
  }
}

function lookup(rows: readonly LocusResolvedRowV20[]): LedgerCallerLocusLookup {
  return {
    findBySessionId: (sessionId: string) => {
      const matches = rows.filter(r => r.row.sessionId === sessionId)
      if (matches.length > 1) throw new Error('ambiguous')
      return matches[0]
    },
  }
}

describe('resolveLedgerCaller', () => {
  it('resolves a valid active locus child to its identity facts (no generation)', () => {
    expect(resolveLedgerCaller('child-1', lookup([resolved()]))).toEqual({
      childSessionId: 'child-1',
      parentSessionId: 'main-1',
      locusId: 'locus-1',
      endpoint: { chatId: 'oc-project' },
    })
  })

  it('preserves threadId and takes the topic row M from its group', () => {
    const caller = resolveLedgerCaller('child-1', lookup([resolved({ endpoint: { chatId: 'oc-project', threadId: 'omt-x' } })]))
    expect(caller.endpoint).toEqual({ chatId: 'oc-project', threadId: 'omt-x' })
    expect(caller.parentSessionId).toBe('main-1')
  })

  it('rejects a session with no matching row — an ordinary session, not a locus child', () => {
    expect(() => resolveLedgerCaller('not-a-child', lookup([resolved()]))).toThrow(LedgerCallerUnavailableError)
  })

  it('rejects an AMBIGUOUS caller rather than picking one', () => {
    const rows = [resolved({ locusId: 'locus-1' }), resolved({ locusId: 'locus-2' })]
    expect(() => resolveLedgerCaller('child-1', lookup(rows))).toThrow(LedgerCallerUnavailableError)
  })

  it.each(['invalid', 'stopped', 'not-created'])('rejects a %s row — only an active child can call', state => {
    const extra = state === 'invalid' ? { invalidReason: 'x' } : state === 'stopped' ? { stoppedAt: 1 } : {}
    expect(() => resolveLedgerCaller('child-1', lookup([resolved({ state, ...extra } as Overrides)])))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('rejects an empty/whitespace childSessionId — the "临时 subagent" no-identity case', () => {
    expect(() => resolveLedgerCaller('', lookup([resolved()]))).toThrow(LedgerCallerUnavailableError)
    expect(() => resolveLedgerCaller('   ', lookup([resolved()]))).toThrow(LedgerCallerUnavailableError)
  })

  it('rejects a row whose M is missing/blank even if otherwise well-formed', () => {
    expect(() => resolveLedgerCaller('child-1', lookup([resolved({ locusMainSessionId: '' })])))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('every refusal is the SAME error shape — 不因目标存在与否产生可区分差异', () => {
    const cases = [
      () => resolveLedgerCaller('nonexistent', lookup([])),
      () => resolveLedgerCaller('child-1', lookup([resolved({ state: 'stopped', stoppedAt: 1 } as Overrides)])),
      () => resolveLedgerCaller('child-1', lookup([resolved(), resolved({ locusId: 'locus-2' })])),
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
    expect(messages.size).toBe(1)
    expect(codes.size).toBe(1)
  })

  it('the refusal message never echoes a locus id or M', () => {
    let thrown: unknown
    try {
      resolveLedgerCaller('nonexistent-child', lookup([resolved({ locusId: 'secret-locus-id', locusMainSessionId: 'secret-main' })]))
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
    const rows = [resolved()]
    const first = resolveLedgerCaller('child-1', lookup(rows))
    expect(reverifyLedgerCaller('child-1', lookup(rows), first)).toEqual(first)
  })

  it('an access change (revision bump) between resolution and write does not invalidate the caller', () => {
    const first = resolveLedgerCaller('child-1', lookup([resolved({ revision: 2 })]))
    expect(reverifyLedgerCaller('child-1', lookup([resolved({ revision: 3 })]), first)).toEqual(first)
  })

  it('rejects when the row stopped in the gap', () => {
    const first = resolveLedgerCaller('child-1', lookup([resolved()]))
    expect(() => reverifyLedgerCaller('child-1', lookup([resolved({ state: 'stopped', stoppedAt: 1 } as Overrides)]), first))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('rejects when the sessionId was replaced (rebuild / rebind / migration): the old child no longer resolves', () => {
    const first = resolveLedgerCaller('child-1', lookup([resolved()]))
    expect(() => reverifyLedgerCaller('child-1', lookup([resolved({ sessionId: 'child-2' })]), first))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('rejects when the M changed in the gap (whole-W migration or rebind)', () => {
    const first = resolveLedgerCaller('child-1', lookup([resolved()]))
    expect(() => reverifyLedgerCaller('child-1', lookup([resolved({ locusMainSessionId: 'main-2' })]), first))
      .toThrow(LedgerCallerUnavailableError)
  })

  it('rejects when the child session was replaced by a wholly different association in the gap', () => {
    const first = resolveLedgerCaller('child-1', lookup([resolved()]))
    expect(() => reverifyLedgerCaller('child-1', lookup([resolved({ locusId: 'locus-9', locusMainSessionId: 'main-9' })]), first))
      .toThrow(LedgerCallerUnavailableError)
  })
})
