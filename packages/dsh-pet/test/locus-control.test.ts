import { describe, expect, it, vi } from 'vitest'
import { LOCUS_COMMAND_TABLE } from '../src/host/locus/admission.js'
import { LocusControllerError } from '../src/host/locus/controller.js'
import { PetError } from '../src/host/errors.js'
import {
  createLocusControlDispatcher,
  LOCUS_BIND_SHARING_DISCLOSURE,
  LOCUS_BIND_UNRESOLVED_TEXT,
  locusSessionIdMatchesPrefix,
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

  it('spec Scenario "子会话不能作为绑定源": a prefix that only hits a child reads exactly like no match', () => {
    const candidates = [session('session-child000000', { parentSessionId: 'session-parent' })]

    expect(resolveLocusBindPrefix('child0', candidates)).toEqual(resolveLocusBindPrefix('zzzzzz', candidates))
    expect(resolveLocusBindPrefix('child0', candidates)).toMatchObject({ resolved: false })
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


function dispatcherWith(overrides: Record<string, unknown> = {}) {
  const bind = vi.fn(async ({ parentSessionId }: { parentSessionId: string }) => bindResult(parentSessionId))
  const unbindCurrent = vi.fn(async () => ({ state: 'stopped' as const }))
  const setAccessMode = vi.fn(async (input: { mode: 'read-only' | 'danger-full-access' }) => ({ accessMode: input.mode }))
  const dispatcher = createLocusControlDispatcher({
    allowOpenIds: () => [OWNER],
    listSessions: () => [session('session-abcdef123456')],
    bind: { bind: bind as never },
    exit: { unbindCurrent },
    access: { setAccessMode },
    ...overrides,
  })
  return { dispatcher, bind, unbindCurrent, setAccessMode }
}
const send = (d: ReturnType<typeof dispatcherWith>['dispatcher'], command: Record<string, unknown>, senderId = OWNER) =>
  d.dispatch({ command: command as never, endpoint: ENDPOINT, senderId })

describe('unified locus command dispatcher', () => {
  it('passes the prefix to enumeration and never enumerates for a too-short prefix', async () => {
    const listSessions = vi.fn((_prefix: string) => [session('session-abcdef123456')])
    const { dispatcher } = dispatcherWith({ listSessions })
    await expect(send(dispatcher, { kind: 'bind', prefix: 'abc' })).resolves.toMatchObject({ ok: false, reason: 'prefix-too-short' })
    expect(listSessions).not.toHaveBeenCalled()
    await send(dispatcher, { kind: 'bind', prefix: 'abcdef' })
    expect(listSessions).toHaveBeenCalledWith('abcdef')
  })

  it('spec Scenario "全文评论绑定已知会话": a document /bind names the doc title and restates who may ask', async () => {
    const { dispatcher } = dispatcherWith({
      bind: { bind: (async ({ parentSessionId }: { parentSessionId: string }) => {
        const result = bindResult(parentSessionId)
        return { ...result, locus: { ...result.locus, endpoint: { chatId: 'doc:docx:Dx1' } } }
      }) as never },
      chatName: () => '技术方案',
    })
    const result = await dispatcher.dispatch({ command: { kind: 'bind', prefix: 'abcdef' }, endpoint: { chatId: 'doc:docx:Dx1', key: 'doc:docx:Dx1' } as never, senderId: OWNER })
    const text = 'text' in result ? result.text ?? '' : ''
    expect(text).toContain('文档「技术方案」')
    expect(text).not.toContain('群「')
    expect(text).toContain('本文档的评论者均可向我提问；只有 allowlist 成员能控制')
  })

  it('prefilters ids with exactly the resolution comparison', () => {
    expect(locusSessionIdMatchesPrefix('session-ABCDEF123456', ' abcdef ')).toBe(true)
    expect(locusSessionIdMatchesPrefix('task-abcdef123456', 'abcdef1')).toBe(true)
    expect(locusSessionIdMatchesPrefix('session-abcdef123456', 'abcdeg')).toBe(false)
    expect(locusSessionIdMatchesPrefix('session-abcdef123456', 'abcde')).toBe(false)
  })

  it('reads the real chat name and returns a title plus short-id bind receipt', async () => {
    const { dispatcher, bind } = dispatcherWith({ chatName: async () => '真实项目群' })
    await expect(send(dispatcher, { kind: 'bind', prefix: 'abcdef' })).resolves.toEqual({
      ok: true,
      // The bind receipt now ends with the sharing-scope disclosure (D3).
      text: `群「真实项目群」已绑定主会话 「研发会话」（abcdef）；已创建新的只读子会话。\n${LOCUS_BIND_SHARING_DISCLOSURE}`,
    })
    expect(bind).toHaveBeenCalledWith({
      endpoint: { chatId: ENDPOINT.chatId }, parentSessionId: 'session-abcdef123456', chatName: '真实项目群', actorId: OWNER,
    })
  })

  it('leaves an unreadable real chat name absent instead of inventing one', async () => {
    const { dispatcher, bind } = dispatcherWith({
      listSessions: () => [session('session-abcdef123456', { title: undefined })],
      chatName: async () => { throw new Error('not readable') },
    })
    await expect(send(dispatcher, { kind: 'bind', prefix: 'abcdef' })).resolves.toEqual({
      ok: true, text: `当前入口已绑定主会话 abcdef；已创建新的只读子会话。\n${LOCUS_BIND_SHARING_DISCLOSURE}`,
    })
    expect(bind).toHaveBeenCalledWith({ endpoint: { chatId: ENDPOINT.chatId }, parentSessionId: 'session-abcdef123456', actorId: OWNER })
  })

  it('keeps absent and ambiguous prefixes on the exact same receipt', async () => {
    const bind = vi.fn()
    const { dispatcher } = dispatcherWith({
      listSessions: () => [session('session-abcdef111111'), session('session-abcdef222222')],
      bind: { bind },
    })
    const noMatch = await send(dispatcher, { kind: 'bind', prefix: 'zzzzzz' })
    const ambiguous = await send(dispatcher, { kind: 'bind', prefix: 'abcdef' })
    expect(noMatch).toEqual({ ok: false, reason: 'prefix-unresolved', text: LOCUS_BIND_UNRESOLVED_TEXT })
    expect(ambiguous).toEqual(noMatch)
    expect(bind).not.toHaveBeenCalled()
  })

  it('rechecks allowlist and never invokes a mutation for an unauthorized direct call', async () => {
    const { dispatcher, bind, unbindCurrent, setAccessMode } = dispatcherWith()
    for (const command of [{ kind: 'bind', prefix: 'abcdef' }, { kind: 'unbind' }, { kind: 'access', mode: 'danger-full-access' }]) {
      await expect(send(dispatcher, command, 'ou-stranger')).resolves.toEqual({ ok: false, reason: 'not-allowed', silent: true })
    }
    expect(bind).not.toHaveBeenCalled()
    expect(unbindCurrent).not.toHaveBeenCalled()
    expect(setAccessMode).not.toHaveBeenCalled()
  })

  it('unbinds the exact endpoint and says a same-W /bind re-enables it', async () => {
    const { dispatcher, unbindCurrent } = dispatcherWith()
    const result = await send(dispatcher, { kind: 'unbind' })
    expect(result).toMatchObject({ ok: true })
    expect(result.text).toContain('/bind')
    expect(result.text).not.toContain('显式重建')
    expect(unbindCurrent).toHaveBeenCalledWith({ endpoint: { chatId: ENDPOINT.chatId }, actorId: OWNER })
  })

  it('maps busy control mutations to a deterministic retry receipt', async () => {
    const { dispatcher } = dispatcherWith({
      exit: { unbindCurrent: async () => { throw Object.assign(new Error('busy'), { code: 'LOCUS_BUSY' }) } },
    })
    await expect(send(dispatcher, { kind: 'unbind' }))
      .resolves.toEqual({ ok: false, reason: 'busy', text: '当前入口仍有执行中或排队消息，请稍后重试。' })
  })

  describe('/bind refusals and re-enable', () => {
    it('跨 W 的 bind 回执指向管理面改绑，不再要求先解除', async () => {
      const { dispatcher } = dispatcherWith({
        bind: { bind: async () => { throw Object.assign(new Error('x'), { code: 'EXPLICIT_PARENT_CONFLICT' }) } },
      })
      const result = await send(dispatcher, { kind: 'bind', prefix: 'abcdef' })
      expect(result).toMatchObject({ ok: false, reason: 'explicit-source-locked' })
      expect(result.text).toBe('该群已由其它会话跟进，不能在这里改绑；原会话归档后可在管理面「改绑到其他会话」。')
    })

    it('停止的入口重新绑定同一 W: receipt says re-enabled, read-only', async () => {
      const { dispatcher } = dispatcherWith({
        bind: { bind: async ({ parentSessionId }: { parentSessionId: string }) => ({ ...bindResult(parentSessionId), created: false, reused: false, reenabled: true }) },
      })
      const result = await send(dispatcher, { kind: 'bind', prefix: 'abcdef' })
      expect(result.text).toContain('已重新启用')
      expect(result.text).toContain('只读')
    })

    it('reused bind reports the access mode as read-only wording, not a permission', async () => {
      const { dispatcher } = dispatcherWith({
        bind: { bind: async ({ parentSessionId }: { parentSessionId: string }) => ({ ...bindResult(parentSessionId), created: false, reused: true }) },
      })
      const result = await send(dispatcher, { kind: 'bind', prefix: 'abcdef' })
      expect(result.text).toContain('本次未重复创建')
      expect(result.text).not.toContain('共享权限')
    })
  })

  describe('/access', () => {
    it('full dispatches danger-full-access and replies "下次唤醒时应用并核验" without claiming it is in force', async () => {
      const { dispatcher, setAccessMode } = dispatcherWith({ writeEnabled: () => true })
      const result = await send(dispatcher, { kind: 'access', mode: 'danger-full-access' })
      expect(setAccessMode).toHaveBeenCalledWith({ endpoint: { chatId: ENDPOINT.chatId }, actorId: OWNER, mode: 'danger-full-access' })
      expect(result).toMatchObject({ ok: true })
      expect(result.text).toContain('下次唤醒时应用并核验')
      expect(result.text).toContain('核验失败将拒绝服务')
    })

    it('uses the mutation receipt verbatim when it supplies one (full-access disclosure)', async () => {
      const { dispatcher } = dispatcherWith({
        writeEnabled: () => true,
        access: { setAccessMode: async () => ({ receipt: '已更新。完全访问披露。' }) },
      })
      const result = await send(dispatcher, { kind: 'access', mode: 'danger-full-access' })
      expect(result).toEqual({ ok: true, text: '已更新。完全访问披露。' })
    })

    it('read dispatches read-only with the same receipt', async () => {
      const { dispatcher, setAccessMode } = dispatcherWith()
      const result = await send(dispatcher, { kind: 'access', mode: 'read-only' })
      expect(setAccessMode).toHaveBeenCalledWith(expect.objectContaining({ mode: 'read-only' }))
      expect(result.text).toContain('下次唤醒时应用并核验')
    })

    it('write switch off: full is refused before the mutation, read is still accepted', async () => {
      const { dispatcher, setAccessMode } = dispatcherWith({ writeEnabled: () => false })
      const refused = await send(dispatcher, { kind: 'access', mode: 'danger-full-access' })
      expect(refused).toMatchObject({ ok: false, reason: 'access-full-disabled' })
      expect(setAccessMode).not.toHaveBeenCalled()
      await expect(send(dispatcher, { kind: 'access', mode: 'read-only' })).resolves.toMatchObject({ ok: true })
      expect(setAccessMode).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['LOCUS_BUSY', 'busy'],
      ['INVALID_REQUEST', 'access-invalid-state'],
      ['LOCUS_NOT_FOUND', 'not-found'],
      ['LOCUS_CONFLICT', 'conflict'],
    ])('maps refusal %s to a distinct receipt', async (code, reason) => {
      const { dispatcher } = dispatcherWith({
        access: { setAccessMode: async () => { throw Object.assign(new Error('x'), { code }) } },
      })
      await expect(send(dispatcher, { kind: 'access', mode: 'read-only' })).resolves.toMatchObject({ ok: false, reason })
    })

    it('without the access seam: unavailable, never a silent success', async () => {
      const { dispatcher } = dispatcherWith({ access: undefined })
      await expect(send(dispatcher, { kind: 'access', mode: 'read-only' })).resolves.toMatchObject({ ok: false, reason: 'access-unavailable' })
    })

    it('missing or invalid mode is an invalid command and mutates nothing', async () => {
      const { dispatcher, setAccessMode } = dispatcherWith()
      await expect(send(dispatcher, { kind: 'access-missing-mode' })).resolves.toMatchObject({ ok: false, reason: 'invalid-command' })
      await expect(send(dispatcher, { kind: 'access-invalid', value: 'x' })).resolves.toMatchObject({ ok: false, reason: 'invalid-command' })
      expect(setAccessMode).not.toHaveBeenCalled()
    })

    it('旧命令不再改变状态: /scope /tools -s -t answer "改用 /access" and mutate nothing', async () => {
      const { dispatcher, setAccessMode, bind, unbindCurrent } = dispatcherWith()
      const result = await send(dispatcher, { kind: 'deprecated-tier', original: '-s write' })
      expect(result).toMatchObject({ ok: false, reason: 'deprecated-command' })
      expect(result.text).toContain('/access read|full')
      expect(setAccessMode).not.toHaveBeenCalled()
      expect(bind).not.toHaveBeenCalled()
      expect(unbindCurrent).not.toHaveBeenCalled()
    })

    it('非 allowlist 变更被拒', async () => {
      const { dispatcher, setAccessMode } = dispatcherWith()
      await expect(send(dispatcher, { kind: 'access', mode: 'danger-full-access' }, 'ou-stranger'))
        .resolves.toEqual({ ok: false, reason: 'not-allowed', silent: true })
      expect(setAccessMode).not.toHaveBeenCalled()
    })
  })
})

describe('help command receipt', () => {
  function dispatcher() {
    const bind = vi.fn(); const unbindCurrent = vi.fn(); const setAccessMode = vi.fn(); const listSessions = vi.fn(() => [])
    const port = createLocusControlDispatcher({
      allowOpenIds: () => [OWNER], listSessions, bind: { bind }, exit: { unbindCurrent }, access: { setAccessMode },
    } as never)
    return { port, bind, unbindCurrent, setAccessMode, listSessions }
  }

  it('lists every command in the table with its usage, mentions the allowlist, and nothing deprecated', async () => {
    const t = dispatcher()
    const result = await t.port.dispatch({ command: { kind: 'help' }, endpoint: ENDPOINT, senderId: OWNER } as never)
    expect(result.ok).toBe(true)
    const text = (result as { text: string }).text
    for (const entry of LOCUS_COMMAND_TABLE) {
      expect(text, entry.usage).toContain(entry.usage)
      expect(text, entry.description).toContain(entry.description)
    }
    expect(text).toContain('/bind <工作会话 id>')
    expect(text).toContain('allowlist')
    expect(text).not.toContain('/scope')
    expect(text).not.toContain('/tools')
    expect(text).not.toContain('干活')
  })

  it('is pure information: no bind, unbind, access change or session listing', async () => {
    const t = dispatcher()
    await t.port.dispatch({ command: { kind: 'help' }, endpoint: ENDPOINT, senderId: OWNER } as never)
    expect(t.bind).not.toHaveBeenCalled()
    expect(t.unbindCurrent).not.toHaveBeenCalled()
    expect(t.setAccessMode).not.toHaveBeenCalled()
    expect(t.listSessions).not.toHaveBeenCalled()
  })
})

describe('控制命令失败按稳定原因回执并留存诊断', () => {
  const bindWith = (bind: () => never | Promise<never>, log?: (message: string) => void) =>
    dispatcherWith({ bind: { bind: bind as never }, ...(log === undefined ? {} : { log }) })
  const bindCmd = { kind: 'bind', prefix: 'abcdef' }

  it('spec Scenario "不可用的主会话不再显示重试"', async () => {
    const { dispatcher } = bindWith(() => { throw new LocusControllerError('LOCUS_MAIN_UNAVAILABLE', 'M is gone') })
    const result = await send(dispatcher, bindCmd)
    expect(result).toMatchObject({ ok: false, reason: 'locus-main-unavailable' })
    expect(result.text).toContain('locus 主会话不可用')
    expect(result.text).not.toContain('请稍后重试')
    // The receipt never echoes the exception message.
    expect(result.text).not.toContain('M is gone')
  })

  it.each([
    ['PARENT_NOT_FOUND', 'parent-not-found', '工作会话'],
    ['PROVISIONING_FAILED', 'provisioning-failed', '入口建立失败'],
    ['DEFAULT_WORKSPACE_UNAVAILABLE', 'default-workspace-unavailable', '默认工作区'],
    ['CAPABILITY_UNAVAILABLE', 'capability-unavailable', '能力'],
  ] as const)('maps %s to its own actionable receipt, not the generic retry text', async (code, reason, phrase) => {
    const { dispatcher } = bindWith(() => { throw new LocusControllerError(code, 'internal detail') })
    const result = await send(dispatcher, bindCmd)
    expect(result).toMatchObject({ ok: false, reason })
    expect(result.text).toContain(phrase)
    expect(result.text).not.toContain('请稍后重试')
    expect(result.text).not.toContain('internal detail')
  })

  it('spec Scenario "未知异常只记原因码"', async () => {
    const log = vi.fn()
    // REPOSITORY_INCONSISTENT is a defined controller code that has no dedicated receipt.
    const { dispatcher } = bindWith(
      () => { throw new LocusControllerError('REPOSITORY_INCONSISTENT', 'row 42 of private-chat is inconsistent') },
      log,
    )
    const result = await send(dispatcher, bindCmd)
    expect(result).toEqual({ ok: false, reason: 'control-failed', text: '控制命令执行失败，请稍后重试。' })
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]![0])
    expect(line).toContain('REPOSITORY_INCONSISTENT')
    expect(line).not.toContain('private-chat')
    expect(line).not.toContain('inconsistent')
  })

  it('records a defined PetError code too', async () => {
    const log = vi.fn()
    const { dispatcher } = bindWith(() => { throw new PetError('WORKSPACE_UNHEALTHY', 'workspace path /secret/place') }, log)
    await send(dispatcher, bindCmd)
    expect(String(log.mock.calls[0]![0])).toContain('WORKSPACE_UNHEALTHY')
    expect(String(log.mock.calls[0]![0])).not.toContain('/secret/place')
  })

  it('spec Scenario "未知异常不泄露内容"', async () => {
    const log = vi.fn()
    const fakeCode = 'A1B2C3D4E5F60718293A4B5C6D7E8F90'
    const error = Object.assign(new Error('upstream said ?token=<fixture-token> failed'), {
      code: fakeCode,
      cause: new Error('cause-marker-private'),
    })
    error.stack = 'Error: stack-marker-private\n    at somewhere (/private/path.ts:1:1)'
    const { dispatcher } = bindWith(() => { throw error }, log)
    const result = await send(dispatcher, bindCmd)
    expect(result).toEqual({ ok: false, reason: 'control-failed', text: '控制命令执行失败，请稍后重试。' })
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]![0])
    expect(line).toContain('unrecognized')
    const everything = `${line}\n${JSON.stringify(result)}`
    for (const secret of ['<fixture-token>', fakeCode, 'cause-marker-private', 'stack-marker-private', 'upstream said', '/private/path.ts', 'Error']) {
      expect(everything, secret).not.toContain(secret)
    }
  })

  it('a non-Error throw is also only "unrecognized"', async () => {
    const log = vi.fn()
    const { dispatcher } = bindWith(() => { throw 'plain-string-secret' }, log)
    await send(dispatcher, bindCmd)
    expect(String(log.mock.calls[0]![0])).toContain('unrecognized')
    expect(String(log.mock.calls[0]![0])).not.toContain('plain-string-secret')
  })

  it('mapped refusals are not logged as unrecognized failures', async () => {
    const log = vi.fn()
    const { dispatcher } = bindWith(() => { throw new LocusControllerError('LOCUS_BUSY', 'busy') }, log)
    await send(dispatcher, bindCmd)
    expect(log).not.toHaveBeenCalled()
  })

  it('works without a log sink', async () => {
    const { dispatcher } = bindWith(() => { throw new Error('x') })
    await expect(send(dispatcher, bindCmd)).resolves.toMatchObject({ ok: false, reason: 'control-failed' })
  })
})

describe('绑定回执披露共享范围', () => {
  it('spec Scenario "绑定回执说明共享范围"', async () => {
    const { dispatcher } = dispatcherWith()
    const result = await send(dispatcher, { kind: 'bind', prefix: 'abcdef' })
    expect(result).toMatchObject({ ok: true })
    expect(result.text).toContain('本入口的提问可能得到引用该工作会话对话内容的答复')
    expect(result.text).toContain('/unbind')
    expect(result.text).toContain('撤销')
  })

  it.each([
    ['reused', { created: false, reused: true }],
    ['re-enabled', { created: false, reused: false, reenabled: true }],
  ] as const)('the %s receipt carries the same disclosure', async (_label, extra) => {
    const { dispatcher } = dispatcherWith({
      bind: { bind: async ({ parentSessionId }: { parentSessionId: string }) => ({ ...bindResult(parentSessionId), ...extra }) },
    })
    const result = await send(dispatcher, { kind: 'bind', prefix: 'abcdef' })
    expect(result.text).toContain('本入口的提问可能得到引用该工作会话对话内容的答复')
    expect(result.text).toContain('/unbind')
  })
})
