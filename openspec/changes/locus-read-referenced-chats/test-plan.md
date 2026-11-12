## Test Plan

Precheck: review.md is at round 3 with `VERDICT: APPROVE_WITH_CHANGES` and `CHANGES_APPLIED: yes`, confirmed on the second recheck on 2026-11-12.

All test files live in `packages/dsh-pet/test/`. New scenarios start at 🔴 red. Scenarios a MODIFIED block keeps word for word are marked 🟡 existing and point at the existing test. In apply step 1, fill in the real test names; if a test cannot be found, add one, mark the row 🔴, and take it through TDD. Platform responses use redacted fixtures with no real open_id, token, or chat name.

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/pet-locus-media-access/spec.md → 子会话按消息 id 读取本入口 chat 内的单条消息 | 读取被回复消息中的截图 | locus-message-tool.test.ts | `returns text and typed image for same-chat post` | 🟡 existing |
| same | 其它 chat 的消息被拒绝 | locus-message-tool.test.ts | `refuses foreign chat without download` | 🟡 existing |
| same | 话题入口读取所在群的消息 | locus-message-tool.test.ts | `topic entrance reads group main-line message` | 🟡 existing |
| same | 读取失败不冒充空消息 | locus-message-tool.test.ts | `read failure, deleted or unparseable is a failure not empty` | 🟡 existing |
| same | 非合并转发却返回多条 | locus-media-merge.test.ts | `non-merge multi-item response is message-not-unique` | 🔴 red |
| specs/pet-locus-media-access/spec.md → 入口历史为含媒体的消息标注消息 id | 视频消息行带 id | locus-chat-history-tool.test.ts | `appends message id to media lines within budget` | 🟡 existing |
| same | 消息链接与合并转发行带 id | locus-chat-history-tool.test.ts | `appends message id to message-link and merge-forward lines` | 🔴 red |
| same | 普通文字行不附 id | locus-chat-history-tool.test.ts | `plain text line without link gets no id` | 🔴 red |
| specs/pet-locus-media-access/spec.md → 引用消息与消息链接的读取指引 | 未装配工具时不提及 | locus-context.test.ts | `does not name pet_locus_message when the Host has not published it` (also asserts `pet_locus_linked_message` is absent) | 🔴 red |
| same | 未装配工具且触发消息含链接 | locus-context.test.ts | `unpublished tools with a link trigger name neither tool and ask to forward` | 🔴 red |
| same | 续投 prompt 指向工具 | locus-context.test.ts | `replied message line points to pet_locus_message in first and follow-up prompts` | 🟡 existing |
| same | 触发消息含链接时指向链接工具 | locus-context.test.ts | `link in trigger message points to pet_locus_linked_message with trigger id` | 🔴 red |
| same | 无法确认链接指向的消息 | locus-context.test.ts | `unpublished guidance says links are unreadable and asks to forward` | 🔴 red |
| same | 链接读取失败时不猜测 | locus-linked-message-tool.test.ts | `failure result tells the model not to describe the link and to ask for a forward` | 🔴 red |
| specs/pet-locus-media-access/spec.md → 合并转发按子消息展开 | 合并转发中的视频可见 | locus-media-merge.test.ts | `expands merge-forward children and downloads child video via outer id` | 🔴 red |
| same | 子消息不属于该外层 | locus-media-merge.test.ts | `child with foreign upper_message_id fails envelope-invalid without download` | 🔴 red |
| same | 子消息超出上限 | locus-media-merge.test.ts | `caps children and states the omitted count` | 🔴 red |
| same | 嵌套合并转发不递归 | locus-media-merge.test.ts | `nested merge-forward returns metadata only` | 🔴 red |
| specs/pet-locus-media-access/spec.md → 单次读取的整体工作预算 | 失败下载也消耗尝试次数 | locus-media-budget.test.ts | `failed downloads count toward the 12-attempt cap` | 🔴 red |
| same | 总时限到期 | locus-media-budget.test.ts | `overall 90s deadline aborts downloads and extraction and leaves spool empty` (also covers the deadline during the non-download stage and the success path within budget) | 🔴 red |
| same | 文字预算截断 | locus-media-budget.test.ts | `serialized text stays within 16000 chars and states omissions` | 🔴 red |
| specs/pet-locus-media-access/spec.md → 链接读取工具的装配与参数 | 传入 URL 被拒绝 | locus-linked-message-tool.test.ts | `rejects url, token or unknown arguments before any platform read` | 🔴 red |
| same | 文档入口不装配 | locus-message-tool-runtime.test.ts | `doc child surface excludes pet_locus_linked_message` | 🔴 red |
| same | 媒体能力可用的 IM 入口装配 | locus-message-tool-runtime.test.ts | `IM/topic × create/cold-restore publish both message tools and attest` (real ToolRuntime matrix, including media unavailable) | 🔴 red |
| specs/pet-locus-media-access/spec.md → 链接只从本入口消息的平台正文中提取 | 多个链接按出现顺序编号 | message-link-extract.test.ts | `extracts, dedupes and numbers links from text and post href` (also covers at most 10 links and the formatted-text adapter) | 🔴 red |
| same | 伪造主机的链接不被提取 | message-link-extract.test.ts | `rejects foreign host, userinfo, http and empty or duplicate token` | 🔴 red |
| same | 含链接的消息不在本入口 | locus-linked-message-tool.test.ts | `foreign source message is chat-mismatch without query call` | 🔴 red |
| specs/pet-locus-media-access/spec.md → 消息链接由平台解析并判定授权 | 触发消息中的链接被解析 | locus-linked-message-tool.test.ts | `resolves link, raw-reads target and downloads with raw keys` | 🔴 red |
| same | 平台判定无权 | locus-linked-message-tool.test.ts | `is_authorized false or non-boolean is link-unauthorized without name or content` | 🔴 red |
| same | 应用缺少权限点 | locus-linked-message-tool.test.ts | `99991672 maps to link-scope-missing` | 🔴 red |
| same | 快照与原消息不一致 | locus-linked-message-tool.test.ts | `raw chat mismatch, deleted or failed raw read fails without download` (also covers multiple resolved messages and caller invalidation while waiting) | 🔴 red |
| specs/pet-locus-media-access/spec.md → 链接指向的消息按本群消息同等返回 | 返回正文与来源群名 | locus-linked-message-tool.test.ts | `returns source name, sender, time and untrusted body` | 🔴 red |
| same | 来源群名含换行与伪造边界 | locus-linked-message-tool.test.ts | `platform fields are JSON plus unicode-escaped; exactly one host boundary pair` | 🔴 red |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 文档子会话的工具面 | locus-message-tool-runtime.test.ts | `doc child surface excludes pet_locus_message` (add an assertion for `pet_locus_linked_message`) | 🔴 red |
| same | 文档 Delivery 不调用 IM 接口 | (existing doc-comments test) | fill in during apply | 🟡 existing |
| same | 触发者姓名查询失败 | (existing doc-comments test) | fill in during apply | 🟡 existing |
| same | 文档待办跳转 | (existing doc-comments test) | fill in during apply | 🟡 existing |
| same | IM 入口不受影响 | locus-message-tool-runtime.test.ts | `IM/topic × create/cold-restore publish both message tools and attest` | 🔴 red |
