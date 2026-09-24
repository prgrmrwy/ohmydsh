import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { main } from '../src/cli/recall-report.js'
import { buildReport, parseRecords, type StoredRecord } from '../src/telemetry/report.js'

const NOW = new Date('2026-09-24T12:00:00Z')
const query = { tokens: 2, han: true, segmented: true, semantic: false }

function rec(hits: StoredRecord['hits'], at = '2026-09-24T10:00:00Z'): StoredRecord {
  return { at, scope: 'caller', query, hitCount: hits?.length ?? 0, hits }
}

function report(records: StoredRecord[], cards: string[], scope = 'personal') {
  return buildReport({ records, corruptLines: 0, scope, cards, days: 14, now: NOW })
}

describe('buildReport', () => {
  it('counts empty recalls and recalls whose hits are all unanchored', () => {
    const r = report(
      [
        rec([]),
        rec([{ slug: 'a', scope: 'personal', anchored: false }]),
        rec([
          { slug: 'a', scope: 'personal', anchored: false },
          { slug: 'b', scope: 'personal', anchored: true },
        ]),
      ],
      ['a', 'b'],
    )
    expect(r.recalls).toBe(3)
    expect(r.empty).toBe(1)
    expect(r.unanchoredOnly).toBe(1)
  })

  it('drops records outside the window and records with no usable timestamp', () => {
    const r = report(
      [rec([], '2026-09-01T00:00:00Z'), rec([]), { hitCount: 0, hits: [] }, { at: 'garbage', hitCount: 0 }],
      [],
    )
    expect(r.recalls).toBe(1)
  })

  it('reports a card as never recalled when only its namesake in another library was returned', () => {
    // The old script matched on slug alone, so this card looked alive.
    const r = report([rec([{ slug: 'shared-name', scope: 'other-lib', anchored: true }])], ['shared-name', 'x'])
    expect(r.neverRecalled).toEqual(['shared-name', 'x'])
  })

  it('treats hits owned by this library as recalled', () => {
    const r = report([rec([{ slug: 'a', scope: 'personal', anchored: true }])], ['a', 'b'])
    expect(r.neverRecalled).toEqual(['b'])
  })

  it('counts hits without a scope as recalled but owned by nobody, and says how many', () => {
    const r = report([rec([{ slug: 'legacy', anchored: false }])], ['legacy', 'b'])
    expect(r.neverRecalled).toEqual(['b'])
    expect(r.unattributedHits).toBe(1)
    expect(r.mostReturned[0]?.key).toBe('*/legacy')
  })

  it('never falls back to the caller scope for unattributed hits', () => {
    const r = report([{ ...rec([{ slug: 'a', anchored: true }]), scope: 'personal' }], ['a'])
    expect(r.mostReturned.map(c => c.key)).toEqual(['*/a'])
  })

  it('breaks down Chinese queries separately', () => {
    const ascii = { ...rec([]), query: { ...query, han: false } }
    const r = report([rec([]), rec([{ slug: 'a', scope: 'personal', anchored: true }]), ascii], ['a'])
    expect(r.han).toEqual({ total: 2, empty: 1 })
  })
})

describe('parseRecords', () => {
  it('skips a truncated tail and non-object lines instead of failing', () => {
    const { records, corrupt } = parseRecords('{"at":"x","hitCount":0}\n[1]\n{"at":"y","hitC\n\n')
    expect(records).toHaveLength(1)
    expect(corrupt).toBe(2)
  })
})

describe('dsh-memex-recall-report', () => {
  function fixture() {
    const home = mkdtempSync(join(tmpdir(), 'dsh-memex-report-home-'))
    const dir = join(home, 'plugins', 'dsh-memex')
    mkdirSync(dir, { recursive: true })
    const rows = [
      rec([{ slug: 'alive', scope: 'personal', anchored: true }]),
      rec([]),
    ]
    writeFileSync(join(dir, 'recall-2026-09.ndjson'), `${rows.map(r => JSON.stringify(r)).join('\n')}\n`)
    writeFileSync(join(dir, 'unrelated.txt'), 'not telemetry')
    const lib = mkdtempSync(join(tmpdir(), 'dsh-memex-report-lib-'))
    mkdirSync(join(lib, 'cards'))
    for (const slug of ['alive', 'dead']) writeFileSync(join(lib, 'cards', `${slug}.md`), `---\ntitle: ${slug}\n---\n`)
    return { home, dir, lib }
  }

  function snapshot(root: string): Record<string, string> {
    const out: Record<string, string> = {}
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        const st = statSync(path)
        if (st.isDirectory()) walk(path)
        else out[path] = `${st.size}:${st.mtimeMs}:${readFileSync(path, 'utf8')}`
      }
    }
    walk(root)
    return out
  }

  function run(argv: string[], env: NodeJS.ProcessEnv) {
    let out = ''
    let err = ''
    const code = main(argv, { env, now: NOW, out: t => (out += t), err: t => (err += t) })
    return { code, out, err }
  }

  it('reads telemetry from $DSH_HOME and reports dead cards for the named library', () => {
    const { home, lib } = fixture()
    const { code, out } = run(['--lib', lib, '--scope', 'personal'], { DSH_HOME: home })
    expect(code).toBe(0)
    expect(out).toContain('recalls              2')
    expect(out).toContain('empty results        1 (50%)')
    expect(out).toMatch(/NEVER RECALLED {2}1\/2 cards/)
    expect(out).toContain('    dead')
    expect(out).not.toContain('    alive')
  })

  it('derives the scope from the library directory name by default', () => {
    const { home, lib } = fixture()
    const { out } = run(['--lib', lib], { DSH_HOME: home })
    // The fixture directory is not named "personal", so its hit belongs to another library.
    expect(out).toMatch(/NEVER RECALLED {2}2\/2 cards/)
  })

  it('changes no file in the telemetry directory or the library', () => {
    const { home, lib } = fixture()
    const before = { t: snapshot(home), l: snapshot(lib) }
    run(['--lib', lib, '--scope', 'personal'], { DSH_HOME: home })
    expect(snapshot(home)).toEqual(before.t)
    expect(snapshot(lib)).toEqual(before.l)
  })

  it('does not create the telemetry directory when it is absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-memex-report-empty-'))
    const { code, out } = run([], { DSH_HOME: home })
    expect(code).toBe(0)
    expect(out).toContain('No telemetry yet')
    expect(readdirSync(home)).toEqual([])
  })

  it('rejects unknown flags and bad values with exit code 2', () => {
    expect(run(['--bogus', 'x'], {}).code).toBe(2)
    expect(run(['--days', '0'], {}).code).toBe(2)
    expect(run(['--days'], {}).code).toBe(2)
  })

  it('fails clearly when the library has no cards directory', () => {
    const { home } = fixture()
    const { code, err } = run(['--lib', mkdtempSync(join(tmpdir(), 'no-cards-'))], { DSH_HOME: home })
    expect(code).toBe(2)
    expect(err).toContain('No cards directory')
  })
})
