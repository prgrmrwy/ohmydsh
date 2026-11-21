# Implementation log — locus-ask-work-first-and-concise

2026-11-10，agent-team 实施（lead + bind-ctl 负责组 1–3，ask-first 负责组 4–8）。

## 对已评审 design 的实现偏离（lead 裁决，spec 语义不变，未改已评审制品）
- D4「人工轮次」：真实工作会话中，新会话或压缩后的第一个人工轮，首条 user/message 是 `plugin:dsh-memex` 注入。实现为：跳过 Host 注入类来源（常量 `WORK_HISTORY_INJECTION_SOURCES`）后，首条消息 `source.kind === 'user'` 才计为人工轮；首条非注入消息是 `plugin:dsh-collab` 或未知来源则不计（fail closed）。
- D4「最终助手文本」：assistant/message 上没有 provider 无关的 `stopReason`。实现为：取该轮最后一条只含 text 块、且其后本轮内没有 tool/call 的 assistant/message；找不到就不给助手文本。不读 stream 或 provider 私有字段。
- D8：询问引用直接取入口 current Delivery 的 `messageId`（IM msgId 与文档评论 `doc:docx:<token>/<comment>/<reply>` 共用），经 `findCurrentSerializedDelivery` 读取；读取抛错时 askParent / replyChild 都返回 delivery-failed，不送达。
- 第 2 组补充：`migrateWholeW` 已提交而收尾阶段失败时，也给错误打 `migrationCommitted` 标记，回执说明“迁移已完成、本入口未绑定”；重试已验证复用 M1、不再迁移（fake 与 real）。

## TDD 记录的如实说明
- 组 6（`locus_work_history`）没有单独跑出“先红”。补救：对实现做了 3 个变异（回退首条规则、关闭脱敏、最终文本不看 tool/call），确认测试会失败；第 3 个变异最初没被抓到，补用例后抓到，源码已恢复。
- “缺少询问引用”：运行时对缺失的必填参数在 schema 层抛 ToolArgsError，测试断言改为 schema 层拒绝 + Host 层 `invalid-ask-ref`（空串、带空白、直接调用函数）。

## 已知局限
- 凭据脱敏是模式匹配：长 base64 串只在同时含数字和字母时替换，纯字母长密钥会漏；`key: xxx` 一类文字可能被过度脱敏。
- `index.ts` 中 `locus_work_history` 的装配（readLive / readCold / inbox 可读性）没有单测，需在 9.3 预览验收中实测 idle/unknown。
- 送达后、处理前 current 换代不拦截，代码以 `shortcut:` 注释标明（spec 已写明）。

## 同步修改的既有测试
- `locus-control.test.ts`：2 条逐字比较回执的断言追加共享范围说明句。
- `locus-context-tools.test.ts`、`locus-official-queue-turn.test.ts`：`locus_reply_child` 加了必填 `askRef`，并补 `findCurrentSerializedDelivery` 依赖。
- `executor-scope.test.ts`：工具注册数守卫 10 → 11（新增 `locus_work_history`）。

## 验证（lead 复跑）
- `packages/dsh-pet`：`tsc --noEmit` 30 个错误，全部在 `domain.ts`、`repository.ts`、`index.ts:362`；把 dsh-pet 改动 stash 后，HEAD 同样是 30 个，属于 worktree 依赖缓存中 zod 4.4 / 4.6 并存的既有环境问题。因此 `npm test`（pretest 会 build）在 build:host 失败；改为直接 `npx vitest run`：226 个文件通过、2 个失败（缺 client bundle）；单独 `npm run build:client` 后，这 2 个和 `locus-migrated-qa` 都通过。合计 3256 通过、4 skipped、0 失败。
- 仓库根：`npm test` 同样卡在 dsh-pet build。直接 `node --test tests/*.test.mjs`：804 条中 22 条失败（sync / openspec adapter 一类），把 dsh-pet 改动 stash 后重跑，同样是这 22 条失败，属既有基线，与本次改动无关。
- `npm run check:artifacts` 通过；`openspec validate --strict` 通过；`git diff --check` 通过。

## 9.1 继承场景（task-3，bind-ctl）
15 个继承场景都已有 `spec Scenario` 标题的测试：3 个原本已有，7 个改标题，2 个改标题并加强断言，3 个新写（逻辑已存在，写完即通过；“误判不产生越权”做了去掉只读过滤的变异检查，确认会失败）。部分场景的实际文件与原映射不同，test-plan 已改为实际路径；“主会话无法回答”在 `locus-context.test.ts` 与 `locus-context-tools.test.ts` 各有一条。

## 最终 dsh-pet 全量（lead，重新 tsc emit + build:client 后直接 vitest）
228 个文件通过、2 skipped；3259 通过、4 skipped、0 失败。test-plan 69 行全部 🟢。
