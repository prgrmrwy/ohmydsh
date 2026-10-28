#!/usr/bin/env node
export interface EvalReportOutput { out(text: string): void; error(text: string): void }
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildOfflineReport } from '../eval/offline-report.js'
const usage = '离线固定虚构自检报告：--root <私有自检目录> --round <round-uuid>。只读，不连接 Host、不启动模型；不支持自由 suite。'
export function runEvalReportCli(args: readonly string[], output: EvalReportOutput): number {
  try {
    if (args.length === 1 && args[0] === '--help') { output.out(usage + '\n'); return 0 }
    const options = new Map<string, string>()
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index]!, value = args[index + 1]
      if (!['--root', '--round'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw new Error(usage)
      options.set(key, value)
    }
    const root = options.get('--root'), round = options.get('--round')
    if (!root || !round || !/^round-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(round)) throw new Error(usage)
    const report = buildOfflineReport(resolve(root), round)
    output.out(report.markdown)
    return report.exitCode
  } catch (error) { output.error(`无法生成离线自检报告：${error instanceof Error ? error.message : String(error)}\n`); return 2 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runEvalReportCli(process.argv.slice(2), { out: text => process.stdout.write(text), error: text => process.stderr.write(text) })
}
