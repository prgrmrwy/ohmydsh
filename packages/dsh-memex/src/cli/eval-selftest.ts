#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { authenticatedEvalClient } from '../eval/host-client.js'
import { confirmFixedSelftest } from '../eval/consent.js'
import type { FixedRound, ModelRoute } from '../eval/round.js'

export interface SelftestIo {
  out(text: string): void; error(text: string): void
  confirm(notice: string): Promise<string>
  /** Authenticated Host bridge call; the CLI never builds sessions itself. */
  call(endpoint: string, payload: unknown): Promise<unknown>
}

const usage = '用法：dsh-memex-eval-selftest --tested <provider/model[@effort]> --judge <provider/model[@effort]>\n只运行内置固定虚构自检；不接受题目、仓库、卡片或 suite 路径。\n只查状态：--status <round-uuid>\n安全续跑：--resume <round-uuid>（必须连续同 Host；无证明则拒绝）。\n人工核对默认值后：--confirm-default-review <round-uuid>（只记确认，不写默认值）。\n'

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
  if (args.length === 2 && ['--status', '--confirm-default-review', '--resume'].includes(args[0]!)) {
    if (!/^round-[a-f0-9-]{36}$/.test(args[1]!)) { io.error('无效 round 身份\n'); return 2 }
    try {
      const payload = { round: args[1]! }
      const status = await io.call('eval/status', payload) as { defaultModelNotice?: string }
      io.out(JSON.stringify(status) + '\n')
      if (args[0] === '--resume') {
        const confirmation = await io.confirm('仅在连续同 Host 资源释放可证明、旧题未评分且无未知提交时创建新 attempt；已完成题不重跑。默认模型仍可能改变，不自动恢复。输入 RESUME FIXED SELFTEST')
        if (confirmation !== 'RESUME FIXED SELFTEST') throw new Error('续跑未确认')
        const requestId = randomUUID()
        io.out(`续跑身份 ${requestId}；未知响应不自动重发。\n`)
        const result = await io.call('eval/resumeRound', { ...payload, requestId }) as { evidenceComplete?: boolean }
        if (result?.evidenceComplete !== true) throw new Error('续跑证据仍未收齐，请查离线报告')
      }
      if (args[0] === '--confirm-default-review') {
        const confirmation = await io.confirm('请先在日常 GUI 手动检查默认模型并按需恢复；仅确认人工核对，不会自动恢复。输入 I REVIEWED THE DEFAULT MODEL')
        if (confirmation !== 'I REVIEWED THE DEFAULT MODEL') throw new Error('人工确认未完成')
        await io.call('eval/confirmDefaultReview', { ...payload, confirmation })
      }
      return 0
    } catch (error) { io.error(`检查未完成：${error instanceof Error ? error.message : String(error)}\n`); return 1 }
  }
  if (args.length === 1 && args[0] === '--help') { io.out(usage); return 0 }
  try { routes = parse(args) } catch (error) {
    io.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`)
    return 2
  }
  let round: FixedRound
  try {
    round = await confirmFixedSelftest({ version: 'selftest-v1', ...routes, maxJudgeCalls: 12 }, io.confirm,
      async request => {
        const pending = await io.call('eval/pendingDefaultReviews', {}) as { round: string; notice: string }[]
        if (!Array.isArray(pending)) throw new Error('Host pending-default response invalid')
        if (pending.length) {
          for (const value of pending) io.error(`${value.round}：${value.notice}\n完成手动核对后用 --confirm-default-review ${value.round} 确认；不会修改默认值。\n`)
          throw new Error('前次默认模型尚未人工确认')
        }
        return io.call('eval/registerRound', request) as Promise<FixedRound>
      })
  } catch (error) {
    io.error(`未启动：${error instanceof Error ? error.message : String(error)}\n`)
    return 3
  }
  io.out(`固定虚构自检 ${round.id}：${round.items.length} 个计划条件。\n`)
  const requestId = randomUUID()
  io.out(`运行身份 ${requestId}；响应不确定时只查状态，不重发。\n`)
  try {
    const result = await io.call('eval/runRound', { round: round.id, requestId }) as { evidenceComplete?: boolean }
    if (result?.evidenceComplete !== true) throw new Error('自检判据存在 unknown 或缺证；请求结束不等于完整验收，请读取离线报告')
    const status = await io.call('eval/status', { round: round.id }) as { defaultModelNotice?: string }
    if (status.defaultModelNotice) io.out(`${status.defaultModelNotice}\n`)
  } catch (error) {
    try {
      const status = await io.call('eval/status', { round: round.id }) as { defaultModelNotice?: string }
      if (status.defaultModelNotice) io.error(`${status.defaultModelNotice}\n`)
    } catch { io.error('默认值当前状态未读取；请在日常 GUI 手动核对，工具不会自动恢复。\n') }
    io.error(`轮次 ${round.id} 未完成，停止并保留现场；请查状态，不自动重发：${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
  io.out('宿主可达限制：被测普通会话不是安全沙箱，路线与越界访问只做事后审计；报告请用 dsh-memex-eval-report 离线生成。\n')
  return 0
}

async function launchCredential(signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new Error('Authentication cancelled')
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Authentication requires an interactive terminal; credentials are never accepted in argv')
  process.stderr.write('粘贴官方 Host 启动 URL（隐藏输入，仅内存保存；不扫描日志）：')
  const raw = process.stdin.isRaw
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let value = ''
    const done = (error?: Error) => {
      signal.removeEventListener('abort', interrupted)
      process.stdin.off('data', input); process.stdin.setRawMode(raw); process.stdin.pause(); process.stderr.write('\n')
      if (error) reject(error); else resolve(value)
    }
    const input = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') { done(new Error('Authentication cancelled')); return }
        if (character === '\r' || character === '\n') { done(); return }
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1)
        else if (character >= ' ') value += character
        if (value.length > 16_384) { done(new Error('Authentication input too long')); return }
      }
    }
    const interrupted = () => done(new Error('Authentication cancelled'))
    signal.addEventListener('abort', interrupted, { once: true })
    process.stdin.on('data', input)
    if (signal.aborted) interrupted()
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let client: Awaited<ReturnType<typeof authenticatedEvalClient>> | undefined
  const abort = new AbortController()
  const interrupt = () => abort.abort()
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
  process.exitCode = await runSelftestCli(process.argv.slice(2), {
    out: text => process.stdout.write(text), error: text => process.stderr.write(text),
    confirm: async notice => {
      process.stderr.write(notice + '\n')
      const input = createInterface({ input: process.stdin, output: process.stderr })
      try { return await input.question('确认：', { signal: abort.signal }) } finally { input.close() }
    },
    call: async (endpoint, payload) => {
      client ??= await authenticatedEvalClient(await launchCredential(abort.signal))
      return client.call(endpoint, payload, abort.signal)
    },
  })
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
}
