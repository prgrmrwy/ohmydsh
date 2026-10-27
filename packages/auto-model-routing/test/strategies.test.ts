import { describe, expect, it } from 'vitest'
import { createRegistry, registry, BUILTIN_STRATEGIES, type FamilyStrategy } from '../src/strategies/index.js'
import { policyEffort } from '../src/routing.js'
import oracle from './fixtures/routing-oracle-0.4.2.json' with { type: 'json' }

const deepseek: FamilyStrategy = {
  id: 'deepseek', label: 'DeepSeek', modelPrefixes: ['deepseek-'], transports: { 'opencode-go': '' },
  effortStarts: { 'deepseek-v5': 'medium' }, childModels: { bounded: 'deepseek-v5', analytical: 'deepseek-v5', frontier: 'deepseek-v5' },
}
const [claude, codex] = BUILTIN_STRATEGIES

it('spec Scenario "内置注册表可构造且允许跨 provider 共用前缀"', () => {
  expect(() => createRegistry(BUILTIN_STRATEGIES)).not.toThrow()
  const extended = createRegistry([...BUILTIN_STRATEGIES, deepseek])
  expect(new Set(extended.providers())).toEqual(new Set(['claude', 'codex', 'dsh-magpie-connector', 'dsh-magpie-connect', 'opencode-go']))
  expect(extended.ids()).toEqual(['claude', 'codex', 'deepseek'])
})

describe('spec Scenario "冲突的注册表拒绝构造"', () => {
  const cases: [string, FamilyStrategy[], RegExp][] = [
    ['duplicate id', [claude!, codex!, { ...deepseek, id: 'codex' }], /codex/],
    ['overlapping model prefix', [claude!, codex!, { ...deepseek, modelPrefixes: ['GPT-6-'] }], /GPT-6-.*gpt-|gpt-.*GPT-6-/],
    ['invalid effort start', [claude!, codex!, { ...deepseek, effortStarts: { 'deepseek-v5': 'max' as never } }], /max/],
    ['overlapping child prefix in one provider', [claude!, codex!, { ...deepseek, transports: { 'dsh-magpie-connector': 'codex/x' } }], /codex\/x.*codex\/|codex\/.*codex\/x/],
    ['shared empty prefix provider', [claude!, codex!, { ...deepseek, transports: { claude: '' } }], /claude/],
    ['duplicate effort key', [claude!, codex!, { ...deepseek, effortStarts: { 'gpt-6-luna': 'high' } }], /gpt-6-luna/],
    ['missing capability slot', [claude!, codex!, { ...deepseek, childModels: { bounded: 'deepseek-v5', analytical: 'deepseek-v5' } as never }], /frontier/],
  ]
  it.each(cases)('%s', (_name, strategies, message) => {
    let built: unknown
    expect(() => { built = createRegistry(strategies) }).toThrow(message)
    expect(built).toBeUndefined()
  })
})

const ALL = ['low', 'medium', 'high', 'xhigh', 'max']
it('spec Scenario "effort 起点按模型名查找且保持原结果"', () => {
  expect(oracle.effortStarts.length).toBe(72)
  for (const row of oracle.effortStarts) {
    const run = () => policyEffort(row.model, row.depth as never, ALL, 'xhigh', row.defaultEffort ?? undefined)
    if ('error' in row) expect(run, JSON.stringify(row)).toThrow('unsupported')
    else expect(run(), JSON.stringify(row)).toBe(row.value)
  }
  // The registry lookup alone reproduces the old known-model table.
  expect(registry.effortStart('opencode-go/gpt-6-luna')).toBe('high')
  expect(registry.effortStart('CLAUDE-OPUS-5-5')).toBeUndefined()
})

it('spec Scenario "effort 边界保持原结果"', () => {
  expect(oracle.effortBoundaries.length).toBe(6)
  for (const row of oracle.effortBoundaries) {
    const run = () => policyEffort(row.model, row.depth as never, row.supported, row.cap as never, row.defaultEffort ?? undefined)
    if ('error' in row) expect(run, JSON.stringify(row)).toThrow('起点不可验证')
    else expect(run(), JSON.stringify(row)).toBe(row.value)
  }
})
