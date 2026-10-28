import { confirmFixedSelftest } from '../eval/consent.js'
import type { FixedRound, ModelRoute } from '../eval/round.js'

export interface SelftestIo {
  out(text: string): void; error(text: string): void
  confirm(notice: string): Promise<string>
  /** Authenticated Host bridge call; the CLI never builds sessions itself. */
  call(endpoint: string, payload: unknown): Promise<unknown>
  runItem(round: string, item: string): Promise<void>
}

const usage = '用法：dsh-memex-eval-selftest --tested <provider/model[@effort]> --judge <provider/model[@effort]>\n只运行内置固定虚构自检；不接受题目、仓库、卡片或 suite 路径。\n'

function route(value: string): ModelRoute {
  const match = /^([^/@\s]+)\/([^@\s]+)(?:@(\S+))?$/.exec(value)
  if (!match) throw new Error(`无效路线：${value}`)
  return { provider: match[1]!, model: match[2]!, ...(match[3] ? { effort: match[3] } : {}) }
}

function parse(args: readonly string[]): { tested: ModelRoute; judge: ModelRoute } {
  const options = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!, value = args[index + 1]
    // Unknown flags are refused before their value is looked at; no path is ever opened.
    if (!['--tested', '--judge'].includes(key)) throw new Error(`不支持的参数：${key}`)
    if (options.has(key) || !value || value.startsWith('--')) throw new Error(`参数缺少值或重复：${key}`)
    options.set(key, value)
  }
  const tested = options.get('--tested'), judge = options.get('--judge')
  if (!tested || !judge) throw new Error('必须同时指定 --tested 与 --judge')
  return { tested: route(tested), judge: route(judge) }
}

export async function runSelftestCli(args: readonly string[], io: SelftestIo): Promise<number> {
  let routes: { tested: ModelRoute; judge: ModelRoute }
  try { routes = parse(args) } catch (error) {
    io.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`)
    return 2
  }
  let round: FixedRound
  try {
    round = await confirmFixedSelftest({ version: 'selftest-v1', ...routes, maxJudgeCalls: 12 }, io.confirm,
      request => io.call('eval/registerRound', request) as Promise<FixedRound>)
  } catch (error) {
    io.error(`未启动：${error instanceof Error ? error.message : String(error)}\n`)
    return 3
  }
  io.out(`固定虚构自检 ${round.id}：${round.items.length} 个计划条件。\n`)
  for (const item of round.items) {
    try { await io.runItem(round.id, item.id) } catch (error) {
      io.error(`条件 ${item.id} 未完成，本轮停止并保留现场：${error instanceof Error ? error.message : String(error)}\n`)
      return 1
    }
  }
  io.out('宿主可达限制：被测普通会话不是安全沙箱，路线与越界访问只做事后审计；报告请用 dsh-memex-eval-report 离线生成。\n')
  return 0
}
