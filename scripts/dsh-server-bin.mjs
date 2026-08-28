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
// 关键:必须返回安装目录内的 `node_modules/.bin/dsh` 符号链接,而不是
// lib/bin.js。scripts/lib/dsh-runtime.sh 的 is_dsh_web_pid() 是 dsh stop /
// restart 在发信号前的 fail-closed 归属证明,按 argv 匹配;用 lib/bin.js 拉起
// 会让启动器无法证明该进程属于自己,从而停不掉它。两者指向同一个入口文件。
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

// 就绪探测按 lib/bin.js 进行,而 .bin/dsh 是同一次安装产生的符号链接。
// 正常情况下两者同时存在;若该链接缺失(异常安装布局),必须失败而不是
// 悄悄回退到 lib/bin.js —— 那会产生停不掉的 server。
if (resolved.kind !== 'env' && !existsSync(serverBin)) {
  console.error(`error: 安装目录缺少 .bin/dsh 符号链接:${serverBin}`)
  console.error('提示:该链接是 dsh stop/restart 识别自身 server 的依据;可删除对应缓存目录后重试。')
  process.exit(1)
}

process.stdout.write(`DSH_SERVER_BIN=${serverBin}\n`)
