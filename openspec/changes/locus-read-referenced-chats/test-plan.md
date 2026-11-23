## Test Plan

Precheck（round-9 gate）：`review.md` 当前为 round 8，`VERDICT: APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`。本计划是 ponytail 精简后的 round-9 提交；**实施前 `review.md` 必须记录 round 9 的 verdict 为 `APPROVE` 或 `APPROVE_WITH_CHANGES` 且 `CHANGES_APPLIED: yes`**。旧轮次的绿色结果是历史，不作为任何新行或修改行的证据。

All test files live in `packages/dsh-pet/test/`. 状态图例：🔴 红（新增或修改的场景，尚无通过的测试，按对应 tasks 组走 TDD）；🟡 既有测试预计覆盖，在所列任务组中定位真实名称，缺失则补测；🟢 已有通过的测试且场景文字未变（在 12.2 复跑）。平台响应用脱敏夹具，不含真实 open_id、token、群名、消息正文或人名。

每个 spec 场景有且仅有一条主行；同一测试可映射多条场景（以「同测试」注明）。

**变异检查（tasks 12.1，共 4 项）**：① 还原 stderr 回退（D4）；② 还原根 id 下载（D5）；③ 还原严格 `(位置, attempt)` 推进（D8）；④ 还原转义大小打包（D9/页容量）。每项至少让一条 🔴 行变红。

**废弃测试**：⚪ 旧测试（依托旧上限、旧 cursor 签名与 cursor-stale、旧 target-first、旧 query 恰一条、旧 30 子消息上限等）不逐行保留，统一由 tasks 1.1「删除旧测试」删除，不计入绿。

### R1 子会话按消息 id 读取本入口 chat 内的单条消息（MODIFIED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 读取被回复消息中的截图 | locus-message-tool.test.ts | `returns text and typed image for same-chat post` | 🟢 |
| 其它 chat 的消息被拒绝 | locus-message-tool.test.ts | `refuses foreign chat without download` | 🟢 |
| 话题入口读取所在群的消息 | locus-message-tool.test.ts | `topic entrance reads group main-line message` | 🟢 |
| 读取失败不冒充空消息 | locus-message-tool.test.ts | `read failure, deleted or unparseable is a failure not empty` | 🟢 |
| 非合并转发却返回多条 | locus-media-merge.test.ts | `non-merge multi-item response is message-not-unique` | 🟢 |

### R2 单条消息读取按模型图片能力与额度返回并重验 caller（MODIFIED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 模型不支持图片 | locus-media-pages.test.ts | `text model: 3 images and 1 video collapse into one metadata line, nothing downloaded, complete unaffected` | 🟢 (core) |
| 图片超出单次额度时续读 | locus-media-pages.test.ts | `20 images with limit 8 continue as 8, 8, 4 without an omitted note` | 🟢 (core) |
| caller 在读取期间改变 | locus-message-tool.test.ts | `drops the result when the caller association changes during the read` | 🟢 |

### R3 单条消息读取工具的装配与参数（MODIFIED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 不接受额外目标参数 | locus-message-tool.test.ts | `accepts exactly messageId and cursor; anything else is refused before any platform read` | 🟢 |
| 文档入口不装配 | locus-message-tool-runtime.test.ts | `doc child surface excludes pet_locus_message` | 🟢 |
| 媒体能力不可用时不装配 | locus-message-tool-runtime.test.ts | `surface, attestation and Host-rendered prompts agree for IM/topic/doc × media available/unavailable` | 🟢 |
| 首次调用与续读的合法参数组合 | locus-message-tool.test.ts | `accepts {messageId} and {messageId, cursor}: the continuation keeps the message id and the caller binding` | 🟢 |

### R4 入口历史为含媒体的消息标注消息 id（MODIFIED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 视频消息行带 id | locus-chat-history-tool.test.ts | `appends message id to media lines within budget` | 🟢 |
| 消息链接与合并转发行带 id | locus-chat-history-tool.test.ts | `appends message id to message-link and merge-forward lines` | 🟢 |
| 普通文字行不附 id | locus-chat-history-tool.test.ts | `plain text line without link gets no id` | 🟢 |

### R5 引用消息与消息链接的读取指引（MODIFIED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 未装配工具时不提及 | locus-context.test.ts | `does not name pet_locus_message or pet_locus_linked_message when the Host has not published them` | 🟢（断言扩至链接工具） |
| 续投 prompt 指向工具 | locus-context.test.ts | `replied message line points to pet_locus_message in first and follow-up prompts` | 🟢 |
| 触发消息含链接时指向链接工具 | locus-context.test.ts | `link in trigger message points to pet_locus_linked_message with trigger id and mentions cursor continuation` | 🟢 |
| 无法确认链接指向的消息 | locus-context.test.ts | `unpublished guidance says links are unreadable and asks to forward` | 🟢 |
| 未读完或有失败项时不声称读完 | locus-message-tool.test.ts | `an incomplete answer says so, and the description forbids claiming a whole read` | 🟢 |

### R6 视频以封面与有界场景关键帧呈现（MODIFIED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 有 ffmpeg 时返回封面与关键帧 | locus-media-video.ffmpeg.test.ts | `returns cover and integer-second frames with the no-sound note, 20 min / 500 MB not skipped, empty spool` | 🟢 (core)（media.ts 层，core 接线后；video 层的 20 分钟取帧已由 ffmpeg 测试 `a 20 minute video is framed from a deep seek…` 覆盖） |
| 无 ffmpeg 时只给封面 | locus-media-video.test.ts | `without frame tools only the cover is returned, with the reason, and nothing is framed` | 🟢 |
| 视频超出上限 | locus-media-video.test.ts | `platform refusal or low disk fails the video unit, keeps the cover and cleans the spool` | 🟢 (core) |
| 抽帧超时 | locus-media-video.test.ts | `a decode timeout after a verified prefix keeps the verified frames and issues a cursor on the video` | 🟢 |

### R7 视频关键帧的尺寸、校验与时间点（MODIFIED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 非均匀抽样的帧逐一配对时间点 | locus-media-video.test.ts | `pairs each frame with its own showinfo time` | 🟢 |
| 时间点缺失时不伪造 | locus-media-video.test.ts | `file without record voids the window with frame-timestamps-unavailable and invents nothing` | 🟢 |
| 横屏、竖屏与窄长帧的最长边约束 | locus-media-video.ffmpeg.test.ts | `output frame sizes for landscape, portrait, narrow and small sources` | 🟢 |
| 帧未通过 attachment 校验 | locus-media-video.test.ts | `one frame failing admission fails only its slot with its recorded time` | 🟢 |

### R8 合并转发逐层完整展开（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 合并转发中的视频可见 | locus-media-merge.test.ts | `merge text is the root mget block; child video downloads with the outer id` | 🟢 (core)（修改：文字取根渲染块） |
| 嵌套合并转发逐层展开 | locus-media-tree.test.ts | `nested F/G/H: one mget block, images from G and H downloaded with the root id` | 🟢 (core) |
| 大合并转发不被截断 | locus-media-tree.test.ts | `120 children return over pages with no omitted note` | 🟢 (core) |
| 不读取内容的类型作为元数据交付 | locus-media-tree.test.ts | `interactive, file and audio nodes are metadata lines, not failures, nothing downloaded` | 🟢 (core) |
| 内层资源以根 id 下载失败 | locus-media-tree.test.ts | `inner key failing 234003 is a failed item and is not retried with another id` | 🟢 (core) |
| 续读不再读取容器 | locus-media-tree.test.ts | `merge continuation after the first page makes zero raw and mget calls` | 🟢 (core) |

### R9 合并转发树的下载前校验（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 乱序输入按前序遍历 | locus-media-tree.test.ts | `out-of-order items traverse in pre-order with sibling order kept` | 🟢 (core) |
| 重复 message_id 只保留首次 | locus-media-tree.test.ts | `duplicate message_id keeps the first occurrence only` | 🟢 (core) |
| 首项不是根或根不属本入口 | locus-media-tree.test.ts | `first item not the root, or root chat mismatch, is envelope-invalid before any download` | 🟢 (core) |
| 环被拒绝 | locus-media-tree.test.ts | `a cycle is envelope-invalid(cycle) before any download` | 🟢 (core) |
| 不可达条目使容器整体失败 | locus-media-tree.test.ts | `unreachable raw item fails the container as envelope-invalid(unreachable) before any render or download` | 🟢 (core) |
| mget 渲染块含不可达节点的正文 | locus-media-tree.test.ts | `mget text containing orphan X: whole container fails; neither A nor X text nor resources delivered` | 🟢 (core) |

### R10 链接读取工具的装配与参数（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 传入 URL 被拒绝 | locus-linked-message-tool.test.ts | `rejects url, token or unknown arguments before any platform read` | 🟢 |
| 文档入口不装配 | locus-message-tool-runtime.test.ts | `doc child surface excludes pet_locus_linked_message` | 🟢 |
| 媒体能力可用的 IM 入口装配 | locus-message-tool-runtime.test.ts | `IM/topic × create/cold-restore publish both message tools and attest; a paged ledger with cursor, failures and a continuation is schema-valid through the runtime` | 🟢 |
| linkIndex 没有上限且非法值被拒绝 | locus-linked-message-tool.test.ts | `accepts messageId, linkIndex (no upper bound) and cursor; refuses url, token, chat and bad values` | 🟢 |

### R11 链接只从本入口消息的平台正文中提取（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 多个链接按出现顺序编号 | message-link-extract.test.ts | `extracts, dedupes and numbers links from text and post href` | 🟢 |
| 超过十个链接全部可读 | message-link-extract.test.ts | `12 links are all numbered and linkIndex 12 resolves the twelfth` | 🟢 (core) |
| token 含百分号编码 | message-link-extract.test.ts；locus-linked-message-tool.test.ts | `percent-encoded token is extracted and sent to the query byte for byte` | 🟢 (core) |
| 伪造主机的链接不被提取 | message-link-extract.test.ts | `rejects foreign host, userinfo, http and empty or duplicate token` | 🟢 |
| 含链接的消息不在本入口 | locus-linked-message-tool.test.ts | `foreign source message is chat-mismatch without query call` | 🟢 |

### R12 消息链接由平台解析并判定授权（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 触发消息中的链接被解析 | locus-linked-message-tool.test.ts | `resolves link, raw-reads the root and downloads with raw keys` | 🟢 |
| 平台判定无权 | locus-linked-message-tool.test.ts | `is_authorized false or non-boolean is link-unauthorized without name or content` | 🟢 |
| 应用缺少权限点 | locus-linked-message-tool.test.ts | `99991672 on stderr and on stdout maps to link-scope-missing; other failures are link-unresolved` | 🟢 |
| 链接指向嵌套合并转发 | locus-linked-message-tool.test.ts | `26-node query with 29-node raw read reads every raw node, not link-unresolved` | 🟢 (core) |
| 链接无效或不可访问 | locus-linked-message-tool.test.ts | `10077 and other platform errors are link-unresolved with platformCode` | 🟢 (core) |
| 快照与原消息不一致 | locus-linked-message-tool.test.ts | `raw chat mismatch or failed raw read fails without download` | 🟢 (core) |
| query 没有返回任何消息 | locus-linked-message-tool.test.ts | `empty query messages or first without message_id is link-unresolved` | 🟢 (core) |

### R13 链接指向话题消息时返回整个话题（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 链接指向话题中的一条回复 | locus-topic-reader.test.ts | `returns root and 5 replies and marks the linked third reply` | 🟢 |
| 多页话题逐页读完 | locus-topic-reader.test.ts | `120 messages over three platform pages read in order with no gap or duplicate` | 🟢 |
| 读取期间新增的消息 | locus-topic-reader.test.ts | `messages added before the last page are read; the read ends at has_more false` | 🟢 |
| 话题回复含多张图片跨页续读 | locus-topic-reader.test.ts | `reply with 20 images (limit 8) reads 8, 8, 4 and the next reply follows once` | 🟢 |

### R14 话题分页合约与终止（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 重复 page token | locus-topic-reader.test.ts | `repeated page_token is pagination-loop with delivered pages kept` | 🟢 |
| 空页带下一页 token | locus-topic-reader.test.ts | `empty page with next token continues; three consecutive empty pages are pagination-stalled` | 🟢 |
| 列表混入其它话题的消息 | locus-topic-reader.test.ts | `foreign chat_id or thread_id item rejects the whole page` | 🟢 |
| 非法 token 为列表页终态失败 | locus-topic-reader.test.ts | `230001 on a continuation is a topic-page failure with no cursor` | 🟢 |

### R15 话题列表失败的回退与去重（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 首页瞬时失败先附重试游标 | locus-topic-reader.test.ts | `first list page transient failure: topic-list diagnostic only, failed empty, attempt 1 cursor, no items delivered` | 🟢 |
| 首页 final 失败回退到链接所指消息 | locus-topic-reader.test.ts | `first list page 230002 falls back to the linked single message with topic-list and no topic cursor` | 🟢 |
| 中间页失败保留已读部分 | locus-topic-reader.test.ts | `page 2 permission failure keeps page 1 and ends terminally with topic-page@2` | 🟢 |
| 链接所指消息在列表中只标注一次 | locus-topic-reader.test.ts | `linked target in the list is marked once; a target absent from the list is not appended` | 🟢 |

### R16 媒体续读游标的签发与校验（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 超出单次承载时给出续读游标 | locus-media-pages.test.ts | `40 images with limit 8 continue over 5 pages and the last has no cursor` | 🟢 (core) |
| 未知、过期或重启前的游标 | locus-media-cursor.test.ts | `unknown, expired and pre-restart cursors are cursor-invalid with zero platform calls` | 🟢 (core) |
| 跨子会话或不同消息使用游标 | locus-media-cursor.test.ts | `foreign session, foreign messageId and linkIndex mismatch are cursor-mismatch with zero platform calls` | 🟢 (core) |

### R17 续读位置与推进（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 一次瞬时失败后恢复 | locus-media-pages.test.ts | `one transient failure then success: attempt-1 cursor, no failed entry, complete on the last page` | 🟢 (core) |
| 同位置第三次失败后跳过并继续读 | locus-media-pages.test.ts | `third transient failure records the unit as failed, later units delivered, complete false` | 🟢 (core) |
| 已有交付后的瞬时失败不是零进展 | locus-media-pages.test.ts | `transient failure after earlier deliveries keeps the cursor on the failing unit with attempt 1` | 🟢 (core) |
| final 失败不中断本页 | locus-media-pages.test.ts | `final 234003 failure is recorded and the same page continues` | 🟢 (core) |
| 无进展的视频以终态跳过 | locus-media-video.test.ts | `zero-progress video whose download exceeds the page budget is failed and skipped; cursor advances` | 🟢 (core) |
| 不可跳过的列表页第三次失败结束读取 | locus-topic-reader.test.ts | `topic list page failing three times ends the read with topic-page failure and no cursor` | 🟢 |
| （补充，非场景）推进不变量 | locus-media-pages.test.ts | `injected failure sequences: (position, attempt) strictly increases, attempt ≤ 2, reads terminate` | 🟢 (core) |

### R18 续读重放语义（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 重放与并发提交的起点和条目 id 稳定 | locus-media-pages.test.ts | `replay and concurrent same-cursor calls start at the same unit with identical ids and refs; spools empty` | 🟢 (core) |

### R19 每页完成性账本（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 全部成功时为 complete | locus-media-pages.test.ts | `no failures yields complete true on the last page with no cursor` | 🟢 (core) |
| 有失败项时不为 complete | locus-media-pages.test.ts | `an image skipped on page 1, reading ends on page 2: failed id only on page 1 and in cross-page aggregation; last page complete false, no cursor, does not repeat the id` | 🟢 (core) |
| 停止读取时保留交付与失败项 | locus-topic-reader.test.ts | `topic first page delivered, second page three transient failures: no cursor, topic-page@2 in failed, complete false, delivered kept` | 🟢 |
| 首次读取在建立计划前失败 | locus-media-pages.test.ts；locus-linked-message-tool.test.ts | `first-call container, link query or root raw read transient failure: complete false, no cursor; repeating the call starts clean` | 🟢 (core) |

Oracle 口径（同一文件内两条独立断言）：**完整遍历**（读到末尾，按条目 id 去重）断言「交付 id 与跨页聚合的 `failed` 内容 id 并集恰为固定输入的计划 id 集合且无重复，最后一页无 `cursor`」；**停止读取** 断言「无 `cursor`、`complete` 为 `false`、`failed` 非空，交付 id 与失败 id 不重叠」，不对停止读取断言全集相等。

### R20 正文无损分段与转义呈现（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 5000 字符的普通消息完整可读 | locus-media-pages.test.ts | `5000-char message is returned whole with no truncation marker` | 🟢 (core) |
| 正文伪造数据块边界 | locus-message-tool.test.ts；locus-linked-message-tool.test.ts | `a forged message-body close in platform text cannot end the Host block; platform fields are JSON plus unicode-escaped, so hostile text never adds a Host boundary` | 🟢 |
| 转义密集文本的分段不超预算 | locus-media-pages.test.ts | `16000 "<" characters: every segment within the 4000 escaped budget; boundaries depend only on the text; rejoins` | 🟢 (core) |
| 分段边界不随页开销变化 | locus-media-pages.test.ts | `same 20000-char text under different page overheads has identical segment ids and ranges` | 🟢 (core) |

### R21 页容量与固定预留（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 转义密集的正文按最终大小分页 | locus-media-pages.test.ts | `16000 "<" paginate by final escaped size; every block parses; segments rejoin to the original` | 🟢 (core) |
| 最大 cursor 长度小于预留 | locus-media-cursor.test.ts | `any issued cursor is shorter than the reserved length` | 🟢 (core) |
| 测试容量配置过小时构造失败 | locus-media-pages.test.ts | `capacity below reserve plus one segment throws at construction` | 🟢 (core) |
| 1000 张图片全部终态失败 | locus-media-pages.test.ts | `1000 final-failed images: pages within capacity, each failed id exactly once, cursor strictly advances, finite, complete false` | 🟢 (core) |

### R22 资源安全监控（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 低磁盘时终止并清理 | locus-media-spool.test.ts | `low free space during download kills the group, deletes the directory, records disk-low` | 🟢 (core) |
| 抽帧阶段的磁盘占用也被监控 | locus-media-spool.test.ts | `frame-extraction phase is monitored, not only the download` | 🟢 (core) |
| 并发调用竞争同一卷 | locus-media-spool.test.ts | `two concurrent calls each stop and clean on shared low free space` | 🟢 (core) |
| ENOSPC 归为磁盘不足 | locus-media-spool.test.ts | `ENOSPC output is disk-low and the directory is deleted` | 🟢 (core) |
| 取消与单页时限 | locus-media-spool.test.ts | `cancel returns nothing; page deadline returns partial plus cursor; spool empty in both` | 🟢 (core) |

### R23 大信封与失败信封的读取（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 超过 1 MiB 的平台信封 | locus-media-spool.test.ts | `3 MiB synthetic merge envelope is read completely` | 🟢 (core) |
| 超出解析上界的信封明确失败 | locus-media-spool.test.ts | `envelope above maxBuffer is envelope-too-large with the byte count, not empty` | 🟢 (core) |
| 失败信封在 stderr 时仍被识别 | locus-linked-message-tool.test.ts | `99991672 on stderr with empty stdout and on stdout both map to link-scope-missing` | 🟢 (core) |

### R24 链接指向的消息按本群消息同等返回（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 返回正文与来源群名 | locus-linked-message-tool.test.ts | `returns source name, sender, time and untrusted body` | 🟢 |
| 来源群名含换行与伪造边界 | locus-linked-message-tool.test.ts | `platform fields are JSON plus unicode-escaped; exactly one host boundary pair` | 🟢 |
| 来源群名之外的内容不被截断 | locus-linked-message-tool.test.ts | `20000-char linked body is lossless over pages while the source name stays within 64 chars` | 🟢 (core) |

### R25 视频按整秒采样与分页（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 19 秒静止视频取整秒帧 | locus-media-video.ffmpeg.test.ts | `19 s static fixture: time set exactly {0..18}` | 🟢 |
| 非零起点与可变帧率按整秒取帧 | locus-media-video.ffmpeg.test.ts | `start_time 2.0 and VFR give one frame per whole second, no duplicated source frame` | 🟢 |
| 长视频逐页读完且页边界无重复 | locus-media-video.ffmpeg.test.ts | `19 s with 8 frames per page reads 8, 8, 3 with strictly increasing times and no gap` | 🟢 |
| 40 秒下载在页时限内成功 | locus-media-video.test.ts | `40 s download inside the 90 s page budget succeeds; no per-CLI 20 s timeout` | 🟢 (core) |
| 慢下载超出页时限且本页无交付 | locus-media-video.test.ts | `100 s download in a 90 s window is video-download-exceeds-window and skipped` | 🟢 (core) |
| 本页已有交付时视频留到下一页 | locus-media-video.test.ts | `download cut after earlier units delivered keeps the cursor on the video` | 🟢 (core) |

### R26 逐槽位帧失败规则（ADDED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 存在文件却无记录作废窗口 | locus-media-video.test.ts | `file without record voids the window with frame-timestamps-unavailable`（同测试亦映射 R7「时间点缺失时不伪造」） | 🟢 |
| 正常退出时中间文件缺失 | locus-media-video.test.ts | `normal exit with a missing middle file fails only that slot (frame-file-missing, recorded time)` | 🟢 |
| 超时保留已验证前缀 | locus-media-video.test.ts | `kill keeps the verified prefix; the largest existing file and later slots are reselected next page` | 🟢 |
| 单帧保存失败只让该槽位失败 | locus-media-video.test.ts | `one frame save failing leaves 7 frames, one failure, and the next page continues after the last processed second` | 🟢 |
| 超过一百帧的文件名与排序 | locus-media-video.test.ts | `150 frames pair correctly by recorded n with six-digit names` | 🟢 |

### 文档入口（pet-locus-doc-comments，MODIFIED）

| Scenario | Test File | Test Name | State |
|---|---|---|---|
| 文档子会话的工具面 | locus-message-tool-runtime.test.ts | `doc child surface excludes pet_locus_message and pet_locus_linked_message` | 🟢（断言扩至链接工具） |
| 文档 Delivery 不调用 IM 接口 | locus-on-demand-provisioning.test.ts；locus-delivery-prompt.test.ts | `a doc Delivery reaches neither media, chat-bot nor IM member lookups with a doc id`（断言扩至分页读取：page:message / page:link） | 🟢 |
| 触发者姓名查询失败 | locus-delivery-prompt.test.ts | `a doc prompt with no resolved name shows only the open id and still renders` | 🟢 |
| 文档待办跳转 | ledger-view.test.ts | `doc-level todo carries no comment note and links to drive +inspect url` | 🟢 |
| IM 入口不受影响 | locus-message-tool-runtime.test.ts | `IM/topic × create/cold-restore publish both message tools and attest` | 🟢（R10 修改后复跑） |


### 实施对照（core，task-1；端口层）

标 `🟢 (core)` 的行由端口层测试覆盖；测试名与上表不同或文件不同者对照如下。工具层（`locus-message-tool*.test.ts`、`locus-linked-message-tool.test.ts`、`locus-context.test.ts` 等）仍待 task-4 接线后补。

| 上表行 | 实际覆盖的测试（`packages/dsh-pet/test/`） |
|---|---|
| R11/R12/R23 链接解析、`99991672` stderr/stdout、10077、26/29 节点、空 messages、raw 不一致、20 000 字符 | `locus-media-linked.test.ts`（端口 `readLinkedPage`）；`message-link-extract.test.ts`（12 链接、百分号编码） |
| R13/R15/R17 列表页/R19 停止读取（话题接线） | `locus-media-topic.test.ts`（读取器本身见 `locus-topic-reader.test.ts`） |
| R25「40 秒下载成功」 | `locus-media-video-page.test.ts`：`a download longer than the per-CLI timeout still succeeds inside the page budget`（按比例缩小：端口 `timeoutMs` 300 ms、页时限 8 s、下载 1 s） |
| R25「100 秒下载超窗」「已有交付时留到下一页」、R17 视频零进展 | `locus-media-video-page.test.ts`：`download cut after earlier units delivered keeps the cursor on the video; as the first unit it is video-download-exceeds-window and skipped`（页时限 1.2 s、下载 3 s） |
| R6 视频超出上限（平台拒绝/磁盘不足） | `locus-media-video-page.test.ts`：`platform refusal …`、`low disk during the video download …` |
| R6 抽帧超时（已验证前缀为空） | `locus-media-video-page.test.ts`：`decode timeout with nothing verified …`；前缀非空的情形见 `locus-media-video.test.ts` |
| R19 首次读取失败（话题/链接） | `locus-media-linked.test.ts`、`locus-media-pages.test.ts` 的 `first-call … transient failure` |
| R16 跨 caller / 工具 / linkIndex | `locus-media-cursor.test.ts`（表层）、`locus-media-pages.test.ts`、`locus-media-linked.test.ts`（端口层，零平台调用） |

偏差记录：根的 chat 与入口不符沿用既有 `chat-mismatch`（R1 🟢），仅「首项不是根」为 `envelope-invalid`；元数据行（`interactive`/文件/音频/已删除）实现为恒成功的 note 单元（稳定 id，计入 `delivered`，不计失败）。
