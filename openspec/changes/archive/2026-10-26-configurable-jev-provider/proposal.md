## Why

`jev-workflow-router` 的影子记录自 2026-10-14 后中断，已有记录的服务调用失败率为 86%。根因有两层：

1. 生成的 profile 行 `third-party-jev-bridge` 以 `disabled: !process.env.TYPESAFE_API_KEY` 门控。Host 启动环境与 `.env.local` 均未提供该变量，整个 MCP 桥被禁用，会话里没有 `mcp__jev__*` 工具。
2. 即便提供 TypeSafe key，TypeSafe 直连 API 对当前出口地区返回 HTTP 451（`Typesafe is not available in your region.`）。launcher 又把 `JEV_PROVIDER` 写死为 `typesafe`，且只透传 `TYPESAFE_API_KEY`，无法只靠配置换 provider。

当前 pin 的 `@jkudish/jev-mcp@0.14.5`（依赖 `@jkudish/jev-agent-tools@0.2.1`）已支持 OpenRouter：jev-mcp 自带 OpenRouter 请求路径（`POST https://openrouter.ai/api/alpha/decisions`，要求 `sk-or-` key，含其自身有界的 HTTP 状态重试），与本仓 `auto-model-routing` 已在用的接口相同。2026-10-26 实测：以 `JEV_PROVIDER=openrouter` 加用户已有的 OpenRouter key 启动 jev-mcp，12 个工具全部列出，一次 `jev_classify` 往返 1.06s，返回 `provider: openrouter`、`model: typesafe/jev-1.14-20261014`。

本 change 只恢复观察链路：shadow 行为、候选闭集、准入门槛与 Phase 1 边界都不变。

## What Changes

- `dsh.yaml` 的 Jev 条目新增 `jevProvider` 字段（不复用 `provider`：该名在 `npm-workflow` 条目中是 npm 包 pin，校验与完整性预检会把它当 pin 遍历），闭集为 `typesafe | openrouter`；每个 provider 映射到固定的凭据变量（`TYPESAFE_API_KEY` / `OPENROUTER_API_KEY`），不接受任意变量名。现役值改为 `openrouter`。
- `scripts/lib/third-party-resources.mjs`：校验按 provider 检查 `credentialEnv` 必须等于映射值；生成的 cordis 行（`disabled` 门控与 `env`）与 launcher 只透传该 provider 的单个凭据变量，并写入对应 `JEV_PROVIDER`。launcher 仍为替换式 env，不继承其它环境变量。
- 凭据通道：用户在已被 Git 忽略的仓库 `.env.local` 中声明 `OPENROUTER_API_KEY`，由 launcher（`scripts/launcher/environment.mjs`）注入 Host 启动环境。密钥不进入仓库、manifest、生成文件、部署账本、日志或错误记录。官方凭据库中的同名 key 保持不变（`auto-model-routing` 继续从那里读取），两处需各自维护。
- `scripts/jev-readiness.mjs`：凭据就绪检查改为所配置 provider 的变量名；会话文件查找兼容当前 `session.v4.jsonl.zstd`。
- `skills/jev-workflow-router`：错误类别闭集新增 `region-blocked`；每条新记录写入实际服务方 `jevProvider`：成功时取自工具结果 JSON 的 `provider` 字段，失败时只从上游错误文本的固定前缀识别服务方与 HTTP 451（错误文本本身不持久化）；无法识别时为 `unknown`。报告按服务方拆分并单列未归属数量，以便把 TypeSafe 时期的失败与 OpenRouter 之后的数据分开。旧记录该字段为 `unknown`，不回填。

## Capabilities

### New Capabilities
- `jev-provider-transport`: Jev MCP 服务方闭集、凭据变量映射、profile 门控行与 launcher 环境、凭据通道和就绪检查。不提供不可用降级或跨服务方自动回退，也不为其它插件提供 Host 侧 transport。

### Modified Capabilities
- `jev-workflow-routing`: “Routing evidence is bounded, private, and auditable”的错误类别闭集新增 `region-blocked`，记录新增有界的服务方标识，报告可按服务方拆分。

## Non-goals

- 不改变 shadow-only 边界，不进入 advisory，不修改 Phase 2 准入门槛（另起 change）。
- 不支持 Cloudflare、Vercel 服务方（上游支持，但本机无需求；需要时再加入闭集）。
- 不让 MCP 桥读取官方凭据库（`dsh-mcp-client` 只接收加载时求值的静态 env）。
- 不改 `auto-model-routing` 自带的 Jev 客户端。

## Impact

- 代码：`dsh.yaml`（Jev 条目与 note）、`scripts/lib/third-party-resources.mjs`、`scripts/jev-readiness.mjs`、`skills/jev-workflow-router/{SKILL.md,recorder.mjs}` 及 `tests/` 中对应用例。
- 外部服务：OpenRouter 成为 Jev 的转发方。只发送 SKILL.md 规定的有界枚举/数值/布尔特征，不发送会话正文。用户 2026-10-26 明确选择改用 OpenRouter；其数据保留条款未单独复核，记录在 manifest note 中。
- 部署：改完需 `dsh build` 并重启 Host，新会话才会出现 `mcp__jev__*` 工具。
- 回滚：`jevProvider` 改回 `typesafe`、`credentialEnv` 改回 `TYPESAFE_API_KEY`，`dsh build` 并重启。
