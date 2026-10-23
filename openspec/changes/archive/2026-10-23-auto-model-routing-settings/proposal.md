## Why

auto-model-routing 的凭据、期限和模型映射分散在环境变量与代码常量中，缺少可操作的设置页。用户需要按任务档位明确配置主会话的 effort 与子会话的 model + effort，而不是查看一张以单个模型举例、混合可编辑值与计算结果的表。

## What Changes

- 新增官方设置区块「自动模型路由」，所有非密钥设置保存在 `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`：
  - OpenRouter API key 经官方 credentials 服务管理，仅显示配置状态、来源与可写性，不回传值。
  - 新会话默认模式 `MANUAL | AUTO`（缺省 MANUAL），不改变已有会话。
  - 自动 effort 上限 `low | medium | high | xhigh`（缺省 xhigh），同时约束主、子会话；自动路由永不选 max。
  - Jev 等待期限 1000–4500ms（缺省 3000）与现有决策提示开关。
  - **路由映射按模型体系分页**：首期 Claude、GPT；GPT 对应内部 provider id `codex`。每页四档 ×「主会话推理等级」「子会话推荐」两列。
  - **主会话映射**按 provider/tier 保存四档 effort，统一作用于当前体系所有主模型；删除页顶主模型选择器，但保留表格主 effort 列。未覆盖格显示「默认（随模型）」，继续使用实际模型起点算法。
  - **子会话映射**按 provider/tier 保存 `{model, reasoningEffort}`，两者均可选择；未覆盖的格子沿用现有模型表与起点算法。
- 子会话使用官方 picker 风格：收起显示「模型名 推理等级」，打开为「模型」「推理等级」两级菜单。模型只可选官方允许的路由，effort 只可选该模型支持且不超过上限的等级；保存时 Host 再校验，不静默替换用户的选择。
- 只有已存模型后来退出允许列表、模型能力变化或上限与显式映射冲突时，才显示失效状态，要求修复；旧值不得成为可选项。
- 设置内各分段控件采用统一紧凑尺寸，Claude/GPT、模式与上限的高度、字号、内边距一致，不拉伸为大块按钮；按标题/字段/提示体现层级。
- 档位为英文名 + info，说明直接使用 `rubric.json` 的英文 `criteria` 原文，不维护翻译副本。
- 不开放判档规则、外发范围、脱敏规则、OpenRouter 地址、Jev 模型 id、effort 缺省起点表、失败即停用规则。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `auto-model-routing`：默认模式、凭据来源与期限可配置；主会话体系级 effort 映射与子会话 model + effort 映射可配置；新增设置端点及分页设置页；保留不换主会话模型、官方门禁不可绕过和 Jev 失败即停用等不变量。

## Impact

- `packages/auto-model-routing/src/`：设置存储与校验、主会话映射、子会话工具、Jev 凭据/期限、设置端点、模型目录与官方白名单读取、client 设置页及 picker。
- 复用官方 `ui-primitives` 的表单、分页、菜单、提示与图标；完整 `ModelSelect` 未公开导出且绑定真实会话，不直接导入、不改 DSH core、不用 `selectModel` 保存设置草稿。
- 非密钥数据新增 `mainEfforts` 与 `childRoutes`，本 change 早期草案的 `childModels` 尚未发布，不实现兼容迁移。旧文件只有 `decisionToast` 时行为不变；会话状态格式不变。
- 同步 package 中英文 README、架构图、`dsh.yaml` 的凭据/配置说明；计划 package 与 manifest 升为 0.2.0。
- 本 change 不涉及进行中的 `configurable-jev-provider`（其范围为 Jev MCP 接线）。新增体系以后按 provider 元数据扩展分页；本期不增加任意 provider 或动态体系注册框架。

### 2026-10-23 用户修订

主表仍保留，但不再选具体主模型。已有 per-model `mainEfforts` 不静默沿用、合并或删除：读取显式诊断且使用时拒绝；界面允许明确重设整组体系覆盖。无覆盖的旧配置（如仅 decisionToast）保持原行为。此前 checking Loop 2 是逐模型旧设计的历史证据，不能当作新体系映射的验收结果。
