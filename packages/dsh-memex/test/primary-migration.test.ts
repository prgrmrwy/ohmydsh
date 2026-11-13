import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeLibraryCards,
  migratePrimarySwitches,
  planPrimaryMigrations,
} from '../src/scope/primary-migration.js'
import type { ScopeConfig } from '../src/scope/types.js'

// Cards travel with the primary entry: a primary switch copies the old library's
// cards into the new one before the routing changes, and never overwrites a
// slug the target already holds.

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dsh-memex-migration-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function card(home: string, dir: 'cards' | 'archive', slug: string, body: string): void {
  mkdirSync(join(home, dir), { recursive: true })
  writeFileSync(join(home, dir, `${slug}.md`), body)
}

const base: ScopeConfig = { autoDerive: true, scopes: [], bindings: [], workspaces: [] }

describe('mergeLibraryCards', () => {
  it('copies cards and archived cards into the target library', () => {
    const from = join(root, 'old')
    const to = join(root, 'new')
    card(from, 'cards', 'a', 'body a')
    card(from, 'cards', 'b', 'body b')
    card(from, 'archive', 'old-a', 'archived a')

    const report = mergeLibraryCards(from, to)

    expect(report.copied).toEqual([join('cards', 'a.md'), join('cards', 'b.md'), join('archive', 'old-a.md')])
    expect(report.skipped).toEqual([])
    expect(readFileSync(join(to, 'cards', 'a.md'), 'utf8')).toBe('body a')
    expect(readFileSync(join(to, 'archive', 'old-a.md'), 'utf8')).toBe('archived a')
    // The source library is never touched.
    expect(readFileSync(join(from, 'cards', 'a.md'), 'utf8')).toBe('body a')
  })

  it('keeps the target copy when both libraries hold one slug', () => {
    const from = join(root, 'old')
    const to = join(root, 'new')
    card(from, 'cards', 'same', 'old body')
    card(to, 'cards', 'same', 'new body')

    const report = mergeLibraryCards(from, to)

    expect(report.copied).toEqual([])
    expect(report.skipped).toEqual([join('cards', 'same.md')])
    expect(readFileSync(join(to, 'cards', 'same.md'), 'utf8')).toBe('new body')
  })

  it('is a no-op for the same library and for a library that was never materialized', () => {
    const home = join(root, 'one')
    card(home, 'cards', 'a', 'a')
    expect(mergeLibraryCards(home, home)).toEqual({ from: home, to: home, copied: [], skipped: [] })

    const empty = mergeLibraryCards(join(root, 'missing'), home)
    expect(empty.copied).toEqual([])
    expect(empty.skipped).toEqual([])
  })

  it('refuses to merge a library into itself or into a path that contains it', () => {
    const outer = join(root, 'outer')
    mkdirSync(outer, { recursive: true })
    expect(() => mergeLibraryCards(outer, join(outer, 'inner'))).toThrow(/contains the other/)
    expect(() => mergeLibraryCards(join(outer, 'inner'), outer)).toThrow(/contains the other/)
  })
})

describe('planPrimaryMigrations', () => {
  it('reports the switch a path declaration makes', () => {
    const previous: ScopeConfig = {
      ...base,
      scopes: [
        { name: 'work', pathPrefixes: ['/w'], primary: true },
        { name: 'personal', pathPrefixes: ['/w'] },
      ],
    }
    const next: ScopeConfig = {
      ...base,
      scopes: [
        { name: 'work', pathPrefixes: ['/w'] },
        { name: 'personal', pathPrefixes: ['/w'] },
      ],
      workspaces: [{ path: '/w', primary: 'personal' }],
    }

    expect(planPrimaryMigrations(previous, next, { namespaceDir: root })).toEqual([{
      workspace: '/w',
      from: 'work',
      to: 'personal',
      fromHome: join(root, 'work'),
      toHome: join(root, 'personal'),
    }])
  })

  it('reports nothing when the primary is unchanged or the edit adds a first claimer', () => {
    const previous: ScopeConfig = {
      ...base,
      scopes: [{ name: 'work', pathPrefixes: ['/w'], primary: true }],
    }
    expect(planPrimaryMigrations(previous, previous, { namespaceDir: root })).toEqual([])
    const next: ScopeConfig = {
      ...base,
      scopes: [
        { name: 'work', pathPrefixes: ['/w'], primary: true },
        { name: 'extra', pathPrefixes: ['/v'] },
      ],
    }
    expect(planPrimaryMigrations(previous, next, { namespaceDir: root })).toEqual([])
  })

  it('treats a first claimer taking over an auto-derived library as a switch', () => {
    // The workspace had no claiming entry: its cards live in the library derived
    // from the repository. Claiming it for another library must carry them over.
    const next: ScopeConfig = { ...base, scopes: [{ name: 'personal', pathPrefixes: ['/w'] }] }
    const derivedHome = join(root, 'team-repo')
    const servedBefore = (workspace: string) => workspace === '/w' ? { name: 'team-repo', home: derivedHome } : undefined
    expect(planPrimaryMigrations(base, next, { namespaceDir: root, servedBefore })).toEqual([{
      workspace: '/w', from: 'team-repo', to: 'personal', fromHome: derivedHome, toHome: join(root, 'personal'),
    }])
    // Without that evidence (or when the same library keeps serving) nothing moves.
    expect(planPrimaryMigrations(base, next, { namespaceDir: root })).toEqual([])
    expect(planPrimaryMigrations(base, next, { namespaceDir: root, servedBefore: () => ({ name: 'personal', home: join(root, 'personal') }) })).toEqual([])
  })

  it('merges once when several workspaces switch between the same two libraries', () => {
    const previous: ScopeConfig = {
      ...base,
      scopes: [{ name: 'work', pathPrefixes: ['/w', '/x'], primary: true }],
    }
    const next: ScopeConfig = {
      ...base,
      scopes: [
        { name: 'work', pathPrefixes: ['/w', '/x'] },
        { name: 'personal', pathPrefixes: ['/w', '/x'] },
      ],
      workspaces: [
        { path: '/w', primary: 'personal' },
        { path: '/x', primary: 'personal' },
      ],
    }
    expect(planPrimaryMigrations(previous, next, { namespaceDir: root })).toHaveLength(1)
  })
})

describe('migratePrimarySwitches', () => {
  it('copies the old primary library before the switch is reported', () => {
    const previous: ScopeConfig = {
      ...base,
      scopes: [{ name: 'work', pathPrefixes: ['/w'], primary: true }],
    }
    const next: ScopeConfig = {
      ...base,
      scopes: [{ name: 'work', pathPrefixes: ['/w'] }, { name: 'personal', pathPrefixes: ['/w'] }],
      workspaces: [{ path: '/w', primary: 'personal' }],
    }
    card(join(root, 'work'), 'cards', 'note', 'note body')

    const [migration] = migratePrimarySwitches(previous, next, { namespaceDir: root })

    expect(migration!.to).toBe('personal')
    expect(migration!.report.copied).toEqual([join('cards', 'note.md')])
    expect(readFileSync(join(root, 'personal', 'cards', 'note.md'), 'utf8')).toBe('note body')
  })
})
