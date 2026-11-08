// Browser-safe: imported by the client bundle. Pure data plus lookups; no load-time validation
// (a metadata typo must never take down the settings page). Constraints are enforced by tests.
import reasoningDepth from './reasoning-depth/rubric.json' with { type: 'json' }
import effortAsVerification from './effort-as-verification/rubric.json' with { type: 'json' }

export type PresetContext = 'execution'
export interface Localized { readonly zh: string; readonly en: string }
export interface PresetSource { readonly title: string; readonly url: string; readonly date: string }
export interface RubricQuestion { readonly type: string; readonly instructions: string; readonly criteria: Readonly<Record<string, string>> }
export interface Rubric { readonly capability: RubricQuestion; readonly depth: RubricQuestion }
/** A built-in, immutable judgement preset: the questions Jev sees plus where they came from. */
export interface Preset {
  readonly id: string
  readonly rubric: Rubric
  readonly title: Localized
  readonly summary: Localized
  readonly evidence: Localized
  readonly sources: readonly PresetSource[]
  readonly context: readonly PresetContext[]
}

/** First entry is the default. Published judgement content never changes in place: add a new id instead. */
export const PRESETS: readonly Preset[] = [
  {
    id: 'reasoning-depth',
    rubric: reasoningDepth,
    title: { zh: '推理深度', en: 'Reasoning depth' },
    summary: {
      zh: 'depth 按任务需要的推理投入判断：只有需要格外仔细的多步推理、困难约束或精细证明时才提高；工作量与风险本身不提高投入。',
      en: 'Depth follows the reasoning investment the task needs: raise it only for unusually careful multi-step reasoning, hard constraints or subtle proofs; volume and risk alone do not.',
    },
    evidence: {
      zh: '本项目 2026-10-24 用 10 条合成任务对 typesafe/jev-1.13 做的小样本分类核对；只证明接口与分类一致性，不证明任务质量或成本收益。',
      en: 'A 10-case synthetic classification check against typesafe/jev-1.13 by this project (2026-10-24); it shows interface and classification consistency, not task quality or cost benefit.',
    },
    sources: [{ title: 'AUTO synthetic Jev check (eval/)', url: 'https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/eval/README.md', date: '2026-10-24' }],
    context: [],
  },
  {
    id: 'effort-as-verification',
    rubric: effortAsVerification,
    title: { zh: 'Effort 管验证与边界情况', en: 'Effort as verification' },
    summary: {
      zh: 'depth 按下一步工作需要的验证、边界情况测试与自主判断投入判断，而非推理难度：隐藏边界情况多、需复现/对照/模糊测试的工作提高；有人会复核迭代的快速首轮降低。额外投入修不了方法选错，那属于能力档。',
      en: 'Depth follows how much verification, edge-case testing and independent judgement the next work needs, not reasoning difficulty: raise it when hidden edge cases must be found by reproducing, comparing or fuzzing; lower it for quick first passes someone will review. Extra effort does not fix a wrong approach; that is a capability matter.',
    },
    evidence: {
      zh: '来源为 Anthropic 对 Opus 5.5 / Fable 5.1 的内部 Terminal-Bench 3.0 跑分（每题 5 次）；本项目尚无真实判档证据。对 GPT 家族属于未经验证的外推。',
      en: "Based on Anthropic's internal Terminal-Bench 3.0 runs for Opus 5.5 / Fable 5.1 (5 attempts per task); this project has no live judgement evidence yet. Applying it to the GPT family is an unverified extrapolation.",
    },
    sources: [{ title: 'Using Claude Code: Spending your effort', url: 'https://claude.dev/blog/spending-your-effort/', date: '2026-09-25' }],
    context: ['execution'],
  },
]

export const DEFAULT_PRESET_ID: string = PRESETS[0]!.id

const LABELS = { capability: ['analytical', 'bounded', 'frontier', 'insufficient_context'], depth: ['baseline', 'higher', 'lower'] } as const
const CONTEXTS: readonly string[] = ['execution']
const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0

/** Structural constraints of a preset list. Called by tests only; the runtime never throws on metadata. */
export function presetIssues(list: readonly Preset[]): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const p of list) {
    const bad = (field: string, message: string) => issues.push(`${p.id}: ${field} ${message}`)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id)) bad('id', 'must be lower kebab-case')
    if (seen.has(p.id)) bad('id', 'is duplicated')
    seen.add(p.id)
    const rubric = p.rubric as unknown as Record<string, RubricQuestion | undefined>
    if (Object.keys(rubric).sort().join() !== 'capability,depth') bad('rubric', 'must hold exactly capability and depth')
    for (const dimension of ['capability', 'depth'] as const) {
      const q = rubric[dimension]
      if (!q) continue
      if (q.type !== 'choice') bad(dimension, 'type must be choice')
      if (!filled(q.instructions)) bad(dimension, 'instructions must be non-empty')
      const keys = Object.keys(q.criteria ?? {}).sort()
      if (keys.join() !== LABELS[dimension].join()) bad(dimension, `criteria keys must be ${LABELS[dimension].join('/')}`)
      for (const [label, text] of Object.entries(q.criteria ?? {})) if (!filled(text)) bad(`${dimension}.${label}`, 'criterion must be non-empty')
    }
    for (const c of p.context) if (!CONTEXTS.includes(c)) bad('context', `has unknown value ${String(c)}`)
    for (const key of ['title', 'summary', 'evidence'] as const) if (!filled(p[key]?.zh) || !filled(p[key]?.en)) bad(key, 'needs non-empty zh and en')
    if (!p.sources.length) bad('sources', 'must not be empty')
    for (const s of p.sources) {
      if (!s.url.startsWith('https://')) bad('sources', `url must be https: ${s.url}`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) bad('sources', `date must be YYYY-MM-DD: ${s.date}`)
    }
  }
  return issues
}

/** Unknown or missing ids resolve to the default preset. */
export function resolvePreset(id: unknown): Preset {
  return PRESETS.find(p => p.id === id) ?? PRESETS[0]!
}
