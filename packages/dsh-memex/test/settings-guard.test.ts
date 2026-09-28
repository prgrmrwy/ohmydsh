import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MemexResolveResult } from '../src/contract.js'
import { createScopeResolver } from '../src/scope/resolver.js'
import type { ScopeConfig, ScopeResolution } from '../src/scope/types.js'
import type { MemexWorkspacesResult } from '../src/contract.js'
import { rowsFromSettings, toScopes, type EditorRow } from '../src/client/settings-model.js'
import { closeSwitch, guard, openSwitch, type Env, type Outcome, type Session } from '../src/client/workspace-actions.js'
import { recompute, type Draft } from '../src/client/workspace-draft.js'
import { attachTo, detachFrom, switchPrimary } from '../src/client/workspace-edits.js'
import { scenario } from './support/workspace-env.js'

const HOME = '/home/u'

/** The Host's answer for one directory, shaped like the `resolve` endpoint. */
function hostRoute(resolution: ScopeResolution, path: string): MemexResolveResult {
  return {
    path,
    scope: resolution.scope,
    home: resolution.home,
    publish: resolution.publish,
    publishKnown: resolution.publishKnown,
    memory: resolution.memory,
    fallback: resolution.fallback,
    personal: resolution.personal,
    claim: resolution.claim,
    offBy: resolution.offBy,
    source: resolution.source,
    exists: false,
    local: resolution.source === 'local',
  }
}

interface Case {
  readonly name: string
  readonly config: Partial<ScopeConfig>
  readonly cwd: string
  readonly remote?: string
}

const cases: readonly Case[] = [
  { name: 'exact path claim', config: { scopes: [{ name: 'a', pathPrefixes: ['/w/p'] }] }, cwd: '/w/p' },
  { name: 'path claim written with ~/', config: { scopes: [{ name: 'a', pathPrefixes: ['~/w/p'], memory: false }] }, cwd: '/home/u/w/p/src' },
  { name: 'entry-level memory and fallback off', config: { scopes: [{ name: 'a', pathPrefixes: ['/w/p'], memory: false, fallback: false }] }, cwd: '/w/p' },
  { name: 'ancestor inheritance', config: { scopes: [{ name: 'a', pathPrefixes: ['/w'], memory: false }] }, cwd: '/w/p' },
  { name: 'deepest prefix wins', config: { scopes: [{ name: 'a', pathPrefixes: ['/w'], memory: false }, { name: 'b', pathPrefixes: ['/w/p'] }] }, cwd: '/w/p/x' },
  { name: 'two claimers, entry mark', config: { scopes: [{ name: 'a', pathPrefixes: ['/w/p'], primary: true, fallback: false }, { name: 'b', pathPrefixes: ['/w/p'] }] }, cwd: '/w/p' },
  {
    name: 'two claimers, declared primary',
    config: {
      scopes: [{ name: 'a', pathPrefixes: ['/w/p'], primary: true }, { name: 'b', pathPrefixes: ['/w/p'], memory: false }],
      workspaces: [{ path: '/w/p', primary: 'b' }],
    },
    cwd: '/w/p',
  },
  { name: 'personal as a sibling claimer', config: { scopes: [{ name: 'a', pathPrefixes: ['/w/p'], primary: true, fallback: false }, { name: 'personal', pathPrefixes: ['/w/p'] }] }, cwd: '/w/p' },
  { name: 'personal as current', config: { scopes: [{ name: 'personal', pathPrefixes: ['/w/p'], fallback: false }] }, cwd: '/w/p' },
  { name: 'declaration covering a child', config: { scopes: [{ name: 'a', pathPrefixes: ['/w/p'] }], workspaces: [{ path: '/w', memory: false, fallback: false }] }, cwd: '/w/p' },
  { name: 'declaration on a sibling only', config: { scopes: [{ name: 'a', pathPrefixes: ['/w/p', '/w/q'] }], workspaces: [{ path: '/w/q', memory: false }] }, cwd: '/w/p' },
  {
    name: 'binding lists personal after an entry closes the fallback',
    config: {
      scopes: [{ name: 'a', pathPrefixes: ['/w/p'], fallback: false }],
      bindings: [{ name: 'bind', read: ['a', 'personal'], write: ['a', 'personal'] }],
    },
    cwd: '/w/p',
  },
  {
    name: 'binding lists personal after a declaration closes the fallback',
    config: {
      scopes: [{ name: 'a', pathPrefixes: ['/w/p'] }],
      workspaces: [{ path: '/w/p', fallback: false }],
      bindings: [{ name: 'bind', read: ['a', 'personal'], write: ['a'] }],
    },
    cwd: '/w/p',
  },
  {
    name: 'remote claim',
    config: { scopes: [{ name: 'r', remotePatterns: ['github\\.com[:/]org/repo'], fallback: false }] },
    cwd: '/x/repo',
    remote: 'git@github.com:org/repo.git',
  },
  {
    name: 'remote claim under a covering declaration',
    config: { scopes: [{ name: 'r', remotePatterns: ['github\\.com[:/]org/repo'] }], workspaces: [{ path: '/x', memory: false }] },
    cwd: '/x/repo',
    remote: 'git@github.com:org/repo.git',
  },
  { name: 'derived from a remote', config: { scopes: [] }, cwd: '/x/other', remote: 'git@github.com:org/other.git' },
  { name: 'derived under a declaration', config: { scopes: [], workspaces: [{ path: '/x/other', fallback: false }] }, cwd: '/x/other', remote: 'git@github.com:org/other.git' },
  { name: 'local derivation with a declared entry', config: { scopes: [{ name: 'docs-learning', memory: false }] }, cwd: '/home/u/docs/learning' },
  { name: 'local derivation, undeclared', config: { scopes: [] }, cwd: '/home/u/docs/learning' },
]

function draftOf(config: Partial<ScopeConfig>): Draft {
  return { rows: rowsFromSettings({ scopes: config.scopes ?? [] }), workspaces: config.workspaces ?? [] }
}

describe('draft recomputation', () => {
  it('the draft recomputation agrees with the Host resolver on a table of configurations', () => {
    for (const item of cases) {
      const resolver = createScopeResolver({
        homeDir: HOME,
        namespaceDir: mkdtempSync(join(tmpdir(), 'dsh-memex-guard-')),
        gitRemote: cwd => (item.remote !== undefined && cwd === item.cwd ? item.remote : undefined),
        gitRoot: () => undefined,
        config: item.config,
      })
      const host = resolver.resolve(item.cwd)
      const page = recompute(draftOf(item.config), { bindings: item.config.bindings ?? [], homeDir: HOME }, item.cwd, hostRoute(host, item.cwd))
      expect({ case: item.name, computable: page.computable }).toEqual({ case: item.name, computable: true })
      expect({ case: item.name, scope: page.scope, memory: page.memory, fallback: page.fallback, personal: page.personal })
        .toEqual({ case: item.name, scope: host.scope, memory: host.memory, fallback: host.fallback, personal: host.personal })
    }
  })

  it('treats a workspace that lost its path claim as on and reachable, declarations aside', () => {
    // The Host answered for a path claim; the draft removed it. The new route is
    // not computable here, so only the declarations may close anything.
    const config: Partial<ScopeConfig> = { scopes: [{ name: 'a', pathPrefixes: ['/w/p'], memory: false, fallback: false }] }
    const resolver = createScopeResolver({ homeDir: HOME, namespaceDir: mkdtempSync(join(tmpdir(), 'dsh-memex-guard-')), gitRemote: () => undefined, gitRoot: () => undefined, config })
    const before = hostRoute(resolver.resolve('/w/p'), '/w/p')
    expect(before).toMatchObject({ memory: false, personal: { read: false, write: false } })
    const dropped: Draft = { rows: rowsFromSettings({ scopes: [{ name: 'a', memory: false, fallback: false }] }), workspaces: [] }
    expect(recompute(dropped, { bindings: [], homeDir: HOME }, '/w/p', before))
      .toMatchObject({ computable: false, memory: true, personal: { read: true, write: true } })
    const declared: Draft = { ...dropped, workspaces: [{ path: '/w/p', memory: false, fallback: false }] }
    expect(recompute(declared, { bindings: [], homeDir: HOME }, '/w/p', before))
      .toMatchObject({ computable: false, memory: false, personal: { read: false, write: false } })
    // An unknown route may still be bound: any binding listing personal keeps
    // that direction reachable.
    expect(recompute(declared, { bindings: [{ name: 'x', read: ['q', 'personal'], write: ['q'] }], homeDir: HOME }, '/w/p', before).personal)
      .toEqual({ read: true, write: false })
  })

  it("keeps a read-only or write-only binding's direction when computing reachability", () => {
    const draft: Draft = {
      rows: rowsFromSettings({ scopes: [{ name: 'r', pathPrefixes: ['/w/r'] }, { name: 'v', pathPrefixes: ['/w/v'] }] }),
      workspaces: [{ path: '/w', fallback: false }],
    }
    const bindings = [
      { name: 'reads', read: ['r', 'personal'], write: ['r'] },
      { name: 'writes', read: ['v'], write: ['v', 'personal'] },
    ]
    expect(recompute(draft, { bindings, homeDir: HOME }, '/w/r').personal).toEqual({ read: true, write: false })
    expect(recompute(draft, { bindings, homeDir: HOME }, '/w/v').personal).toEqual({ read: false, write: true })
  })
})

function withRows(session: Session, rows: readonly EditorRow[]): Session {
  return { ...session, draft: { ...session.draft, rows } }
}

const ctx = (env: Env) => ({ bindings: env.bindings, homeDir: env.homeDir })
const hostOf = (env: Env, path: string) => env.registry.find(item => item.path === path)?.route

function accepted(outcome: Outcome): Extract<Outcome, { ok: true }> {
  if (!outcome.ok) throw new Error(`refused: ${JSON.stringify(outcome.refusal)}`)
  return outcome
}

describe('workspace close, open and the guard', () => {
  it('closing a parent lists registered child workspaces that also close', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/w'] }, { name: 'b', pathPrefixes: ['/w/p'] }] }, ['/w', '/w/p'])
    const done = accepted(closeSwitch(session, env, '/w', 'memory'))
    expect(done.session.draft.workspaces).toEqual([{ path: '/w', memory: false }])
    expect(done.notes).toContainEqual({ kind: 'alsoCloses', path: '/w/p', item: 'memory' })
    expect(done.notes).not.toContainEqual({ kind: 'alsoCloses', path: '/w', item: 'memory' })
  })

  it('refuses to open a workspace an ancestor declaration closes and names the ancestor', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/w'] }], workspaces: [{ path: '/w', memory: false }] }, ['/w', '/w/p'])
    expect(openSwitch(session, env, '/w/p', 'memory')).toEqual({
      ok: false, refusal: { kind: 'ancestor', path: '/w/p', ancestor: '/w', item: 'memory', registered: true },
    })
  })

  it('points an ancestor refusal at the configuration when the ancestor is not registered', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/w'] }], workspaces: [{ path: '/w', fallback: false }] }, ['/w/p'])
    expect(openSwitch(session, env, '/w/p', 'fallback')).toEqual({
      ok: false, refusal: { kind: 'ancestor', path: '/w/p', ancestor: '/w', item: 'fallback', registered: false },
    })
  })

  it('opening removes the entry field and adds off declarations for other registered workspaces', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/w/p', '/w/q'], memory: false }] }, ['/w/p', '/w/q'])
    const done = accepted(openSwitch(session, env, '/w/p', 'memory'))
    expect(toScopes(done.session.draft.rows)).toEqual([{ name: 'a', pathPrefixes: ['/w/p', '/w/q'] }])
    expect(done.session.draft.workspaces).toEqual([{ path: '/w/q', memory: false }])
    expect(recompute(done.session.draft, ctx(env), '/w/p', hostOf(env, '/w/p')).memory).toBe(true)
    expect(recompute(done.session.draft, ctx(env), '/w/q', hostOf(env, '/w/q')).memory).toBe(false)
    expect(done.notes).toContainEqual({ kind: 'removedEntryField', scope: 'a', item: 'memory' })
    expect(done.notes).toContainEqual({ kind: 'unregisteredReopen', scope: 'a', item: 'memory' })
    expect(done.notes).toContainEqual({ kind: 'preserved', path: '/w/q', item: 'memory' })
  })

  it('refuses to open when the closing entry carries remote patterns', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/w/p'], remotePatterns: ['org/x'], memory: false }] }, ['/w/p'])
    expect(openSwitch(session, env, '/w/p', 'memory')).toEqual({ ok: false, refusal: { kind: 'remoteEntry', path: '/w/p', scope: 'a', item: 'memory' } })
  })

  it('attaching an entry under an inherited off primary adds memory and fallback declarations', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/w'], memory: false, fallback: false }, { name: 'b', pathPrefixes: ['/o'] }] }, ['/w/p'])
    const done = accepted(attachTo(session, env, '/w/p', { name: 'b', discovered: false }))
    expect(done.session.draft.workspaces).toEqual([{ path: '/w/p', memory: false, fallback: false }])
    expect(recompute(done.session.draft, ctx(env), '/w/p', hostOf(env, '/w/p')))
      .toMatchObject({ scope: 'b', memory: false, fallback: false, personal: { read: false, write: false } })
    expect(done.notes).toContainEqual({ kind: 'preserved', path: '/w/p', item: 'memory' })
    expect(done.notes).toContainEqual({ kind: 'preserved', path: '/w/p', item: 'fallback' })
  })

  it('detaching the only primary adds a memory declaration so the derived route stays off', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/home/u/work/thing'], memory: false }] }, ['/home/u/work/thing'])
    const done = accepted(detachFrom(session, env, '/home/u/work/thing', session.draft.rows[0]!.key))
    // personal was reachable before, so the fallback needs no declaration.
    expect(done.session.draft.workspaces).toEqual([{ path: '/home/u/work/thing', memory: false }])
  })

  it('refuses a save whose preserving declaration would close an on child workspace', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/w'], memory: false }, { name: 'c', pathPrefixes: ['/w/p'] }] }, ['/w', '/w/p'])
    expect(detachFrom(session, env, '/w', session.draft.rows[0]!.key)).toEqual({ ok: false, refusal: { kind: 'wouldClose', path: '/w', victim: '/w/p', item: 'memory' } })
  })

  it('refuses a claim-changing save while the registry is unavailable', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/x'], memory: false }] }, [], { known: false })
    const detached = session.draft.rows.map(row => ({ ...row, paths: [] }))
    expect(guard(withRows(session, detached), env)).toEqual({ ok: false, refusal: { kind: 'degraded' } })
    const rehomed = session.draft.rows.map(row => ({ ...row, home: '/elsewhere' }))
    expect(guard(withRows(session, rehomed), env).ok).toBe(true)
    // Declaring a library that claims nothing routes nothing: allowed.
    const declared = [...session.draft.rows, { key: 'n', name: 'stray', paths: [], repos: [], home: '', saved: false }]
    expect(guard(withRows(session, declared), env).ok).toBe(true)
  })

  it("making personal an entry on the workspace's own block is explicit and noted", () => {
    const { session, env } = scenario({
      scopes: [{ name: 'a', pathPrefixes: ['/w/p'], primary: true }, { name: 'personal', pathPrefixes: ['/o'] }],
      workspaces: [{ path: '/w/p', fallback: false }],
    }, ['/w/p'])
    const done = accepted(attachTo(session, env, '/w/p', { name: 'personal', discovered: false }))
    // The fallback declaration stays; the second exact claimer makes `a` the declared primary.
    expect(done.session.draft.workspaces).toEqual([{ path: '/w/p', fallback: false, primary: 'a' }])
    expect(recompute(done.session.draft, ctx(env), '/w/p', hostOf(env, '/w/p')).personal).toEqual({ read: true, write: true })
    expect(done.notes).toContainEqual({ kind: 'personalDespiteDeclaration', path: '/w/p' })
    // The same draft without the user's action on this block is refused.
    const rows = done.session.draft.rows
    expect(guard(withRows(session, rows), env)).toEqual({ ok: false, refusal: { kind: 'personalEntry', path: '/w/p' } })
  })

  it('refuses an edit that makes personal an entry of a workspace indirectly', () => {
    // Detach onto an inherited personal.
    const detach = scenario({
      scopes: [{ name: 'personal', pathPrefixes: ['/w'] }, { name: 'a', pathPrefixes: ['/w/p'] }],
      workspaces: [{ path: '/w/p', fallback: false }],
    }, ['/w/p'])
    expect(detachFrom(detach.session, detach.env, '/w/p', detach.session.draft.rows[1]!.key)).toEqual({ ok: false, refusal: { kind: 'personalEntry', path: '/w/p' } })

    // Attach personal on a parent whose child inherits it.
    const parent = scenario({
      scopes: [{ name: 'a', pathPrefixes: ['/w'], primary: true }, { name: 'personal', pathPrefixes: ['/o'] }],
      workspaces: [{ path: '/w/p', fallback: false }],
    }, ['/w', '/w/p'])
    expect(attachTo(parent.session, parent.env, '/w', { name: 'personal', discovered: false }))
      .toEqual({ ok: false, refusal: { kind: 'personalEntry', path: '/w/p' } })
  })
})

describe('switching primary and attaching entries', () => {
  const at = (session: Session, env: Env, path: string) => recompute(session.draft, ctx(env), path, hostOf(env, path))

  it("switching primary keeps both switches' effective values", () => {
    const { session, env } = scenario({
      scopes: [{ name: 'a', pathPrefixes: ['/w/p'], fallback: false }, { name: 'c', pathPrefixes: ['/o'] }],
      workspaces: [{ path: '/w/p', memory: false }],
    }, ['/w/p'])
    const done = accepted(switchPrimary(session, env, '/w/p', { name: 'c', discovered: false }))
    expect(at(done.session, env, '/w/p')).toMatchObject({ scope: 'c', memory: false, fallback: false, personal: { read: false, write: false } })
    expect(done.session.draft.workspaces).toEqual([{ path: '/w/p', memory: false, fallback: false }])
    expect(done.notes).toContainEqual({ kind: 'replaced', path: '/w/p', scope: 'c', replaced: 'a' })
  })

  it("carries the old primary's entry-level memory off into a path declaration", () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/w/p'], memory: false }, { name: 'c', pathPrefixes: ['/o'] }] }, ['/w/p'])
    const done = accepted(switchPrimary(session, env, '/w/p', { name: 'c', discovered: false }))
    expect(toScopes(done.session.draft.rows)).toEqual([{ name: 'a', memory: false }, { name: 'c', pathPrefixes: ['/o', '/w/p'] }])
    expect(done.session.draft.workspaces).toEqual([{ path: '/w/p', memory: false }])
    expect(at(done.session, env, '/w/p').memory).toBe(false)
  })

  it('adds no fallback declaration when a binding kept personal reachable before the switch', () => {
    const { session, env } = scenario({
      scopes: [{ name: 'a', pathPrefixes: ['/w/p'], fallback: false }, { name: 'c', pathPrefixes: ['/o'] }],
      bindings: [{ name: 'bind', read: ['a', 'personal'], write: ['a', 'personal'] }],
    }, ['/w/p'])
    expect(hostOf(env, '/w/p')).toMatchObject({ fallback: false, personal: { read: true, write: true } })
    const done = accepted(switchPrimary(session, env, '/w/p', { name: 'c', discovered: false }))
    expect(done.session.draft.workspaces).toEqual([])
    expect(at(done.session, env, '/w/p')).toMatchObject({ scope: 'c', fallback: true, personal: { read: true, write: true } })
  })

  it('adds a fallback declaration when switching away from an entry-level fallback off without a binding', () => {
    const { session, env } = scenario({ scopes: [{ name: 'a', pathPrefixes: ['/w/p'], fallback: false }, { name: 'c', pathPrefixes: ['/o'] }] }, ['/w/p'])
    const done = accepted(switchPrimary(session, env, '/w/p', { name: 'c', discovered: false }))
    expect(done.session.draft.workspaces).toEqual([{ path: '/w/p', fallback: false }])
    expect(at(done.session, env, '/w/p').personal).toEqual({ read: false, write: false })
  })

  it("refuses a switch whose new primary's binding would make personal reachable", () => {
    const { session, env } = scenario({
      scopes: [{ name: 'a', pathPrefixes: ['/w/p'], fallback: false }, { name: 'c', pathPrefixes: ['/o'] }],
      bindings: [{ name: 'cb', read: ['c', 'personal'], write: ['c'] }],
    }, ['/w/p'])
    expect(switchPrimary(session, env, '/w/p', { name: 'c', discovered: false })).toEqual({ ok: false, refusal: { kind: 'binding', path: '/w/p', binding: 'cb' } })
  })

  it('attaching on an inherited workspace makes the new entry its sole primary and names every inherited library', () => {
    const { session, env } = scenario({
      scopes: [{ name: 'a', pathPrefixes: ['/w'], primary: true }, { name: 'b', pathPrefixes: ['/w'] }, { name: 'c', pathPrefixes: ['/o'] }],
    }, ['/w/p', '/w/q'])
    const done = accepted(attachTo(session, env, '/w/p', { name: 'c', discovered: false }))
    expect(toScopes(done.session.draft.rows)).toEqual([
      { name: 'a', pathPrefixes: ['/w'], primary: true },
      { name: 'b', pathPrefixes: ['/w'] },
      { name: 'c', pathPrefixes: ['/o', '/w/p'] },
    ])
    expect(done.session.draft.workspaces).toEqual([])
    expect(at(done.session, env, '/w/p').scope).toBe('c')
    expect(at(done.session, env, '/w/q').scope).toBe('a')
    expect(done.notes).toContainEqual({ kind: 'inheritedAttach', path: '/w/p', scope: 'c', inherited: ['a', 'b'] })
  })

  it("refuses an inherited attach whose new primary's binding lists personal, saying it would become primary", () => {
    const { session, env } = scenario({
      scopes: [{ name: 'a', pathPrefixes: ['/w'], fallback: false }, { name: 'b', pathPrefixes: ['/o'] }],
      bindings: [{ name: 'bb', read: ['b', 'personal'], write: ['b'] }],
    }, ['/w/p'])
    expect(attachTo(session, env, '/w/p', { name: 'b', discovered: false })).toEqual({
      ok: false, refusal: { kind: 'becomesPrimary', path: '/w/p', scope: 'b', cause: { kind: 'binding', path: '/w/p', binding: 'bb' } },
    })
  })

  it('refuses an inherited attach whose preserving declaration would close an on child', () => {
    const { session, env } = scenario({
      scopes: [{ name: 'a', pathPrefixes: ['/w'], memory: false }, { name: 'd', pathPrefixes: ['/w/p/q'] }, { name: 'b', pathPrefixes: ['/o'] }],
    }, ['/w/p', '/w/p/q'])
    expect(attachTo(session, env, '/w/p', { name: 'b', discovered: false })).toEqual({
      ok: false, refusal: { kind: 'becomesPrimary', path: '/w/p', scope: 'b', cause: { kind: 'wouldClose', path: '/w/p', victim: '/w/p/q', item: 'memory' } },
    })
  })
})
