import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sessionIdentityHash } from '../src/eval/filter.js'
import { main } from '../src/cli/recall-report.js'
import { buildReport, parseRecords, renderReport, type StoredRecord } from '../src/telemetry/report.js'

const NOW = new Date('2026-09-24T12:00:00Z')
const query = { tokens: 2, han: true, segmented: true, semantic: false }

function rec(hits: StoredRecord['hits'], at = '2026-09-24T10:00:00Z'): StoredRecord {
  return { at, scope: 'caller', query, hitCount: hits?.length ?? 0, hits }
}

function report(records: StoredRecord[], cards: string[], scope = 'personal') {
  return buildReport({ records, corruptLines: 0, scope, cards, days: 14, now: NOW })
}

describe('buildReport', () => {
  it('excludes registered eval telemetry hashes without rehashing and legacy eval scopes', () => {
    const result = buildReport({ records: [
      { ...rec([]), session: sessionIdentityHash('eval') },
      { ...rec([]), scope: 'eval-123-repo' },
      { ...rec([]), session: sessionIdentityHash('daily') },
    ], evalRegistry: JSON.stringify({ round: 'round-test', role: 'created', sessionHash: sessionIdentityHash('eval') }), corruptLines: 0, scope: 'personal', cards: [], days: 14, now: NOW })
    expect(result.recalls).toBe(1)
  })
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

  it('EVAL-053: 跨库命中不被误归属', () => {
    const r = report([rec([{ slug: 'retry-limit', scope: 'other-lib', anchored: true }])], ['retry-limit'])
    expect(r.neverRecalled).toEqual(['retry-limit'])
  })
  it('EVAL-054: 旧记录被计入但不归属', () => {
    const r = report([rec([{ slug: 'legacy-card', anchored: true } as never])], ['legacy-card', 'untouched'])
    expect(r.neverRecalled).toEqual(['untouched'])
    expect(r.unattributedHits).toBe(1)
    expect(renderReport(r, '/lib')).toContain('hits without a scope 1')
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

  it('reads the registry in the real CLI path and keeps files unchanged', () => {
    const { home, dir, lib } = fixture()
    const lines = [rec([]), { ...rec([]), session: sessionIdentityHash('registered-eval') }]
    writeFileSync(join(dir, 'recall-2026-09.ndjson'), lines.map(row => JSON.stringify(row)).join('\n') + '\n')
    writeFileSync(join(dir, 'eval-registry.ndjson'), JSON.stringify({ round: 'round-test', role: 'created', sessionHash: sessionIdentityHash('registered-eval') }) + '\n')
    const before = snapshot(home)
    const result = run(['--lib', lib], { DSH_HOME: home })
    expect(result.out).toContain('recalls              1')
    expect(result.err).toBe('')
    expect(snapshot(home)).toEqual(before)
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

  it('EVAL-051: 部署后可在本机运行', () => {
    const { home, lib } = fixture()
    const other = mkdtempSync(join(tmpdir(), 'dsh-memex-report-other-'))
    expect(run(['--lib', lib, '--scope', 'personal'], { DSH_HOME: home }).out).toContain('recalls              2')
    expect(run(['--lib', lib, '--scope', 'personal'], { DSH_HOME: other }).out).toContain(`No telemetry yet at ${join(other, 'plugins', 'dsh-memex')}`)
  })

  it('EVAL-052: 运行不改变任何文件', () => {
    const { home, dir, lib } = fixture()
    writeFileSync(join(dir, 'eval-registry.ndjson'), JSON.stringify({ round: 'round-test', role: 'created', sessionHash: sessionIdentityHash('x') }) + '\n')
    const before = { telemetry: snapshot(dir), registry: readFileSync(join(dir, 'eval-registry.ndjson'), 'utf8'), library: snapshot(lib) }
    expect(run(['--lib', lib, '--scope', 'personal'], { DSH_HOME: home }).code).toBe(0)
    expect(snapshot(dir)).toEqual(before.telemetry)
    expect(readFileSync(join(dir, 'eval-registry.ndjson'), 'utf8')).toBe(before.registry)
    expect(snapshot(lib)).toEqual(before.library)
  })

  it('EVAL-055: 默认排除已登记的测试会话', () => {
    const { home, dir, lib } = fixture()
    const rows = [
      ...Array.from({ length: 50 }, () => ({ ...rec([]), session: sessionIdentityHash('daily') })),
      ...Array.from({ length: 30 }, () => ({ ...rec([]), session: sessionIdentityHash('registered-eval') })),
    ]
    writeFileSync(join(dir, 'recall-2026-09.ndjson'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    writeFileSync(join(dir, 'eval-registry.ndjson'), JSON.stringify({ round: 'round-test', role: 'created', sessionHash: sessionIdentityHash('registered-eval') }) + '\n')
    const { code, out } = run(['--lib', lib, '--scope', 'personal'], { DSH_HOME: home })
    expect(code).toBe(0)
    expect(out).toContain('recalls              50')
    expect(out).toContain('excluded eval recalls 30')
  })

  it('EVAL-056: 登记缺失时按 scope 名排除', () => {
    const { home, dir, lib } = fixture()
    const rows = [...Array.from({ length: 5 }, () => ({ ...rec([]), scope: 'eval-nexus' })), rec([])]
    writeFileSync(join(dir, 'recall-2026-09.ndjson'), rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    const { code, out } = run(['--lib', lib, '--scope', 'personal'], { DSH_HOME: home })
    expect(code).toBe(0)
    expect(out).toContain('recalls              1')
    expect(out).toContain('excluded eval recalls 5')
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

  it('reads records carrying the reuse-evidence fields alongside old ones, and ignores write events', () => {
    const { home, dir, lib } = fixture()
    const rich = {
      ...rec([{ slug: 'alive', scope: 'personal', anchored: true, rank: 1, hash: '0123456789abcdef', modified: '2026-10-01', explain: [{ t: 0, f: 'slug', w: 5 }] }]),
      libraries: [{ scope: 'personal', commit: 'abc', dirty: false }],
      session: 'fedcba9876543210',
      call: 'call-1',
      intent: 'gap',
    }
    writeFileSync(join(dir, 'recall-2026-09.ndjson'), `${JSON.stringify(rich)}\n`, { flag: 'a' })
    writeFileSync(join(dir, 'writes-2026-09.ndjson'), `${JSON.stringify({ at: '2026-09-24T10:00:00Z', scope: 'personal', slug: 'dead', kind: 'created' })}\n`)
    const { code, out } = run(['--lib', lib, '--scope', 'personal'], { DSH_HOME: home })
    expect(code).toBe(0)
    expect(out).toContain('recalls              3')
    expect(out).toContain('    dead')
  })

  it('fails clearly when the library has no cards directory', () => {
    const { home } = fixture()
    const { code, err } = run(['--lib', mkdtempSync(join(tmpdir(), 'no-cards-'))], { DSH_HOME: home })
    expect(code).toBe(2)
    expect(err).toContain('No cards directory')
  })
})
