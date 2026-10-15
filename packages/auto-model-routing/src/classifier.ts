export type Tier = 'simple' | 'standard' | 'complex' | 'unclassified'
export type Level = Exclude<Tier, 'unclassified'> | 'escalated'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Reason = 'classified' | 'continued' | 'escalated' | 'explicit' | 'unclassified' | 'no-effort-support' | 'manual-restore'

const levels: readonly Level[] = ['simple', 'standard', 'complex', 'escalated']
const efforts: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export function classify(input: string): Tier {
  const text = input.trim()
  if (!text) return 'unclassified'
  let score = text.length >= 200 ? 2 : 0
  if (text.length >= 1500) score += 2
  if (/```/.test(text)) score += 1
  if (/(?:[\w.-]+\/)+[\w.-]*|\b(?:npm|pnpm|git|node)\s+\S+/.test(text)) score += 1
  if (/排查|架构|跨模块|多个模块|并发|竞态|迁移|安全审查|\b(?:architecture|race condition|migration|security audit)\b/i.test(text)) score += 3
  if (/接口|测试|修复|实现|\b(?:implement|endpoint|tests?|fix)\b/i.test(text)) score += 1
  return score >= 3 ? 'complex' : score >= 1 ? 'standard' : 'simple'
}

export function resolveLevel(input: string, previous?: Level): { level?: Level; reason: Reason } {
  const text = input.trim()
  const explicit: readonly [RegExp, Level][] = [
    [/用最高档|\b(?:max effort|highest effort)\b/i, 'escalated'],
    [/用高档|\bhigh effort\b/i, 'complex'],
    [/用标准档|\bmedium effort\b/i, 'standard'],
    [/用低档|\blow effort\b/i, 'simple'],
  ]
  for (const [pattern, level] of explicit) if (pattern.test(text)) return { level, reason: 'explicit' }
  if (previous && /^(?:继续|接着|continue|go on)[。.!！\s]*$/i.test(text)) return { level: previous, reason: 'continued' }
  if (/^(?:重新做|重做|redo\b|try again\b)/i.test(text)) {
    return { level: levels[Math.min(levels.indexOf(previous ?? 'simple') + 1, levels.length - 1)]!, reason: 'escalated' }
  }
  const tier = classify(text)
  if (tier === 'unclassified') return previous ? { level: previous, reason: 'unclassified' } : { reason: 'unclassified' }
  return { level: tier, reason: 'classified' }
}

const defaultTable: readonly Effort[] = ['low', 'medium', 'high', 'max']
const tables: Readonly<Record<string, readonly Effort[]>> = {
  'claude-opus-5-5': ['low', 'medium', 'xhigh', 'max'],
  'claude-sonnet-5-5': defaultTable,
  'claude-fable-5-1': defaultTable,
  'gpt-6.1-sol': ['low', 'medium', 'xhigh', 'max'],
  'gpt-6-astra': ['low', 'low', 'medium', 'high'],
}

export function mapEffort(model: string, level: Level, supported: readonly Effort[]): Effort | undefined {
  const target = (tables[model] ?? defaultTable)[levels.indexOf(level)]!
  const ordered = efforts.filter(effort => supported.includes(effort))
  return ordered.filter(effort => efforts.indexOf(effort) <= efforts.indexOf(target)).at(-1) ?? ordered[0]
}
