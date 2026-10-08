# devbox 验收交接（本地已推进到验收之前）

## 目标冻结（0.1，2026-10-04 复核）
npm dist-tags：`latest` = `next` = `0.2.0-rc.2`（另有 `alpha` = `0.2.1-alpha.1`，非目标，不追）。
tag `dsh-v0.2.0-rc.2` = `639ed015397290b3745d163aafe02ffee4aa3f84`，与 compat 基线一致。

## 要验收的精确 commit
- 公开仓：分支 `ws/upgrade-dsh-0-2-0-runtime`（本文件所在 commit，基于 main `c9e927e5a`）
- 私有 overlay：`inner-ohmydsh` 分支 `ws/upgrade-dsh-0-2-0-runtime`（W1 `f94dc0e`、W2 `52ebc2b`）

## 本地已证明（隔离 DSH_HOME，0.2.0 依赖；见 w1–w5-local.md）
| 检查 | 结果 |
|---|---|
| 根 `npm test` | 281 / 279 pass / 0 fail / 2 skipped（基线 255/253） |
| 10 个 local package build/typecheck/test | 全绿；dsh-pet 2813 pass / 43 skipped，dsh-memex 350，worktree-session 216 |
| subscriptions-sandbox-shim / ai-code-report-bridge（overlay） | 29 / 33 pass |
| `check:artifacts`、`openspec validate --strict`、`git diff --check` | 通过 |
| compat/subagent 构建（0.2.0 源码） | 语义门 160 通过，5 marker + deliverSubagentPrompt 命中 |
| 生产文件 | `~/.dsh` 未写；`profiles/web/cordis.patch.yml` sha256 前缀 `d2951d0b0814b220` 未变；3080 未重启 |

## 必须在 devbox 做（本地无法或不应做）
按 tasks.md 顺序，**所有步骤用独立 `DSH_HOME` 与非 3080 端口**：

1. **0.3 / 3.1 快照与候选**：拷入 sessions、Pet SQLite、profile、`settings.yaml` 的 owner-only 副本；记录生产启动清单、loader 行数、memex 逐工作区路由/主入口/开关。
2. **3.2 裸官方 0.2.0**：CLI、`--dump-config`、Web 认证链；`settings.yaml` 首启导入后出现 `settings.yaml.imported`，记录被拒分节（日志 `section %s ... was not imported`）。
3. **6.1 候选全组合**：`node scripts/sync.mjs` 连跑两次，第二次 `no changes`；profile patch 中：
   - 区段后紧跟锚行 `- insert: [] # ohmydsh: anchor…`；
   - `dsh-memex` / `session-links` 各有一条运行时所有行，含 org 键与（memex）`settings.yaml` 的 scopes；
   - `preset-dsh-pet-executor` 声明行在区段内，`$DSH_HOME/.agent-presets/dsh-pet-executor` 已不存在。
4. **5.3 launcher**：首次 Host 启动构建 `.launcher`（安装 `@deepseek-ai/dsh@0.2.0-rc.2` + subagent override），确认依赖树中 cordis 唯一、`npm ls --all` 无 problems；磁盘至少预留 3 GB。
5. **3.8 / 4.5 设置页**：记忆设置页增删 scope → 立即生效（不重启）；保存被拒时显示「保存被拒绝」；再跑 sync ×2 后值仍在、`internalHosts` 仍生效。
6. **3.9** connection 405 片段：去掉时插件 RPC 405，加回 200。
7. **3.10 Session v4 演练**（脱敏副本）：首次写入发布 v4；重启一致；回滚到 0.1.5 + 恢复备份可读。memex 召回注入行的 source 为 `plugin:dsh-memex`。
8. **3.11 / 3.12 / 5.8 UI**：会话标题复制徽标、侧栏 provider 图标、受限地区守门预热随会话切换；Pet 打开会话 / 打开 locus 子代；Worktree 首发 handoff。
9. **5.1 / 5.6 / 5.7 Pet**：名额池（默认 8）占用与释放；silent 结算、idle child、independent 冷恢复 + 已保存 preset、精确 child Session、Storage 原子性；executor preset 挂载；轮盘、真实飞书入口与媒体下载。
10. **1.6 / 1.7 / 2.6 第三方**：费用面板（cost-meter 1.8.11）、订阅登录与 codex 目录（0.9.7）、宽度档位、better-sidebar 0.24.1 终端、skin-center / session-archive 0.4.4（含活跃会话归档被拒的提示）；启动清单不含 traex。

## 已知风险（验收时重点看）
- `settings.yaml` 由 sync 种子和上游首启导入**两次**写同一行；本地推断二者值相同、上游合并幂等，但未在真实 0.2.0 上观察过。
- launcher 的 undici 7.30.0 偏差沿用 0.1.5 结论（`dsh-http-proxy` 仍声明 `^8.10.0`），需在 Node 24 上复测 JSON 读取接口。
- cockpit-bridge 仍为 0.5.1（peer 只要求 cordis），未在 0.2.0 上实测。
- 前一次根测试出现过一次 `launcher-npm-env` 偶发失败（之后多次复跑均通过），留意是否在 devbox 复现。

## 回滚
任何一项失败：不合入；生产仍在 main（0.1.5），无需回滚。若已合入：回到 main `c9e927e5a` 与 overlay `a999c01`，`dsh build` ×2，恢复 6.4 备份，由用户 `dsh restart`。
