import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerMemexLifecycle } from '../src/lifecycle/index.js'
import { createScopeResolver } from '../src/scope/resolver.js'

interface Decision { kind: 'enter' | 'reject'; messages?: any[]; startsRequestSeries?: true }

function fixture(memory = true) {
  const listeners = new Map<string, (...args: any[]) => any>()
  const injected: any[] = []
  const session = { header: { cwd: '/work/repo' } }
  const agent = { session, inject: (message: any) => injected.push(message) }
  const ctx = {
    on(name: string, listener: (...args: any[]) => any) { listeners.set(name, listener); return () => listeners.delete(name) },
    logger: () => ({ warn: () => undefined }),
  }
  const scopes = {
    resolve: () => ({ scope: 'repo', home: '/memex/repo', publish: 'internal', publishKnown: true,
    memory, source: 'derived', created: false, workspacePaths: [] }),
  }
  const userInput = { id: 'user-input', source: { kind: 'user' } }
  /** The host closing `turn`: the only moment the plugin may decide to remind. */
  const stopping = (turn: number) => listeners.get('agent/turn-stopping')!({ agent, turn, signal: new AbortController().signal })
  /** The host proposing a step in `turn`; `decision` is what the rest of the chain would let through. */
  const preStep = (turn: number, over: { decision?: Decision; signal?: AbortSignal } = {}): Promise<Decision> =>
    listeners.get('agent/pre-step')!(
      { agent, messages: [], turn, step: 1, signal: over.signal ?? new AbortController().signal },
      async () => over.decision ?? { kind: 'enter', messages: [userInput] },
    )
  const sessionStart = (source: 'startup' | 'clear' | 'compact') => listeners.get('agent/created')!({ agent, source })
  return { listeners, injected, session, agent, ctx, scopes, userInput, stopping, preStep, sessionStart }
}

const isReminder = (message: any) =>
  message.source?.kind === 'plugin:dsh-memex' && message.source.form === 'notice'
const reminders = (decision: Decision) => (decision.messages ?? []).filter(isReminder)

describe('memex lifecycle', () => {
  it('injects recall context at session start', () => {
    const f = fixture()
    registerMemexLifecycle(f.ctx as never, f.scopes as never)
    f.sessionStart('startup')
    expect(f.injected).toHaveLength(1)
    expect(f.injected[0].content[0].text).toContain('Current memory scope: repo')
    expect(f.injected[0].source).toEqual({ kind: 'plugin:dsh-memex', form: 'instructions' })
  })

  it('treats a sourceless agent/created (DSH 0.1.5) as a fresh start', () => {
    const f = fixture()
    const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
    lifecycle.mark('recall', f.session)
    lifecycle.mark('write', f.session)
    f.listeners.get('agent/created')!({ agent: f.agent })
    expect(f.injected).toHaveLength(1)
    // A fresh start clears write state, so a later recall can earn a reminder again.
    lifecycle.mark('recall', f.session)
    // The reminder is deferred: closing the turn schedules it, the next turn's first step carries it.
    f.listeners.get('agent/turn-stopping')!({ agent: f.agent, turn: 1 })
    expect(f.injected).toHaveLength(1)
    return f.preStep(2).then(decision => expect(reminders(decision)).toHaveLength(1))
  })

  it('does not subscribe to the removed agent/session-start event', () => {
    const f = fixture()
    registerMemexLifecycle(f.ctx as never, f.scopes as never)
    expect(f.listeners.has('agent/session-start')).toBe(false)
  })

  describe('write reminder', () => {
    it('is never injected at turn close, because that would add a step to the turn that is closing', () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      expect(f.injected).toHaveLength(0)
    })

    it('rides along with the next turn once, and only after recall and before a write', async () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      // No recall yet: closing a turn schedules nothing.
      f.stopping(1)
      expect(reminders(await f.preStep(2))).toHaveLength(0)

      lifecycle.mark('recall', f.session)
      f.stopping(2)
      const next = await f.preStep(3)
      expect(reminders(next)).toHaveLength(1)
      // The user's own message stays first; the reminder follows it.
      expect(next.messages![0]).toBe(f.userInput)
      expect(next.messages![1].source).toMatchObject({ kind: 'plugin:dsh-memex', form: 'notice', summary: 'Memex write reminder' })
      expect(next.messages![1].content[0].text).toContain('Memex reminder')

      // Delivered once: neither another close nor another step brings it back.
      f.stopping(3)
      expect(reminders(await f.preStep(4))).toHaveLength(0)
      expect(f.injected).toHaveLength(0)
    })

    it('never lands in the turn that scheduled it, however many steps that turn still runs', async () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(5)
      // Another listener may steer the closing turn into more steps, each with its own pre-step.
      expect(reminders(await f.preStep(5))).toHaveLength(0)
      expect(reminders(await f.preStep(5))).toHaveLength(0)
      expect(reminders(await f.preStep(6))).toHaveLength(1)
    })

    it('is scheduled once even when the closing turn is stopped again before delivery', async () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      f.stopping(1)
      expect(reminders(await f.preStep(1))).toHaveLength(0)
      const next = await f.preStep(2)
      expect(reminders(next)).toHaveLength(1)
      expect(next.messages).toHaveLength(2)
    })

    it('never opens a step of its own: with nothing to ride along with it waits', async () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      // The loop would close this turn without a model request; adding a message here would force one.
      const empty = await f.preStep(2, { decision: { kind: 'enter', messages: [] } })
      expect(empty).toEqual({ kind: 'enter', messages: [] })
      // It stays scheduled for the first step that does carry input.
      expect(reminders(await f.preStep(3))).toHaveLength(1)
    })

    it('leaves a rejected or aborted step alone and keeps waiting', async () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      expect(await f.preStep(2, { decision: { kind: 'reject' } })).toEqual({ kind: 'reject' })
      const aborted = await f.preStep(2, { signal: AbortSignal.abort() })
      expect(reminders(aborted)).toHaveLength(0)
      expect(reminders(await f.preStep(3))).toHaveLength(1)
    })

    it('keeps everything else the rest of the chain decided', async () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      const hostContext = { id: 'host-context', source: { kind: 'plugin', plugin: 'host', form: 'notice' } }
      const next = await f.preStep(2, { decision: { kind: 'enter', messages: [f.userInput, hostContext], startsRequestSeries: true } })
      expect(next.kind).toBe('enter')
      expect(next.startsRequestSeries).toBe(true)
      expect(next.messages!.slice(0, 2)).toEqual([f.userInput, hostContext])
      expect(next.messages).toHaveLength(3)
    })

    it('is dropped when a card is written before the next turn', async () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      lifecycle.mark('retro', f.session)
      expect(reminders(await f.preStep(2))).toHaveLength(0)
      f.stopping(2)
      expect(reminders(await f.preStep(3))).toHaveLength(0)
    })

    it('is dropped when compaction resets recall, and can be earned again by recalling again', async () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      f.sessionStart('compact')
      expect(reminders(await f.preStep(2))).toHaveLength(0)
      f.stopping(2)
      expect(reminders(await f.preStep(3))).toHaveLength(0)

      lifecycle.mark('recall', f.session)
      f.stopping(3)
      expect(reminders(await f.preStep(4))).toHaveLength(1)
    })

    it('is ended by a state reset even when a new recall follows before the next step', async () => {
      // A reset ends the recall the reminder belonged to. A recall made AFTER the
      // reset has not closed a turn yet, so it must not inherit the old schedule.
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      f.sessionStart('compact')
      lifecycle.mark('recall', f.session)
      expect(reminders(await f.preStep(2))).toHaveLength(0)
    })

    it('is dropped when the session restarts in a workspace with memory switched off', async () => {
      const f = fixture()
      const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      f.scopes.resolve = () => ({ scope: 'repo', home: '/memex/repo', publish: 'internal', publishKnown: true,
        memory: false, source: 'derived', created: false, workspacePaths: [] })
      f.sessionStart('clear')
      lifecycle.mark('recall', f.session)
      expect(reminders(await f.preStep(2))).toHaveLength(0)
    })
  })

  it('injects nothing at all when the workspace has memory switched off', async () => {
    const f = fixture(false)
    const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
    f.sessionStart('startup')
    // No recall prompt: inviting calls the tools would then refuse is worse than
    // saying nothing.
    expect(f.injected).toHaveLength(0)
    // And no reminder either, even if something marked a recall before.
    lifecycle.mark('recall', f.session)
    f.stopping(1)
    expect(f.injected).toHaveLength(0)
    expect(reminders(await f.preStep(2))).toHaveLength(0)
  })

  it('resumes injecting when the switch is turned back on', () => {
    // The switch is read per session start, so re-enabling takes effect on the
    // next session without a restart.
    const f = fixture(false)
    registerMemexLifecycle(f.ctx as never, f.scopes as never)
    f.sessionStart('startup')
    expect(f.injected).toHaveLength(0)
    f.scopes.resolve = () => ({ scope: 'repo', home: '/memex/repo', publish: 'internal', publishKnown: true,
      memory: true, source: 'derived', created: false, workspacePaths: [] })
    f.sessionStart('startup')
    expect(f.injected).toHaveLength(1)
  })

  it('resets recall but preserves write state after compaction', async () => {
    const f = fixture()
    const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
    lifecycle.mark('recall', f.session)
    lifecycle.mark('write', f.session)
    f.sessionStart('compact')
    expect(f.injected).toHaveLength(1)
    f.stopping(1)
    expect(f.injected).toHaveLength(1)
    expect(reminders(await f.preStep(2))).toHaveLength(0)
  })

  it('injects nothing when a path declaration closes memory for the directory or its children', async () => {
    const resolver = createScopeResolver({
      homeDir: mkdtempSync(join(tmpdir(), 'dsh-memex-lifecycle-')), gitRemote: () => undefined, gitRoot: () => undefined,
      config: { scopes: [{ name: 'proj', pathPrefixes: ['/w/proj'] }], workspaces: [{ path: '/w/proj', memory: false }] },
    })
    for (const cwd of ['/w/proj', '/w/proj/deep/child', '/w/other']) {
      const f = fixture()
      f.session.header.cwd = cwd
      const lifecycle = registerMemexLifecycle(f.ctx as never, resolver)
      f.sessionStart('startup')
      lifecycle.mark('recall', f.session)
      f.stopping(1)
      const next = await f.preStep(2)
      // Neither the recall instructions nor the write reminder, except outside the declaration.
      expect(f.injected).toHaveLength(cwd === '/w/other' ? 1 : 0)
      expect(reminders(next)).toHaveLength(cwd === '/w/other' ? 1 : 0)
    }
  })
})
