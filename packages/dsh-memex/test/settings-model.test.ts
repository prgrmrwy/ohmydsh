import { describe, expect, it } from 'vitest'
import type { MemexStoreView } from '../src/contract.js'
import {
  addEntryToGroup,
  setMemory,
  attachEntry,
  candidatesFor,
  claimersOf,
  detachEntry,
  expandPath,
  primaryOf,
  setFallback,
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
    expect(repoToPattern('https://code.byted.org/apaas/nexus.git')).toBe('code\\.byted\\.org[:/]apaas/nexus')
    expect(repoToPattern('')).toBe('')
  })

  it('keeps a hand-written pattern verbatim', () => {
    expect(repoToPattern('code\\.byted\\.org[:/]apaas/nexus')).toBe('code\\.byted\\.org[:/]apaas/nexus')
    expect(repoToPattern('github\\.com/org/.*')).toBe('github\\.com/org/.*')
  })

  it('places an undeclared library under the namespace', () => {
    expect(defaultHome('/ns/', 'learning')).toBe('/ns/learning')
  })

  it('carries every field the page does not edit through a save', () => {
    const rows = rowsFromSettings({ scopes: [
      { name: 'nexus', pathPrefixes: ['/work/nexus'], remotePatterns: ['apaas/nexus'], publish: 'internal' },
    ] })
    expect(toScopes(rows)).toEqual([
      { name: 'nexus', pathPrefixes: ['/work/nexus'], remotePatterns: ['apaas/nexus'], publish: 'internal' },
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
      row({ key: 'a', name: 'one', repos: ['apaas/nexus'] }),
      row({ key: 'b', name: 'two', repos: ['apaas/nexus'] }),
      row({ key: 'c', name: 'Bad Name' }),
    ]
    expect(conflicts(noPrimary, '/ns', messages)).toEqual(['name: Bad Name', 'primary: apaas/nexus ← one, two'])

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
      store({ scope: 'nexus' }),
      store({ scope: 'stray', declared: false, source: 'discovered' }),
      store({ scope: 'pending', declared: false, source: 'local' }),
    ]
    const rows = [row({ key: 'a', name: 'nexus' }), row({ key: 'b', name: 'pending' })]
    expect(undeclaredStores(stores, rows).map(item => item.scope)).toEqual(['stray'])
    expect(storesByName(stores).get('nexus')?.declared).toBe(true)
  })
})

describe('workspace grouping', () => {
  it('keeps one block for paths claimed by the same entries', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'personal', paths: ['/w/ohmydsh', '/w/cockpit'] }),
      row({ key: 'b', name: 'nexus', paths: ['/w/nexus'] }),
    ]
    const groups = groupsOf(rows)
    expect(groups.map(group => [group.key, [...group.paths]])).toEqual([
      ['personal', ['/w/ohmydsh', '/w/cockpit']],
      ['nexus', ['/w/nexus']],
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
        publish: 'external', publishKnown: true, memory: true, source: 'local', exists: true, local: true,
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
    const rows: EditorRow[] = [row({ key: 'a', name: 'nexus', paths: ['/home/u/work/nexus'] })]
    const views = workspaceViews(rows, ws('/home/u/work/nexus', 'nexus'))
    expect(views[0]!.entries.map(entry => [entry.kind, entry.name, entry.primary])).toEqual([
      ['entry', 'nexus', true],
      ['fallback', 'personal', false],
    ])

    const personal: EditorRow[] = [row({ key: 'p', name: 'personal', paths: ['/home/u/work/nexus'] })]
    // personal is the current library here; a fallback pointing at itself is noise.
    expect(workspaceViews(personal, ws('/home/u/work/nexus'))[0]!.entries).toHaveLength(1)
  })

  it('keeps declared paths that belong to no workspace visible', () => {
    const rows: EditorRow[] = [row({ key: 'a', name: 'legacy', paths: ['/srv/legacy'] })]
    const views = workspaceViews(rows, ws('/home/u/work/nexus', 'nexus'))
    expect(views.map(view => [view.fromRegistry, view.title])).toEqual([[true, 'nexus'], [false, '/srv/legacy']])
    // A declared path is still a workspace a session can run in, so it carries
    // the fallback entry too.
    expect(views[1]!.entries.map(entry => entry.name)).toEqual(['legacy', 'personal'])
  })

  it('stages the derived primary before a second claimer can steal the route', () => {
    const rows: EditorRow[] = []
    const view = workspaceViews(rows, {
      known: true,
      homeDir: home,
      items: [{ id: 'w1', title: 'learning', path: '/home/u/Documents/learning', route: {
        path: '/home/u/Documents/learning', scope: 'documents-learning', home: '/ns/documents-learning',
        publish: 'external', publishKnown: true, memory: true, source: 'local', exists: true, local: true,
      } }],
    })[0]!
    const staged = attachEntry(rows, view, { name: 'tools', discovered: false })
    expect(staged.map(item => [item.name, item.primary === true])).toEqual([
      ['documents-learning', true],
      ['tools', false],
    ])
  })

  it('attaches an existing library by adding the path to its own entry', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'nexus', paths: ['/home/u/work/nexus'], primary: true }),
      row({ key: 'b', name: 'flow', paths: ['/home/u/work/flow'] }),
    ]
    const view = workspaceViews(rows, ws('/home/u/work/nexus', 'nexus'))[0]!
    const next = attachEntry(rows, view, { name: 'flow', discovered: false })
    // One configuration entry per library: never a second row with the same name.
    expect(next).toHaveLength(2)
    expect(next[1]!.paths).toEqual(['/home/u/work/flow', '/home/u/work/nexus'])
    expect(next[1]!.primary).toBe(false)
    expect(conflicts(next, '/ns', messages)).toEqual([])
  })

  it('detaches a library from one workspace by dropping that path only', () => {
    const rows: EditorRow[] = [row({ key: 'a', name: 'personal', paths: ['/home/u/work/nexus', '/home/u/work/cockpit'] })]
    const view = workspaceViews(rows, ws('/home/u/work/nexus', 'nexus'))[0]!
    expect(detachEntry(rows, view, 'a')[0]!.paths).toEqual(['/home/u/work/cockpit'])
  })

  it('writes the fallback decision on the entry that carries the route', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'nexus', paths: ['/home/u/work/nexus'], primary: true }),
      row({ key: 'b', name: 'flow', paths: ['/home/u/work/nexus'] }),
    ]
    const view = workspaceViews(rows, ws('/home/u/work/nexus', 'nexus'))[0]!
    const off = setFallback(rows, view, false)
    expect(off.map(item => item.fallback)).toEqual([false, undefined])
    expect(toScopes(off)).toEqual([
      { name: 'nexus', pathPrefixes: ['/home/u/work/nexus'], primary: true, fallback: false },
      { name: 'flow', pathPrefixes: ['/home/u/work/nexus'] },
    ])
  })

  it('turns the fallback off on an undeclared workspace, staging its derived primary', () => {
    const rows: EditorRow[] = []
    const view = workspaceViews(rows, {
      known: true,
      homeDir: home,
      items: [{ id: 'w1', title: 'learning', path: '/home/u/Documents/learning', route: {
        path: '/home/u/Documents/learning', scope: 'documents-learning', home: '/ns/documents-learning',
        publish: 'external', publishKnown: true, memory: true, source: 'local', exists: true, local: true,
      } }],
    })[0]!
    expect(view.entries.map(entry => entry.kind)).toEqual(['assumed', 'fallback'])
    const off = setFallback(rows, view, false)
    // Turning the default off is a decision, so it has to be written down — and
    // with it the primary, or the declaration itself would move the route.
    expect(toScopes(off)).toEqual([
      { name: 'documents-learning', pathPrefixes: ['/home/u/Documents/learning'], primary: true, fallback: false },
    ])
    const on = toScopes(setFallback(off, view, true))
    expect(on[0]!.fallback).toBe(true)
  })

  it('switches memory off on the entry that carries the route', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'nexus', paths: ['/home/u/work/nexus'], primary: true }),
      row({ key: 'b', name: 'flow', paths: ['/home/u/work/nexus'] }),
    ]
    const view = workspaceViews(rows, ws('/home/u/work/nexus', 'nexus'))[0]!
    expect(view.memory).toBe(true)
    const off = setMemory(rows, view, false)
    // The route carrier decides, exactly like the fallback switch.
    expect(off.map(item => item.memory)).toEqual([false, undefined])
    expect(toScopes(off)).toEqual([
      { name: 'nexus', pathPrefixes: ['/home/u/work/nexus'], primary: true, memory: false },
      { name: 'flow', pathPrefixes: ['/home/u/work/nexus'] },
    ])
    expect(workspaceViews(off, ws('/home/u/work/nexus', 'nexus'))[0]!.memory).toBe(false)
    expect(toScopes(setMemory(off, view, true))[0]!.memory).toBe(true)
  })

  it('stages the derived primary when memory is switched off on an undeclared workspace', () => {
    const rows: EditorRow[] = []
    const view = workspaceViews(rows, {
      known: true,
      homeDir: home,
      items: [{ id: 'w1', title: 'thing', path: '/home/u/work/thing', route: {
        path: '/home/u/work/thing', scope: 'work-thing', home: '/ns/work-thing',
        publish: 'external', publishKnown: true, memory: true, source: 'local', exists: true, local: true,
      } }],
    })[0]!
    expect(view.memory).toBe(true)
    expect(toScopes(setMemory(rows, view, false))).toEqual([
      { name: 'work-thing', pathPrefixes: ['/home/u/work/thing'], primary: true, memory: false },
    ])
  })

  it('writes both switches on a declared library that claims no path', () => {
    // The block still shows the switches, so they must still write: there is no
    // workspace to claim, and the block's own entry is the route carrier.
    const rows: EditorRow[] = [row({ key: 'a', name: 'legacy', paths: [] })]
    const view = workspaceViews(rows, undefined)[0]!
    expect(view.entries.map(entry => [entry.kind, entry.name])).toEqual([
      ['entry', 'legacy'],
      ['fallback', 'personal'],
    ])
    expect(toScopes(setMemory(rows, view, false))[0]!.memory).toBe(false)
    expect(toScopes(setFallback(rows, view, false))[0]!.fallback).toBe(false)
  })

  it('moves the primary inside one workspace only', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'nexus', paths: ['/home/u/work/nexus'], primary: true }),
      row({ key: 'b', name: 'flow', paths: ['/home/u/work/nexus'] }),
      row({ key: 'c', name: 'other', paths: ['/home/u/work/other'], primary: true }),
    ]
    const view = workspaceViews(rows, ws('/home/u/work/nexus', 'nexus'))[0]!
    expect(setPrimary(rows, view, 'b').map(item => item.primary === true)).toEqual([false, true, true])
  })

  it('never offers a library that is already on the workspace', () => {
    const rows: EditorRow[] = [
      row({ key: 'a', name: 'nexus', paths: ['/home/u/work/nexus'], primary: true }),
      row({ key: 'b', name: 'flow', paths: ['/home/u/work/flow'] }),
    ]
    const candidates = candidatesFor(rows, [store({ scope: 'stray', declared: false, source: 'discovered' })], [rows[0]!])
    expect(candidates).toEqual([{ name: 'flow', discovered: false }, { name: 'stray', discovered: true }])
    // 'nexus' is attached, so re-adding it — the old route to a duplicate name —
    // is not offered at all.
    expect(candidates.map(item => item.name)).not.toContain('nexus')
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
        publish: 'external', publishKnown: true, memory: true, source: 'local', exists: true, local: true,
      } }],
    })[0]! as WorkspaceView
    expect(view.assumed).toBeUndefined()
    expect(stageAssumedPrimary(rows, view)).toHaveLength(1)
  })
})
