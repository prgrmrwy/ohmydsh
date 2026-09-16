## 1. 端点推导判据

- [x] 1.1 `extractLocusEndpoint` 收敛为「`thread_id` 可用取话题入口，否则取群本体入口」；`root_id`/`reply_to` 不再参与入口判定
- [x] 1.2 归一化失败的分层：`thread_id` 不可用仍拒绝（`invalid-thread`），`root_id`/`reply_to` 不可用视为缺失、不否决消息；`EndpointRefusal` 与 `LocusAdmissionRefusal` 删除 `ambiguous-thread`
- [x] 1.3 确认准入其余防线在改动后逐条不变：授权解析、mention、bot-sender、去重、水位、消息类型、空内容、控制命令（其余判定分支未被触碰，`test/locus-admission.test.ts` 全绿）

## 2. 回复目标与上下文一致性

- [x] 2.1 `locus-controller.messageFromAdmission` 仅在端点带 thread 时把 `root_id` 写入 `replyTarget.rootMessageId`；群级引用只保留 `replyToMessageId`
- [x] 2.2 核对持久层不变量仍成立（`replyTarget` 必须派生自 endpoint/message、`rootMessageId` 三处一致），并确认 child prompt 不再把群级引用链根渲染成「当前 thread 根消息」——群级 `replyTarget` 为 `{chatId, messageId}`，与 `locus/context.ts` 的渲染条件一致
- [x] 2.3 核对出站路径不变：群级投递以触发 `messageId` 调 `im +messages-reply`（不带 `--reply-in-thread`），话题投递仍带 `--reply-in-thread`（`channel/lark.ts` 的 `replyToTarget` 未改）

## 3. 回归测试与真实形态样例

- [x] 3.1 `test/fixtures/real-lark-events.ts` 补真实形态样例：群时间线引用消息、引用链中间回复、话题内回复，以及「引用事实不可归一化」；同时把样例字段改为消费端契约（`sender_id`、`mentions[].id` 字符串、`.content` 为已渲染文本）
- [x] 3.2 `test/locus-admission.test.ts` 把「只有 root_id / reply_to 时必须拒绝」改写为「必须得到群入口」，并覆盖引用事实不可用不否决、引用链根与直接父不同、thread_id 不可用仍拒绝
- [x] 3.3 `test/locus-real-event-shapes.test.ts` 把「真实形态话题消息缺 thread_id 必须拒绝」改写为「必须落到群入口」，并保留「有 thread_id 时话题入口优先」的正确性对照
- [x] 3.4 补 Delivery/replyTarget 回归：群级引用投递不携带 `rootMessageId`，话题投递仍携带 thread 与话题根（`admission and reply targets for the real observed shapes` 块）
- [x] 3.5 削弱判据（在 `extractLocusEndpoint` 恢复旧的「有 root/reply 即拒绝」分支）验证上述用例确实失败：44 项中 8 项失败；恢复实现后 44/44 全绿

## 4. 验证与记录

- [x] 4.1 `npx tsc -p tsconfig.json --noEmit` 通过；`npx vitest run` 在 `packages/dsh-pet` 下与改动前基线逐项对比：均为 5 个文件因本 worktree 缺依赖（`@deepseek-ai/dsh-storage-sqlite`、client 库）失败、2 项断言失败，通过数由 2341 增至 2348，无新增失败
- [x] 4.2 仓库级 `npm test`（124 通过 / 0 失败 / 1 跳过）与 `npm run check:artifacts`（tracked paths comply）通过；`openspec validate pet-group-quote-reply-entry --strict` 通过
- [x] 4.3 在 `docs/notes/dsh-plugin-integration-pitfalls.md` 新增第 8 节：实测字段形态表、`ambiguous-thread` 的历史含义、身份事实与可选事实的失败方式差异、替身必须照抄消费端契约
- [x] 4.4 记录剩余未验证项：`packages/dsh-pet` 的实机验收尚未进行——「群时间线引用 @bot 得到引用回复」与「话题内回复仍在原话题」只有在真实群 + 部署后的 Host 上才能确认；本 change 不冒充已完成该验收
- [ ] 4.5 部署与实机验收（需所有者批准）：经主仓 `dsh build` 物化到 `~/.dsh` 并重启 `dsh web`，随后在真实群按 4.4 的两条场景验收
