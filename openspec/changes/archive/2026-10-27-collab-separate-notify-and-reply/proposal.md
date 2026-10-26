## Why

协作结果可能无需回信，却需要叫醒等待结果的会话继续工作。当前 needsReply 同时控制唤醒和待回复问题，导致这种结果只入账而不通知；用户已于 2026-10-27 明确要求拆开两个意图。

## What Changes

- 消息增加可选布尔 notify，显式值独立控制唤醒；needsReply 仅控制待回复问题。未提供 notify 时沿用 needsReply 的旧唤醒语义。
- 新提交持久化有效 notify；旧日志缺字段按 needsReply 解释，旧 cmdId 收据与参数哈希不变。
- 所有实际产生 wake 的消息都计入话题上限；投递 mode 以有效 notify 为前提。
- 更新工具说明、约定 v4、接入投影和 Pet 通知来源识别，保留状态入口结构和定向指针协议。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `collab-kernel`: 独立通知意图、兼容重放、投递 mode、话题限额与约定。
- `dsh-collab`: 工具透传 notify，戳投影识别独立通知，待回复仍只看 needsReply。
- `pet-locus-collaboration`: Pet 代理按有效通知意图识别消息来源。

## Impact

修改 collab-kernel、dsh-collab、Pet 协作接入的局部判断及相关规范、测试、说明。不处理队列显示，不修改 Magpie、AUTO、Cloudflare、生产连接；不部署、不重启、不合入。无新增依赖。已建立 collab-notify-split 空间向相关 Access 会话通报写范围。
