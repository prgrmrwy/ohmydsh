import { describe, expect, it, vi } from 'vitest'
import {
  createLocusLarkPort,
  type LarkCliRunner,
} from '../src/host/channel/lark.js'

const OWNER = 'ou_58c5c01075637418a8b934e58e5e1400'
const CHAT = 'oc_58c5c01075637418a8b934e58e5e1400'
const MESSAGE = 'om_58c5c01075637418a8b934e58e5e1400'

function envelope(data: unknown): { stdout: string } {
  return { stdout: JSON.stringify({ ok: true, data }) }
}

function portWith(
  implementation: (
    binary: string,
    args: readonly string[],
    options: { timeout: number; maxBuffer: number },
  ) => Promise<{ stdout: string; stderr?: string }>,
) {
  const runner = vi.fn(implementation) as unknown as LarkCliRunner
  return { port: createLocusLarkPort('lark-cli-test', runner), runner }
}

describe('strict LocusLarkPort group provisioning', () => {
  it('creates as the fixed Pet bot with explicit owner and user, then returns strict rollback', async () => {
    const calls: string[][] = []
    const { port } = portWith(async (_binary, args) => {
      calls.push([...args])
      if (args.includes('+chat-create')) return envelope({ chat_id: CHAT })
      if (args[2] === 'api') return envelope({})
      throw new Error('unexpected command')
    })

    const group = await port.createGroup({ name: '答疑 · DSH', ownerId: OWNER })
    expect(group).toMatchObject({ chatId: CHAT, chatName: '答疑 · DSH' })
    expect(group.rollback).toBeTypeOf('function')
    await group.rollback?.()

    expect(calls).toEqual([
      [
        '--profile', 'dsh-pet',
        'im', '+chat-create',
        '--as', 'bot',
        '--name', '答疑 · DSH',
        '--users', OWNER,
        '--owner', OWNER,
        '--json',
      ],
      [
        '--profile', 'dsh-pet',
        'api', 'DELETE', `/open-apis/im/v1/chats/${CHAT}`,
        '--as', 'bot',
        '--json',
      ],
    ])
  })

  it.each([
    ['process failure', async () => Promise.reject(new Error('spawn failed'))],
    ['unreadable output', async () => ({ stdout: 'not-json' })],
    ['negative envelope', async () => ({ stdout: JSON.stringify({ ok: false, data: { chat_id: CHAT } }) })],
    ['missing chat id', async () => envelope({})],
    ['malformed chat id', async () => envelope({ chat_id: 'not-a-chat' })],
  ])('rejects %s instead of publishing a group', async (_label, implementation) => {
    const { port } = portWith(implementation)
    await expect(port.createGroup({ name: '答疑 · DSH', ownerId: OWNER })).rejects.toThrow()
  })

  it('rejects an absent owner before invoking lark-cli', async () => {
    const { port, runner } = portWith(async () => envelope({ chat_id: CHAT }))
    await expect(port.createGroup({ name: '答疑 · DSH', ownerId: '  ' })).rejects.toThrow(/owner/)
    expect(runner).not.toHaveBeenCalled()
  })
})

describe('strict LocusLarkPort control messages', () => {
  it('requires a successful envelope with matching chat id and a message id', async () => {
    const { port, runner } = portWith(async () => envelope({ message_id: MESSAGE, chat_id: CHAT }))

    await expect(port.sendControlMessage({
      endpoint: { chatId: CHAT },
      text: '上下文来源发生变化。',
    })).resolves.toBeUndefined()
    expect(runner).toHaveBeenCalledWith(
      'lark-cli-test',
      [
        '--profile', 'dsh-pet',
        'im', '+messages-send',
        '--as', 'bot',
        '--chat-id', CHAT,
        '--text', '上下文来源发生变化。',
        '--json',
      ],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
    )
  })

  it.each([
    ['process failure', async () => Promise.reject(new Error('spawn failed'))],
    ['unreadable output', async () => ({ stdout: 'not-json' })],
    ['negative envelope', async () => ({ stdout: JSON.stringify({ ok: false, data: { message_id: MESSAGE, chat_id: CHAT } }) })],
    ['missing message id', async () => envelope({ chat_id: CHAT })],
    ['malformed message id', async () => envelope({ message_id: 'not-a-message', chat_id: CHAT })],
    ['missing chat id', async () => envelope({ message_id: MESSAGE })],
    ['wrong chat id', async () => envelope({ message_id: MESSAGE, chat_id: 'oc_other' })],
  ])('rejects %s rather than treating sendToChat-style swallowing as delivery', async (_label, implementation) => {
    const { port } = portWith(implementation)
    await expect(port.sendControlMessage({ endpoint: { chatId: CHAT }, text: 'notice' }))
      .rejects.toThrow()
  })

  it('does not widen a thread control receipt to the parent chat', async () => {
    const { port, runner } = portWith(async () => envelope({ message_id: MESSAGE, chat_id: CHAT }))
    await expect(port.sendControlMessage({
      endpoint: { chatId: CHAT, threadId: 'omt_thread' },
      text: 'notice',
    })).rejects.toThrow(/thread endpoint/)
    expect(runner).not.toHaveBeenCalled()
  })
})

describe('strict LocusLarkPort deletion', () => {
  it('uses the raw bot DELETE endpoint and accepts only an ok envelope', async () => {
    const { port, runner } = portWith(async () => envelope({}))
    await expect(port.deleteGroup?.(CHAT)).resolves.toBeUndefined()
    expect(runner).toHaveBeenCalledWith(
      'lark-cli-test',
      [
        '--profile', 'dsh-pet',
        'api', 'DELETE', `/open-apis/im/v1/chats/${CHAT}`,
        '--as', 'bot',
        '--json',
      ],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
    )
  })

  it('treats Feishu 232009 as idempotent success even when the CLI exits non-zero', async () => {
    const failure = Object.assign(new Error('command failed'), {
      stderr: JSON.stringify({ ok: false, error: { code: 232009, message: 'chat deleted' } }),
    })
    const { port } = portWith(async () => Promise.reject(failure))
    await expect(port.deleteGroup?.(CHAT)).resolves.toBeUndefined()
  })

  it.each([
    ['missing scope', 99991672],
    ['another Feishu error', 232010],
  ])('rejects %s (%s) so the controller can report a residual group', async (_label, code) => {
    const failure = Object.assign(new Error('command failed'), {
      stderr: JSON.stringify({
        ok: false,
        error: {
          code,
          subtype: code === 99991672 ? 'app_scope_not_applied' : 'api_error',
          missing_scopes: code === 99991672 ? ['im:chat:delete'] : [],
        },
      }),
    })
    const { port } = portWith(async () => Promise.reject(failure))
    await expect(port.deleteGroup?.(CHAT)).rejects.toThrow(/process failed/)
  })

  it('rejects malformed or false success envelopes', async () => {
    const unreadable = portWith(async () => ({ stdout: 'not-json' })).port
    const refused = portWith(async () => ({ stdout: JSON.stringify({ ok: false, data: {} }) })).port
    await expect(unreadable.deleteGroup?.(CHAT)).rejects.toThrow()
    await expect(refused.deleteGroup?.(CHAT)).rejects.toThrow()
  })
})
