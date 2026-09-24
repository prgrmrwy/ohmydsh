# Spike 环境与隔离边界

## 环境

| 事实 | 值 |
|---|---|
| Spike 根 | `/tmp/pet-compat-spike/`（临时目录，可随时删除） |
| Node | v24.16.0 |
| SQLite | 3.51.0，经 `node:sqlite` 的 `DatabaseSync`（Node 内置，无原生依赖） |
| 上游源码 | `packages/dsh-pet/compat/subagent/.upstream`，`git show HEAD:` 读**未打补丁**原版（HEAD = `fb2c4b9e…`，tag `dsh-v0.1.5-rc.2`） |
| 0.1.2 对照 | `npm pack @deepseek-ai/dsh-subagent@0.1.2-rc.1` 与 `@deepseek-ai/dsh-agent-presets@0.1.2-rc.1`，解包到 `/tmp/probe012*`，**只读 `.d.ts`，未安装** |

## 隔离边界（全部满足）

- **未触碰现网 Host**：pid 27689（`.launcher/.../bin.js web --port 3080`）全程未重启、未发信号
- **未触碰生产数据**：`~/.dsh/plugins/dsh-pet/state.sqlite` 未读未写；所有 SQLite 实验在 `/tmp/pet-compat-spike/t*.sqlite` 新建库上进行
- **未改配置**：`dsh.yaml`、`~/.dsh/profiles/**` 未修改；未运行 `dsh build` / `sync.mjs`
- **未装依赖**：`npm pack` 只下载 tarball 解包读取，未 `npm install`，未改动仓库 `node_modules`
- **未占用端口**：本轮全部核验为进程内脚本与静态阅读，未启动任何 Host

因此 tasks 4.0 原计划的"独立 `DSH_HOME` + 独立端口"**未实际需要**：批 B 的三项运行时核验是纯 SQLite 语义实验（不需要 DSH），批 C 四项均以静态证据闭合。完整 Host 环境留到实施阶段的端到端验收（tasks 6.5 / 8.6 / 10.4 / 10.5）时再建。

## 产出

| 文件 | 内容 |
|---|---|
| `spike-static-api-evidence.md` | 五项能力的正面证据（`.d.ts` 行号 + 文档原文）与六条被排除的替代方案 |
| `batch-b-self-hosted-storage.md` | storage 自持 4/4 通过（3 项实测 + 1 项静态） |
| `batch-c-official-subagent-api.md` | 官方 subagent API 等价性 4/4 静态确认 |

## 实验脚本（可复跑）

`/tmp/pet-compat-spike/` 下：`atomicity.mjs`（5.1）、`exclusive.mjs`（5.2，需两进程）、`failclosed.mjs`（5.3）。均为零依赖单文件，`node <file>` 直接运行。
