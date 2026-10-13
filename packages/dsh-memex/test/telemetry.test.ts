import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { anchored, buildRecord, explainHit, queryShape } from '../src/telemetry/record.js'
import { appendRecord, appendWriteEvent, resetFailureLatch, telemetryDir, telemetryFile, writeEventFile } from '../src/telemetry/sink.js'
import { cardFacts, librarySnapshot } from '../src/telemetry/snapshot.js'

afterEach(() => { resetFailureLatch() })

describe('anchored', () => {
  it('treats a slug segment match as anchored', () => {
    expect(anchored(['proxy'], 'dsh-proxy-model-differs-by-seam', 'DSH 出站代理')).toBe(true)
    expect(anchored(['hardlink'], 'pnpm-file-deploy-hardlink-manifest-is-live', 'pnpm 硬链接')).toBe(true)
  })

  it('treats Han tokens as substrings, matching the kernel', () => {
    expect(anchored(['会话', '归档'], 'dsh-session-archive-attached-guard', 'DSH 会话归档物理删除可用')).toBe(true)
  })

  it('rejects a bigram that only occurs in body text', () => {
    // 不能 is exactly the cross-word-boundary noise CJK segmentation produces.
    expect(anchored(['不能'], 'removal-judgments-need-full-semantic-coverage', '判定官方已支持必须覆盖全部语义')).toBe(false)
  })

  it('requires a whole segment for ASCII, not a substring', () => {
    // "prox" must not match the "proxy" segment: the kernel compares segments.
    expect(anchored(['prox'], 'dsh-proxy-model', 'Proxy model')).toBe(false)
  })

  it('ignores empty tokens', () => {
    expect(anchored([''], 'any-slug', 'Any title')).toBe(false)
  })
})

describe('queryShape', () => {
  it('keeps only counts and flags, never the text', () => {
    const shape = queryShape(['子进', '进程'], { han: true, segmented: true, semantic: false })
    expect(shape).toEqual({ tokens: 2, han: true, segmented: true, semantic: false })
  })
})

describe('record contents', () => {
  it('never carries the query text or card bodies', () => {
    // A distinctive marker: if any part of the query could leak, it shows here.
    const marker = 'SUPERSECRETQUERYMARKER'
    const record = buildRecord({
      at: new Date('2026-09-23T10:00:00Z'),
      scope: 'personal',
      query: queryShape([marker, 'x'], { han: false, segmented: false, semantic: false }),
      hits: [{ slug: 'some-card', scope: 'personal', anchored: true }],
    })
    expect(JSON.stringify(record)).not.toContain(marker)
    expect(record.hitCount).toBe(1)
  })

  it('reports an empty recall as hitCount 0', () => {
    const record = buildRecord({
      at: new Date('2026-09-23T10:00:00Z'),
      scope: 'personal',
      query: queryShape(['x'], { han: false, segmented: false, semantic: false }),
      hits: [],
    })
    expect(record.hitCount).toBe(0)
  })
})

describe('sink', () => {
  function home(): { env: NodeJS.ProcessEnv; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-memex-telemetry-'))
    return { env: { DSH_HOME: dir }, dir }
  }

  const sample = buildRecord({
    at: new Date('2026-09-23T10:00:00Z'),
    scope: 'personal',
    query: queryShape(['a'], { han: false, segmented: false, semantic: false }),
    hits: [{ slug: 'card-one', scope: 'personal', anchored: true }],
  })

  it('writes newline-delimited JSON under the plugin state root', () => {
    const { env } = home()
    appendRecord(sample, { env })
    appendRecord(sample, { env })
    const lines = readFileSync(telemetryFile(new Date(sample.at), env), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(JSON.parse(line).scope).toBe('personal')
  })

  it('resolves inside the DSH home, never inside a library', () => {
    const { env, dir } = home()
    expect(telemetryDir(env)).toBe(join(dir, 'plugins', 'dsh-memex'))
    expect(telemetryDir(env)).not.toContain('.dsh-memex')
  })

  it('swallows write failures and reports them only once', () => {
    const { env, dir } = home()
    chmodSync(dir, 0o500) // read-only: mkdir of plugins/ must fail
    const onFirstFailure = vi.fn()
    expect(() => {
      appendRecord(sample, { env, onFirstFailure })
      appendRecord(sample, { env, onFirstFailure })
      appendRecord(sample, { env, onFirstFailure })
    }).not.toThrow()
    expect(onFirstFailure).toHaveBeenCalledTimes(1)
    chmodSync(dir, 0o700)
    expect(existsSync(telemetryFile(new Date(sample.at), env))).toBe(false)
  })

  it('writes card-write events to their own monthly file, never into the recall log', () => {
    const { env } = home()
    const at = new Date('2026-10-12T10:00:00Z')
    appendWriteEvent({ at: at.toISOString(), scope: 'personal', slug: 'card-one', kind: 'created', hash: 'abc', session: 's', call: 'c' }, { env })
    expect(writeEventFile(at, env)).toBe(join(telemetryDir(env), 'writes-2026-10.ndjson'))
    expect(JSON.parse(readFileSync(writeEventFile(at, env), 'utf8').trim())).toMatchObject({ slug: 'card-one', kind: 'created' })
    expect(existsSync(telemetryFile(at, env))).toBe(false)
  })

  it('swallows write-event failures too', () => {
    const { env, dir } = home()
    chmodSync(dir, 0o500)
    expect(() => appendWriteEvent({ at: new Date().toISOString(), scope: 'p', slug: 's', kind: 'created' }, { env })).not.toThrow()
    chmodSync(dir, 0o700)
  })
})

describe('hit explanation', () => {
  const card = [
    '---',
    'title: "DSH 出站代理模型"',
    'tags: [proxy, network]',
    'category: architecture',
    'modified: 2026-10-01',
    '---',
    'Intro paragraph mentions subprocess.',
    '',
    '## Inherit rules',
    'See [[child-env-scrub]] for 子进程 details.',
    '',
  ].join('\n')

  it('reports, per query-token index, the highest-weight field it matched', () => {
    const explained = explainHit(['proxy', 'inherit', 'scrub', 'subprocess', 'absent'], 'dsh-proxy-model', card)
    expect(explained).toEqual([
      { t: 0, f: 'slug', w: 5 },
      { t: 1, f: 'headings', w: 3 },
      { t: 2, f: 'wikilinks', w: 2 },
      { t: 3, f: 'body', w: 1 },
    ])
  })

  it('takes tags and category from the frontmatter', () => {
    expect(explainHit(['network', 'architecture'], 'x', card)).toEqual([
      { t: 0, f: 'tags', w: 4 },
      { t: 1, f: 'category', w: 3 },
    ])
  })

  it('compares Han tokens as substrings and ASCII tokens as whole segments', () => {
    expect(explainHit(['出站', '子进'], 'x', card)).toEqual([
      { t: 0, f: 'title', w: 5 },
      { t: 1, f: 'body', w: 1 },
    ])
    expect(explainHit(['prox'], 'dsh-proxy-model', card)).toEqual([])
  })

  it('never carries the tokens themselves', () => {
    const marker = 'zzmarkerzz'
    expect(JSON.stringify(explainHit([marker, 'proxy'], `${marker}-card`, card))).not.toContain(marker)
  })
})

describe('card facts', () => {
  function library(): string {
    const home = mkdtempSync(join(tmpdir(), 'dsh-memex-lib-'))
    mkdirSync(join(home, 'cards'))
    return home
  }

  it('reads a content hash and the modified date from the card file', () => {
    const home = library()
    writeFileSync(join(home, 'cards', 'one.md'), '---\ntitle: One\nmodified: 2026-10-01\n---\nBody\n')
    const facts = cardFacts(home, 'one')
    expect(facts?.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(facts?.modified).toBe('2026-10-01')
    expect(facts?.content).toContain('Body')
    writeFileSync(join(home, 'cards', 'one.md'), '---\ntitle: One\nmodified: 2026-10-02\n---\nChanged\n')
    expect(cardFacts(home, 'one')?.hash).not.toBe(facts?.hash)
  })

  it('omits modified when the frontmatter has none', () => {
    const home = library()
    writeFileSync(join(home, 'cards', 'two.md'), '---\ntitle: Two\n---\nBody\n')
    expect(cardFacts(home, 'two')).not.toHaveProperty('modified')
  })

  it('returns undefined for a missing card instead of throwing', () => {
    expect(cardFacts(library(), 'missing')).toBeUndefined()
  })

  it('refuses a slug that would escape the cards directory', () => {
    const home = library()
    writeFileSync(join(home, 'secret.md'), 'outside')
    expect(cardFacts(home, '../secret')).toBeUndefined()
  })
})

describe('library snapshot', () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()
  }

  function repo(): string {
    const home = mkdtempSync(join(tmpdir(), 'dsh-memex-snap-'))
    mkdirSync(join(home, 'cards'))
    writeFileSync(join(home, 'cards', 'a.md'), 'a\n')
    git(home, 'init', '-q')
    git(home, 'add', '.')
    git(home, 'commit', '-q', '-m', 'init')
    return home
  }

  it('records HEAD and a clean worktree', () => {
    const home = repo()
    expect(librarySnapshot('personal', home)).toEqual({ scope: 'personal', commit: git(home, 'rev-parse', 'HEAD'), dirty: false })
  })

  it('reports uncommitted changes as dirty', () => {
    const home = repo()
    writeFileSync(join(home, 'cards', 'b.md'), 'b\n')
    expect(librarySnapshot('personal', home)).toMatchObject({ dirty: true })
  })

  it('ignores untracked files outside cards/, such as the kernel state directory', () => {
    const home = repo()
    mkdirSync(join(home, '.memex'))
    writeFileSync(join(home, '.memex', 'state'), 'x')
    expect(librarySnapshot('personal', home)).toMatchObject({ dirty: false })
  })

  it('marks a non-git directory as unknown', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-memex-nogit-'))
    expect(librarySnapshot('personal', home)).toEqual({ scope: 'personal', commit: 'unknown' })
  })

  it('leaves the repository untouched', () => {
    const home = repo()
    writeFileSync(join(home, 'cards', 'b.md'), 'b\n')
    const before = { status: git(home, 'status', '--porcelain'), files: readdirSync(join(home, '.git')).sort() }
    librarySnapshot('personal', home)
    expect({ status: git(home, 'status', '--porcelain'), files: readdirSync(join(home, '.git')).sort() }).toEqual(before)
  })
})
