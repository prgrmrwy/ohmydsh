# dsh-auto-model-routing

[English](README.md) · 简体中文

![AUTO 实际效果：「重构并调试」被判为 complex，用 high；随后的「改个名」被判为 simple，降到 low；悬停 AUTO 芯片查看判档，点击切到 MANUAL](docs/auto-routing.gif)

<!-- problem -->
不必每条消息都手动调高或调低推理强度。AUTO 下，每个用户回合由 Jev 决策模型（经 OpenRouter）判为 `simple` / `standard` / `complex` / `escalated`，插件**只调整你已选模型的推理强度**，不换 provider 和模型。Jev 任何失败都会让 AUTO 自动停用，芯片上显示原因。

**安装**：DSH `0.2.0-rc.2`，Node.js `>=22.19`。

```sh
dsh plugin --profile web add dsh-auto-model-routing
# 或从源码安装（出现提示时批准本地构建）：
dsh plugin --profile web add prgrmrwy/dsh-auto-model-routing
```

重启 DSH、刷新页面，再到**设置 → 自动模型路由**配置 OpenRouter key。配套 skill 已包含，提供委派指引，但不强制拦截每次派发。与模型池路由或本地分类器不同，本插件用外部 Jev 判档，始终不换主模型。演示来自隔离 Host，使用本地模拟的 Jev 和模型响应。

在 [ohmydsh](https://github.com/prgrmrwy/ohmydsh) 中只需启用 local `auto-model-routing` 条目并运行 `dsh build`，不再单独启用 skill 条目。

## 使用

| 位置 | 操作 |
|---|---|
| **AUTO / MANUAL 芯片**（模型选择器左侧） | 点击切换；悬停查看本回合 effort、最近一次 Jev 决策及其分布 |
| **判档提示** | 每次判档后在芯片上方显示 3 秒，例如 `complex → high · 0.70s` |
| 回复下方的**仪表按钮** | 悬停看判档，点击标注「这轮应该用哪档」 |
| **设置 → 自动模型路由** | OpenRouter key、默认模式、强度上限、判档等待上限、提示开关、路由映射（见下图） |

![设置 → 自动模型路由：判档服务、会话默认值，以及 Claude / GPT 分页下每档的主会话推理等级与子会话推荐](docs/settings.gif)

**缺省强度**：从各模型的官方推荐起点出发。standard 取起点，simple 降一级，complex 升一级，escalated 升两级；受上限约束（缺省 `xhigh`），AUTO 永不选 `max`。路由映射可逐格覆盖：主会话等级作用于同体系所有模型，子会话格为完整的 model + effort。

**子会话**：`route_subagent` 工具用同一套判档，返回 provider/model/effort（Claude：Haiku → Sonnet → Opus → Opus；GPT：Luna → Sol → Sol → Sol）。只有根会话为 AUTO 时才判档，否则返回 `routed: false`。这些路由须在官方子智能体允许列表中，该列表在会话创建时固定。

## 须知

- **新会话缺省 MANUAL**，可在设置中改。
- **失败即关闭**：无 key、余额不足、限流、地区受限、超时或响应无效时，会话切到 `MANUAL · Jev 停用` 并显示原因，点 AUTO 重试。没有本地降级，也不重试。
- **MANUAL 只停止调整**：会话保持 AUTO 最后设定的 effort。AUTO 也会把它写入官方模型选择，所以新会话会从这个值开始。
- **外发数据**：AUTO 下每个用户回合会把你的消息（最多 8000 字符）和上一轮的少量片段发给 OpenRouter / TypeSafe（`typesafe/jev-1.13`）。外发前先按形态脱敏（密钥、token、URL 凭据、IP），这是尽力而为，不保证去掉所有敏感信息。
- **key** 经官方 DSH 凭据服务保存，不写进插件配置。启动环境里的 `OPENROUTER_API_KEY` 优先且只读；要迁到 GUI，先从启动环境删掉它，重启一次，再在设置页保存。
- **文件**：设置在 `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`；每个会话的模式与判档记录在 `$DSH_HOME/state/auto-model-routing/`。改动在下一次请求生效，无需重启。

## 架构
<!-- section: architecture -->

![auto-model-routing 架构图：芯片与 RPC 端点、agent/pre-step 钩子经 OpenRouter 请求 Jev、agent/request 钩子只改推理强度、route_subagent 工具共用同一判断](docs/architecture.dual.svg)

`agent/pre-step` 钩子在每个用户回合的第 1 步判档；随后以 prepend 注册的 `agent/request` 钩子只改写 `reasoningEffort`，并同步到官方模型选择。入口 [`src/index.ts`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/src/index.ts)，判档规则 [`src/rubric.json`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/src/rubric.json)，强度表 [`src/effort.ts`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/src/effort.ts)，界面 [`src/client/`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/src/client/index.ts)，回归用例 [`eval/`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/eval/README.zh.md)，图源 [`docs/architecture.json`](docs/architecture.json)（archify）。

## 开发验证

```sh
npm test
npm run typecheck
npm run build
```

测试使用真实 AgentLoop、假 LLM 流和本地回环假 Jev，不访问 OpenRouter。`node scripts/label-report.mjs` 按规则版本汇总你的档位标注。

规范与设计：当前规范见 [`openspec/specs/auto-model-routing`](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/specs/auto-model-routing/spec.md)。归档 change 记录了设计演进：[路由](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/changes/archive/2026-10-22-auto-model-routing/design.md)（决策 D1–D14）与[设置](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/changes/archive/2026-10-23-auto-model-routing-settings/design.md)。配套 skill 见 [`skills/subagent-model-routing`](skills/subagent-model-routing/SKILL.md)。修改钩子前先读 [DSH 插件集成陷阱](https://github.com/prgrmrwy/ohmydsh/blob/main/docs/architecture/dsh-plugin-integration-pitfalls.md)。

## 移除
<!-- section: removal -->

运行 `dsh plugin --profile web remove dsh-auto-model-routing`，重启 DSH 并刷新页面；ohmydsh 则设为 `enabled: false` 并构建。插件提供的 skill 与工具一并撤销，设置和日志保留。会话保持 AUTO 最后设定的 effort，直到在模型选择器里另选。
