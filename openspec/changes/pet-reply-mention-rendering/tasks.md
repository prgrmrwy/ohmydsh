## 1. 纯渲染器

- [x] 1.1 `channel/mentions.ts`：候选检测（`@` 前边界、非标记形式）与整词渲染（最长匹配、唯一命中、次数上限）
- [x] 1.2 归一化成员表输入：只接受非空 `member_id` 与显示名，同名即歧义、不渲染
- [x] 1.3 单测覆盖：唯一命中、最长优先、同名歧义、非成员、已有 `<at `、邮箱/词内 `@`、标点与串尾边界、CJK 前导、次数上限、空名单、畸形成员项（12 例）

## 2. 出站通道接线

- [x] 2.1 `channel/lark.ts` 增加 `listChatMembers`（bot 身份、`+chat-members-list --member-types user --page-all`、按 chat 5 分钟缓存）
- [x] 2.2 `replyToTarget` 发送前渲染；仅当正文出现候选时取成员表（无 `@` 的回复零额外调用）；失败/异常按原文发送并记低基数诊断
- [x] 2.3 诊断不含姓名、open_id、群 id 或正文；`createLarkCliClient` 增加可选 logger，`index.ts` 传入 `petLog`

## 3. 注入补齐平台契约

- [x] 3.1 统一 locus 投递提示（首次与续投两处）说明平台 @ 写法与「Host 会渲染」
- [x] 3.2 `pet_locus_finish` 工具说明同步该事实

## 4. 测试与验证

- [x] 4.1 通道接线：含可渲染引用时先读成员表再以标记发送（逐参数断言两次调用的 args）；成员表不可读时发出原文且不抛错；无 `@` 时只有一次调用
- [x] 4.2 注入文案：投递提示两种变体与工具说明都含 @ 语法与渲染事实
- [x] 4.3 削弱验证：去掉渲染接线、去掉歧义保护、去掉 `@` 前边界保护、删掉提示与工具说明后，74 项中 5 项失败（4 个文件全红）；恢复后 74/74
- [x] 4.4 验证：`tsc -p tsconfig.json` 通过；client 半区仅剩本 worktree 缺依赖的 `client/index.tsx` 既有报错；`packages/dsh-pet` 全量 vitest 与基线同形（5 个文件因缺依赖失败、2 项断言失败，通过数 2362 → 2379）；仓库 `npm test` 124 通过 / 0 失败；`check:artifacts` 通过；`openspec validate --strict` 通过
- [x] 4.5 记录剩余未验证项：对方是否真的收到提醒只能在真实群确认（本 change 不冒充已完成）
- [ ] 4.6 部署与实机验收（需所有者批准）：`dsh build` + 重启 `dsh web` 后按 4.5 验收
