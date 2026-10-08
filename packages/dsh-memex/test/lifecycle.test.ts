import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerMemexLifecycle } from '../src/lifecycle/index.js'
import { createScopeResolver } from '../src/scope/resolver.js'

function fixture(memory = true) {
  const listeners = new Map<string, (payload: any) => void>()
  const injected: any[] = []
  const session = { header: { cwd: '/work/repo' } }
  const agent = { session, inject: (message: any) => injected.push(message) }
  const ctx = {
    on(name: string, listener: (payload: any) => void) { listeners.set(name, listener); return () => listeners.delete(name) },
    logger: () => ({ warn: () => undefined }),
  }
  const scopes = {
    resolve: () => ({ scope: 'repo', home: '/memex/repo', publish: 'internal', publishKnown: true,
    memory, source: 'derived', created: false, workspacePaths: [] }),
  }
  return { listeners, injected, session, agent, ctx, scopes }
}

describe('memex lifecycle', () => {
  it('injects recall context at session start', () => {
    const f = fixture()
    registerMemexLifecycle(f.ctx as never, f.scopes as never)
    f.listeners.get('agent/created')!({ agent: f.agent, source: 'startup' })
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
    f.listeners.get('agent/turn-stopping')!({ agent: f.agent })
    expect(f.injected).toHaveLength(2)
  })

  it('does not subscribe to the removed agent/session-start event', () => {
    const f = fixture()
    registerMemexLifecycle(f.ctx as never, f.scopes as never)
    expect(f.listeners.has('agent/session-start')).toBe(false)
  })

  it('reminds only after recall and before a write', () => {
    const f = fixture()
    const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
    f.listeners.get('agent/turn-stopping')!({ agent: f.agent })
    expect(f.injected).toHaveLength(0)
    lifecycle.mark('recall', f.session)
    f.listeners.get('agent/turn-stopping')!({ agent: f.agent })
    expect(f.injected).toHaveLength(1)
    // The reminder may extend the same turn by one model step; it must not
    // enqueue itself again if the model still chooses not to write.
    f.listeners.get('agent/turn-stopping')!({ agent: f.agent })
    expect(f.injected).toHaveLength(1)
    lifecycle.mark('retro', f.session)
    f.listeners.get('agent/turn-stopping')!({ agent: f.agent })
    expect(f.injected).toHaveLength(1)
  })

  it('injects nothing at all when the workspace has memory switched off', () => {
    const f = fixture(false)
    const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
    f.listeners.get('agent/created')!({ agent: f.agent, source: 'startup' })
    // No recall prompt: inviting calls the tools would then refuse is worse than
    // saying nothing.
    expect(f.injected).toHaveLength(0)
    // And no reminder either, even if something marked a recall before.
    lifecycle.mark('recall', f.session)
    f.listeners.get('agent/turn-stopping')!({ agent: f.agent })
    expect(f.injected).toHaveLength(0)
  })

  it('resumes injecting when the switch is turned back on', () => {
    // The switch is read per session start, so re-enabling takes effect on the
    // next session without a restart.
    const f = fixture(false)
    registerMemexLifecycle(f.ctx as never, f.scopes as never)
    f.listeners.get('agent/created')!({ agent: f.agent, source: 'startup' })
    expect(f.injected).toHaveLength(0)
    f.scopes.resolve = () => ({ scope: 'repo', home: '/memex/repo', publish: 'internal', publishKnown: true,
      memory: true, source: 'derived', created: false, workspacePaths: [] })
    f.listeners.get('agent/created')!({ agent: f.agent, source: 'startup' })
    expect(f.injected).toHaveLength(1)
  })

  it('resets recall but preserves write state after compaction', () => {
    const f = fixture()
    const lifecycle = registerMemexLifecycle(f.ctx as never, f.scopes as never)
    lifecycle.mark('recall', f.session)
    lifecycle.mark('write', f.session)
    f.listeners.get('agent/created')!({ agent: f.agent, source: 'compact' })
    expect(f.injected).toHaveLength(1)
    f.listeners.get('agent/turn-stopping')!({ agent: f.agent })
    expect(f.injected).toHaveLength(1)
  })

  it('injects nothing when a path declaration closes memory for the directory or its children', () => {
    const resolver = createScopeResolver({
      homeDir: mkdtempSync(join(tmpdir(), 'dsh-memex-lifecycle-')), gitRemote: () => undefined, gitRoot: () => undefined,
      config: { scopes: [{ name: 'proj', pathPrefixes: ['/w/proj'] }], workspaces: [{ path: '/w/proj', memory: false }] },
    })
    for (const cwd of ['/w/proj', '/w/proj/deep/child', '/w/other']) {
      const f = fixture()
      f.session.header.cwd = cwd
      const lifecycle = registerMemexLifecycle(f.ctx as never, resolver)
      f.listeners.get('agent/created')!({ agent: f.agent, source: 'startup' })
      lifecycle.mark('recall', f.session)
      f.listeners.get('agent/turn-stopping')!({ agent: f.agent })
      // Neither the recall instructions nor the write reminder, except outside the declaration.
      expect(f.injected).toHaveLength(cwd === '/w/other' ? 2 : 0)
    }
  })
})
