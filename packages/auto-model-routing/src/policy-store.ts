import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
const route = z.object({ provider: z.enum(['claude','codex','dsh-magpie-connect']), model: z.string().min(1).max(128), reasoningEffort: z.enum(['low','medium','high','xhigh']) }).strict()
const schema = z.object({
  version: z.literal(1), childId: z.string(), parentId: z.string(), rootId: z.string(),
  policyVersion: z.string(), mappingVersion: z.string(),
  status: z.enum(['recommended','applied','unsupported','needs-context','failed']),
  path: z.enum(['ordinary','teammate','fork']),
  family: z.enum(['claude','codex']).optional(),
  explicit: z.object({ provider: z.enum(['claude','codex','dsh-magpie-connect']), model: z.string().optional(), reasoningEffort: z.string().optional() }).strict(),
  decision: z.object({ id: z.number(), source: z.enum(['main','subagent']), tier: z.string(), depth: z.string(), capability: z.string().optional(), effort: z.string(), model: z.string().optional(), provider: z.string().optional(), status: z.string(), ms: z.number(), decisionProvider: z.string(), decisionModel: z.string(), confidence: z.number().min(0).max(1).optional(), capabilityConfidence: z.number().min(0).max(1).optional(), probabilities: z.record(z.string(),z.number().min(0).max(1)).optional(), capabilityProbabilities: z.record(z.string(),z.number().min(0).max(1)).optional() }).strict().optional(),
  route: route.optional(), actual: route.optional(), reason: z.string().max(240).optional(),
}).strict()
export type ChildDecision = z.infer<typeof schema>
/** Strict per-child files: corrupt or mismatched records fail closed; no raw task or credentials. */
export class PolicyStore {
  constructor(private readonly directory: string) {}
  private path(id: string) { return join(this.directory, `${createHash('sha256').update(id).digest('hex')}.json`) }
  bind(id: string): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    writeFileSync(`${this.path(id)}.bound`, id, { flag: 'wx', mode: 0o600 })
  }
  wasBound(id: string): boolean {
    try { if (readFileSync(`${this.path(id)}.bound`, 'utf8') !== id) throw new Error('绑定标记损坏'); return true }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  }
  get(id: string): ChildDecision | undefined {
    try {
      const record = schema.parse(JSON.parse(readFileSync(this.path(id), 'utf8')))
      if (record.childId !== id) throw new Error('child identity mismatch')
      return record
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error('policy-v2 决策无法恢复；暂停该子会话') }
  }
  set(value: ChildDecision): void {
    const checked = schema.parse(value)
    mkdirSync(this.directory, { recursive: true, mode: 0o700 }); chmodSync(this.directory, 0o700)
    const target = this.path(value.childId), temp = `${target}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(checked), { flag: 'wx', mode: 0o600 })
    renameSync(temp, target)
  }
}
