## Why

用户想在使用一段时间后，观察 AUTO 期间的 token 用量变化，以及判断是否合适。所需数据已经分散存在本地：legacy 判档账本、policy-v2 决策绑定，以及会话日志里的实际 usage。但目前没有统一口径的报告，临时拼数据很容易算错，例如重复计数、只解出 zstd 第一帧、把多个策略混在一起，或者把位置效应和起点变化误当成判断效果。[feedback-evaluation.md](../../../../packages/auto-model-routing/docs/feedback-evaluation.md) 已定义计数口径，但也写明“本期不做报表”。

本报告是观察统计，用来回答“AUTO 期间用量和判断分布是什么样”，以及“数据覆盖了多少”。它不回答“AUTO 是否节省了 token”；因果问题仍需要受控对照，即 `auto-routing-policy-and-enforcement` 任务 4.3。

## What Changes

- 在插件中新增按需 skill `auto-model-routing-report`，随插件安装和禁用。只有用户明确要求评估 AUTO 效果或用量时才使用；不自动运行，不创建定时任务。
- 新增绝对只读的统计入口 `src/usage-report.ts`，构建到 `lib/` 随包发布。它复用插件的反馈账本读取逻辑，把 policy-v2 绑定按消息 ID 与会话日志中的实际 usage 精确关联，再按版本、模型和 depth 分组，输出 JSON。它不写文件、不联网、不调用模型。legacy 账本只用于确定首个 AUTO 记录的位置；legacy 时期的统计已有 10-24 的结果和 `label-report.mjs`，不再重复实现。
- 用 `--since` 指定起始日期，从追加写入的原始数据重新计算；不保存快照，前提是用户不删除旧会话日志。
- 报告固定输出：覆盖缺口、统计范围声明（仅主会话 assistant 调用）、样本是否足够，以及一份只含 effort 分布的 AUTO 前起点参照。
- 不修改路由、判档或反馈记录等运行时行为。补记未生效决策（方案 B）不在本次范围内。

## Capabilities

### New Capabilities

- `auto-routing-usage-report`：按需、只读的 AUTO 用量与判断观察报告，覆盖精确关联、计数口径、分组、覆盖缺口、范围声明、隐私输出白名单和 skill 调用边界。

### Modified Capabilities

（无。现有 `auto-model-routing` 的运行时要求不变；包内 skill 的分发沿用现有“插件安装自包含配套 skill”要求。）

## Impact

- `packages/auto-model-routing/skills/auto-model-routing-report/`、`src/usage-report.ts`、测试；`lib` 与 `skills` 已在 `files` 中。
- 只读访问 `$DSH_HOME/state/auto-model-routing/`（账本和会话状态文件名）和 `$DSH_HOME/sessions/**`。
- `docs/feedback-evaluation.md` 中“不做报表”改为指向本 skill。
- 需要发布新的插件版本，版本号和发布时机在实施阶段决定。
