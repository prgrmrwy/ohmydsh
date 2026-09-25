import { chmodSync, mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { anchored, buildRecord, queryShape } from '../src/telemetry/record.js'
import { appendRecord, resetFailureLatch, telemetryDir, telemetryFile } from '../src/telemetry/sink.js'

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
})
