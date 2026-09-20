# Pet mention open-id 与触发者显示名规范追平

本 note 记录已随 `pet-locus-delivery-safety-hardening` 真机验收发布、后来补入规范的两项行为。

## 出站 mention

Locus 业务回复仍优先把 `@显示名` 按当前 chat 成员的精确「显示名 → open_id」映射渲染为平台 `<at>` 标记。
当 Agent 只拿到成员的 `ou_…` 并写出 `@ou_…` 时，Host 也会用同一份当前 chat 成员表的反向
「open_id → 显示名」映射渲染为真实提醒。非成员 open_id、歧义显示名、词内 `@`、已有标记以及成员表
不可读时保持既有 fail-soft 规则，不猜测、不跨群解析、不阻断 Delivery。

## 触发者显示名

统一 locus 投递提示包含触发消息、触发者身份与会话标识，但不包含压平的历史消息。Host 可从当前 chat
成员列表解析触发者显示名，并将显示名与 open_id 一并放入投递提示词和 Delivery 记录；这属于触发者
身份，而不是会话历史读取结果。成员解析失败时只保留 open_id，投递照常继续。

## 证据

- `packages/dsh-pet/src/host/channel/mentions.ts`：成员 open_id 兜底渲染。
- `packages/dsh-pet/src/host/channel/lark.ts`：复用带 TTL 的人类成员列表解析显示名。
- `packages/dsh-pet/src/host/channel/locus-controller.ts`：投递前填充 `senderName`。
- 真机 `delivery-39`：`senderName = 张勇`，Host 记录 `rendered 1`，飞书原始消息含
  `mentions: [{ id, key: "@_user_1", name: 张勇 }]`。
- 相关规范 delta：`pet-locus-collaboration` 与 `pet-lark-channel`。
