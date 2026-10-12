## Why

2026-09-24 至 2026-10-08 的召回评估（rubric v3，60 次召回）之后又迭代了三版评分规则，都没有被采用。根因是历史记录缺少只在当时才存在的事实：查询那一刻库里有哪些卡、命中的是卡的哪个版本、这次召回为了什么、属于哪个任务。旁观者事后无法分清记忆的贡献来源。同一评估还显示，Agent 大多只看召回摘要（内核只展示每张卡的标题与第一段），而现有卡片的第一段常常只是铺垫。

本 change 按 `packages/dsh-memex/docs/effectiveness-evaluation-draft.md` 的讨论结论，做两件事：补齐以后能回答“记了没有、找到没有、用对没有”所需的记录；并只做一项优化（唯一 P0），让卡片第一段可以直接使用。

## What Changes

- **召回遥测补记判据**（仍不记查询原文与卡片正文）：每个被查库当时的 git commit 与是否有未提交改动；每条命中的卡片内容 hash、`modified` 与名次；每条命中由第几个查询词在哪个字段命中（近似内核权重的复算，只用于记录）；会话 id 的 hash 与工具调用 id，用于和会话记录对齐。
- **新增写卡事件遥测**：每次写入成功后记录库、slug、新建或覆盖、时间、会话 hash、调用 id，以及写入时的模型。来源只进遥测，不进卡片 frontmatter。
- **召回工具新增可选参数 `intent`**（`memex_search`、`memex_recall`）：Agent 在看到结果前声明召回目的（`gap` / `background` / `by-name` / `dedupe` / `verify`），只写入遥测，不改变检索参数与结果。工具描述保持上游原文不变。
- **唯一 P0：写卡要求第一段可独立使用**。在本仓库注入的召回引导与环境级指令中，要求卡片第一段依次写清触发情境、结论或做法、适用边界、使用前最低核验，背景放在后面；同时提示调用召回工具时声明 `intent`。不改上游 skill、工具描述、卡片格式与检索排序，不回写已有卡片。
- 召回报告命令兼容新字段；旧记录照常读取。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-memex-memory`：修改「召回遥测记录检索判据，不记录原文」以纳入库快照、卡片版本、命中解释、关联键与意图；新增「写卡事件遥测」「召回意图参数只用于遥测」两条要求。
- `dsh-memex-integration`：修改「会话开始时注入召回引导」，注入内容增加卡片第一段的写法要求与召回意图提示，并说明这是本地附加要求、不改写上游方法论。

## Impact

- 代码：`packages/dsh-memex/src/tools/index.ts`（参数、记录调用、写入事件）、`packages/dsh-memex/src/telemetry/`（记录类型、命中解释、库快照、写入事件 sink）、`packages/dsh-memex/src/lifecycle/index.ts`（注入文本）、`packages/dsh-memex/src/telemetry/report.ts`（兼容）。
- 指令：`instructions/dsh-home.md` 的写卡要求一句（经 sync 物化到 `$DSH_HOME/AGENTS.md`）。
- 测试：`packages/dsh-memex/test/` 下 tools、telemetry、lifecycle、recall-report 相关用例。
- 版本与部署：dsh-memex 0.3.0 → 0.4.0，`dsh.yaml` 同步；需 `dsh build` 与重启，在用户确认 DSH 空闲后进行。**部署会同时带上尚未部署的 `dsh-memex-defer-write-reminder`**（CHANGELOG Unreleased 中的条目），其 GUI 实测可一并完成。
- 与未开工的 `dsh-memex-demote-in-context-self-cards` 同样改动 `tools/index.ts` 与命中记录类型，彼此不依赖；后者若之后实施需在本 change 之上重排。
- 评估（仓库外，不提交）：用新规则在 2026-09-24 至 2026-10-08 历史数据上重算可回溯部分的基线；上线后 1 周看写入端，3–4 周看检索与消费端。
