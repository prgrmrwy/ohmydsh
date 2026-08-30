#!/usr/bin/env node
// ohmydsh scripts/dsh-server-bin.mjs — 解析出用于**拉起长期 web server** 的
// dsh CLI bin 路径,打印到 stdout 供 bin/dsh 捕获。
//
// 背景(scope-npm-registry-injection / design D2):启动器原先用
// `npx -y @deepseek-ai/dsh@<ver> web` 拉起 server。npx 会把解析后的完整 npm
// 配置烘焙成一批 npm_* 环境变量传给子进程(实测 22 个,含 npm_config_registry
// 与 npm_config_engine_strict),server 再原样透传给 agent shell,于是 agent
// 在任意仓库执行 npm/pnpm/rush 时都被这套仓库配置劫持(env 优先级高于所有
// .npmrc)。改为「解析 bin → node 直连」后,子进程不再有任何 npm_*(实测 0)。
//
// 关键:返回真实的 lib/bin.js,不要返回安装目录内的 `node_modules/.bin/dsh`。
// npm 的 .bin 通常是符号链接,但 pnpm 的 .bin 是 shell shim;后者若被启动器
// 以 `node <bin>` 执行会直接产生 SyntaxError。dsh-runtime.sh 同时识别真实
// lib/bin.js 与历史 npm exec/.bin argv,所以 stop/restart 的归属证明仍然成立。
//
// 用法:DSH_CLI_VERSION=<version> node scripts/dsh-server-bin.mjs
// 输出:成功时 stdout 打印 `DSH_SERVER_BIN=<绝对路径>` 并退出 0;失败退出 1。
//
// 结果用标记行而不是裸路径:冷启动时 resolveCliBin 会触发安装通道,而
// probeNpxInstall / probePnpmInstall 刻意用 stdio:'inherit' 让用户看到安装
// 进度(如 npx 的 `--version` 回显),这些噪声与结果共用 stdout。调用方按
// 标记提取,才不会把安装输出当成路径的一部分。
import { existsSync } from 'node:fs'
import { resolveCliBin, serverBinFrom } from './lib/dsh-cli.mjs'

const version = process.env.DSH_CLI_VERSION ?? ''
if (version === '') {
  console.error('error: DSH_CLI_VERSION is required (启动器应从 dsh.yaml 的 dshVersion 传入)')
  process.exit(1)
}

// 复用既有解析顺序(DSH_BIN → npx 缓存 → pnpm 直装 → 通道 A/B 安装),
// 不新写解析逻辑,冷启动的就绪保证与 runDshCli 一致。
const resolved = resolveCliBin({
  spec: `@deepseek-ai/dsh@${version}`,
  version,
  dshBinEnv: process.env.DSH_BIN,
})

if (resolved === null) {
  console.error(`error: 无法解析官方 DSH CLI(@deepseek-ai/dsh@${version});请检查网络或 npm registry`)
  process.exit(1)
}

const serverBin = serverBinFrom(resolved)

// DSH_BIN 是显式逃生门,可以是调用方自行提供的命令形式;保持原有契约,
// 只校验解析器自己管理的 npm/pnpm 安装入口。
if (resolved.kind !== 'env' && !existsSync(serverBin)) {
  console.error(`error: DSH server 入口不存在:${serverBin}`)
  process.exit(1)
}

process.stdout.write(`DSH_SERVER_BIN=${serverBin}\n`)
