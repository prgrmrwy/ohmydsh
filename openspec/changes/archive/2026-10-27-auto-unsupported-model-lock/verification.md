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
