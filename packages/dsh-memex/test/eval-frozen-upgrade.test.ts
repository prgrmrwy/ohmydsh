import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, realpathSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
const upgrade = vi.hoisted(() => ({ prompts: false, packagedReads: 0 }))
vi.mock('../src/eval/fixtures.js', async original => {
  const actual = await original<typeof import('../src/eval/fixtures.js')>()
  return { ...actual, validateFixture: (...args: Parameters<typeof actual.validateFixture>) => { upgrade.packagedReads++; return actual.validateFixture(...args) } }
})
vi.mock('../src/eval/judge-protocol.js', async original => {
  const actual = await original<typeof import('../src/eval/judge-protocol.js')>()
  return { ...actual, frozenItemProtocols: (...args: Parameters<typeof actual.frozenItemProtocols>) => actual.frozenItemProtocols(...args).map(protocol => {
    if (upgrade.prompts) {
      const input = JSON.parse(protocol.prompt)
      input.rubric = 'Next release wording, not the historical wording.'
      if (input.writeback) input.writeback.rubric = 'Next release writeback wording.'
      protocol.prompt = JSON.stringify(input)
    }
    return protocol
  }) }
})
import { freezeInput, readFrozenInput } from '../src/eval/freeze.js'
import { selftestManifest } from '../src/eval/selftest-manifest.js'
import { registerFixedRound, loadFixedRound } from '../src/eval/round.js'
import { freezeSelection } from '../src/eval/selection.js'
import { scoreFrozenItem } from '../src/eval/score-item.js'
import { loadOfflineOutcomes } from '../src/eval/offline-outcomes.js'
import { buildOfflineReport } from '../src/eval/offline-report.js'
const published = structuredClone(selftestManifest)
afterEach(() => { upgrade.prompts = false; Object.assign(selftestManifest, structuredClone(published)) })
function root() { return mkdtempSync(join(realpathSync(tmpdir()), 'eval-frozen-upgrade-')) }
function registered() {
  const directory = root()
  const plan = registerFixedRound(directory, { version: 'selftest-v1', tested: { provider: 'mock', model: 'tested', effort: 'low' }, judge: { provider: 'mock', model: 'judge', effort: 'high' }, maxJudgeCalls: 12 })
  return { root: directory, plan }
}
async function scored(writeback = false) {
  const f = registered(), item = f.plan.items[writeback ? 4 : 0]!, directory = join(f.root, f.plan.id, item.id)
  freezeInput(directory, {})
  freezeSelection(join(directory, 'selection'), [{ id: 'root:answer', text: item.requiredFacts.join('; ') }], ['root:answer'])
  if (writeback) freezeInput(join(directory, 'program-evidence'), { retrieval: [], writes: [{ source: 'root:4', tool: 'memex_retro', at: 10, success: true, targetCorrect: true, slug: 'lease', content: item.requiredFacts.join('; ') }], sessions: [] })
  await scoreFrozenItem(directory, item, f.plan.judge, async () => ({ verdict: 'yes', reason: 'historical result', quotes: [{ source: 'root:answer', quote: item.requiredFacts[0] }],
    ...(writeback ? { writeback: { verdict: 'yes', reason: 'historical write', quotes: [{ source: 'root:4:write', quote: item.requiredFacts[0] }] } } : {}) }))
  return { ...f, item, directory }
}
function copied(f: ReturnType<typeof registered>, change: (value: any) => void) {
  const value = structuredClone(readFrozenInput(join(f.root, f.plan.id))) as any
  change(value)
  const directory = root(); freezeInput(join(directory, f.plan.id), value)
  return directory
}
function resource(value: any, path: string, bytes: Buffer) {
  value.resources[path] = bytes.toString('base64')
  Object.assign(value.manifest.find((entry: any) => entry.path === path), { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
it('rebuilds the identical old report after a published manifest upgrade, but execution refuses it', async () => {
  const f = await scored(), before = buildOfflineReport(f.root, f.plan.id), files = readdirSync(join(f.root, f.plan.id), { recursive: true })
  ;(selftestManifest[0] as { sha256: string }).sha256 = 'a'.repeat(64)
  upgrade.packagedReads = 0
  expect(() => loadFixedRound(f.root, f.plan.id)).toThrow(/manifest/)
  expect(buildOfflineReport(f.root, f.plan.id)).toEqual(before)
  expect(upgrade.packagedReads).toBe(0)
  expect(readdirSync(join(f.root, f.plan.id), { recursive: true })).toEqual(files)
})
it.each([false, true])('uses frozen protocol wording without rejudging after a prompt upgrade (writeback=%s)', async writeback => {
  const f = await scored(writeback), before = buildOfflineReport(f.root, f.plan.id)
  upgrade.prompts = true
  expect(buildOfflineReport(f.root, f.plan.id)).toEqual(before)
  expect(loadOfflineOutcomes(f.root, f.plan.id)[f.item.id]?.endpoint).toEqual(writeback ? ['yes', 'yes', 'yes', 'yes', 'yes'] : ['yes', 'yes'])
})
it('accepts a self-consistent historical question copy while execution still requires the published copy', () => {
  const f = registered()
  const directory = copied(f, value => {
    const questions = JSON.parse(Buffer.from(value.resources['questions.json'], 'base64').toString())
    questions[0].prompt += ' Historical wording.'
    for (const item of value.plan.items.filter((item: any) => item.question === 'know')) item.prompt = questions[0].prompt
    resource(value, 'questions.json', Buffer.from(JSON.stringify(questions)))
  })
  expect(() => loadFixedRound(directory, f.plan.id)).toThrow(/manifest/)
  expect(buildOfflineReport(directory, f.plan.id).markdown).toContain('know-mem')
})
it('does not trust hash-valid malformed or inconsistent historical manifests, resources, questions or routes', () => {
  const f = registered()
  for (const change of [
    (v: any) => { v.plan.version = 'selftest-v2' },
    (v: any) => { v.plan.maxJudgeCalls = 120 },
    (v: any) => { v.plan.items.pop() },
    (v: any) => { v.plan.items[0].prompt = 'not the frozen question' },
    (v: any) => { v.plan.judge.path = '/free' },
    (v: any) => { v.plan.tested.provider = ' ' },
    (v: any) => { v.plan.judge.effort = 1 },
    (v: any) => { v.manifest[0].sha256 = 'a'.repeat(64) },
    (v: any) => { v.manifest.push(v.manifest[0]) },
    (v: any) => { v.manifest[0].extra = true },
    (v: any) => { v.manifest[0].size = -1 },
    (v: any) => { v.manifest[0].path = '../questions.json' },
    (v: any) => { v.resources['extra.json'] = 'e30=' },
    (v: any) => { delete v.resources['repo/README.md'] },
    (v: any) => {
      const q = JSON.parse(Buffer.from(v.resources['questions.json'], 'base64').toString())
      q[0].conditions = ['mem', 'mem']; resource(v, 'questions.json', Buffer.from(JSON.stringify(q)))
      v.plan.items[1] = { ...v.plan.items[0] }
    },
    (v: any) => {
      const q = JSON.parse(Buffer.from(v.resources['questions.json'], 'base64').toString())
      q[0].judgements = ['facts', 'arbitrary']; resource(v, 'questions.json', Buffer.from(JSON.stringify(q)))
      for (const item of v.plan.items.filter((item: any) => item.question === 'know')) item.judgements = q[0].judgements
    },
    (v: any) => {
      const q = JSON.parse(Buffer.from(v.resources['questions.json'], 'base64').toString())
      q[0].requiredFacts = []; resource(v, 'questions.json', Buffer.from(JSON.stringify(q)))
      for (const item of v.plan.items.filter((item: any) => item.question === 'know')) item.requiredFacts = []
    },
  ]) {
    const directory = copied(f, change)
    expect(() => buildOfflineReport(directory, f.plan.id)).toThrow()
  }
})
it('validates frozen protocols even before raw responses exist and rejects damaged frozen bytes', async () => {
  const f = registered(), item = f.plan.items[0]!, directory = join(f.root, f.plan.id, item.id)
  freezeInput(directory, {})
  freezeSelection(join(directory, 'selection'), [{ id: 'root:1', text: 'retryLimit is 4' }], ['root:1'])
  freezeInput(join(directory, 'judge-protocols'), [{ prompt: 'a different task' }])
  expect(() => loadOfflineOutcomes(f.root, f.plan.id)).toThrow(/Frozen judge protocol mismatch/)
  const damaged = registered()
  writeFileSync(join(damaged.root, damaged.plan.id, 'input.json'), '{}\n')
  expect(() => buildOfflineReport(damaged.root, damaged.plan.id)).toThrow(/hash mismatch/)
})
it('rejects hash-valid frozen protocols with unbound route, criteria, evidence, schema or write sources', async () => {
  for (const change of [
    (p: any) => { p[0].provider = 'foreign' },
    (p: any) => { p[0].effort = 'other' },
    (p: any) => { p[0].path = '/free' },
    (p: any) => { p[0].schema.properties.verdict.enum.push('maybe') },
    (p: any) => { p.pop() },
    (p: any) => { p.reverse() },
    (p: any) => { p[0].prompt = 'a different task' },
    (p: any) => { p[0].prompt = JSON.stringify({ ...JSON.parse(p[0].prompt), criterion: 'other' }) },
    (p: any) => { p[0].prompt = JSON.stringify({ ...JSON.parse(p[0].prompt), protocol: 'judge-v2' }) },
    (p: any) => { p[0].prompt = JSON.stringify({ ...JSON.parse(p[0].prompt), requiredFacts: ['unbound'] }) },
    (p: any) => { p[0].prompt = JSON.stringify({ ...JSON.parse(p[0].prompt), evidence: [{ id: 'root:answer', text: 'different evidence' }] }) },
    (p: any) => { const prompt = JSON.parse(p[0].prompt); prompt.writeback.sources = ['foreign:write']; p[0].prompt = JSON.stringify(prompt) },
    (p: any) => { const prompt = JSON.parse(p[0].prompt); delete prompt.writeback; p[0].prompt = JSON.stringify(prompt) },
  ]) {
    const f = await scored(true), protocols = structuredClone(readFrozenInput(join(f.directory, 'judge-protocols'))) as any
    change(protocols)
    const other = root(); freezeInput(join(other, f.plan.id), readFrozenInput(join(f.root, f.plan.id)))
    const directory = join(other, f.plan.id, f.item.id); freezeInput(directory, {})
    freezeInput(join(directory, 'selection'), readFrozenInput(join(f.directory, 'selection')))
    freezeInput(join(directory, 'program-evidence'), readFrozenInput(join(f.directory, 'program-evidence')))
    freezeInput(join(directory, 'judge-protocols'), protocols)
    // Copy the actual frozen raw responses, not summarized outcomes.
    for (const index of [0, 1]) copyFileSync(join(f.directory, 'judge-protocols', `${index}-raw.json`), join(directory, 'judge-protocols', `${index}-raw.json`))
    expect(() => loadOfflineOutcomes(other, f.plan.id)).toThrow(/Frozen judge protocol mismatch/)
  }
})
