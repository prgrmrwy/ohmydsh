import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertLibraryTarget, assertRetirable, moveLibrary } from '../src/scope/library-move.js'

// A library's git repository lives inside its directory, so changing the path
// means moving the directory: cards merge (the target keeps its own copy of a
// shared slug), repository state follows only when the target has none, and the
// old directory is deleted only once the configuration points elsewhere.

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dsh-memex-move-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function library(path: string, cards: Record<string, string>): void {
  mkdirSync(join(path, 'cards'), { recursive: true })
  for (const [slug, body] of Object.entries(cards)) writeFileSync(join(path, 'cards', `${slug}.md`), body)
}

describe('moveLibrary', () => {
  it('copies cards and repository state into a fresh directory', () => {
    const from = join(root, 'old')
    const to = join(root, 'new')
    library(from, { a: 'a', b: 'b' })
    writeFileSync(join(from, '.sync.json'), '{"remote":"git@example:me/lib.git"}')
    mkdirSync(join(from, '.git'))
    writeFileSync(join(from, '.git', 'HEAD'), 'ref: refs/heads/main')

    const report = moveLibrary(from, to)

    expect(report.from).toBe(from)
    expect(report.to).toBe(to)
    expect(report.copied).toEqual([join('cards', 'a.md'), join('cards', 'b.md')])
    expect(report.carried).toEqual(['.git', '.sync.json'])
    expect(readFileSync(join(to, 'cards', 'a.md'), 'utf8')).toBe('a')
    expect(readFileSync(join(to, '.git', 'HEAD'), 'utf8')).toBe('ref: refs/heads/main')
  })

  it('keeps the target copy of a shared card and its own repository', () => {
    const from = join(root, 'old')
    const to = join(root, 'new')
    library(from, { same: 'old body', only: 'only body' })
    library(to, { same: 'new body' })
    writeFileSync(join(from, '.sync.json'), '{"remote":"old"}')
    writeFileSync(join(to, '.sync.json'), '{"remote":"new"}')

    const report = moveLibrary(from, to)

    expect(report.skipped).toEqual([join('cards', 'same.md')])
    expect(report.copied).toEqual([join('cards', 'only.md')])
    expect(report.carried).toEqual([])
    expect(readFileSync(join(to, 'cards', 'same.md'), 'utf8')).toBe('new body')
    expect(readFileSync(join(to, '.sync.json'), 'utf8')).toBe('{"remote":"new"}')
  })

  it('refuses a target that is the same directory, inside the source, or a file', () => {
    const from = join(root, 'old')
    library(from, { a: 'a' })
    expect(() => moveLibrary(from, from)).toThrow(/already lives/)
    expect(() => moveLibrary(from, join(from, 'inner'))).toThrow(/into itself/)
    expect(() => moveLibrary(join(from, 'inner'), from)).toThrow(/inside the new home/)
    const file = join(root, 'file')
    writeFileSync(file, 'x')
    expect(() => assertLibraryTarget(from, file)).toThrow(/not a directory/)
    // A missing source is an error too: a typo must not silently create an empty library.
    expect(() => moveLibrary(join(root, 'missing'), join(root, 'target'))).toThrow(/does not exist/)
  })
})

describe('assertRetirable', () => {
  it('refuses roots, the home directory, and paths that contain a live library', () => {
    const live = join(root, 'live')
    expect(() => assertRetirable('/', [live])).toThrow(/refusing to delete/)
    expect(() => assertRetirable(join(root, 'old'), [join(root, 'old', 'live')])).toThrow(/lives inside it/)
    expect(() => assertRetirable(live, [live])).toThrow(/refusing to delete/)
    expect(() => assertRetirable(join(root, 'retired'), [live])).not.toThrow()
    expect(existsSync(join(root, 'retired'))).toBe(false)
  })
})
