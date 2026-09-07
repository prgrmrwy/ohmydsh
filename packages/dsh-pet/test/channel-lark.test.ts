import { describe, expect, it, vi } from 'vitest'
import {
  createLarkCliClient,
  parseBotIdentity,
  permissionDiagnostic,
  type LarkCliRunner,
} from '../src/host/channel/lark.js'

const APP = 'cli_aa14740a43f81cd4'
const BOT = 'ou_58c5c01075637418a8b934e58e5e1400'

const READY = {
  appId: APP,
  verified: true,
  identities: {
    bot: {
      status: 'ready',
      available: true,
      verified: true,
      openId: BOT,
      appName: 'Pet Bot',
    },
  },
}

describe('supported CLI version', () => {
  it('accepts the installed identity-contract version and rejects older builds', async () => {
    const supported = createLarkCliClient(
      'lark-cli',
      vi.fn(async () => ({ stdout: 'lark-cli version 1.0.93\n' })) as unknown as LarkCliRunner,
    )
    const outdated = createLarkCliClient(
      'lark-cli',
      vi.fn(async () => ({ stdout: 'lark-cli version 1.0.92\n' })) as unknown as LarkCliRunner,
    )

    await expect(supported.cliVersion?.()).resolves.toEqual({ supported: true, version: '1.0.93' })
    await expect(outdated.cliVersion?.()).resolves.toEqual({ supported: false, version: '1.0.92' })
  })
})

describe('verified bot identity parsing', () => {
  it('reads the real top-level auth status shape', () => {
    expect(parseBotIdentity(READY, APP)).toEqual({
      kind: 'ready',
      identity: { appId: APP, openId: BOT, name: 'Pet Bot' },
    })
  })

  it.each([
    ['another app', { ...READY, appId: 'cli_other' }],
    ['not ready', { ...READY, identities: { bot: { ...READY.identities.bot, status: 'missing' } } }],
    ['not verified', { ...READY, verified: false }],
    ['no open id', { ...READY, identities: { bot: { ...READY.identities.bot, openId: undefined } } }],
    ['non-json shape', 'not-json'],
  ])('fails closed for %s', (_label, value) => {
    expect(parseBotIdentity(value, APP).kind).toBe('unavailable')
  })
})

describe('safe permission diagnostics', () => {
  it('keeps scopes and the official console link', () => {
    expect(
      permissionDiagnostic({
        error: {
          subtype: 'app_scope_not_applied',
          code: 99991672,
          missing_scopes: ['im:chat.members:read'],
          console_url: `https://open.feishu.cn/page/scope-apply?clientID=${APP}`,
          message: 'raw detail that must not be retained',
        },
      }),
    ).toEqual({
      code: 99991672,
      missingScopes: ['im:chat.members:read'],
      consoleUrl: `https://open.feishu.cn/page/scope-apply?clientID=${APP}`,
    })
  })

  it('drops a non-official URL', () => {
    expect(
      permissionDiagnostic({
        error: {
          subtype: 'app_scope_not_applied',
          missing_scopes: ['im:chat.members:read'],
          console_url: 'https://evil.example/steal',
        },
      }),
    ).toEqual({ missingScopes: ['im:chat.members:read'] })
  })
})

describe('real shortcut error output', () => {
  it('extracts permission diagnostics after stderr progress lines', async () => {
    const failure = Object.assign(new Error('command failed'), {
      stdout: '',
      stderr: `[page 1] fetching...\n${JSON.stringify({
        ok: false,
        identity: 'bot',
        error: {
          type: 'authorization',
          subtype: 'app_scope_not_applied',
          code: 99991672,
          missing_scopes: ['im:chat.members:read'],
          console_url: `https://open.feishu.cn/page/scope-apply?clientID=${APP}`,
          message: 'raw server detail',
        },
      }, null, 2)}\n`,
    })
    const runner = vi.fn(async () => Promise.reject(failure)) as unknown as LarkCliRunner
    const client = createLarkCliClient('lark-cli', runner)

    await expect(client.listChatBots('oc_group')).resolves.toEqual({
      kind: 'permission-denied',
      diagnostic: {
        code: 99991672,
        missingScopes: ['im:chat.members:read'],
        consoleUrl: `https://open.feishu.cn/page/scope-apply?clientID=${APP}`,
      },
    })
  })
})

describe('Pet profile isolation', () => {
  it('prefixes every Host-owned operation with the named profile', async () => {
    const calls: readonly string[][] = []
    const mutableCalls = calls as string[][]
    const runner = vi.fn(async (_binary: string, args: readonly string[]) => {
      mutableCalls.push([...args])
      if (args.includes('status')) return { stdout: JSON.stringify(READY) }
      if (args.includes('+chat-create')) {
        return { stdout: JSON.stringify({ ok: true, data: { chat_id: 'oc_created' } }) }
      }
      if (args.includes('+chat-members-list')) {
        return { stdout: JSON.stringify({ ok: true, data: { bots: [], users: [] } }) }
      }
      if (args.includes('create') && args.includes('reactions')) {
        return { stdout: JSON.stringify({ ok: true, data: { reaction_id: 'r1' } }) }
      }
      return { stdout: JSON.stringify({ ok: true, data: {} }) }
    }) as unknown as LarkCliRunner
    const client = createLarkCliClient('lark-cli', runner)

    await client.addReaction('om_1', 'OnIt')
    await client.removeReaction('om_1', 'r1')
    await client.listMessages('oc_1', 5)
    await client.botReady()
    await client.botIdentity?.(APP)
    await client.chatName('oc_1')
    await client.listChatBots('oc_1')
    await client.reply('om_1', 'hi')
    await client.createChat?.('qa', [BOT], BOT)
    await client.memberCount?.('oc_1')
    await client.sendToChat?.('oc_1', 'notice')

    expect(mutableCalls).toHaveLength(11)
    for (const args of mutableCalls) {
      expect(args.slice(0, 2)).toEqual(['--profile', 'dsh-pet'])
    }
  })
})
