import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { freezeRetrieval, readFrozenRetrieval, recomputeRetrieval, returnedCharacters, writeRetrievalReport, type FrozenRetrieval } from '../src/eval/retrieval/freeze.js'
import { computeRetrievalReport } from '../src/eval/retrieval/metrics.js'
import { parseSearch } from '../src/run/parse.js'
import * as kernel from '../src/run/kernel.js'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function root(): string { const path = mkdtempSync(join(realpathSync(tmpdir()), 'retrieval-freeze-')); roots.push(path); return path }
function fixture(count = 2): FrozenRetrieval {
  return {
    version: 'retrieval-v1', kernelVersion: '0.4.1', config: { nestedSlugs: true }, queryPreprocessingVersion: 'han-bigram-v1', limit: 10,
    exclusions: { categories: ['eval', 'handoff'], prefixes: ['probe-'], slugs: ['excluded'] }, manifest: [{ path: 'cards/A.md', sha256: 'a'.repeat(64) }], manifestHash: 'b'.repeat(64),
    questions: Array.from({ length: count }, (_, i) => ({ id: String(i), query: 'fixture', targets: ['A'], type: 'single-hop', topic: String(i), origin: 'fixture', set: 'dev' })),
    observations: Array.from({ length: count }, (_, i) => ({ id: String(i), slugs: ['D', 'A'], status: 'ok', error: null, elapsedMs: i + 1, returnedChars: 7 })),
    distractors: [{ slug: 'D', sha256: 'c'.repeat(64) }], integrity: { before: { valid: true, differences: [] }, after: { valid: true, differences: [] } }, status: 'ok',
    costs: { kernelInstallationBytes: 123, snapshotBytes: 456, quantileVersion: 'nearest-rank-v1', characterCountVersion: 'chars-v1' },
  }
}

describe('冻结观测与离线重算', () => {
  it('删除快照并换环境后离线重算一致', () => {
    const runDir = root()
    const snapshot = join(runDir, 'snapshot'); mkdirSync(snapshot)
    const installation = join(runDir, 'installation'); mkdirSync(installation)
    const frozen = fixture()
    freezeRetrieval(runDir, frozen)
    const original = writeRetrievalReport(runDir, frozen)
    expect(original.report.exclusions.slugs).toEqual(['excluded'])
    expect(original.report.manifestHash).toBe(frozen.manifestHash)
    expect(readFileSync(original.markdownPath, 'utf8')).toContain('excluded')
    expect(readFileSync(original.markdownPath, 'utf8')).toContain(frozen.manifestHash)
    const originalBytes = readFileSync(original.jsonPath)
    const originalMarkdown = readFileSync(original.markdownPath)
    // All targets are verified children of this test's freshly created root.
    rmSync(snapshot, { recursive: true }); renameSync(installation, join(runDir, 'unavailable'))
    const spy = vi.spyOn(kernel, 'runKernel').mockRejectedValue(new Error('kernel must remain offline'))
    const result = recomputeRetrieval(runDir)
    expect(result.report).toEqual(original.report)
    expect(result.jsonPath).not.toBe(original.jsonPath)
    expect(readFileSync(original.jsonPath)).toEqual(originalBytes)
    expect(readFileSync(original.markdownPath)).toEqual(originalMarkdown)
    expect(spy).not.toHaveBeenCalled()
    expect(readFrozenRetrieval(runDir)).toEqual(frozen)
    expect(statSync(join(runDir, 'frozen.json')).mode & 0o777).toBe(0o600)
    expect(() => freezeRetrieval(runDir, fixture())).toThrow()
    expect(() => writeRetrievalReport(runDir, fixture())).toThrow()
    const holdout = root(); const data = { ...fixture(), questions: fixture().questions.map(q => ({ ...q, set: 'holdout' as const })) }
    freezeRetrieval(holdout, data)
    expect(writeRetrievalReport(holdout, data).jsonPath).toContain('holdout')
  })

  it('中途出错的题保留在分母', () => {
    const data = fixture(5)
    const observations = data.observations.map((o, i) => i === 2 ? { ...o, slugs: [], status: 'error' as const, error: 'unparseable', returnedChars: 'unknown' as const } : o)
    const runDir = root(); const frozen = { ...data, observations, status: 'incomplete' as const }
    freezeRetrieval(runDir, frozen)
    const report = recomputeRetrieval(runDir).report
    expect(report.status).toBe('incomplete')
    expect(report.validBaseline).toBe(false)
    expect(report.overall).toMatchObject({ count: 5, top3: 0.8, emptyRate: 0, emptyCount: 0 })
    expect(report.errors).toEqual([{ id: '2', error: 'unparseable' }])
  })

  it('返回字符数按协议计算', () => {
    const data = fixture()
    const chars = returnedCharacters([{ title: 'ab', summary: '中文' }, { title: 'c', summary: '' }])
    expect(chars).toBe(7)
    const hits = parseSearch('## unicode\n😀\n多行\nLinks: first paragraph\n附加行\n> Matched: metadata removed\nLinks: [[link]]')
    expect(returnedCharacters(hits)).toBe([...('😀\n多行\nLinks: first paragraph\n附加行\nLinks: [[link]]')].length)
    const report = computeRetrievalReport({ ...data, observations: [{ ...data.observations[0]!, returnedChars: chars }, { ...data.observations[1]!, slugs: [], status: 'error', error: 'timeout', returnedChars: 'unknown' }] })
    expect(report.costs).toMatchObject({ returnedCharsMedian: 7, returnedCharsCount: 1 })
  })

  it('invalid 轮次删除快照后重算仍为 invalid', () => {
    const runDir = root(); const data = fixture()
    freezeRetrieval(runDir, { ...data, status: 'invalid', integrity: { ...data.integrity, after: { valid: false, differences: ['cards/A.md', 'cards/new.md'] } } })
    const report = recomputeRetrieval(runDir).report
    expect(report.status).toBe('invalid')
    expect(report.integrity.after.differences).toEqual(['cards/A.md', 'cards/new.md'])
    expect(report.overall).toMatchObject({ top1: 'unknown', top3: 'unknown', top10: 'unknown', mrr: 'unknown', emptyRate: 'unknown', misselectionRate: 'unknown' })
    expect(report.validBaseline).toBe(false)
    expect(readFileSync(readdirSync(runDir).filter(f => f.endsWith('.md')).map(f => join(runDir, f))[0]!, 'utf8')).toContain('cards/A.md')
  })

  it('干扰卡计数可离线重算', () => {
    const registered = root(); const ordinary = root()
    freezeRetrieval(registered, fixture(1)); freezeRetrieval(ordinary, { ...fixture(1), distractors: [] })
    const first = recomputeRetrieval(registered).report; const second = recomputeRetrieval(ordinary).report
    expect(first.overall.misselectionRate).toBe(second.overall.misselectionRate)
    expect(first.overall.distractorFirstCount).toBe(1)
    expect(second.overall.distractorFirstCount).toBe(0)
  })

  it('冻结观测被篡改则拒绝重算', () => {
    const runDir = root(); freezeRetrieval(runDir, fixture())
    const path = join(runDir, 'frozen.json')
    const content = JSON.parse(readFileSync(path, 'utf8'))
    content.data.manifestHash = 'changed'; writeFileSync(path, JSON.stringify(content))
    const before = readdirSync(runDir)
    expect(() => recomputeRetrieval(runDir)).toThrow(/hash/i)
    expect(readdirSync(runDir)).toEqual(before)
  })

  it('未知协议版本拒绝重算', () => {
    const runDir = root()
    const data = { ...fixture(), version: 'retrieval-v999' }
    writeFileSync(join(runDir, 'frozen.json'), JSON.stringify({ data, sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') }))
    expect(() => recomputeRetrieval(runDir)).toThrow(/retrieval-v999/)
    expect(readdirSync(runDir)).toEqual(['frozen.json'])
  })
})
