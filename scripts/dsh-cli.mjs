#!/usr/bin/env node
// ohmydsh scripts/dsh-cli.mjs — 把一次调用原样转交给官方 @deepseek-ai/dsh CLI。
//
// 背景:`dsh` 这个名字同时是本仓库启动器(bin/dsh)与官方 CLI 的入口。用户
// 的 PATH 里通常只有 ~/.local/bin/dsh(启动器),于是官方 CLI 的调用形式
// (`dsh plugin --profile web add <pkg>`、`dsh --dump-config` 等)会落到启动器
// 手上。启动器把不认识的参数塞进 PASSTHRU 并拼到 `dsh web` 之后,而官方
// web 子命令没有 --profile 选项 → `error: unknown option '--profile'`。
//
// 本脚本是启动器的转发出口:解析出与 dsh.yaml pin 同版本的官方 CLI bin
// (复用 scripts/lib/dsh-cli.mjs 的 npx 缓存 / pnpm 直装通道,不额外触发
// npx 安装锁竞争),以 node 直连执行并透传 stdio 与退出码。
import { spawnSync } from 'node:child_process'
import { resolveCliBin } from './lib/dsh-cli.mjs'

const version = process.env.DSH_CLI_VERSION ?? ''
if (version === '') {
  console.error('error: DSH_CLI_VERSION is required (启动器应从 dsh.yaml 的 dshVersion 传入)')
  process.exit(1)
}

const resolved = resolveCliBin({
  spec: `@deepseek-ai/dsh@${version}`,
  version,
  dshBinEnv: process.env.DSH_BIN,
})

if (resolved === null) {
  console.error(`error: 无法解析官方 DSH CLI(@deepseek-ai/dsh@${version});请检查网络或 npm registry`)
  process.exit(1)
}

const args = process.argv.slice(2)
const result = resolved.kind === 'env'
  ? spawnSync(resolved.bin, args, { stdio: 'inherit' })
  : spawnSync(process.execPath, [resolved.bin, ...args], { stdio: 'inherit' })

if (result.error !== undefined) {
  console.error(`error: 执行官方 DSH CLI 失败:${result.error.message}`)
  process.exit(1)
}
// 被信号终止时用约定的 128+signo 退出码,避免误报成功。
if (result.signal !== null && result.signal !== undefined) process.exit(1)
process.exit(result.status ?? 1)
