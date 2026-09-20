## 1. 已随上一个 change 发布（本 change 记录并核对）

- [x] 1.1 `mentions.ts` 增加 `open_id → 显示名` 索引与解析分支：`@ou_…` 命中本 chat 成员时改写为 `<at user_id="ou_…">显示名</at>`，未命中或词内 `@` 保持原文（提交 `353b2c7`）。
- [x] 1.2 `lark.ts` 增加 `resolveMemberName(chatId, openId)`，复用既有 `memberList`（`--member-types user`，带 TTL 缓存），失败返回 undefined。
- [x] 1.3 `locus-controller.ts` 投递前填充 `senderName`（`withSenderName`），并把该字段透传到 Delivery 记录与提示词；解析失败 fail-soft 只呈现 open_id。
- [x] 1.4 `index.ts` 接线 `addressing.resolveMemberName`，保持与注入声明一致的声明式访问。
- [x] 1.5 `channel-mentions.test.ts` 覆盖三条：成员 open_id 渲染为提醒、非成员 open_id 保持原文、词内 `@ou_…` 不改写。
- [x] 1.6 `locus-controller-races.test.ts` 覆盖两条：能解析时 Delivery 带 `senderName`、不能解析时保留 open_id 且投递照常。
- [x] 1.7 真机复验（2026-09-19 10:21，重启后）：`delivery-39` 的 `senderName = 张勇`，Host 日志 `lark reply mentions: rendered 1`，群内消息带真实 `mentions: [{ id, key: "@_user_1", name: 张勇 }]`；对照修复前同群消息为裸 `@ou_322…` 且无 `mentions` 条目。

## 2. 规范追平与校验（本 change 的剩余工作）

- [ ] 2.1 复核两个 delta 相对 current spec 只做「扩展 + 澄清」：确认 `pet-locus-collaboration` 的渲染要求未丢失任何既有场景，`pet-lark-channel` 的注入要求未放松「不注入压平历史」这条主约束。
- [ ] 2.2 运行 `packages/dsh-pet` 的 build、typecheck、完整 Vitest，以及仓库 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs` 两次幂等与 `openspec validate --strict`。
- [ ] 2.3 按原 change 的验收结论在 `docs/notes/` 记录：这两处行为现已有规范覆盖，以及它们与 `pet-lark-channel` 注入约束的边界。

## 3. 归档

- [ ] 3.1 把两个 delta 同步进 current spec（含 `会话内容由 Agent 自取而非预先注入` 的澄清段落），再归档本 change。
