## Why

TypeSafe Jev 直连 API 对当前出口地区返回 HTTP 451（`{"title":"Typesafe is not available in your region."}`），导致所有 `mcp__jev__*` 工具与 `jev-workflow-router` 不可用。（2026-10-20：`auto-model-routing` 已自带直连 OpenRouter 的 Jev 客户端，不依赖本 change。）上游 `@jkudish/jev-mcp@0.14.1` / `@jkudish/jev-agent-tools` 已支持 TypeSafe、OpenRouter、Cloudflare、Vercel 四种 provider，但本仓接线层把 provider 与凭据硬编码为 TypeSafe，换 provider 无法只靠配置完成。

## What Changes

- **Spike（先行）**：在 OpenRouter（首选）上验证 Jev choice 可用、10 条本地样本的 p50/p95 延迟、单价与数据保留条款；结论写入 `spike-jev-provider.md`，由用户确认条款后才可启用该 provider。spike 不通过时，本 change 只交付“可配置化”，不切换现役 provider。
- `dsh.yaml` 的 Jev 条目改为声明 `provider`（闭集：`typesafe` / `openrouter` / `cloudflare` / `vercel`）与对应的凭据环境变量名；每个 provider 的凭据变量名为固定闭集映射，不接受任意变量名。
- `scripts/lib/third-party-resources.mjs`：校验改为按 provider 校验凭据变量名；生成的 cordis 行与 launcher 只透传该 provider 所需的凭据变量，并写入对应 `JEV_PROVIDER`。Cloudflare 额外透传账户 ID 变量。
- `scripts/jev-readiness.mjs`：凭据就绪检查按所配置 provider 的变量名进行，报告字段不再写死 TypeSafe。
- 凭据仍只经本机凭据/环境通道读取，不进入仓库、生成文件、部署账本、日志或错误记录。

## Capabilities

### New Capabilities
- `jev-provider-transport`: 定义 Jev provider 闭集、凭据映射、MCP launcher 配置与错误规范化；不提供不可用降级，也不为其它 change 提供 Host 侧 transport。

### Modified Capabilities
- `jev-workflow-routing`: “Routing evidence is bounded, private, and auditable”中的错误类别闭集新增 `region-blocked`；外部处理方由固定 TypeSafe 改为“所配置的 Jev provider”，provider 变更需在路由证据中可识别（记录 provider id，不记录凭据）。

## Impact

- `dsh.yaml`（Jev 条目）、`scripts/lib/third-party-resources.mjs`、`scripts/jev-readiness.mjs` 及其测试（`tests/` 中第三方资源与 readiness 相关用例）。
- `skills/jev-workflow-router/recorder.mjs`：错误枚举新增 `region-blocked`，记录 provider id。
- 外部服务：可能新增 OpenRouter 作为数据处理方（经其转发至 TypeSafe），需用户确认条款。
- 回滚：`provider` 改回 `typesafe` 并 `dsh build`。
