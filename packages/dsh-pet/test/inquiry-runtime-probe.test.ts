/**
 * Opt-in observations of the reviewed runtime, NOT G3/G4/G5 acceptance tests.
 *
 * Run with DSH_PET_TEST_RUNTIME=<absolute reviewed launcher-build directory>.
 * No Agent/Session factory, model, provider, persistence backend, production
 * home, credentials, network, or actual effectful tool is instantiated. Inbox
 * receives only an in-memory append sink; tool bodies only increment counters.
 * Passing CURRENT GAP cases document unsafe current behavior, not approval to
 * publish inquiries. A runtime change should make those observations fail.
 */
import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'

const REVIEWED_BUILD = 'eb586fe8ead9f58d0e54a8a2f527c2947acf1c1d685a9e78330716cb81b653d5-58844649-a3be-4ae2-b6c1-aa63ebcacbca'
const runtimePath = process.env.DSH_PET_TEST_RUNTIME

type Runtime = {
  cordis: typeof import('@deepseek-ai/cordis')
  scope: typeof import('@deepseek-ai/dsh-scope')
  tools: typeof import('@deepseek-ai/dsh-tools')
  prompt: typeof import('@deepseek-ai/dsh-system-prompt')
  agent: typeof import('@deepseek-ai/dsh-agent')
}

/** Resolve every direct import from this dependency root, never package devDeps. */
async function loadReviewedRuntime(input: string): Promise<Runtime> {
  if (!isAbsolute(input)) throw new Error('DSH_PET_TEST_RUNTIME must be absolute')
  const root = realpathSync(input)
  if (!root.endsWith(`${sep}.launcher-builds${sep}${REVIEWED_BUILD}`)) {
    throw new Error('DSH_PET_TEST_RUNTIME is not the reviewed immutable launcher build')
  }
  const require = createRequire(join(root, 'package.json'))
  const resolvePackage = (shortName: string, version = '0.1.2-rc.1'): string => {
    const name = `@deepseek-ai/${shortName}`
    const manifestPath = realpathSync(require.resolve(`${name}/package.json`))
    const local = relative(root, manifestPath)
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) {
      throw new Error(`${name} resolved outside the selected runtime`)
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name !== name || manifest.version !== version) {
      throw new Error(`Unexpected reviewed package identity/version: ${name}`)
    }
    // The CLI intentionally has only a bin, not an importable package entry.
    if (shortName === 'dsh') return pathToFileURL(manifestPath).href
    const entry = realpathSync(require.resolve(name))
    const entryLocal = relative(root, entry)
    if (entryLocal.startsWith(`..${sep}`) || isAbsolute(entryLocal)) {
      throw new Error(`${name} entry resolved outside the selected runtime`)
    }
    return pathToFileURL(entry).href
  }
  resolvePackage('dsh')
  resolvePackage('dsh-subagent', '0.1.2-rc.1-locus-settlement-notice.1')
  const subagent = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-subagent/package.json'), 'utf8'))
  expect(subagent.dsh_compat).toMatchObject({
    upstreamBase: 'a66e4702047846cdaa10c66c9d3df3951f5ea70d',
    patchSha256: '97ef5189f726799c13bdd7622aa37292a7451fe13981fac77de4d82161e14b28',
  })
  // Import only inert class/service modules; do not import the DSH CLI entry.
  const [cordis, scope, tools, prompt, agent] = await Promise.all([
    import(/* @vite-ignore */ resolvePackage('cordis', '4.0.2')),
    import(/* @vite-ignore */ resolvePackage('dsh-scope')),
    import(/* @vite-ignore */ resolvePackage('dsh-tools')),
    import(/* @vite-ignore */ resolvePackage('dsh-system-prompt')),
    import(/* @vite-ignore */ resolvePackage('dsh-agent')),
  ])
  return { cordis, scope, tools, prompt, agent } as Runtime
}

const message = (id: string): UserMessage => ({
  id, role: 'user', content: [{ type: 'text', text: id }], source: { kind: 'user' },
} as UserMessage)

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

/** Await the actual Cordis injection callback, not the returned fiber. */
async function withTools(scope: Context, install: (ctx: Context) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    scope.inject(['tools'], ctx => {
      try { install(ctx); resolve() } catch (error) { reject(error) }
    })
  })
}

describe.skipIf(runtimePath === undefined)('opt-in fixed-runtime inquiry seam observations (NOT gate acceptance)', () => {
  let runtime: Runtime
  beforeAll(async () => { runtime = await loadReviewedRuntime(runtimePath!) })

  function inboxFixture() {
    const events: { type: string; data: unknown; seq: number }[] = []
    const claims: { id: string; turn: number }[] = []
    // This is a data sink, NOT a lookalike Inbox or a real registered Session.
    const sink = {
      ownEvents: () => events,
      append(type: string, data: unknown) {
        const event = { type, data, seq: events.length }
        events.push(event)
        return event
      },
    }
    const inbox = new runtime.agent.Inbox(sink as never, {
      inserted() {}, discarded() {},
      claimed(value, turn) { claims.push({ id: String(value.id), turn }) },
    })
    return { inbox, events, claims }
  }

  it('next-turn stays pending at a next-step boundary and is claimed one per turn', () => {
    const { inbox, claims } = inboxFixture()
    inbox.append('next-turn', message('inquiry'))
    inbox.append('next-turn', message('later-delivery'))
    expect(inbox.claim('next-step', 1)).toEqual([])
    expect(inbox.claim('next-turn', 2).map(value => value.id)).toEqual(['inquiry'])
    expect(inbox.nextTurn.map(value => value.id)).toEqual(['later-delivery'])
    expect(claims).toEqual([{ id: 'inquiry', turn: 2 }])
  })

  // BASELINE (pre-seam): this pins the behavior of the OLD reviewed build that
  // motivated the isolated-claim seam. The tracked patch now adds an opt-in
  // `isolateQueuedTurn` claim, so a rebuilt runtime must keep this combined
  // batch only for the DEFAULT path; an inquiry dispatch must use the opt-in
  // and leave next-step pending. Do not read this as "the gap is still open".
  it('BASELINE: the default next-turn claim also sweeps pending GUI next-step input', () => {
    const { inbox, events, claims } = inboxFixture()
    inbox.append('next-step', message('gui-steer'))
    inbox.append('next-turn', message('inquiry'))
    expect(inbox.claim('next-turn', 1).map(value => value.id)).toEqual(['gui-steer', 'inquiry'])
    expect(claims).toEqual([{ id: 'gui-steer', turn: 1 }, { id: 'inquiry', turn: 1 }])
    expect(events.slice(-2).map(event => event.data)).toEqual([
      { target: 'next-step', start: 0, removedCount: 1, inserted: [] },
      { target: 'next-turn', start: 0, removedCount: 1, inserted: [] },
    ])
  })

  async function toolFixture() {
    const ctx = new runtime.cordis.Context()
    await ctx.plugin(runtime.prompt.default)
    await ctx.plugin(runtime.tools.default)
    // Only scope identity is required by ToolRuntime; no Agent is registered.
    const agent = {} as Agent
    const scope = runtime.scope.createScope(ctx, agent)
    const input = (name: string, callId = name): ToolExecutionInput => ({
      agent, name, callId: callId as ToolCallId, arguments: {}, signal: new AbortController().signal,
    })
    const tool = (name: string, body: () => void) => runtime.tools.defineTool({
      name, description: 'Synthetic counter only; no external effects.', parameters: {},
      output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'counter' }] },
      async execute() { body(); return true },
    })
    return { ctx, scope, input, tool, close: async () => { await scope.dispose(); await ctx.fiber.dispose() } }
  }

  it('a scoped monotonic guard denies inherited AND own-layer calls before their bodies', async () => {
    const f = await toolFixture()
    let effects = 0
    let inquiry = true
    let guardChecks = 0
    try {
      f.ctx.tools.register(f.tool('global_effect', () => { effects++ }))
      await withTools(f.scope.ctx, ctx => {
        ctx.tools.register(f.tool('own_effect', () => { effects++ }))
        ctx.tools.guard(() => { guardChecks++; return inquiry ? 'inquiry denies effects' : undefined })
      })
      // An extensible allow cannot override the subsequent monotonic denial.
      f.ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }))
      for (const name of ['global_effect', 'own_effect']) {
        const result = await f.ctx.tools.execute(f.input(name))
        expect(result.isError).toBe(true)
        expect(result.error?.message).toBe('inquiry denies effects')
      }
      expect(effects).toBe(0)
      expect(guardChecks).toBe(2)
      inquiry = false // Synthetic work identity changes, not a persistent agent policy.
      expect((await f.ctx.tools.execute(f.input('own_effect', 'business-control'))).isError).toBe(false)
      expect(effects).toBe(1)
    } finally { await f.close() }
  })

  it('CURRENT GAP: revocation during an async execute wrapper does not re-run the guard at the body', async () => {
    const f = await toolFixture()
    const enteredWrapper = deferred()
    const releaseWrapper = deferred()
    let allowed = true
    let guardChecks = 0
    let effects = 0
    let pending: Promise<unknown> | undefined
    try {
      await withTools(f.scope.ctx, ctx => {
        ctx.tools.register(f.tool('own_effect', () => { effects++ }))
        ctx.tools.guard(() => { guardChecks++; return allowed ? undefined : 'revoked' })
      })
      f.ctx.on('tools/execute', async (_exec, next) => {
        enteredWrapper.resolve()
        await releaseWrapper.promise
        return next()
      })
      const execution = f.ctx.tools.execute(f.input('own_effect'))
      pending = execution
      await enteredWrapper.promise
      expect(guardChecks).toBe(1)
      expect(effects).toBe(0)
      allowed = false
      releaseWrapper.resolve()
      // Diagnostic oracle for this fixed runtime: desired final-boundary denial
      // would instead be isError=true/effects=0 and intentionally fail this test.
      expect((await execution).isError).toBe(false)
      expect(effects).toBe(1)
      expect(guardChecks).toBe(1)
      const subsequent = await f.ctx.tools.execute(f.input('own_effect', 'after-revocation'))
      expect(subsequent.isError).toBe(true)
      expect(subsequent.error?.message).toBe('revoked')
      expect(effects).toBe(1)
    } finally {
      releaseWrapper.resolve()
      await pending?.catch(() => undefined)
      await f.close()
    }
  })
})
