# 验证与复核

2026-10-27，按 tasks 实施；不部署、不重启 3080、不做真实订阅模型付费调用。

## 实现范围

- Host：新增 `src/support.ts`（`autoSupportedModel` / `mainSupported` / `currentMainSelection`）；`src/policy-host.ts` 在 `agent/pre-step` 判 Jev 前与 `agent/request` 实际配置处统一门禁，不支持模型落 MANUAL 且不改写；effort 映射失败降级为 `no-effort-support` 不阻断请求；`src/index.ts` 的 `agent/created` 默认 AUTO 增加支持范围保护，policy-v2 `state`/`setMode` 返回 `autoSupport` 并于不支持时强制 MANUAL + `policy.invalidate`。
- Client：`View.autoSupport`；锁定态芯片显示 `MANUAL` + 官方描边图标 `IconInfoOutlineRegular`，用 `aria-disabled`（非原生 disabled，保证 hover 可用），点击不调用 setMode；悬停面板说明仅支持 Claude/GPT 系列并给出仓库 issue/PR 链接；可通过官方 `ctx.modelDirectories` 的会话选择 store 即时触发状态重取（服务缺失时退回 3s 轮询）。
- 文档：README.md / README.zh.md 主会话段落补充支持范围与锁定行为。
- 测试：新增支持范围矩阵、AUTO 落锁、状态接口、映射失败降级、客户端锁定渲染与点击行为用例；`test/content.test.ts` 的 egress 主机允许列表加入 `github.com`（仅用户点击打开的静态说明链接，代码不发起请求）。

## 实际执行结果

- `vitest run`（完整包）：34 个测试文件，**33 通过 / 1 失败**；268 个测试，**266 通过 / 2 失败**。
  - 失败为 `test/usage-report.test.ts` 的 2 个 zstd 截断尾帧用例（`tail-incomplete` 期望 1 实际 0）。
  - 已单独复现：本机 Node v24.16 的 `zlib.zstdDecompressSync` 对截断帧返回空结果而不抛错（`cut 1/5/9` 均 OK），而该测试假定截断帧会抛错。本次 diff 未改 `src/usage-report.ts` 或 `test/usage-report-fixture.ts`（其只依赖 `node:zlib` 与未改动的 `feedback.ts`），因此记为**既有环境差异**，不并入本 change 的验收。
- `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json`：通过。
- `tsc -p tsconfig.json && tsdown`：通过（host lib + client bundle 76.66 kB）。
- `openspec validate auto-unsupported-model-lock --strict`：通过。
- 归档时发现 current spec 结构问题：`默认新策略与显式回滚`、`新策略决策与执行`、`手动隔离与失败可见` 三个 Requirement 位于 `## 当前默认 AUTO 契约` 自定义小节下，不在主 `## Requirements` 段内，OpenSpec 1.4.1 无法合并 delta（archive 中止且未改文件）。为完成归档，将这三段 Requirement 原样移入 `## Requirements` 首部，并把原小节改为一段说明；`openspec validate --specs --strict` 通过（48 项），随后 `openspec archive` 成功（+1 added / ~1 modified）。同一结构问题也存在于未归档的 `auto-routing-policy-and-enforcement` 等 change 的后续归档路径，需在各自归档时留意。
- Rust/Go 等无关构建：不适用。

## 复核边界

- 未在真实 3080 GUI 上验证悬停面板、info 图标观感与链接点击；这是浏览器侧验收，需部署后人工确认。
- 未执行 `dsh build`、未重启 DSH；Host 侧改动需要重建与重启才在现有 GUI 生效。
- 未对真实 DeepSeek / Claude 订阅发起付费模型调用；落锁与映射降级由 fake adapter 集成测试覆盖，不声称真机 provider 行为已验收。
- 子任务路由（fail-closed）与 legacy 回滚未改动，既有相关测试全部通过。
- `usage-report` 在上述 Node 版本下的截断帧识别缺陷属于既有风险，未在本 change 内修复。


## 隔离预览验收（2026-10-27，实际执行）

- **环境**：worktree 内隔离 DSH home `.git/ws/dsh-home/e306ecb1-…`（由 `ws prepare-preview` 拥有），预览端口 **3276**，日常 3080 未改动、未重启。
- **隔离构建**：干净 worktree 的 `bin/dsh` 因 lean 依赖判定失败，改为 `scripts/launcher/environment.mjs` 载入 worktree `.env.local`（`DSH_HOME`=隔离 home）后执行 `node scripts/sync.mjs`；首次构建需预置隔离 profile 的 `.npmrc`（`@byted`/`@dp`/`@logsdk` scope registry）与 `pnpm-workspace.yaml` 的 `allowBuilds` 决策，并需在 worktree 内完成本地 package 构建（`packages/*/lib`），否则 local plugin 会以缺 lib 形态部署。修复后 `sync` 完成，`ws prepare-preview` 返回 `status: ok`（8 writes，preferred port=3276）。
- **加载**：预览 `dsh.log` 在最后一次 `dsh web:` 之后 **0 条 “failed to import”**；`dsh-auto-model-routing` 正常加载。
- **Host API（真实 HTTP + cookie）**：
  - `POST /api/auto-model-routing.state` 对真实预览会话返回 `{"mode":"MANUAL","policy":"policy-v2","autoSupport":{"supported":false,"provider":"opencode-go","model":"deepseek-v4.1-flash"}}`；
  - `POST /api/auto-model-routing.setMode {mode:"AUTO"}` 仍返回同上的 `MANUAL` + `autoSupport.supported=false`（拒绝进入 AUTO）；
  - `POST /api/auto-model-routing.settings` 返回 `policy-v2` 配置（来自源 home 种子）。
- **真实 GUI（Chrome headless + Playwright，打开 token URL）**：
  - 默认模型 `DeepSeek V4.1 Flash` 下芯片渲染为 `MANUAL`，`data-locked="true"`、`aria-disabled="true"`、原生 `disabled=false`、含描边 info 图标、**不含切换箭头**；
  - 悬停整个按钮后面板可见，文本包含「AUTO 不支持当前模型 / opencode-go / deepseek-v4.1-flash 不在自动路由支持范围，已切换为 MANUAL。/ 目前仅支持 Claude / GPT 系列模型…」，链接为 `https://github.com/prgrmrwy/dsh-auto-model-routing`（`target=_blank`、`rel=noopener noreferrer`）；
  - 页面无 pageerror；截图 `/tmp/preview-accept2.png`（未提交，避免仓库留存截图）。
- **未覆盖边界**：预览目录只有 DeepSeek 模型可选，未能在真实 GUI 中走到「切回 Claude/GPT 后芯片解锁并手动启用」的正向路径（该路径由 `policy-host.integration.test.ts` 的 fake adapter 用例覆盖）；未发送真实模型请求，不验证 provider 侧实际 effort 消费。
