export type Tier = 'simple' | 'standard' | 'complex' | 'escalated'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Reason = 'jev' | 'continued' | 'no-effort-support' | 'manual-restore' | 'jev-failed'

export const tiers: readonly Tier[] = ['simple', 'standard', 'complex', 'escalated']
const efforts: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

const defaultTable: readonly Effort[] = ['low', 'medium', 'high', 'max']
const tables: Readonly<Record<string, readonly Effort[]>> = {
  'claude-opus-5-5': ['low', 'medium', 'xhigh', 'max'],
  'claude-sonnet-5-5': defaultTable,
  'claude-fable-5-1': defaultTable,
  'gpt-6.1-sol': ['low', 'medium', 'xhigh', 'max'],
  'gpt-6-astra': ['low', 'low', 'medium', 'high'],
}

export function mapEffort(model: string, tier: Tier, supported: readonly Effort[]): Effort | undefined {
  const target = (tables[model] ?? defaultTable)[tiers.indexOf(tier)]!
  const ordered = efforts.filter(effort => supported.includes(effort))
  return ordered.filter(effort => efforts.indexOf(effort) <= efforts.indexOf(target)).at(-1) ?? ordered[0]
}

export type ChildProvider = 'claude' | 'codex'
/** Sub-agent table (design D9); the single source used by `route_subagent`. */
export const CHILD_TABLE: Readonly<Record<Tier, Readonly<Record<ChildProvider, readonly [model: string, effort: Effort]>>>> = {
  simple: { claude: ['claude-haiku-5-5', 'low'], codex: ['gpt-6-luna', 'medium'] },
  standard: { claude: ['claude-sonnet-5-5', 'medium'], codex: ['gpt-6.1-sol', 'medium'] },
  complex: { claude: ['claude-opus-5-5', 'xhigh'], codex: ['gpt-6.1-sol', 'xhigh'] },
  escalated: { claude: ['claude-fable-5-1', 'high'], codex: ['gpt-6-astra', 'medium'] },
}
