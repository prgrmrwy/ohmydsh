# W3 本地实现证据（worktree 内装 0.2.0-rc.2 依赖，隔离 DSH_HOME；未部署）

## 3.3 版本族
- `dshVersion` 0.1.5-rc.2 → 0.2.0-rc.2；skill-filesystem / mcp-client provider pin 与 integrity 改到 0.2.0-rc.2。
- 11 个 local package 共 149 处 `@deepseek-ai/dsh-*` 范围改为 `^0.2.0-rc.2`。上游已删除的两个包按接口迁移处理（repo-layout「上游移除的运行体包不得被机械改写」）：
  `dsh-pet` 的 `dsh-agent-presets` → 承接包 `dsh-agent-preset-registry`（服务名同为 `agentPresets`）；
  `dsh-memex` 的 devDep `dsh-settings-file` 删除，随 W4 设置重写一起处理。
- 根 lockfile 需要重新解析（旧锁把 0.1.5 精确版本互相钉住，`npm install` ERESOLVE）。重解后：86 个 `@deepseek-ai/*`，**无重复版本、无残留 0.1.x**，cordis 4.0.4、schemastery 3.18.4。
- `scripts/jev-readiness.mjs` 的期望版本改为读 manifest `thirdPartyResources`（原来 jev/bridge/superflow/provider 四个版本全写死）。
- `dsh-pet` 与 `dsh-pet-executor` 在**候选内**暂时 `enabled: false`（用户确认，design D4），manifest 注释写明生产切换前必须恢复。

## 0.2.0 类型检查发现（对照勘察结论）
| 包 | 问题 | 勘察时是否预见 |
|---|---|---|
| home-network-model-guard / session-title-copy / sidebar-session-provider-icon | `SessionListState.current` 被删除 | **否**（新增任务 3.12） |
| session-links | `ContentBlock.isError` 不存在 | 是 |
| worktree-session | `agent/created` 监听器返回值类型变为 `Promise<undefined> \| undefined` | 部分（事件预见，签名未预见） |
| dsh-memex | `kind:'plugin'`、`SettingsScope`、`settings.register` | 是（W4） |
| dsh-pet | `agent/created` 签名 | 是（W5） |

## 修复与测试（全部在 0.2.0 依赖上跑）
- **mainSessionId**（3 包各一份 `src/client/main-session.ts`）：0.1.5 读 `current`，0.2.0 读 `retainedBy.mainView > 0`。依据：官方 `ui-workspace` navigation 每次导航只为目标会话 retain `mainView` 并 release 上一份，官方 `ui-session.publishMain` 用同一判据。各加 3 例单测（两种形态 + 无选中）。
- **session-links**：失败判定同时认 0.2.0 tool-role 消息顶层 `isError` 与旧 `tool-result` 块；新增 0.2.0 形态用例，对旧代码红。
- **subscriptions-sandbox-shim**：配对同时认 `role:'tool'` + `toolCallId`；孤儿 tool-role 结果整条消息丢弃（不留空 tool 消息）。新增 3 例，对旧代码 2 红。这是静默破坏：旧代码在 0.2.0 下会把所有工具调用当孤儿删掉。
- **worktree-session**：`agent/created` 监听器显式返回 `undefined`；handoff 透传 0.2.0 `input.submit(mode, source)` 的 `source`（官方只用于 product-analytics）——新增用例对旧代码红；固定「0.2.0 对活跃会话拒绝归档」走既有 archive-failed、资源全保留的用例；`agent-loop-context` 测试辅助认 0.2.0 的 `kind:'runtime-context'`（插件代码本身不依赖来源形态）。

| 包 | build | typecheck | test |
|---|---|---|---|
| cockpit-memex-browse-shim | ok | ok | 9 |
| cockpit-worktree-open-shim | ok | ok | 4 |
| home-network-model-guard | ok | ok | 73 |
| session-links | ok | ok | 59 |
| session-title-copy | ok | ok | 23 |
| sidebar-session-provider-icon | ok | ok | 28 |
| system-clock | ok | ok | 21 |
| subscriptions-sandbox-shim | — | — | 29 |
| worktree-session | ok | ok | 216 |

根 `npm test`：267 / 264 pass / **1 fail** / 2 skipped。唯一失败是 `pet-locus-runtime-override` 的「runtime patch 必须钉在 manifest DSH 版本」——这是设计上的守卫（版本变化必须重新审计 Pet compat），按计划由 W5 的 5.2 消除，不是遗漏。

## 3.7 第三方
- better-sidebar 0.19.1 → 0.24.1：出站域名不变；依赖删 `node-pty`、`schemastery`，加 `@deepseek-ai/schemastery`、`yaml`（终端改走 0.2.0 官方能力）。
- skin-center 0.3.24 → 0.4.4：出站域名不变；`prepare` 脚本只在 git/目录安装运行。
- session-archive 0.3.24 → 0.4.4：依赖与出站域名不变，无 child_process。
- cockpit-bridge：0.5.1 与 0.6.0 的 peer 都只有 `cordis ^4.0.1`，暂留 0.5.1，候选实测后定。

## 留待候选 / devbox
3.1、3.2、3.8–3.12：需要隔离 `DSH_HOME` 与真实 0.2.0 Host。
