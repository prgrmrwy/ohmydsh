import { describe, expect, it } from 'vitest'
import type { MemexStoreView } from '../src/contract.js'
import {
  addEntryToGroup,
  attachEntry,
  candidatesFor,
  claimersOf,
  detachEntry,
  expandPath,
  primaryOf,
  setPrimary,
  stageAssumedPrimary,
  underPath,
  workspaceViews,
  addPathToGroup,
  addRow,
  conflicts,
  groupsOf,
  removePathFromGroup,
  setPathInGroup,
  setPrimaryInGroup,
  declareRow,
  defaultHome,
  repoToPattern,
  rowsFromSettings,
  storesByName,
  toScopes,
  undeclaredStores,
  type EditorRow,
  type WorkspaceView,
} from '../src/client/settings-model.js'
import type { MemexWorkspacesResult } from '../src/contract.js'
import { closeSwitch, type Env } from '../src/client/workspace-actions.js'
import { recompute } from '../src/client/workspace-draft.js'
import { attachTo, switchPrimary } from '../src/client/workspace-edits.js'
import { scenario } from './support/workspace-env.js'

function registryOf(env: Env): MemexWorkspacesResult {
  return { known: true, homeDir: env.homeDir, items: env.registry.map((item, index) => ({ id: `w${String(index)}`, title: item.path, path: item.path, ...(item.route === undefined ? {} : { route: item.route }) })) }
}

const messages = { name: 'name', home: 'home', pattern: 'pattern', primary: 'primary' }

function store(overrides: Partial<MemexStoreView> & { scope: string }): MemexStoreView {
  return {
    home: `/ns/${overrides.scope}`,
    homeSource: 'namespace',
    publish: 'external',
    publishKnown: true,
    memory: true,
    source: 'config',
    declared: true,
    exists: true,
    pathPrefixes: [],
    remotePatterns: [],
    sync: { known: true, configured: false },
    ...overrides,
  }
}

function row(overrides: Partial<EditorRow> & { key: string }): EditorRow {
  return { name: '', paths: [], repos: [], home: '', saved: true, ...overrides }
}

describe('settings model', () => {
  it('turns a typed repository URL into a transport-agnostic pattern', () => {
    expect(repoToPattern('git@github.com:prgrmrwy/ohmydsh.git')).toBe('github\\.com[:/]prgrmrwy/ohmydsh')
    expect(repoToPattern('https://git.corp.example/team/acme.git')).toBe('git\\.corp\\.example[:/]team/acme')
    expect(repoToPattern('')).toBe('')
  })

  it('keeps a hand-written pattern verbatim', () => {
    expect(repoToPattern('git\\.corp\\.example[:/]team/acme')).toBe('git\\.corp\\.example[:/]team/acme')
    expect(repoToPattern('github\\.com/org/.*')).toBe('github\\.com/org/.*')
  })

  it('places an undeclared library under the namespace', () => {
    expect(defaultHome('/ns/', 'learning')).toBe('/ns/learning')
  })

  it('carries every field the page does not edit through a save', () => {
    const rows = rowsFromSettings({ scopes: [
      { name: 'acme', pathPrefixes: ['/work/acme'], remotePatterns: ['team/acme'], publish: 'internal' },
    ] })
    expect(toScopes(rows)).toEqual([
      { name: 'acme', pathPrefixes: ['/work/acme'], remotePatterns: ['team/acme'], publish: 'internal' },
    ])
  })

  it('drops blank paths and blank homes instead of storing empty values', () => {
    const rows: EditorRow[] = [row({ key: 'a', name: 'solo', paths: ['  ', '/keep'], home: '   ' })]
    expect(toScopes(rows)).toEqual([{ name: 'solo', pathPrefixes: ['/keep'] }])
  })

  it('blocks two rows that would share one library path', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'one', home: '/libs/shared' }),
      row({ key: 'b', name: 'two', home: '/libs/shared' }),
    ]
    expect(conflicts(rows, '/ns', messages)).toEqual(['home: one · two'])
  })

  it('blocks an explicit path that collides with another scope default', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'one' }),
      row({ key: 'b', name: 'two', home: '/ns/one' }),
    ]
    expect(conflicts(rows, '/ns', messages)).toEqual(['home: one · two'])
  })

  it('blocks a workspace shared by two entries with no unique primary, and bad names', () => {
    const noPrimary: EditorRow[] = [
      row({ key: 'a', name: 'one', repos: ['team/acme'] }),
      row({ key: 'b', name: 'two', repos: ['team/acme'] }),
      row({ key: 'c', name: 'Bad Name' }),
    ]
    expect(conflicts(noPrimary, '/ns', messages)).toEqual(['name: Bad Name', 'primary: team/acme ← one, two'])

    const twoPrimary: EditorRow[] = [
      row({ key: 'a', name: 'one', primary: true, paths: ['/work/proj'] }),
      row({ key: 'b', name: 'two', primary: true, paths: ['/work/proj'] }),
    ]
    expect(conflicts(twoPrimary, '/ns', messages)).toEqual(['primary: /work/proj ← one, two'])

    const ok: EditorRow[] = [
      row({ key: 'a', name: 'proj-internal', primary: true, paths: ['/work/proj'] }),
      row({ key: 'b', name: 'proj-public', paths: ['/work/proj'] }),
    ]
    expect(conflicts(ok, '/ns', messages)).toEqual([])
  })

  it('accepts a sound draft', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'one', paths: ['/work/one'], repos: ['org/one'] }),
      row({ key: 'b', name: 'two' }),
    ]
    expect(conflicts(rows, '/ns', messages)).toEqual([])
  })

  it('adds an empty row and a declaration row without duplicating one', () => {
    const added = addRow([row({ key: 'a', name: 'one' })])
    expect(added).toHaveLength(2)
    expect(added[1]).toMatchObject({ saved: false, name: '' })

    const declared = declareRow([], store({ scope: 'stray', declared: false, source: 'discovered' }))
    expect(declared).toEqual([expect.objectContaining({ name: 'stray', saved: false, home: '' })])
    expect(declareRow(declared, store({ scope: 'stray', declared: false }))).toHaveLength(1)
  })

  it('lists only libraries nothing declares', () => {
    const stores = [
      store({ scope: 'acme' }),
      store({ scope: 'stray', declared: false, source: 'discovered' }),
      store({ scope: 'pending', declared: false, source: 'local' }),
    ]
    const rows = [row({ key: 'a', name: 'acme' }), row({ key: 'b', name: 'pending' })]
    expect(undeclaredStores(stores, rows).map(item => item.scope)).toEqual(['stray'])
    expect(storesByName(stores).get('acme')?.declared).toBe(true)
  })
})

describe('workspace grouping', () => {
  it('keeps one block for paths claimed by the same entries', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'personal', paths: ['/w/ohmydsh', '/w/cockpit'] }),
      row({ key: 'b', name: 'acme', paths: ['/w/acme'] }),
    ]
    const groups = groupsOf(rows)
    expect(groups.map(group => [group.key, [...group.paths]])).toEqual([
      ['personal', ['/w/ohmydsh', '/w/cockpit']],
      ['acme', ['/w/acme']],
    ])
  })

  it('puts both entries of a shared workspace in one block, primary first', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'proj-public', paths: ['/w/proj'] }),
      row({ key: 'b', name: 'proj-internal', primary: true, paths: ['/w/proj'] }),
    ]
    const groups = groupsOf(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.rows.map(item => item.name)).toEqual(['proj-internal', 'proj-public'])
    expect(groups[0]!.paths).toEqual(['/w/proj'])

    // On a registered workspace a path declaration picks the primary, over the mark.
    const declared = workspaceViews(rows, { known: true, homeDir: '/home/u', items: [{ id: 'w', title: 'proj', path: '/w/proj' }] }, [],
      { workspaces: [{ path: '/w/proj', primary: 'proj-public' }] })[0]!
    expect(declared.entries.map(entry => [entry.name, entry.primary])).toEqual([
      ['proj-public', true], ['proj-internal', false], ['personal', false],
    ])
  })

  it('gives a pathless entry its own block', () => {
    const groups = groupsOf([row({ key: 'a', name: 'lonely' }), row({ key: 'b', name: 'lonely-two' })])
    expect(groups.map(group => group.rows[0]!.name)).toEqual(['lonely', 'lonely-two'])
  })

  it('applies a path edit to every entry of the block', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'one', primary: true, paths: ['/w/proj'] }),
      row({ key: 'b', name: 'two', paths: ['/w/proj'] }),
    ]
    const group = groupsOf(rows)[0]!
    expect(setPathInGroup(rows, group, 0, '/w/moved').map(item => item.paths[0])).toEqual(['/w/moved', '/w/moved'])
    expect(removePathFromGroup(rows, group, 0).map(item => item.paths)).toEqual([[], []])
    expect(addPathToGroup(rows, group).map(item => item.paths)).toEqual([['/w/proj', ''], ['/w/proj', '']])
  })

  it('keeps exactly one primary when a workspace gains a second entry', () => {
    // A registered workspace: the existing exact claimer becomes the declared primary,
    // and the new entry's own mark (it is primary elsewhere) is left alone.
    const { session, env } = scenario({ scopes: [{ name: 'one', pathPrefixes: ['/w/proj'] }, { name: 'two', pathPrefixes: ['/w/two'], primary: true }] }, ['/w/proj'])
    const done = attachTo(session, env, '/w/proj', { name: 'two', discovered: false })
    if (!done.ok) throw new Error('refused')
    expect(done.session.draft.workspaces).toEqual([{ path: '/w/proj', primary: 'one' }])
    expect(toScopes(done.session.draft.rows)).toEqual([
      { name: 'one', pathPrefixes: ['/w/proj'] },
      { name: 'two', pathPrefixes: ['/w/two', '/w/proj'], primary: true },
    ])
    expect(done.notes).toContainEqual({ kind: 'declaredPrimary', path: '/w/proj', scope: 'one' })
    expect(conflicts(done.session.draft.rows, '/ns', messages, done.session.draft.workspaces, '/home/u')).toEqual([])

    // A configuration block has no registered path to declare: it keeps the entry mark.
    const rows: EditorRow[] = [row({ key: 'a', name: 'one', paths: ['/w/proj'] })]
    const added = addEntryToGroup(rows, groupsOf(rows)[0]!)
    expect(added).toHaveLength(2)
    expect(added[0]).toMatchObject({ name: 'one', primary: true })
    // The new entry joins as an additional one, unmarked.
    expect(added[1]!.name).toBe('')
    expect(added[1]!.primary).not.toBe(true)

    const moved = setPrimaryInGroup(added, groupsOf(added)[0]!, added[1]!.key)
    expect(moved.map(item => item.primary)).toEqual([false, true])
  })
})


describe('workspace-first view', () => {
  const home = '/home/u'
  const ws = (path: string, title = 'ws') => ({
    known: true as const,
    homeDir: home,
    items: [{ id: 'w1', title, path }],
  })

  it('expands a configured ~/ prefix so it matches an absolute registry path', () => {
    expect(expandPath('~/work/proj', home)).toBe('/home/u/work/proj')
    expect(underPath('/home/u/work/proj/src', '~/work/proj', home)).toBe(true)
    // Segment-wise: a sibling whose name only starts the same is not under it.
    expect(underPath('/home/u/work/project', '~/work/proj', home)).toBe(false)
  })

  it('takes only the deepest claimers, like the resolver', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'wide', paths: ['/home/u'] }),
      row({ key: 'b', name: 'proj', paths: ['/home/u/work/proj'] }),
    ]
    // A broader claim elsewhere does not attach itself to this workspace.
    expect(claimersOf(rows, '/home/u/work/proj/src', home).map(item => item.name)).toEqual(['proj'])
    expect(claimersOf(rows, '/home/u/other', home).map(item => item.name)).toEqual(['wide'])
  })

  it('gives an undeclared workspace its derived entry without writing configuration', () => {
    const rows: EditorRow[] = []
    const views = workspaceViews(rows, {
      known: true,
      homeDir: home,
      items: [{ id: 'w1', title: 'learning', path: '/home/u/Documents/learning', route: {
        path: '/home/u/Documents/learning', scope: 'documents-learning', home: '/ns/documents-learning',
        publish: 'external', publishKnown: true, memory: true, fallback: true, personal: { read: true, write: true },
        claim: { kind: 'none' }, offBy: { memory: [], fallback: [] }, source: 'local', exists: true, local: true,
      } }],
    })
    expect(views).toHaveLength(1)
    expect(views[0]!.assumed?.scope).toBe('documents-learning')
    expect(views[0]!.entries).toEqual([
      { kind: 'assumed', name: 'documents-learning', primary: true },
      // The fallback is on by default here too: the workspace is usable with no
      // configuration at all.
      { kind: 'fallback', name: 'personal', primary: false, enabled: true },
    ])
    expect(rows).toHaveLength(0)
  })

  it('offers the fallback entry on a declared workspace, and hides it when it is the primary', () => {
    const rows: EditorRow[] = [row({ key: 'a', name: 'acme', paths: ['/home/u/work/acme'] })]
    const views = workspaceViews(rows, ws('/home/u/work/acme', 'acme'))
    expect(views[0]!.entries.map(entry => [entry.kind, entry.name, entry.primary])).toEqual([
      ['entry', 'acme', true],
      ['fallback', 'personal', false],
    ])

    const personal: EditorRow[] = [row({ key: 'p', name: 'personal', paths: ['/home/u/work/acme'] })]
    // personal is the current library here; a fallback pointing at itself is noise.
    expect(workspaceViews(personal, ws('/home/u/work/acme'))[0]!.entries).toHaveLength(1)
  })

  it('keeps declared paths that belong to no workspace visible', () => {
    const rows: EditorRow[] = [row({ key: 'a', name: 'legacy', paths: ['/srv/legacy'] })]
    const views = workspaceViews(rows, ws('/home/u/work/acme', 'acme'))
    expect(views.map(view => [view.fromRegistry, view.title])).toEqual([[true, 'acme'], [false, '/srv/legacy']])
    // A declared path is still a workspace a session can run in, so it carries
    // the fallback entry too.
    expect(views[1]!.entries.map(entry => entry.name)).toEqual(['legacy', 'personal'])
  })

  it('stages the derived primary before a second claimer can steal the route', () => {
    const { session, env } = scenario({ scopes: [{ name: 'tools', pathPrefixes: ['/work/tools'] }] }, ['/home/u/Documents/learning'])
    const done = attachTo(session, env, '/home/u/Documents/learning', { name: 'tools', discovered: false })
    if (!done.ok) throw new Error('refused')
    expect(toScopes(done.session.draft.rows)).toEqual([
      { name: 'tools', pathPrefixes: ['/work/tools', '/home/u/Documents/learning'] },
      { name: 'documents-learning', pathPrefixes: ['/home/u/Documents/learning'] },
    ])
    // The primary is decided by the workspace's declaration, not an entry mark.
    expect(done.session.draft.workspaces).toEqual([{ path: '/home/u/Documents/learning', primary: 'documents-learning' }])
    expect(done.notes).toContainEqual({ kind: 'stagedPrimary', scope: 'documents-learning' })
    expect(recompute(done.session.draft, { bindings: [], homeDir: env.homeDir }, '/home/u/Documents/learning', env.registry[0]!.route).scope)
      .toBe('documents-learning')
  })

  it('attaches an existing library by adding the path to its own entry', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'acme', paths: ['/home/u/work/acme'], primary: true }),
      row({ key: 'b', name: 'flow', paths: ['/home/u/work/flow'] }),
    ]
    const view = workspaceViews(rows, ws('/home/u/work/acme', 'acme'))[0]!
    const next = attachEntry(rows, view, { name: 'flow', discovered: false })
    // One configuration entry per library: never a second row with the same name.
    expect(next).toHaveLength(2)
    expect(next[1]!.paths).toEqual(['/home/u/work/flow', '/home/u/work/acme'])
    expect(next[1]!.primary).toBe(false)
    expect(conflicts(next, '/ns', messages)).toEqual([])
  })

  it('model path comparisons use the Host homeDir, not an empty string', () => {
    // The live configuration writes `~/…`; an empty homeDir expands that to `/…`
    // and every comparison against the absolute registry path silently misses.
    const rows: EditorRow[] = [
      row({ key: 'p', name: 'personal', paths: ['~/work/acme', '~/work/cockpit'] }),
      row({ key: 'f', name: 'flow', paths: ['~/work/acme/'] }),
    ]
    const registry = { known: true as const, homeDir: home, items: [{ id: 'w1', title: 'acme', path: '/home/u/work/acme', route: {
      path: '/home/u/work/acme', scope: 'documents-acme', home: '/ns/documents-acme', publish: 'external' as const, publishKnown: true,
      memory: true, fallback: true, personal: { read: true, write: true }, claim: { kind: 'none' as const }, offBy: { memory: [], fallback: [] },
      source: 'local' as const, exists: true, local: true,
    } }] }
    const view = workspaceViews(rows, registry)[0]!
    // Removal drops the `~/` spelling of this workspace, and only it.
    expect(detachEntry(rows, view, 'p')[0]!.paths).toEqual(['~/work/cockpit'])
    expect(detachEntry(rows, view, 'f')[1]!.paths).toEqual([])
    // Attaching a library that already claims the workspace through `~/` adds no second spelling.
    expect(attachEntry(rows, view, { name: 'personal', discovered: false })[0]!.paths).toEqual(['~/work/acme', '~/work/cockpit'])
    // A derived primary already declared through `~/` is not staged again.
    const derived: EditorRow[] = [row({ key: 'd', name: 'documents-acme', paths: ['~/work/acme'] })]
    expect(stageAssumedPrimary(derived, workspaceViews([], registry)[0]!)).toHaveLength(1)
  })

  it('detaches a library from one workspace by dropping that path only', () => {
    const rows: EditorRow[] = [row({ key: 'a', name: 'personal', paths: ['/home/u/work/acme', '/home/u/work/cockpit'] })]
    const view = workspaceViews(rows, ws('/home/u/work/acme', 'acme'))[0]!
    expect(detachEntry(rows, view, 'a')[0]!.paths).toEqual(['/home/u/work/cockpit'])
  })

  it("a fallback close writes only this workspace's declaration and leaves shared-library workspaces untouched", () => {
    const { session, env } = scenario({
      scopes: [{ name: 'acme', pathPrefixes: ['/home/u/work/acme', '/home/u/work/cockpit'], primary: true }, { name: 'flow', pathPrefixes: ['/home/u/work/acme'] }],
    }, ['/home/u/work/acme', '/home/u/work/cockpit'])
    const done = closeSwitch(session, env, '/home/u/work/acme', 'fallback')
    if (!done.ok) throw new Error('refused')
    expect(toScopes(done.session.draft.rows)).toEqual(toScopes(session.draft.rows))
    expect(done.session.draft.workspaces).toEqual([{ path: '/home/u/work/acme', fallback: false }])
    const views = workspaceViews(done.session.draft.rows, registryOf(env), [], done.session.draft)
    const fallbackOf = (view: WorkspaceView) => view.entries.find(entry => entry.kind === 'fallback')?.enabled
    expect(views.map(view => [view.path, fallbackOf(view)])).toEqual([['/home/u/work/acme', false], ['/home/u/work/cockpit', true]])
  })

  it('closing the fallback of an undeclared workspace adds a declaration and no scopes entry', () => {
    const { session, env } = scenario({ scopes: [] }, ['/home/u/Documents/learning'])
    expect(workspaceViews([], registryOf(env))[0]!.entries.map(entry => entry.kind)).toEqual(['assumed', 'fallback'])
    const done = closeSwitch(session, env, '/home/u/Documents/learning', 'fallback')
    if (!done.ok) throw new Error('refused')
    expect(done.session.draft.rows).toEqual([])
    expect(done.session.draft.workspaces).toEqual([{ path: '/home/u/Documents/learning', fallback: false }])
    const view = workspaceViews(done.session.draft.rows, registryOf(env), [], done.session.draft)[0]!
    expect(view.entries.find(entry => entry.kind === 'fallback')?.enabled).toBe(false)
  })

  it('closing memory in one workspace leaves another workspace on the same primary on', () => {
    const { session, env } = scenario({ scopes: [{ name: 'personal', pathPrefixes: ['/home/u/work/acme', '/home/u/work/cockpit'] }] },
      ['/home/u/work/acme', '/home/u/work/cockpit'])
    const done = closeSwitch(session, env, '/home/u/work/acme', 'memory')
    if (!done.ok) throw new Error('refused')
    expect(toScopes(done.session.draft.rows)).toEqual([{ name: 'personal', pathPrefixes: ['/home/u/work/acme', '/home/u/work/cockpit'] }])
    expect(done.session.draft.workspaces).toEqual([{ path: '/home/u/work/acme', memory: false }])
    const views = workspaceViews(done.session.draft.rows, registryOf(env), [], done.session.draft)
    expect(views.map(view => [view.path, view.memory])).toEqual([['/home/u/work/acme', false], ['/home/u/work/cockpit', true]])
    expect(done.notes.filter(note => note.kind === 'alsoCloses')).toEqual([])
  })

  it('configuration blocks of every kind carry no switch and say why', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'legacy', paths: ['/srv/legacy'], memory: false }),
      row({ key: 'b', name: 'loose', paths: [] }),
    ]
    const views = workspaceViews(rows, ws('/home/u/work/acme', 'acme'))
    expect(views.map(view => [view.title, view.switches])).toEqual([
      ['acme', { editable: true }],
      ['/srv/legacy', { editable: false, reason: 'unregistered' }],
      ['loose', { editable: false, reason: 'pathless' }],
    ])
    // The state is still shown: legacy's entry closes memory.
    expect(views[1]!.memory).toBe(false)
    const degraded = workspaceViews(rows, undefined)
    expect(degraded.map(view => view.switches)).toEqual([
      { editable: false, reason: 'degraded' },
      { editable: false, reason: 'degraded' },
    ])
  })

  it('setting the fallback personal row as primary replaces the old primary on that workspace', () => {
    const { session, env } = scenario({ scopes: [] }, ['/home/u/docs/learning'])
    const done = switchPrimary(session, env, '/home/u/docs/learning', { name: 'personal', discovered: false })
    if (!done.ok) throw new Error('refused')
    expect(toScopes(done.session.draft.rows)).toEqual([{ name: 'personal', pathPrefixes: ['/home/u/docs/learning'] }])
    expect(done.notes).toContainEqual({ kind: 'replaced', path: '/home/u/docs/learning', scope: 'personal', replaced: 'docs-learning' })
    const view = workspaceViews(done.session.draft.rows, registryOf(env), [], done.session.draft)[0]!
    expect(view.entries.map(entry => [entry.kind, entry.name, entry.primary])).toEqual([['entry', 'personal', true]])
  })

  it('switching under an inherited ancestor prefix splits the workspace out and leaves siblings routed', () => {
    const { session, env } = scenario({
      scopes: [{ name: 'a', pathPrefixes: ['/w'], primary: true }, { name: 'b', pathPrefixes: ['/w'] }, { name: 'c', pathPrefixes: ['/o'] }],
    }, ['/w/p', '/w/q'])
    const done = switchPrimary(session, env, '/w/p', { name: 'c', discovered: false })
    if (!done.ok) throw new Error('refused')
    expect(toScopes(done.session.draft.rows)).toEqual([
      { name: 'a', pathPrefixes: ['/w'], primary: true },
      { name: 'b', pathPrefixes: ['/w', '/w/p'] },
      { name: 'c', pathPrefixes: ['/o', '/w/p'] },
    ])
    expect(done.session.draft.workspaces).toEqual([{ path: '/w/p', primary: 'c' }])
    const context = { bindings: [], homeDir: env.homeDir }
    expect(recompute(done.session.draft, context, '/w/q', env.registry[1]!.route).scope).toBe('a')
    expect(recompute(done.session.draft, context, '/w/p', env.registry[0]!.route).scope).toBe('c')
    expect(done.notes).toContainEqual({ kind: 'replaced', path: '/w/p', scope: 'c', replaced: 'a', splitFrom: '/w' })
  })

  it("switching primary in one workspace leaves the shared library's other workspaces unchanged", () => {
    const { session, env } = scenario({
      scopes: [{ name: 'personal', pathPrefixes: ['/home/u/work/acme', '/home/u/work/cockpit'] }, { name: 'x', pathPrefixes: ['/o'] }],
    }, ['/home/u/work/acme', '/home/u/work/cockpit'])
    const done = switchPrimary(session, env, '/home/u/work/acme', { name: 'x', discovered: false })
    if (!done.ok) throw new Error('refused')
    expect(toScopes(done.session.draft.rows)).toEqual([
      { name: 'personal', pathPrefixes: ['/home/u/work/cockpit'] },
      { name: 'x', pathPrefixes: ['/o', '/home/u/work/acme'] },
    ])
    const views = workspaceViews(done.session.draft.rows, registryOf(env), [], done.session.draft)
    expect(views[1]!.entries.map(entry => [entry.name, entry.primary])).toEqual([['personal', true]])
    expect(views[1]!.memory).toBe(true)
    expect(done.session.draft.workspaces).toEqual([])
  })

  it('blocks a workspace with no declaration and no unique mark', () => {
    const rows: EditorRow[] = [row({ key: 'a', name: 'one', paths: ['/w/p'] }), row({ key: 'b', name: 'two', paths: ['/w/p'] })]
    expect(conflicts(rows, '/ns', messages, [], '/home/u')).toEqual(['primary: /w/p ← one, two'])
    expect(conflicts(rows, '/ns', messages, [{ path: '/w/p', primary: 'two' }], '/home/u')).toEqual([])
  })

  it('blocks a workspace with several marks and no declaration, and a non-exact declared primary', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'one', paths: ['/w/p'], primary: true }),
      row({ key: 'b', name: 'two', paths: ['/w/p'], primary: true }),
      row({ key: 'c', name: 'up', paths: ['/w'] }),
    ]
    expect(conflicts(rows, '/ns', messages, [], '/home/u')).toEqual(['primary: /w/p ← one, two'])
    expect(conflicts(rows, '/ns', messages, [{ path: '/w/p', primary: 'one' }], '/home/u')).toEqual([])
    // Declared on a path its primary only inherits: stale, and the Host would refuse it.
    expect(conflicts(rows, '/ns', { ...messages, declared: 'declared' }, [{ path: '/w/p', primary: 'up' }], '/home/u'))
      .toEqual(['primary: /w/p ← one, two', 'declared: /w/p → up'])
  })

  it('moves the primary inside one workspace only', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'acme', paths: ['/home/u/work/acme'], primary: true }),
      row({ key: 'b', name: 'flow', paths: ['/home/u/work/acme'] }),
      row({ key: 'c', name: 'other', paths: ['/home/u/work/other'], primary: true }),
    ]
    const view = workspaceViews(rows, ws('/home/u/work/acme', 'acme'))[0]!
    expect(setPrimary(rows, view, 'b').map(item => item.primary === true)).toEqual([false, true, true])
  })

  it('never offers a library that is already on the workspace', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'acme', paths: ['/home/u/work/acme'], primary: true }),
      row({ key: 'b', name: 'flow', paths: ['/home/u/work/flow'] }),
    ]
    const candidates = candidatesFor(rows, [store({ scope: 'stray', declared: false, source: 'discovered' })], [rows[0]!])
    expect(candidates).toEqual([{ name: 'flow', discovered: false }, { name: 'stray', discovered: true }])
    // 'acme' is attached, so re-adding it — the old route to a duplicate name —
    // is not offered at all.
    expect(candidates.map(item => item.name)).not.toContain('acme')
  })

  it('leaves a library a workspace already presents out of the undeclared list', () => {
    const rows: EditorRow[] = []
    const stores = [
      store({ scope: 'documents-learning', declared: false, source: 'derived' }),
      store({ scope: 'acceptance-probe', declared: false, source: 'discovered' }),
    ]
    // A workspace whose route is that library shows it already, and declares it
    // from there — the weaker duplicate entry is dropped.
    expect(undeclaredStores(stores, rows, ['documents-learning']).map(item => item.scope)).toEqual(['acceptance-probe'])
    expect(undeclaredStores(stores, rows).map(item => item.scope)).toEqual(['documents-learning', 'acceptance-probe'])
  })

  it('resolves the primary of a workspace to its marked entry only', () => {
    const claimers = [
      row({ key: 'a', name: 'one', paths: ['/w'] }),
      row({ key: 'b', name: 'two', paths: ['/w'] }),
    ]
    expect(primaryOf(claimers)).toBeUndefined()
    expect(primaryOf([claimers[0]!])?.name).toBe('one')
    expect(primaryOf([{ ...claimers[0]!, primary: true }, claimers[1]!])?.name).toBe('one')
  })

  it('stages nothing when the derived primary is already declared', () => {
    const rows: EditorRow[] = [row({ key: 'a', name: 'documents-learning', paths: ['/home/u/Documents/learning'], primary: true })]
    const view = workspaceViews(rows, {
      known: true,
      homeDir: home,
      items: [{ id: 'w1', title: 'learning', path: '/home/u/Documents/learning', route: {
        path: '/home/u/Documents/learning', scope: 'documents-learning', home: '/ns/documents-learning',
        publish: 'external', publishKnown: true, memory: true, fallback: true, personal: { read: true, write: true },
        claim: { kind: 'none' }, offBy: { memory: [], fallback: [] }, source: 'local', exists: true, local: true,
      } }],
    })[0]! as WorkspaceView
    expect(view.assumed).toBeUndefined()
    expect(stageAssumedPrimary(rows, view)).toHaveLength(1)
  })
})
