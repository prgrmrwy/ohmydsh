import { describe, expect, it } from 'vitest'
import {
  LOCUS_WRITE_DISABLED_DIAGNOSTIC,
  LOCUS_WRITE_ENABLED,
  verifyLocusLivePolicy,
  verifyLocusPersistedPolicy,
} from '../src/host/locus/policy-verification.js'

const readOnly = { accessMode: 'read-only' as const }
const full = { accessMode: 'danger-full-access' as const }

describe('locus live sandbox policy verification (v20 accessMode)', () => {
  it('requires the live mode to equal the row\'s accessMode exactly', () => {
    expect(verifyLocusLivePolicy(readOnly, { mode: 'read-only', workspaceRoot: '/repo' }, true))
      .toEqual({ ok: true, effective: 'read-only' })
    expect(verifyLocusLivePolicy(full, { mode: 'danger-full-access' }, true))
      .toEqual({ ok: true, effective: 'danger-full-access' })
    for (const [row, mode] of [
      [readOnly, 'workspace-write'],
      [readOnly, 'danger-full-access'],
      [full, 'read-only'],
      [full, 'workspace-write'],
    ] as const) {
      expect(verifyLocusLivePolicy(row, { mode }, true)).toMatchObject({ ok: false, reason: 'mode-mismatch' })
    }
  })

  it('refuses an unreadable live policy', () => {
    expect(verifyLocusLivePolicy(readOnly, undefined, true)).toMatchObject({ ok: false, reason: 'policy-unavailable' })
    expect(verifyLocusLivePolicy(full, {}, true)).toMatchObject({ ok: false, reason: 'policy-unavailable' })
  })

  it('does not let a workspace root decide anything', () => {
    expect(verifyLocusLivePolicy(full, { mode: 'danger-full-access', workspaceRoot: '/' }, true))
      .toEqual({ ok: true, effective: 'danger-full-access' })
    expect(verifyLocusLivePolicy(full, { mode: 'workspace-write', workspaceRoot: '/' }, true))
      .toMatchObject({ ok: false, reason: 'mode-mismatch' })
  })
})

describe('the write master switch (LOCUS_WRITE_ENABLED)', () => {
  it('ships OFF: concurrent writes have no agreed protocol yet', () => {
    expect(LOCUS_WRITE_ENABLED).toBe(false)
  })

  it('refuses a danger-full-access row instead of demoting it (D8: no silent downgrade)', () => {
    for (const mode of ['read-only', 'danger-full-access'] as const) {
      const result = verifyLocusLivePolicy(full, { mode }, false)
      expect(result).toMatchObject({ ok: false, reason: 'write-disabled', diagnostic: LOCUS_WRITE_DISABLED_DIAGNOSTIC })
    }
    expect(verifyLocusPersistedPolicy(full, false))
      .toMatchObject({ ok: false, reason: 'write-disabled', diagnostic: LOCUS_WRITE_DISABLED_DIAGNOSTIC })
  })

  it('explains itself and never claims the entry keeps serving read-only', () => {
    expect(LOCUS_WRITE_DISABLED_DIAGNOSTIC).toContain('并发写')
    expect(LOCUS_WRITE_DISABLED_DIAGNOSTIC).toContain('写档已全局停用')
    expect(LOCUS_WRITE_DISABLED_DIAGNOSTIC).not.toMatch(/按只读服务/)
  })

  it('leaves read-only entries completely untouched', () => {
    expect(verifyLocusLivePolicy(readOnly, { mode: 'read-only' }, false)).toEqual({ ok: true, effective: 'read-only' })
    expect(verifyLocusPersistedPolicy(readOnly, false)).toEqual({ ok: true, effective: 'read-only' })
  })

  it('restores the full-access path exactly when flipped back on', () => {
    expect(verifyLocusLivePolicy(full, { mode: 'danger-full-access' }, true)).toEqual({ ok: true, effective: 'danger-full-access' })
    expect(verifyLocusPersistedPolicy(full, true)).toEqual({ ok: true, effective: 'danger-full-access' })
  })
})
