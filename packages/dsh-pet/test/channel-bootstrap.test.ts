/**
 * Bot binding.
 *
 * The property that matters most is what Pet NEVER does: a secret must reach
 * lark-cli through stdin and leave no trace in argv, in state, or in a
 * diagnostic. The rest is flow control around a blocking CLI.
 */

import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  BotBootstrap,
  findAppId,
  findVerificationUrl,
  PET_CLI_PROFILE,
  type BootstrapState,
} from '../src/host/channel/bootstrap.js'

const SECRET = 'super-secret-value-do-not-leak'

/** A child process stand-in. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter() as EventEmitter & { setEncoding(e: string): void }
  readonly stderr = new EventEmitter() as EventEmitter & { setEncoding(e: string): void }
  readonly stdin = { end: vi.fn() }
  exitCode: number | null = null
  readonly signals: string[] = []

  constructor() {
    super()
    this.stdout.setEncoding = () => undefined
    this.stderr.setEncoding = () => undefined
  }

  kill(signal: string): boolean {
    this.signals.push(signal)
    return true
  }

  out(text: string): void {
    this.stdout.emit('data', text)
  }

  end(code: number): void {
    this.exitCode = code
    this.emit('exit', code)
  }
}

interface Harness {
  readonly bootstrap: BotBootstrap
  readonly children: FakeChild[]
  readonly commands: { command: string; args: readonly string[] }[]
  readonly states: BootstrapState[]
}

function harness(): Harness {
  const children: FakeChild[] = []
  const commands: { command: string; args: readonly string[] }[] = []
  const states: BootstrapState[] = []
  const bootstrap = new BotBootstrap({
    onState: state => states.push(state),
    spawnProcess: (command, args) => {
      commands.push({ command, args })
      const child = new FakeChild()
      children.push(child)
      return child as unknown as ChildProcess
    },
  })
  return { bootstrap, children, commands, states }
}

describe('parsing CLI output', () => {
  it('finds the verification URL', () => {
    expect(
      findVerificationUrl('请在浏览器打开 https://accounts.feishu.cn/oauth?code=abc 完成授权'),
    ).toBe('https://accounts.feishu.cn/oauth?code=abc')
  })

  it('trims trailing punctuation from the URL', () => {
    expect(findVerificationUrl('open (https://example.com/x).')).toBe('https://example.com/x')
  })

  it('finds the app id', () => {
    expect(findAppId('App ID: cli_a91b50b53178dbc4\n')).toBe('cli_a91b50b53178dbc4')
  })

  it('returns undefined when neither is present', () => {
    expect(findVerificationUrl('waiting...')).toBeUndefined()
    expect(findAppId('waiting...')).toBeUndefined()
  })
})

describe('creating a new bot', () => {
  it('runs config init --new in the Pet profile', async () => {
    const h = harness()

    const settled = h.bootstrap.createNew()
    h.children[0]?.end(0)
    await settled

    // A dedicated profile keeps the user's existing app, its tokens and its
    // identity policy untouched.
    expect(h.commands[0]?.args).toEqual([
      'config',
      'init',
      '--new',
      '--name',
      PET_CLI_PROFILE,
    ])
  })

  it('surfaces the verification URL while still waiting', async () => {
    const h = harness()
    const settled = h.bootstrap.createNew()

    h.children[0]?.out('Open https://accounts.feishu.cn/oauth?code=abc to authorize\n')

    // The process is still running: the user has not finished yet.
    expect(h.bootstrap.current).toEqual({
      phase: 'awaiting-authorization',
      verificationUrl: 'https://accounts.feishu.cn/oauth?code=abc',
    })

    h.children[0]?.end(0)
    await settled
  })

  it('reports bound with the app id once the CLI succeeds', async () => {
    const h = harness()
    const settled = h.bootstrap.createNew()
    h.children[0]?.out('App ID: cli_newbot0001\n')
    h.children[0]?.end(0)

    const state = await settled

    expect(state).toEqual({ phase: 'bound', appId: 'cli_newbot0001' })
  })

  it('fails rather than claiming success without an app id', async () => {
    const h = harness()
    const settled = h.bootstrap.createNew()
    h.children[0]?.end(0)

    const state = await settled

    // Reporting "bound" here would leave a configuration Pet cannot describe.
    expect(state.phase).toBe('failed')
    expect(state.diagnostic).toMatch(/no App ID/)
  })

  it('fails with a diagnostic when the CLI exits non-zero', async () => {
    const h = harness()
    const settled = h.bootstrap.createNew()
    h.children[0]?.out('authorization denied by user\n')
    h.children[0]?.end(1)

    const state = await settled

    expect(state.phase).toBe('failed')
    expect(state.diagnostic).toMatch(/authorization denied/)
  })

  it('reports a spawn failure instead of throwing', async () => {
    const bootstrap = new BotBootstrap({
      spawnProcess: () => {
        throw new Error('lark-cli not found')
      },
    })

    const state = await bootstrap.createNew()

    expect(state.phase).toBe('failed')
    expect(state.diagnostic).toMatch(/lark-cli not found/)
  })

  it('cancels an in-flight flow with SIGTERM', async () => {
    const h = harness()
    void h.bootstrap.createNew()

    h.bootstrap.cancel()

    expect(h.children[0]?.signals).toEqual(['SIGTERM'])
    expect(h.bootstrap.current.phase).toBe('idle')
  })
})

describe('connecting an existing bot', () => {
  it('never places the secret in argv', async () => {
    const h = harness()
    const settled = h.bootstrap.connectExisting('cli_existing01', SECRET)
    h.children[0]?.out('App ID: cli_existing01\n')
    h.children[0]?.end(0)
    await settled

    // Process listings are readable by other local processes, so a secret in
    // argv is effectively disclosed.
    const args = h.commands[0]?.args ?? []
    expect(args.join(' ')).not.toContain(SECRET)
    expect(args).toContain('--app-secret-stdin')
    expect(args).toEqual([
      'config',
      'init',
      '--app-id',
      'cli_existing01',
      '--app-secret-stdin',
      '--name',
      PET_CLI_PROFILE,
    ])
  })

  it('feeds the secret through stdin and closes it', async () => {
    const h = harness()
    const settled = h.bootstrap.connectExisting('cli_existing01', SECRET)

    expect(h.children[0]?.stdin.end).toHaveBeenCalledWith(SECRET)

    h.children[0]?.out('App ID: cli_existing01\n')
    h.children[0]?.end(0)
    await settled
  })

  it('keeps the secret out of the resulting state', async () => {
    const h = harness()
    const settled = h.bootstrap.connectExisting('cli_existing01', SECRET)
    h.children[0]?.out('App ID: cli_existing01\n')
    h.children[0]?.end(0)

    const state = await settled

    expect(JSON.stringify(state)).not.toContain(SECRET)
    expect(JSON.stringify(h.states)).not.toContain(SECRET)
  })

  it('keeps the secret out of a failure diagnostic', async () => {
    const h = harness()
    const settled = h.bootstrap.connectExisting('cli_existing01', SECRET)
    // A CLI may echo part of its input when rejecting it.
    h.children[0]?.out(`invalid secret: ${SECRET}\n`)
    h.children[0]?.out('app secret is invalid\n')
    h.children[0]?.end(1)

    const state = await settled

    expect(state.phase).toBe('failed')
    expect(state.diagnostic).not.toContain(SECRET)
  })

  it('redacts the secret when it is the final failure line', async () => {
    const h = harness()
    const settled = h.bootstrap.connectExisting('cli_existing01', SECRET)
    h.children[0]?.out(`invalid secret: ${SECRET}\n`)
    h.children[0]?.end(1)

    const state = await settled

    expect(JSON.stringify(state)).not.toContain(SECRET)
    expect(JSON.stringify(h.states)).not.toContain(SECRET)
  })

  it('does not surface even a fragment of a submitted secret', async () => {
    const h = harness()
    const settled = h.bootstrap.connectExisting('cli_existing01', SECRET)
    h.children[0]?.out(`invalid prefix: ${SECRET.slice(0, 8)}\n`)
    h.children[0]?.end(1)

    expect(JSON.stringify(await settled)).not.toContain(SECRET.slice(0, 8))
  })

  it('cancels a replaced attempt and ignores its late success', async () => {
    const h = harness()
    const first = h.bootstrap.connectExisting('cli_first', 'first-secret')
    const second = h.bootstrap.connectExisting('cli_second', 'second-secret')

    expect(h.children[0]?.signals).toEqual(['SIGTERM'])
    h.children[0]?.out('App ID: cli_first\n')
    h.children[0]?.end(0)
    h.children[1]?.out('App ID: cli_second\n')
    h.children[1]?.end(0)

    expect(await first).toEqual({ phase: 'idle' })
    expect(await second).toEqual({ phase: 'bound', appId: 'cli_second' })
    expect(h.bootstrap.current).toEqual({ phase: 'bound', appId: 'cli_second' })
  })

  it('keeps a cancelled attempt idle after its late exit', async () => {
    const h = harness()
    const settled = h.bootstrap.connectExisting('cli_existing01', SECRET)
    h.bootstrap.cancel()
    h.children[0]?.out('App ID: cli_existing01\n')
    h.children[0]?.end(0)

    expect(await settled).toEqual({ phase: 'idle' })
    expect(h.bootstrap.current).toEqual({ phase: 'idle' })
  })

  it('refuses an empty app id or secret without spawning anything', async () => {
    const h = harness()

    expect((await h.bootstrap.connectExisting('', SECRET)).phase).toBe('failed')
    expect((await h.bootstrap.connectExisting('cli_x', '  ')).phase).toBe('failed')
    expect(h.commands).toHaveLength(0)
  })
})
