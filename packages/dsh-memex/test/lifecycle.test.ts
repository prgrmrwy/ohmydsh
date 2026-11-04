import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerMemexLifecycle } from '../src/lifecycle/index.js'
import { createScopeResolver } from '../src/scope/resolver.js'
import { registerMemexTools } from '../src/tools/index.js'

afterEach(() => { vi.unstubAllEnvs() })

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

  describe('会话开始时注入召回引导', () => {
    function routedFixture() {
      const root = mkdtempSync(join(tmpdir(), 'memex-lifecycle-route-'))
      const home = join(root, 'custom-library')
      vi.stubEnv('DSH_HOME', join(root, 'dsh-home'))
      const scopes = createScopeResolver({
        homeDir: root, gitRemote: () => undefined, gitRoot: () => undefined,
        config: { scopes: [{ name: 'custom', home, pathPrefixes: ['/work/repo'], publish: 'internal', fallback: false }] },
      })
      return { ...fixture(), root, home, scopes }
    }

    it('注入与工具解析一致', async () => {
      const f = routedFixture()
      const resolve = vi.spyOn(f.scopes, 'resolve')
      const tools = new Map<string, ToolDefinition>()
      const ctx = { ...f.ctx, tools: { register(tool: ToolDefinition) { tools.set(tool.name, tool); return () => undefined } } }
      const runner = vi.fn(async () => ({ ok: true, exitCode: 0, stdout: '## sample\nSample\nBody\n', stderr: '' }))
      registerMemexLifecycle(ctx as never, f.scopes)
      registerMemexTools(ctx as never, f.scopes, { runner })
      f.sessionStart('startup')
      const text = f.injected[0].content[0].text
      expect(text).toContain('Current memory scope: custom')
      expect(text).toContain(`Library: ${f.home}`)
      const result = await tools.get('memex_search')!.execute({ query: 'sample' }, { agent: f.agent } as never) as { json: string }
      expect(JSON.parse(result.json)).toMatchObject({ current: { scope: 'custom', home: f.home }, targets: [{ scope: 'custom', home: f.home }] })
      expect(runner).toHaveBeenCalledExactlyOnceWith(['search', '--limit', '10', '--', 'sample'], expect.objectContaining({ home: f.home }))
      expect(resolve.mock.calls).toEqual([['/work/repo'], ['/work/repo']])
    })

    it('注入不写卡片', () => {
      const f = routedFixture()
      mkdirSync(join(f.home, 'cards'), { recursive: true })
      writeFileSync(join(f.home, 'cards', 'one.md'), '---\ntitle: One\n---\nFirst card\n')
      writeFileSync(join(f.home, 'cards', 'two.md'), '---\ntitle: Two\n---\nSecond card\n')
      writeFileSync(join(f.home, '.memexrc'), '{"nestedSlugs":true}\n')
      const inventory = () => readdirSync(f.root, { recursive: true }).sort().map(relative => {
        const path = join(f.root, relative)
        const stat = statSync(path)
        return { path: relative, directory: stat.isDirectory(), ...(stat.isFile() ? { content: readFileSync(path, 'utf8'), mtime: stat.mtimeMs } : {}) }
      })
      const before = inventory()
      const ensure = vi.spyOn(f.scopes, 'ensure')
      registerMemexLifecycle(f.ctx as never, f.scopes)
      for (const source of ['startup', 'compact', 'clear'] as const) f.sessionStart(source)
      expect(f.injected).toHaveLength(3)
      expect(inventory()).toEqual(before)
      expect(ensure).not.toHaveBeenCalled()
    })

    it('注入失败不阻断会话', async () => {
      const f = fixture()
      const warn = vi.fn()
      const resolve = vi.spyOn(f.scopes, 'resolve').mockImplementation(() => { throw new Error('library route unavailable') })
      registerMemexLifecycle({ ...f.ctx, logger: () => ({ warn }) } as never, f.scopes as never)
      expect(f.sessionStart('startup')).toBeUndefined()
      expect(resolve).toHaveBeenCalledExactlyOnceWith('/work/repo')
      expect(f.injected).toHaveLength(0)
      expect(warn).toHaveBeenCalledExactlyOnceWith('Could not inject memex recall context: %s', 'library route unavailable')
      expect(await f.preStep(1)).toEqual({ kind: 'enter', messages: [f.userInput] })
    })

    it('注入提示评测类卡片不贴查询原文', () => {
      const f = fixture()
      registerMemexLifecycle(f.ctx as never, f.scopes as never)
      f.sessionStart('startup')
      const text = f.injected[0].content[0].text
      expect(text).toMatch(/evaluation, probe, (and |or )?handoff/i)
      expect(text).toMatch(/do not (paste|include).*evaluation quer/i)
      expect(text).toMatch(/question (ids|numbers).*gold set file path/i)
      expect(text).toMatch(/(lexical|word).*overlap.*(ahead|before).*target/i)
    })

    it('评测提示不拦截写入', async () => {
      const home = mkdtempSync(join(tmpdir(), 'memex-eval-guidance-write-'))
      vi.stubEnv('DSH_HOME', join(home, 'dsh-home'))
      const scopes = createScopeResolver({
        homeDir: home, gitRemote: () => undefined, gitRoot: () => undefined,
        config: { scopes: [{ name: 'repo', pathPrefixes: ['/work/repo'], publish: 'internal' }] },
      })
      const f = fixture()
      const warn = vi.fn()
      const tools = new Map<string, ToolDefinition>()
      const ctx = { ...f.ctx, logger: () => ({ warn }), tools: { register(tool: ToolDefinition) { tools.set(tool.name, tool); return () => undefined } } }
      const lifecycle = registerMemexLifecycle(ctx as never, scopes)
      f.sessionStart('startup')
      registerMemexTools(ctx as never, scopes, {
        runner: async (args, options) => {
          writeFileSync(join(options.home, 'cards', `${args[2]}.md`), options.stdin!)
          return { ok: true, exitCode: 0, stdout: '', stderr: '' }
        },
        onToolSuccess: (tool, session) => lifecycle.mark(tool, session),
      })
      const content = '---\ntitle: Evaluation note\ncategory: eval\n---\nEvaluation query: fictional retrieval example\n'
      const result = await tools.get('memex_write')!.execute({ slug: 'evaluation-note', content }, { agent: f.agent } as never) as { json: string }
      expect(JSON.parse(result.json)).toMatchObject({ written: true, slug: 'evaluation-note', additional: [] })
      expect(JSON.parse(result.json)).not.toHaveProperty('warning')
      expect(warn).not.toHaveBeenCalled()
      const current = scopes.resolve(f.session.header.cwd)
      const card = readFileSync(join(current.home, 'cards', 'evaluation-note.md'), 'utf8')
      expect(card).toContain('Evaluation query: fictional retrieval example')
      expect(card.split('---')[1]!.trim().split('\n').map(line => line.split(':')[0])).toEqual(['title', 'category', 'source'])
    })
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
