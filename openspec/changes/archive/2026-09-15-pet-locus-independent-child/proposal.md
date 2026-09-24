## Why

真实答疑群验收已证明独立 child 可以经原生 `send_message` 问到 caller-bound main，但父回复可能在原飞书 turn 结束后才进入 child；现有实现却把 `turn/end` 当成 Delivery 完成，提前撤销回复目标，导致 child 随后正确调用回复工具仍被判 stale，飞书没有正文。

所有者决定继续收敛：不引入完整 inquiry/continuation 平台，而把每个 locus 的飞书请求作为严格串行、带租约的 Delivery 队列处理。child 自己维护处理过程，Host 只维护当前请求、触发消息锚点、截止时间与完成提交，从而先让 Pet Locus 可稳定使用。

## What Changes

- 新建与显式重建的 locus child 使用零父上下文 provider；创建前核验其确实不继承父上下文，无法证明时 fail closed，不回退 fork。
- 每个活跃 locus 同时只向固定 child session 投递一个 current Delivery；后续合格飞书消息持久按接收序排队，当前项终结后才投递下一项。模型 `turn/end` 不再代表 Delivery 完成。
- **BREAKING**：以单一 caller-bound `pet_locus_finish` 替代 `pet_locus_reply`。child 明确选择 `reply`（提供正文）或 `no-reply`（提供原因）；Host 从唯一 current Delivery 解析触发 `messageId`，提交终态后推进队列。
- 新增 caller-bound `pet_locus_wait({ waitMinutes, reason? })`。模型声明“从现在预计还需等待多久”；可重复声明，但 Host 维护从消息接收起最多 24 小时的绝对硬上限，默认期限为接收后 1 小时。
- current Delivery 到期后由 Host 标记 `expired`、尽力中止该次运行并推进到下一条未过期消息；超时不重建 child session、不清除 locus 历史。过期 backlog 直接跳过。
- 群级和话题级回复都绑定本次触发消息的 `messageId`；话题回复还必须留在原话题。模型不能提供或替换 chat/message/thread 目标。
- 父子 `agent-message` 只交换上下文：current 存在时可跨模型 turn 继续处理同一 Delivery，但该消息不创建、修改或选择回复目标。GUI/user、来源未知及无 current 的 agent message 不获得完成或回复能力。
- 采用简单的 at-most-once 出站语义：明确成功、明确失败或发送结果未知都会终结该 Delivery 并继续队列；结果未知不自动重发。
- 本期不实现 `/new` 清理命令，也不实现原生 `send_message` 的 pair/correlation；只把二者保留为后续逃生与迟到回答隔离方向。
- 不引入上下文模式字段，不自动迁移或裁剪已有 child 历史，不实施 B035 的公共事实、answer store、result outbox 或 continuation segment 平台。

## Capabilities

### Modified Capabilities

- `pet-locus-collaboration`：新 child 使用独立上下文；飞书工作改为 locus 级单 current Delivery、显式 finish、有限 wait 与超时推进。

## Impact

- Pet Host：`src/host/locus/child.ts` 的独立 provider 行为保留；Delivery ledger/persistence、locus channel controller、caller-bound context/tool、turn observer、启动恢复与严格 Lark reply adapter 需要对齐新的串行租约模型。
- Agent 工具：移除 `pet_locus_reply`，新增 `pet_locus_finish` 与 `pet_locus_wait`；两者均不接受任何路由选择器。
- 数据：Delivery 需要持久保存 current/backlog、deadline、完成类型与出站结果；需要 additive schema/domain version 迁移并对未知版本 fail closed。
- 运行时：继续复用同一个独立 child session；超时只关闭当前 Delivery/运行，不自动重建 session。
- 前置：`pet-unified-locus-collaboration` 尚未归档；本 change 修改其中 `pet-locus-collaboration` 的上下文及投递/结算要求，归档时必须按前置 change 后、本 change 的顺序对齐。
