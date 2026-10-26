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

## AUTO 自动选配（默认策略）

AUTO 直接使用新策略，无需版本选择或额外开启。下面及前面的四档说明仅供旧策略回滚参考。主会话只判断 `lower/baseline/higher` 投入，模型保持不变；子任务独立判断能力与投入，在官方 fresh `subagent` / `spawn_teammate` 首次请求前绑定实际 child ID 并应用，恢复后保持初始配置。旧四档映射只用于原策略。

此分支 `route_subagent` 仅为可选预览，不必先预览再派发，不把推荐当应用，也不要把推荐复制成用户显式约束。显式 model/effort 保留；两者指定不判、只指定一个只判另一维。fork 未通过真实历史兼容门槛，明确拒绝，不擅自变为 fresh。未知/未绑定创建路径停止并报告。

通过 `auto-model-routing.childRouting` RPC（payload `{sessionId}`）查看 `recommended/applied/unsupported/needs-context/failed`。applied 只表示实际请求配置匹配，不表示任务成功或模型调用成功。记录只含最小身份、版本和路由，不含任务原文。切回原策略/MANUAL 停止新决策，已绑定实例维持初始路线；关闭插件才完全退出请求接入，届时恢复会用宿主创建配置。

见 [Jev 验证](docs/jev-policy-v2-validation.md)和[开发验收/支持矩阵](docs/policy-v2-development.md)。本地开发完成不代表已部署、默认推广或真实子模型收益验证。

### Magpie transport 与选择器展示

默认策略接受 `dsh-magpie`、`dsh-magpie-connect` 两个精确 transport，不互为 alias：完整 model id、实时模型能力、支持 effort/cap、当前允许列表与父 captured allowlist 都按原 transport 校验。未知家族需显式 model。根会话 AUTO 且显式 `policy: legacy` 时，两种 Magpie 预览均在 Jev 前拒绝；MANUAL 仍直接返回 `routed: false`，不判档、不写状态。已绑定子实例恢复原路线。

主请求可以正确使用 High，同时官方投影保留用户的 Next Medium。默认 AUTO 不为抹平显示调用 `selectModel`，因为官方 API 会保存全局 defaults，并可能覆盖下次 intent；MANUAL 请求保持原样。在 ohmydsh 中，Pet 受管 Host 扩展在同模型 trigger/根 effort 行展示 **最近实际：High · 下次：Medium**，勾选与提交仍按 Next。扩展一起重建 `llm`、`api-session-controller`、`api-remotes`、`client-ui-model-selection`、`client-ui-commands`（均为 `@deepseek-ai/dsh-` 包）。stock rc.2 仍可使用插件 route，但模型列表保持 flat、无 actual/next 文案。展示 metadata 不改变 route、model id 或名字。见 [Magpie 配置与展示前提](<../dsh-magpie/README.zh.md#模型菜单分组与实际下次-effort>)；本地测试不等于已部署或 live GUI 验收。

## 须知

- **新会话缺省 MANUAL**，可在设置中改。
- **失败即关闭**：无 key、余额不足、限流、地区受限、超时或响应无效时，会话切到 `MANUAL · Jev 停用` 并显示原因，点 AUTO 重试。没有本地降级，也不重试。
- **MANUAL 只停止调整**：主会话使用官方当前选择，不复原旧值。新策略按请求应用 effort，不调用会修改全局默认模型的 selectModel。旧配置保留供回滚；必要时通过插件配置/RPC 显式设 `policy: legacy`，不作为日常设置。
- **外发数据**：AUTO 下每个用户回合会把你的消息（最多 8000 字符）和上一轮的少量片段发给 OpenRouter / TypeSafe（`typesafe/jev-1.13`）。外发前先按形态脱敏（密钥、token、URL 凭据、IP），这是尽力而为，不保证去掉所有敏感信息。
- **key** 经官方 DSH 凭据服务保存，不写进插件配置。启动环境里的 `OPENROUTER_API_KEY` 优先且只读；要迁到 GUI，先从启动环境删掉它，重启一次，再在设置页保存。
- **文件**：设置在 `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`；每个会话的模式与判档记录在 `$DSH_HOME/state/auto-model-routing/`。改动在下一次请求生效，无需重启。

## 架构
<!-- section: architecture -->

![auto-model-routing 架构图：芯片与 RPC 端点、agent/pre-step 钩子经 OpenRouter 请求 Jev、agent/request 钩子只改推理强度、route_subagent 工具共用同一判断](docs/architecture.dual.svg)

`agent/pre-step` 钩子在每个用户回合的第 1 步判档；随后以 prepend 注册的 `agent/request` 钩子只改写 `reasoningEffort`；默认策略不改官方 next intent/全局 defaults，仅显式 legacy 回滚同步选择。入口 [`src/index.ts`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/src/index.ts)，判档规则 [`src/rubric.json`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/src/rubric.json)，强度表 [`src/effort.ts`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/src/effort.ts)，界面 [`src/client/`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/src/client/index.ts)，回归用例 [`eval/`](https://github.com/prgrmrwy/dsh-auto-model-routing/blob/main/eval/README.zh.md)，图源 [`docs/architecture.json`](docs/architecture.json)（archify）。

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
