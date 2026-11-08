import { expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import oracle from './fixtures/routing-oracle-0.4.2.json' with { type: 'json' }

const pkg = resolve(import.meta.dirname, '..')
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

it('spec Scenario "内置预设满足注册表约束"', async () => {
  const { PRESETS, DEFAULT_PRESET_ID } = await import('../src/presets/index.js')
  expect(PRESETS.map(p => p.id)).toEqual(['reasoning-depth', 'effort-as-verification'])
  expect(PRESETS.find(p => p.id === 'effort-as-verification')?.context).toEqual(['execution'])
  expect(DEFAULT_PRESET_ID).toBe('reasoning-depth')
  expect(PRESETS.find(p => p.id === 'reasoning-depth')!.context).toEqual([])
  const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0
  for (const p of PRESETS) {
    expect(existsSync(join(pkg, 'src/presets', p.id, 'rubric.json')), p.id).toBe(true)
    expect(p.rubric, p.id).toEqual(JSON.parse(readFileSync(join(pkg, 'src/presets', p.id, 'rubric.json'), 'utf8')))
    expect(Object.keys(p.rubric).sort()).toEqual(['capability', 'depth'])
    for (const q of [p.rubric.capability, p.rubric.depth]) { expect(q.type).toBe('choice'); expect(nonEmpty(q.instructions)).toBe(true) }
    expect(Object.keys(p.rubric.capability.criteria).sort()).toEqual(['analytical', 'bounded', 'frontier', 'insufficient_context'])
    expect(Object.keys(p.rubric.depth.criteria).sort()).toEqual(['baseline', 'higher', 'lower'])
    for (const c of [...Object.values(p.rubric.capability.criteria), ...Object.values(p.rubric.depth.criteria)]) expect(nonEmpty(c)).toBe(true)
    expect(p.context.every(c => c === 'execution')).toBe(true)
    for (const text of [p.title, p.summary, p.evidence]) { expect(nonEmpty(text.zh)).toBe(true); expect(nonEmpty(text.en)).toBe(true) }
    expect(p.sources.length).toBeGreaterThan(0)
    for (const s of p.sources) { expect(s.url.startsWith('https://')).toBe(true); expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/) }
  }
  expect(new Set(PRESETS.map(p => p.id)).size).toBe(PRESETS.length)
})

it('spec Scenario "约束检查能发现不合格预设"', async () => {
  const { PRESETS, presetIssues } = await import('../src/presets/index.js')
  const base = PRESETS[0]!
  const withRubric = (id: string, edit: (r: any) => void) => { const rubric = structuredClone(base.rubric) as any; edit(rubric); return { ...base, id, rubric } }
  const cases: [unknown[], string, string][] = [
    [[{ ...base, id: 'dup' }, { ...base, id: 'dup' }], 'dup', 'id'],
    [[withRubric('extra-max', r => { r.depth.criteria.max = 'x' })], 'extra-max', 'depth'],
    [[withRubric('no-ic', r => { delete r.capability.criteria.insufficient_context })], 'no-ic', 'capability'],
    [[withRubric('blank-higher', r => { r.depth.criteria.higher = '  ' })], 'blank-higher', 'higher'],
    [[{ ...base, id: 'bad-context', context: ['history'] }], 'bad-context', 'context'],
    [[{ ...base, id: 'no-sources', sources: [] }], 'no-sources', 'sources'],
  ]
  expect(presetIssues(PRESETS)).toEqual([])
  for (const [list, id, field] of cases) {
    const issues = presetIssues(list as never)
    expect(issues.length, id).toBeGreaterThan(0)
    expect(issues.some(i => i.includes(id) && i.includes(field)), `${id}: ${issues.join('; ')}`).toBe(true)
  }
})

/**
 * Published judgement content. Entries are READ-ONLY: never edit an existing row; to change how a
 * preset judges, add a new preset id and append its row (see docs/presets/README.md).
 */
const LOCK: Record<string, { rubricSha256: string; context: readonly string[] }> = {
  'reasoning-depth': { rubricSha256: oracle.rubricSha256, context: [] },
  'effort-as-verification': { rubricSha256: '18e7013c737b6d3c37e1eeb0cbc69c746c6c648ab41be08eae565833a47c28a6', context: ['execution'] },
}
interface LockEntry { id: string; rubricBytes: Buffer; context: readonly string[] }
function lockDrift(entries: readonly LockEntry[], lock: typeof LOCK): string[] {
  const issues: string[] = []
  for (const e of entries) {
    const row = lock[e.id]
    if (!row) { issues.push(`${e.id}: not in lock table`); continue }
    if (createHash('sha256').update(e.rubricBytes).digest('hex') !== row.rubricSha256) issues.push(`${e.id}: rubric drifted`)
    if (JSON.stringify(e.context) !== JSON.stringify(row.context)) issues.push(`${e.id}: context drifted`)
  }
  for (const id of Object.keys(lock)) if (!entries.some(e => e.id === id)) issues.push(`${id}: locked but not registered`)
  return issues
}
const entriesOf = async () => (await import('../src/presets/index.js')).PRESETS.map(p => ({ id: p.id, rubricBytes: readFileSync(join(pkg, 'src/presets', p.id, 'rubric.json')), context: p.context }))

it('spec Scenario "内置预设与锁定表一致"', async () => {
  const entries = await entriesOf()
  expect(lockDrift(entries, LOCK)).toEqual([])
  expect(LOCK['reasoning-depth']!.rubricSha256).toBe(oracle.rubricSha256)
  expect(Object.keys(LOCK).sort()).toEqual(entries.map(e => e.id).sort())
})

it('spec Scenario "内容漂移使锁定测试失败"', async () => {
  const entries = await entriesOf()
  const tampered = entries.map(e => e.id === 'reasoning-depth' ? { ...e, rubricBytes: Buffer.concat([e.rubricBytes, Buffer.from(' ')]) } : e)
  expect(lockDrift(tampered, LOCK).some(i => i.includes('reasoning-depth') && i.includes('rubric'))).toBe(true)
  const target = entries.find(e => e.id === 'effort-as-verification')!
  expect(target).toBeDefined()
  expect(lockDrift(entries.map(e => e === target ? { ...e, context: [] } : e), LOCK).some(i => i.includes(target.id) && i.includes('context'))).toBe(true)
  const readme = join(pkg, 'docs/presets/README.md')
  expect(existsSync(readme)).toBe(true)
  expect(readFileSync(readme, 'utf8')).toContain('只能追加新 id')
})

it('spec Scenario "新预设文本含关键分界"', async () => {
  const p = (await import('../src/presets/index.js')).resolvePreset('effort-as-verification')
  expect(p.id).toBe('effort-as-verification')
  const r = JSON.parse(readFileSync(join(pkg, 'src/presets/effort-as-verification/rubric.json'), 'utf8'))
  expect(p.rubric).toEqual(r)
  expect(r.depth.instructions).toContain('does not fix choosing the wrong approach')
  expect(r.depth.instructions).toContain('Execution')
  expect(r.depth.instructions).toContain('does not prove whether anyone reviews')
  expect(JSON.stringify(r)).not.toContain('a user reads and steers each reply')
  expect(r.depth.criteria.higher).toContain('edge cases')
  expect(r.depth.criteria.higher).toContain('review')
  expect(r.depth.criteria.lower).toContain('brainstorming')
  expect(r.capability.instructions).toContain('wrong approach')
  expect(p.evidence.en).toContain('GPT')
})

it('spec Scenario "缺省预设与变更前规则逐字节相同"', () => {
  expect(sha(join(pkg, 'src/presets/reasoning-depth/rubric.json'))).toBe(oracle.rubricSha256)
  expect(existsSync(join(pkg, 'src/rubric.json'))).toBe(false)
})

it('spec Scenario "每个内置预设都有文档"', async () => {
  const { PRESETS } = await import('../src/presets/index.js')
  const missing = PRESETS.map(p => `docs/presets/${p.id}.md`).filter(f => !existsSync(join(pkg, f)))
  expect(missing).toEqual([])
})
