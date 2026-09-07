/**
 * Prefix resolution, with the non-disclosure property as the main subject.
 *
 * The interesting assertion is not that both failures fail — it is that they
 * are byte-for-byte the same value. A test that only checked `resolved:false`
 * would pass even if one branch leaked a count, which is precisely the
 * failure mode this design forbids.
 */

import { describe, expect, it } from 'vitest'
import {
  MIN_PREFIX_LENGTH,
  resolveSessionByPrefix,
  type BindableSession,
} from '../src/host/qa/resolve-session.js'

const SESSIONS: BindableSession[] = [
  { id: 'session-abc123de-0000-0000-0000-000000000001', title: '排查登录失败' },
  { id: 'session-abc123ff-0000-0000-0000-000000000002', title: '另一个也以 abc123 开头' },
  { id: 'session-def456aa-0000-0000-0000-000000000003', title: '唯一的 def456' },
  { id: 'session-9999aaaa-0000-0000-0000-000000000004', title: '已归档', archived: true },
  {
    id: 'session-child000-0000-0000-0000-000000000005',
    title: '某个 qa child',
    parentSession: 'session-def456aa-0000-0000-0000-000000000003',
  },
]

describe('resolving a unique prefix', () => {
  it('matches on the short id as shown in the UI', () => {
    const result = resolveSessionByPrefix('def456', SESSIONS)

    expect(result.resolved).toBe(true)
    if (result.resolved) expect(result.session.title).toBe('唯一的 def456')
  })

  it('accepts a longer prefix to break a collision', () => {
    // `abc123` alone is ambiguous; one more character settles it.
    expect(resolveSessionByPrefix('abc123', SESSIONS).resolved).toBe(false)

    const result = resolveSessionByPrefix('abc123d', SESSIONS)

    expect(result.resolved).toBe(true)
    if (result.resolved) expect(result.session.title).toBe('排查登录失败')
  })

  it('is case-insensitive', () => {
    expect(resolveSessionByPrefix('DEF456', SESSIONS).resolved).toBe(true)
  })
})

describe('the two failures are indistinguishable', () => {
  it('returns an identical value for no match and several matches', () => {
    const none = resolveSessionByPrefix('ffffff', SESSIONS)
    const several = resolveSessionByPrefix('abc123', SESSIONS)

    // THE assertion of this module: not merely that both fail, but that the
    // caller cannot tell which happened. A leaked count would turn `/bind`
    // into an oracle for probing which session ids exist.
    expect(none).toEqual(several)
    expect(none.resolved).toBe(false)
    expect(JSON.stringify(none)).toBe(JSON.stringify(several))
  })

  it('reports nothing beyond the fused reason', () => {
    const result = resolveSessionByPrefix('abc123', SESSIONS)

    // No count, no ids, no titles — the whole value is the refusal.
    expect(Object.keys(result).sort()).toEqual(['reason', 'resolved'])
    if (!result.resolved) expect(result.reason).toBe('not-unique')
  })
})

describe('sessions that cannot be a source', () => {
  it('excludes archived sessions', () => {
    // Archived sessions cannot be forked, so matching one would only produce
    // a failure later, with a worse message.
    expect(resolveSessionByPrefix('9999aa', SESSIONS).resolved).toBe(false)
  })

  it('excludes subagent children', () => {
    // Binding a QA group to a QA child would nest one answering context
    // inside another.
    expect(resolveSessionByPrefix('child0', SESSIONS).resolved).toBe(false)
  })

  it('does not let an excluded session create a collision', () => {
    // `def456` matches one live session and no others; the child that points
    // AT it must not make the prefix ambiguous.
    expect(resolveSessionByPrefix('def456', SESSIONS).resolved).toBe(true)
  })
})

describe('a prefix that is too short', () => {
  it('is refused with its own reason', () => {
    const result = resolveSessionByPrefix('abc', SESSIONS)

    // Safe to state precisely: it describes the input the user just typed,
    // not anything about which sessions exist.
    expect(result.resolved).toBe(false)
    if (!result.resolved) expect(result.reason).toBe('too-short')
  })

  it('accepts exactly the minimum length', () => {
    expect('def456'.length).toBe(MIN_PREFIX_LENGTH)
    expect(resolveSessionByPrefix('def456', SESSIONS).resolved).toBe(true)
  })
})
