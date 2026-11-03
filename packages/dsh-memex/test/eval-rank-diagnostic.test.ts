import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { freezeInput } from '../src/eval/freeze.js'
import { buildOfflineReport } from '../src/eval/offline-report.js'
import { registerFixedRound } from '../src/eval/round.js'
import { selftestManifest } from '../src/eval/selftest-manifest.js'
import { freezeSelection } from '../src/eval/selection.js'
import { scoreFrozenItem } from '../src/eval/score-item.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(root) !== realpathSync(tmpdir()) || !basename(root).startsWith('eval-rank-') || realpathSync(root) !== root) throw new Error('Unexpected test cleanup path')
    rmSync(root, { recursive: true, force: true })
  }
})
const own = { scope: 'eval-fictional-repo', home: '/fictional/.dsh-memex/eval-fictional-repo' }
const result = (tool: string, value: unknown, id = 'root:2') => ({ id, tool, text: typeof value === 'string' ? value : JSON.stringify(value) })
const search = (slugs: string[]) => result('memex_search', { current: own, hits: slugs.map(slug => ({ scope: own.scope, slug })) })
const recall = (content: string, mode = 'search') => result('memex_recall', { current: own, mode, content })
function round(results?: unknown, question = 'know') {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-rank-'))
  roots.push(root)
  const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'tested' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const directory = join(root, plan.id, `${question}-mem`)
  mkdirSync(directory)
  freezeInput(join(directory, 'attempt'), { session: 'root', attempt: { ...own, condition: 'mem', cwd: '/fictional/repo' } })
  freezeInput(join(directory, 'program-evidence'), { retrieval: [{ source: 'root:2', tool: 'memex_search', text: 'retryLimit is 4' }], writes: [], sessions: [] })
  if (results !== undefined) freezeInput(join(directory, 'collected-tool-results'), results)
  return { root, plan, directory, report: () => buildOfflineReport(root, plan.id) }
}
function bytes(directory: string): Record<string, string> {
  return Object.fromEntries((readdirSync(directory, { recursive: true }) as string[]).filter(path => /input\.(json|sha256)$/.test(path))
    .map(path => [path, createHash('sha256').update(readFileSync(join(directory, path))).digest('hex')]))
}

describe('固定自检的目标卡召回名次诊断', () => {
  it('目标卡在第二位被记录', async () => {
    const f = round([result('memex_search', { current: own, hits: [
      { scope: 'foreign', slug: 'retry-limit' }, { scope: own.scope, slug: 'other' }, { scope: own.scope, slug: 'retry-limit' },
    ] })])
    freezeSelection(join(f.directory, 'selection'), [{ id: 'root:answer', text: 'retryLimit is 4' }], ['root:answer'])
    await scoreFrozenItem(f.directory, f.plan.items[0]!, f.plan.judge, async () => ({ verdict: 'yes', reason: 'fixed fact', quotes: [{ source: 'root:answer', quote: 'retryLimit is 4' }] }))
    const before = f.report()
    expect(before.markdown).toContain('| know-mem | retry-limit | 已召回 | 2 |')
    expect(before.markdown).toContain('| know-mem | pass | pass | not-applicable | not-applicable | pass |')
    expect(f.report()).toEqual(before)
  })
  it('空 recall 记为未召回', () => {
    const f = round([recall('No cards found.')])
    expect(f.report().markdown).toContain('| know-mem | retry-limit | 未召回 | — |')
  })
  it('空 recall 的 current 不符时为 unknown', () => {
    for (const current of [undefined, { ...own, home: '/other' }, { ...own, scope: 'foreign' }]) {
      for (const evidence of [result('memex_recall', { current, mode: 'search', content: 'No cards found.' }), result('memex_search', { current, hits: [{ scope: own.scope, slug: 'retry-limit' }] })]) {
        const f = round([evidence])
        expect(f.report().markdown).toContain('| know-mem | retry-limit | unknown | unknown |')
      }
    }
  })
  it('其他库的同名卡不算召回', () => {
    const f = round([result('memex_search', { current: own, hits: [{ scope: 'foreign', slug: 'retry-limit' }] })])
    expect(f.report().markdown).toContain('| know-mem | retry-limit | 未召回 | — |')
  })
  it('索引正文中的标题与坏格式', () => {
    for (const evidence of [recall('## retry-limit\nTitle\nText', 'index'), recall('## retry-limit\nTitle\nText', 'list'), result('memex_search', '{bad'),
      result('memex_search', { current: own, hits: [{}] }), recall('unrecognized'), result('memex_search', { current: own, hits: null })]) {
      const f = round([evidence])
      expect(f.report().markdown).toContain('| know-mem | retry-limit | unknown | unknown |')
    }
  })
  it('无记忆与证据缺失分别标注', () => {
    const f = round()
    const before = bytes(join(f.root, f.plan.id)), report = f.report()
    expect(report.markdown).toContain('| know-nomem | retry-limit | N/A | N/A |')
    expect(report.markdown).toContain('| know-mem | retry-limit | unknown | unknown |')
    expect(report.markdown).toContain('| know-mem | pass | unknown | not-applicable | not-applicable | unknown |')
    expect(bytes(join(f.root, f.plan.id))).toEqual(before)
  })
  it('任一次命中取最好名次，未命中且含未知结果保留 unknown', () => {
    expect(round([search(['a', 'b', 'retry-limit']), recall('## retry-limit\nTitle\nText'), result('memex_search', '{bad')]).report().markdown)
      .toContain('| know-mem | retry-limit | 已召回 | 1 |')
    expect(round([search(['a']), recall('No cards found.')]).report().markdown).toContain('| know-mem | retry-limit | 未召回 | — |')
    expect(round([search(['a']), result('memex_search', '{bad')]).report().markdown).toContain('| know-mem | retry-limit | unknown | unknown |')
  })
  it('诊断坏证据不回退到程序摘要，哈希损坏时记 unknown', () => {
    for (const evidence of [[], [result('memex_read', { current: own, slug: 'retry-limit', content: 'retryLimit is 4' })], {}, [null]]) {
      expect(round(evidence).report().markdown).toContain('| know-mem | retry-limit | unknown | unknown |')
    }
    const f = round([search(['retry-limit'])])
    writeFileSync(join(f.directory, 'collected-tool-results', 'input.json'), '[]\n')
    const before = bytes(join(f.root, f.plan.id)), report = f.report()
    expect(report.markdown).toContain('| know-mem | retry-limit | unknown | unknown |')
    expect(report.markdown).toContain('| know-mem | pass | unknown | not-applicable | not-applicable | unknown |')
    expect(bytes(join(f.root, f.plan.id))).toEqual(before)
  })
  it('stale 与 writeback 均诊断原租约目标卡', () => {
    for (const question of ['stale', 'writeback']) {
      expect(round([search(['retry-limit', 'lease-duration'])], question).report().markdown)
        .toContain(`| ${question}-mem | lease-duration | 已召回 | 2 |`)
    }
  })
  it('旧轮次仅凭冻结产物补算', () => {
    // Minimal anonymized collected-tool-results/attempt sample from historical
    // round-34bbf914, with the existing round constructor supplying frozen inputs.
    // The report has no Host logs, library or source session to consult.
    const f = round([recall('## retry-limit\nFictional Lantern retry limit\nFictional Lantern permits four retries.\n\n## lease-duration\nFictional Lantern lease duration\nPreviously a 15-second lease.\n')])
    const before = bytes(join(f.root, f.plan.id)), manifest = structuredClone(selftestManifest)
    expect(f.report().markdown).toContain('| know-mem | retry-limit | 已召回 | 1 |')
    expect(bytes(join(f.root, f.plan.id))).toEqual(before)
    expect(selftestManifest).toEqual(manifest)
  })
})
