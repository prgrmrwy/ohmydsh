## Why

两个行为在 `pet-locus-delivery-safety-hardening` 的真机验收期间随缺陷修复一起发布，但没有对应的 delta spec：
一是出站 @ 渲染新增了「成员裸 open_id」这条解析路径，二是投递提示词与 Delivery 记录开始携带发送者显示名。
规范因此落后于已发布行为，其中一处还与 `pet-lark-channel` 的 `会话内容由 Agent 自取而非预先注入` 存在字面张力。
本 change 把规范追平到实际行为，并澄清那条张力，使后续实现与审查有唯一真相源。

## What Changes

- `pet-locus-collaboration` 的 `出站业务回复的 @ 引用渲染为平台真实提醒` 扩展：渲染除「显示名 → open_id」外，
  也接受**本 chat 成员的精确 open_id**，改写为 `<at user_id="ou_…">显示名</at>`；不属于本 chat 的 open_id 保持原文。
  动机：Agent 若只拿到 `ou_…`，写出的 id 原本会作为纯文本发出——对方收不到通知，且 open_id 被公开在群里。
- `pet-lark-channel` 的 `会话内容由 Agent 自取而非预先注入` 澄清：禁止的是把**压平的历史/消息读取结果**注入 prompt 或落库；
  而**触发者身份**本来就被要求出现在注入中，因此从 chat 成员列表解析出的**显示名**可以出现在投递提示词与 Delivery 记录里。
  该澄清不放松「不注入压平历史」这条主约束。
- 记录本 change 的实现已在 `353b2c7` 随上一个 change 的验收发布；本 change 的剩余工作是规范与校验，不是新代码。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-collaboration`：`出站业务回复的 @ 引用渲染为平台真实提醒` 增加 open_id 解析路径与对应场景。
- `pet-lark-channel`：`会话内容由 Agent 自取而非预先注入` 澄清「触发者显示名」与「压平历史」的边界。

## Impact

- 代码：`packages/dsh-pet/src/host/channel/mentions.ts`（open_id → 显示名索引与解析）、
  `packages/dsh-pet/src/host/channel/lark.ts`（`resolveMemberName`）、
  `packages/dsh-pet/src/host/channel/locus-controller.ts`（投递前填充 `senderName`）、
  `packages/dsh-pet/src/index.ts`（端口接线）。
- 测试：`packages/dsh-pet/test/channel-mentions.test.ts`、`packages/dsh-pet/test/locus-controller-races.test.ts`。
- 行为：出站回复不再可能把裸 open_id 作为纯文本发出；投递提示词的 `sender` 行在有名字时呈现为 `显示名 ou_…`。
- 兼容性：无破坏性变更。成员列表不可读时两条改动都 fail-soft，回到「按原文发送 / 只呈现 open_id」的既有行为。
- 沿用既有边界：渲染仍只使用当前 chat 成员列表的精确映射，不做跨群解析、不猜测、歧义时不改写。
