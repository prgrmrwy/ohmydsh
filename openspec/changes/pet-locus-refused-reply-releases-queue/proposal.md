# Proposal

## Why

当一个 locus child 对当前 Delivery 的 `pet_locus_finish` 被授权拒绝（例如 `mixed-source`、`association-unproven`），而该轮随后结束、child 不再续进时，这条 Delivery 仍是 `current`，按单 current 队列规则会把同一入口后续所有消息堵到软期限（默认 1 小时，`wait` 可延长）。用户只看到"处理中"表情，长时间无回复、无解释。2026-10-20 「下线豆包工作伙伴」群实测 delivery-75 因结果轮回复被拒堵住后续两条 @ 消息近 30 分钟；同一模式 10-13 也出现过（被中断投递）。结果轮误拒的根因已在 `restore-pet-inquiry-runtime-channel` 修复，但授权拒绝是一类按规格必须保留的 fail-closed 行为（GUI 混入等），这个"拒绝后无人收尾"的缺口仍在。

## What Changes

- 当前 Delivery 在一个执行轮中出现过 finish 授权拒绝，且该轮结束时 Delivery 仍未终结、该轮也未成功调用 `pet_locus_wait`，Host 将其收尾为 `failed`，原因 `reply-refused`，并推进队列。
- 收尾不发送业务正文；沿用既有失败控制反馈（失败表情）让触发者知道这条没有回复。
- 同一轮内被拒后又成功 finish 的不受影响；被拒后成功 `wait` 的不收尾，仍由期限或后续续进决定。
- 不放宽任何授权规则，不新增出站正文类型，不改期限、`wait` 上限与启动恢复。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-collaboration`：Delivery 队列与终结规则新增"回复被拒且本轮未续进时收尾为失败"一条，及对应场景。

## Impact

- `packages/dsh-pet`：locus turn 观察与 Delivery 结算路径（记录本轮 finish 拒绝/wait 成功，turn-end 时按规则收尾）、失败反馈复用。
- 现役群：被拒后的 Delivery 不再堵队列到期限；正常回复、询问等待（先 `wait` 再结束本轮）的行为不变。
- 需要本机重建与重启 Host 生效。
