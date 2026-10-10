## Why

写卡提醒目前在回合将要结束时（`agent/turn-stopping`）通过 `agent.inject()` 注入。宿主语义是「回合结束前收到新消息就在同一回合里再跑一步」，因此模型在给出最终回答之后，还会被拉回来写卡，并以一句「已记录 N 张卡片」收尾。Web GUI 只完整展示回合的最后一条助手消息，真正的回答被折叠进工具调用分组里，用户看到的“答复”只剩写卡汇报。

这也违反了现行规范 `dsh-memex-integration` 中「提醒 SHALL 采用不打断当前回合的投递方式」「且不打断当前回复」的要求：实现上虽然没有中断流式输出，但抢走了回合最终回复的位置。

## What Changes

- 写卡提醒改为**延后到下一个回合**投递：本回合结束时只把提醒排进下一回合的队列，不在当前回合追加模型步骤。
- 当前回合的最后一条助手消息 SHALL 始终是模型对用户请求的回答，不会是对写卡提醒的回应。
- 保留现有前置条件：仅在「已召回且未写卡」时提醒；每次写卡前最多提醒一次；不自动写卡；关闭记忆的工作区不提醒；压缩后的状态规则不变。
- 代价（已被接受）：用户在这一回合之后不再发消息时，提醒不会被模型看到，这条经验也就不会被写成卡片。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `dsh-memex-integration`：修改「回合关闭前提醒写卡，且需满足前置条件」——投递时机从“当前回合追加一步”改为“排入下一回合”，并新增“回合最终回复不被提醒占据”的场景。

## Impact

- 代码：`packages/dsh-memex/src/lifecycle/index.ts`（提醒的投递方式）。
- 测试：`packages/dsh-memex/test/lifecycle.test.ts`、`packages/dsh-memex/test/lifecycle-runtime.test.ts`（原测试断言“同一回合多一次请求”，需要改为断言“提醒出现在下一回合的首个请求中”）。
- 文档：`packages/dsh-memex/README.md`、`packages/dsh-memex/docs/integration-notes.md` 中对提醒时机的描述。
- 部署：需要 `dsh build` 并重启 DSH 才能生效；不涉及 manifest pin 或第三方依赖变化。
