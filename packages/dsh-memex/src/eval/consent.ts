import { testedLimits } from './tested-budget.js'
import { fixedPlanPreview, parseFixedRegistration, type FixedRound } from './round.js'

/** Counts derived from the frozen plan; spontaneous descendants cannot be bounded in advance. */
export function describeFixedPlan(plan: Pick<FixedRound, 'items'>): { treatment: number; control: number; judgeParents: number; followUps: number; maxJudgeCalls: number; descendantBudget: 'unknown' } {
  return {
    treatment: plan.items.filter(item => item.condition === 'mem').length,
    control: plan.items.filter(item => item.condition === 'nomem').length,
    judgeParents: 1,
    followUps: plan.items.filter(item => item.followUp !== undefined).length,
    maxJudgeCalls: plan.items.reduce((sum, item) => sum + item.judgements.length, 0),
    descendantBudget: 'unknown',
  }
}

export async function confirmFixedSelftest<T>(request: unknown, confirm: (notice: string) => Promise<string>, register: (request: unknown) => Promise<T>): Promise<T> {
  const frozen = structuredClone(parseFixedRegistration(request))
  const plan = describeFixedPlan(fixedPlanPreview())
  const notice = [
    `仅运行固定虚构三题 × mem/nomem 六条件：顶层 ${plan.treatment}（有记忆）+ 对照 ${plan.control}（无记忆）普通会话，裁判父 ${plan.judgeParents}，追问回合 ${plan.followUps}（共 ${plan.followUps} 个追问回合）。`,
    `被测路线：${JSON.stringify(frozen.tested)}；裁判路线：${JSON.stringify(frozen.judge)}。两判据/条件，裁判请求最多 ${plan.maxJudgeCalls} 次；失败/未知提交不自动重发。自发后代数量与成本预算：未知。`,
    `每条件软监测：最多 ${testedLimits.maxRequestsPerCondition} 次根/后代模型请求、${testedLimits.maxDurationMsPerCondition / 1000} 秒墙钟；观察超限即取消，不保证恰好截止且不能追回已发请求。`,
    '普通会话不是安全沙箱，可能读真实文件或题目答案；普通自发后代数量与成本未知、独立记录，普通请求路线只做事后审计，异常即停止，不能追回已外发内容。',
    'selectModel 可能异步更改全局默认模型；工具不会自动恢复，保存原值并持续提醒，请手动检查。归档静止测试根而非销毁，释放证明缺失保留现场停止。',
    '仅检查链路，裁判未校准，不代表 Memex 效果。若同意请输入 RUN FIXED SELFTEST。',
  ].join('\n')
  if (await confirm(notice) !== 'RUN FIXED SELFTEST') throw new Error('Fixed selftest declined; no round registered')
  return register(frozen)
}
