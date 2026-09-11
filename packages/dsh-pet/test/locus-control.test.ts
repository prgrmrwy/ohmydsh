import { describe, expect, it, vi } from 'vitest'
import {
  createLocusControlDispatcher,
  LOCUS_BIND_UNRESOLVED_TEXT,
  locusSessionReceiptLabel,
  resolveLocusBindPrefix,
  type LocusBindableSession,
} from '../src/host/locus/control.js'

const ENDPOINT = { chatId: 'oc-project', key: 'oc-project' } as const
const OWNER = 'ou-owner'

function session(
  id: string,
  overrides: Partial<LocusBindableSession> = {},
): LocusBindableSession {
  return { id, title: '研发会话', workspaceId: 'ws-project', state: 'active', ...overrides }
}

function bindResult(parentSessionId: string) {
  return {
    group: {
      chatId: ENDPOINT.chatId,
      workspaceId: 'ws-project',
      mainSessionId: parentSessionId,
      mainSource: 'explicit' as const,
      state: 'active' as const,
      createdAt: 1,
      updatedAt: 1,
    },
    locus: {
      locusId: 'locus-1',
      generation: 1,
      endpoint: { chatId: ENDPOINT.chatId },
      workspaceId: 'ws-project',
      parentSessionId,
      childSessionId: 'session-child',
      source: 'explicit' as const,
      state: 'active' as const,
      permission: 'read' as const,
      createdAt: 1,
    },
    created: true,
    reused: false,
  }
}

describe('unified locus bind prefix resolution', () => {
  it('accepts six or more badge characters and excludes archived or child sessions', () => {
    const candidates = [
      session('session-abcdef111111'),
      session('session-abcdef222222', { state: 'archived' }),
      session('session-child000000', { parentSessionId: 'session-parent' }),
    ]

    expect(resolveLocusBindPrefix('abcde', candidates)).toEqual({
      resolved: false,
      reason: 'too-short',
    })
    expect(resolveLocusBindPrefix('abcdef', candidates)).toEqual({
      resolved: true,
      session: candidates[0],
    })
    expect(resolveLocusBindPrefix('ABCDEF111', candidates)).toEqual({
      resolved: true,
      session: candidates[0],
    })
  })

  it('gives no match and multiple matches one indistinguishable outcome', () => {
    const candidates = [
      session('session-abcdef111111'),
      session('session-abcdef222222'),
    ]
    expect(resolveLocusBindPrefix('zzzzzz', candidates)).toEqual({
      resolved: false,
      reason: 'not-unique',
    })
    expect(resolveLocusBindPrefix('abcdef', candidates)).toEqual({
      resolved: false,
      reason: 'not-unique',
    })
  })

  it('uses the title with the same first-six short identity as the UI badge', () => {
    expect(locusSessionReceiptLabel(session('session-abcdef123456'))).toBe('「研发会话」（abcdef）')
    expect(locusSessionReceiptLabel(session('session-abcdef123456', { title: ' ' }))).toBe('abcdef')
    expect(locusSessionReceiptLabel(session('session-123456abcdef', { title: '研发会话' })))
      .toBe('「研发会话」（123456）')
  })
})

describe('unified locus command dispatcher', () => {
  it('reads the real chat name and returns a title plus short-id bind receipt', async () => {
    const bind = vi.fn(async ({ parentSessionId }: { parentSessionId: string }) => bindResult(parentSessionId))
    const dispatcher = createLocusControlDispatcher({
      allowOpenIds: () => [OWNER],
      listSessions: () => [session('session-abcdef123456')],
      bind: { bind: bind as never },
      exit: { unbindCurrent: async () => ({ state: 'stopped' }) },
      chatName: async () => '真实项目群',
    })

    await expect(dispatcher.dispatch({
      command: { kind: 'bind', prefix: 'abcdef' },
      endpoint: ENDPOINT,
      senderId: OWNER,
    })).resolves.toEqual({
      ok: true,
      text: '群「真实项目群」已绑定主会话 「研发会话」（abcdef）；已创建新的只读子会话。',
    })
    expect(bind).toHaveBeenCalledWith({
      endpoint: { chatId: ENDPOINT.chatId },
      parentSessionId: 'session-abcdef123456',
      chatName: '真实项目群',
      actorId: OWNER,
    })
  })

  it('leaves an unreadable real chat name absent instead of inventing one', async () => {
    const bind = vi.fn(async ({ parentSessionId }: { parentSessionId: string }) => bindResult(parentSessionId))
    const dispatcher = createLocusControlDispatcher({
      allowOpenIds: () => [OWNER],
      listSessions: () => [session('session-abcdef123456', { title: undefined })],
      bind: { bind: bind as never },
      exit: { unbindCurrent: async () => ({ state: 'stopped' }) },
      chatName: async () => { throw new Error('not readable') },
    })

    await expect(dispatcher.dispatch({
      command: { kind: 'bind', prefix: 'abcdef' }, endpoint: ENDPOINT, senderId: OWNER,
    })).resolves.toEqual({
      ok: true,
      text: '当前入口已绑定主会话 abcdef；已创建新的只读子会话。',
    })
    expect(bind).toHaveBeenCalledWith({
      endpoint: { chatId: ENDPOINT.chatId },
      parentSessionId: 'session-abcdef123456',
      actorId: OWNER,
    })
  })

  it('keeps absent and ambiguous prefixes on the exact same receipt', async () => {
    const sessions = [session('session-abcdef111111'), session('session-abcdef222222')]
    const bind = vi.fn()
    const dispatcher = createLocusControlDispatcher({
      allowOpenIds: () => [OWNER],
      listSessions: () => sessions,
      bind: { bind },
      exit: { unbindCurrent: async () => ({ state: 'stopped' }) },
    })
    const noMatch = await dispatcher.dispatch({
      command: { kind: 'bind', prefix: 'zzzzzz' }, endpoint: ENDPOINT, senderId: OWNER,
    })
    const ambiguous = await dispatcher.dispatch({
      command: { kind: 'bind', prefix: 'abcdef' }, endpoint: ENDPOINT, senderId: OWNER,
    })
    expect(noMatch).toEqual({ ok: false, reason: 'prefix-unresolved', text: LOCUS_BIND_UNRESOLVED_TEXT })
    expect(ambiguous).toEqual(noMatch)
    expect(bind).not.toHaveBeenCalled()
  })

  it('uses the dedicated protected rebuild port and never the ordinary ensure bind', async () => {
    const bind = vi.fn()
    const rebuildProtected = vi.fn(async ({ parentSessionId }: { parentSessionId: string }) => bindResult(parentSessionId))
    const dispatcher = createLocusControlDispatcher({
      allowOpenIds: () => [OWNER],
      listSessions: () => [session('session-abcdef123456')],
      bind: { bind, rebuildProtected: rebuildProtected as never },
      exit: { unbindCurrent: async () => ({ state: 'stopped' }) },
    })

    await expect(dispatcher.dispatch({
      command: { kind: 'bind', prefix: 'abcdef' }, endpoint: ENDPOINT, senderId: OWNER, authorization: 'legacy',
    })).resolves.toMatchObject({ ok: true })
    expect(bind).not.toHaveBeenCalled()
    expect(rebuildProtected).toHaveBeenCalledWith({
      endpoint: { chatId: ENDPOINT.chatId },
      parentSessionId: 'session-abcdef123456',
      actorId: OWNER,
      marker: 'legacy',
    })
  })

  it('fails closed when a protected endpoint has no explicit rebuild adapter', async () => {
    const bind = vi.fn()
    const dispatcher = createLocusControlDispatcher({
      allowOpenIds: () => [OWNER],
      listSessions: () => [session('session-abcdef123456')],
      bind: { bind },
      exit: { unbindCurrent: async () => ({ state: 'stopped' }) },
    })
    await expect(dispatcher.dispatch({
      command: { kind: 'bind', prefix: 'abcdef' }, endpoint: ENDPOINT, senderId: OWNER, authorization: 'legacy',
    })).resolves.toMatchObject({ ok: false, reason: 'rebuild-unavailable' })
    expect(bind).not.toHaveBeenCalled()
  })

  it('rechecks allowlist and never invokes a mutation for an unauthorized direct call', async () => {
    const bind = vi.fn()
    const unbindCurrent = vi.fn()
    const dispatcher = createLocusControlDispatcher({
      allowOpenIds: () => [OWNER],
      listSessions: () => [session('session-abcdef123456')],
      bind: { bind },
      exit: { unbindCurrent },
    })
    await expect(dispatcher.dispatch({
      command: { kind: 'bind', prefix: 'abcdef' }, endpoint: ENDPOINT, senderId: 'ou-stranger',
    })).resolves.toEqual({ ok: false, reason: 'not-allowed', silent: true })
    expect(bind).not.toHaveBeenCalled()
    expect(unbindCurrent).not.toHaveBeenCalled()
  })

  it('unbinds the exact endpoint only after a stopped marker is confirmed', async () => {
    const unbindCurrent = vi.fn(async () => ({ state: 'stopped' as const }))
    const dispatcher = createLocusControlDispatcher({
      allowOpenIds: () => [OWNER],
      listSessions: () => [],
      bind: { bind: vi.fn() },
      exit: { unbindCurrent },
    })
    const result = await dispatcher.dispatch({ command: { kind: 'unbind' }, endpoint: ENDPOINT, senderId: OWNER })
    expect(result).toMatchObject({ ok: true })
    expect(result.text).toContain('显式重建')
    expect(unbindCurrent).toHaveBeenCalledWith({ endpoint: { chatId: ENDPOINT.chatId }, actorId: OWNER })
  })

  it('maps busy control mutations to a deterministic retry receipt', async () => {
    const dispatcher = createLocusControlDispatcher({
      allowOpenIds: () => [OWNER],
      listSessions: () => [],
      bind: { bind: vi.fn() },
      exit: {
        unbindCurrent: async () => {
          throw Object.assign(new Error('busy'), { code: 'LOCUS_BUSY' })
        },
      },
    })
    await expect(dispatcher.dispatch({ command: { kind: 'unbind' }, endpoint: ENDPOINT, senderId: OWNER }))
      .resolves.toEqual({ ok: false, reason: 'busy', text: '当前入口仍有执行中或排队消息，请稍后重试。' })
  })
})
