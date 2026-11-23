## Context

`locus-read-message-media`（2026-11-12 归档）给 IM 入口子会话加了 `pet_locus_message({ messageId })`：Host 以 bot 身份原始读取消息，要求平台返回的 `chat_id` 等于入口 chat，再下载图片、视频封面与关键帧。

所有者决定（2026-11-12 与 2026-11-19/21）：**被带进本群的内容可以读**（逐条转发、合并转发、消息链接），不要求提问者在来源群，bot 不主动翻别的群；**目标是拿全上下文，Host 不自设内容上限**，受限只来自平台权限、部署 `AttachmentStore` 限额与模型上下文，到达边界用续读（`cursor`）接上，不静默丢弃。

### 已实测的平台事实

以下事实来自 2026-11-12 与 2026-11-21 探针（`pet` 应用、bot 身份、lark-cli 1.0.97；id 已脱敏）：

1. `POST /open-apis/im/v1/message_links/query` 返回 `chat_info{chat_id,is_authorized,name}` 与 `messages[]` 快照。快照的资源 key 不能用于下载（`234003`）；须以快照返回的 `message_id` 做原始读取后取原 key。query 对嵌套合并转发少返回最深一层（26 节点对 raw 29 节点），因此 query 只用于确定根与 `chat_info`。
2. 合并转发的原始读取一次返回全部层级（无分页），`upper_message_id` 为直接父。**只有根 id 能下载任意层的 key**；中间层与叶子 id 下载得 `234003`，对它们做原始读取得 `230002`。
3. `+messages-mget` 对根消息渲染全部层级为一段文字（含发送者、`@` 解析、`![Image](key)` 标记）。
4. `+threads-messages-list` 默认 `--order asc`，根消息位置 `-1`，回复 `0,1,…`；`has_more`/`page_token` 分页，`--page-size 50` 可用；非法 token 为 `230001`。
5. lark-cli 失败信封在 **stderr**，stdout 为空（`10077`、`99992354`、`99991672` 均已见）。
6. `+messages-resources-download` 没有 Range 或续传；本机可用磁盘约 3.4 GiB。
7. 内层**视频** key 能否经根 id 下载尚未实测（tasks 6.6）。

## Goals / Non-Goals

**Goals:**
- 子会话能读到本群消息中消息链接指向的消息（正文与媒体），以及合并转发的全部子消息（含嵌套）与链接所指消息所在的整个话题。
- Host 不自设内容上限；到达平台、磁盘、模型上下文或单页时限边界时以续读接上。
- 保留不变量：模型不传 URL、token、chat；入口消息必须在本入口 chat 内；跨入口内容只经平台 `is_authorized` 与 bot 原始读取成功才可读；媒体 spool 返回前删除；返回前重验 caller；文档入口不装配。

**Non-Goals:**
- 跨群历史、成员核验、候选搜索；user token 路径。
- 链接目标内部的链接不自动展开（模型对含该链接的消息 id 再显式调用一次）。
- 答复标注来源群（所有者不要求；群名仍作为事实返回）。
- 跨调用缓存视频（所有者决定，见「所有者决定」）；内容变化检测与权限撤销检测（见「Ponytail 精简」的 trade-off）。

## Decisions

**D1 工具面。** 新增 `pet_locus_linked_message({ messageId, linkIndex?, cursor? })`；`pet_locus_message` 参数改为 `{ messageId, cursor? }`。两者都只在 IM 入口且 Host 媒体能力可用时装配。prompt 与工具说明经同一判定渲染；未装配时两个工具名都不出现。

**D2 链接提取。** 来源是本消息原始读取的正文：`text` 取文字，`post` 取文字与 `tag:a` 的 `href`，其它类型不提取。用 WHATWG `URL` 判定：`https:`、无 userinfo、主机精确属于部署白名单（缺省 `applink.feishu.cn`、`applink.larkoffice.com`）、路径 `/client/message/link/open`、恰有一个非空 `token`。按规范化完整 URL 去重，按出现顺序全部编号，没有个数上限。`token` 的百分号编码原样保留（`%3D` 不得截断或解码）。

**D3 链接读取链路（首次调用）。**
1. 原始读取 `messageId`，`chat_id` 必须属于本入口（话题入口按所在群）；否则 `chat-mismatch`。
2. 提取链接，取第 `linkIndex`（缺省 1）；无链接或越界 → `link-not-found`，不调用平台解析。
3. `lark-cli api POST /open-apis/im/v1/message_links/query --as bot`（经 `petCliArgs`，固定 `--profile dsh-pet`）：`99991672` → `link-scope-missing`；其它错误（含 `10077`）→ `link-unresolved`；`is_authorized !== true` → `link-unauthorized`（不返回群名）；`messages` 为空或第一项缺 `message_id` → `link-unresolved`。根 = `messages[0].message_id`，`chat_info` 取自同一响应。
4. 对根做原始读取，要求 `chat_id === chat_info.chat_id`，否则 `link-mismatch`。
5. 根带 `thread_id` → 话题流（D6）；根为 `merge_forward` → 合并转发流（D5）；否则单条流。

续读不再重新执行 1–4，只使用快照（D7）。

**D4 失败信封读取。** 所有 `lark-cli` 调用的失败信封先读 stdout，stdout 为空或不可解析时读 stderr，取最后一个可解析的 JSON 文档；错误码写入失败项的诊断。测试夹具必须同时有 stderr 形态（stdout 为空）与 stdout 形态，两者映射相同。

**D5 合并转发。** 根的原始读取与 mget 渲染构成容器读取（不可跳过；首次调用失败则无 cursor）。
- **校验（下载前）**：原始 `items` 首项的 `message_id` 等于根 id，且根的 `chat_id` 等于本入口或 `chat_info.chat_id`；按 `message_id` 去重，保留首次出现；从根出发沿 `upper_message_id` 反向建立的子集合遍历，用访问集合防环，遇环 → `envelope-invalid(cycle)`；任一条目不可从根到达 → 整个容器以 `envelope-invalid(unreachable)` 失败，不渲染、不下载、不做部分交付。
- **文字**：根 mget 渲染块作为**一个整体**文字单元，按 D8 固定分段；嵌套层级、发送者与 `@` 解析都来自渲染块，不做节点级对齐；因此不可达节点的正文无法被单独排除，只能按校验整体失败。
- **资源**：按遍历顺序（前序 DFS，兄弟按 raw 先后）取去重后节点的图片与视频 key，每个资源是一个单元，下载一律使用**根 id**。图片与文字不交错，顺序由渲染块中的 `![Image](key)` 标记体现。
- 不读取内容的类型（`interactive`、文件、音频）作为元数据行交付，不记失败。子条目数量不设上限，超出页容量的部分续读。
- 下载 key 下载失败（`234003` 等）→ final 失败项；不换 id 重试。

**D6 话题。** 触发条件：链接根带 `thread_id`。
- 列表每次 CLI 调用只取一个平台页：`lark-cli im +threads-messages-list --thread <omt> --as bot --order asc --page-size 50 --no-reactions --format json`，由 Host 掌握分页，读取 `has_more` 直到 `false`；读取期间新增的消息按读到为止，不设稳定边界。
- **页合约**：`ok === true`、`messages` 为数组；每一项的 `chat_id` 等于来源群、`thread_id` 等于请求话题，任一项不满足 → 整页作废 `envelope-invalid(topic-item-foreign)`；页内 `thread_message_position` 严格递增。`has_more: true` 必须带非空 `page_token`。
- **终止**：新 token 与本次读取已用过的 token 相同 → `pagination-loop`；连续 3 个空页（无消息）→ `pagination-stalled`；`230001` 为列表页 final 失败。
- **链接所指**：列表中出现链接根（同 id）时标注「链接所指」，不重复交付。列表中没有则不追加。
- **列表首页失败**：瞬时失败时附同位置话题 cursor，`attempt` 加 1（不交付列表项）；第 3 次，或 final 失败（`230002`、`99991672`、`230001`）时回退为**链接所指消息的单条读取**（kind `single`，可照常续读），并记 `topic-list` 失败项；不附话题 cursor。
- **中间页失败**：已读页保留；该页 final 失败，或第 3 次瞬时失败，记 `topic-page@<页序号>`，结束读取，不附 cursor。
- 话题内每条消息按 D5（合并转发）、D8/D9（文字与资源）同一规则处理；消息内的单元也跨页续读。

**D7 续读快照表。** 媒体续读 cursor 是 Host 进程内存中的快照表项：
- 结构：`{ id, caller, containerId, linkIndex?, kind, units（只追加）, position, attempt, failedCount, topic?{pageToken, emptyStreak, seenTokens} }`；`failedCount` 为累计终态失败数，快照不保存失败明细。`units` 是读取计划（文字段、资源、视频单元，话题时含已读页的单元），建立后不可修改，续读只读它；每签发一页新建一个条目，旧条目保留至过期。
- 游标是随机不透明 id（128 位 base64url，固定最大长度）。TTL 30 分钟；每次签发时清理过期条目。
- 续读校验（平台调用之前）：id 不存在或过期 → `cursor-invalid`；`caller` 不等于实际 caller 的会话与入口 → `cursor-mismatch`；`containerId` 不等于参数 `messageId` → `cursor-mismatch`；参数带 `linkIndex` 且不等于条目值 → `cursor-mismatch`。Host 重启后表为空，旧 id 全部 `cursor-invalid`。
- 续读每页在返回前重验 caller（不成立 → `caller-changed`，丢弃结果，不返回 cursor）。
- 游标只在读取计划建立后签发；计划建立前的失败不附 cursor。
- 接受的 trade-off：续读只用快照，不重读容器与链接，因此不检测两页之间的编辑、撤回或权限撤销；结果可能混合两个版本，由 `failed` 项与下载失败如实反映其中可检测的部分。

**D8 单元、位置与推进。**
- 单元序列：文字段（固定分段，id `<根或消息id>#t@<码点偏移>`）、资源单元（`<节点id>#r<序号>`）、视频单元（`<节点id>#v`）。不读取内容的类型（`interactive`、文件、音频、已删除）为恒成功的 note 单元（id `<节点id>#n<序号>`，计入读取计划与 delivered，不计失败）；「模型不能看图」汇总行不是单元，每页至多 1 条。（实施对照 2026-11-23）
- 位置 = 单元序号 + 视频单元内的进度 `k`（下一个待取整秒）。
- 推进规则（唯一规则）：
  - 交付成功 → 位置前进，`attempt` 归零。
  - 瞬时失败（平台读取、下载、话题页的超时与 5xx 等）→ 本页在该单元前结束，cursor 停在该单元，`attempt` 加 1，原因只写入文字诊断、不进入 `failed`；**同一位置第 3 次失败 → 该单元记入 `failed` 并跳过**。
  - final 失败（`230002`、`99991672`、`234003`、校验与结构错误、磁盘不足、`link-*`）→ 该单元记入 `failed` 并跳过，本页继续。
  - 不可跳过的话题列表页：瞬时失败附同位置 cursor，第 3 次或 final 失败 → 读取结束、不附 cursor（话题列表首页按 D6 回退）。续读不重读容器（D7）。
  - 视频单元在本页无交付且下载耗尽页时限 → final 跳过（不可续传，避免相同进度循环）；本页已有交付 → cursor 停在视频单元。
- 每个返回的 cursor，其（位置，`attempt`）按字典序严格大于请求的，且 `attempt ≤ 2`。
- **模型不能看图**：每次调用开始判定一次。false 时资源单元不进入本次交付，不下载；全部资源（图片与视频）合并为一条元数据行（写明张数与视频数），不计失败，不影响 `complete`。

**D9 页容量、预算与资源安全。**
- 单页容量 16 000 字符，按最终序列化大小计：数据块 wrapper、转义后的 JSON、账本与诊断行，以及**固定预留**（wrapper 与账本骨架的上界、最大 cursor 长度与一条失败明细的上界）。打包按计划顺序加单元，超出即停，不再签发后回退。**单元与其失败明细原子打包**：放不下则本页在该单元前结束（cursor 停在该单元，`attempt` 不变），下一页重新尝试该单元（可能多一次平台调用，失败明细仍只记入一次）。
- 文字固定分段预算 4 000 个转义后字符（页容量的四分之一，固定值）；边界只取决于文本与预算。
- 构造时检查：预留 + 一个分段不超过页容量，仅用于测试夹具的容量配置。
- 单页时限 90 s（`AbortSignal` 贯穿平台读取、下载与抽帧）；视频下载超时为本页剩余时限，不设单独的 CLI 超时；解码窗口 30 s。
- 单页 `AttachmentStore` 图片数与字节限额用尽即停，剩余资源由续读交付。
- 大信封：`execFile` 的 `maxBuffer` 为 128 MiB；超过时 `envelope-too-large`（附字节数），不当作无内容。
- 磁盘：每 50 ms 用 `statfs` 测 spool 所在卷的可用空间，低于 512 MiB（可配置）→ 终止进程组、删除调用目录、`disk-low`；子进程输出 `ENOSPC` 同样归为 `disk-low`。覆盖下载与抽帧两个阶段，并发调用的占用自然计入卷的可用空间。

**D10 视频。**
- 抽帧使用单次 `select`：每个整秒取第一帧（首帧，以及 `floor(t)` 与上一选中帧不同的帧），**加场景变化帧 `gt(scene,0.08)`**（2026-11-23 所有者在真机验收后决定恢复，见「Ponytail 精简」trade-off 7）；同一源帧只选一次；不用 `fps` 重采样。阈值 0.08 沿用 `ffed6b60` 引入的旧实现（`LOCUS_VIDEO_LIMITS.sceneThreshold`）。
- 展示时间取 `showinfo` 的 `pts_time`（减去流的 `start_time`，−1 ms 以内按 0），不推算。
- 位置 `k` 仍为整数秒（不用 PTS/time_base，不跨页保存场景状态）；一页从 `k` 开始解码（输入 seek 到 `k−1`，因此窗口首帧有前一帧可比较场景分数，保持源时间轴），选择 `t ≥ k` 的整秒首帧与场景帧。一页覆盖窗口 `[k, k+n)`，两类帧按时间排序，与 showinfo 时间逐帧配对，合计至多本页配额（与图片额度共用）。失败槽位同样推进 `k`，因此不会再次选出。
  - 窗口缩小：`-frames:v` 取配额+1，用多出的一帧判断溢出；溢出时以该帧所在整秒 `s` 为界，本页只交付 `s` 之前的帧，`nextK = s`（整秒帧每秒至少一帧，故 `s > k` 或全部在同一秒）。被推迟的帧下一页从 `s` 起重新选出，不丢、不重复。
  - 单秒放不下：若配额+1 帧全在同一整秒，本页交付该秒前「配额」帧，其余场景帧记一项该秒的 `scene-frames-over-budget` 失败（计数，不静默），`nextK = s+1`，`k` 仍严格前进。
  - 超时被杀：只交付早于「最大文件对应记录」所在整秒的槽位，`nextK` 为该整秒（该秒的场景帧可能还没解码，整秒不被拆页）；可交付的部分为空时按空前缀处理（`frame-extraction-timeout`）。
- 记录与文件的配对：按 showinfo 的序号 `n` 与文件名 `f_%06d` 配对。
  - 存在文件却没有对应记录 → 时间轨无法配对，整个窗口作废，视频 `frame-timestamps-unavailable`（final），封面照常。
  - 记录存在而文件缺失或为空、超过单帧字节上限、magic MIME 不符或 `AttachmentStore` 拒绝 → 只该槽位失败（`frame-file-missing` 或 `frame-admission-failed`），时间取自记录，`k` 照常推进。
  - 进程超时或被终止：只处理序号小于最大已存在文件的槽位；最大者可能被截断，连同其后的槽位留待下一页；已处理前缀为空 → `frame-extraction-timeout`（final 跳过）。
- 每页重新下载视频（无 Range、无跨调用缓存），按剩余时限，下载后 `ffprobe`，解码后删除视频与帧再返回。

**D11 装配与指引。** `selectLocusEntryReadTools` 在 IM 入口且媒体可用时装配两个工具；`publishesLocusMessageTool` 与 prompt 共用同一判定。触发消息含链接时（D2 同一提取函数），首投与续投 prompt 增一行「可用 `pet_locus_linked_message`，messageId 用触发消息 id」。两个工具说明与 prompt 写明：返回 `cursor` 时继续读完；`complete` 为 false 时如实说明失败项与未读范围，不声称读完。历史工具行尾 id 的判定扩展到含 D2 可提取链接、或 `merge_forward` 标记的行。

**D12 结果与披露。** 返回结构：`{ complete, delivered, failed:[{id,reason}], cursor? }` 与渲染文字（交付数、失败项、是否有后续）。`failed` 只含本页新记入的终态失败明细（瞬时失败原因只在文字中），消费者按 `id` 跨页聚合。`complete` 为 `true` 当且仅当没有 `cursor` 且快照中的累计终态失败数为 0。平台文字（正文、发送者、群名）以 JSON 字符串值呈现，`<` `>` `&` 转义为 `\u003c` `\u003e` `\u0026`，放在 Host 生成的数据块内，固定说明在数据块外；`pet_locus_message` 与 `pet_locus_linked_message` 相同。群名去控制字符与换行并截断到 64 字，元数据字段 128 字（标签清洗，不是内容上限）。

## 所有者决定（已确认，不再讨论）

1. 长视频每页重新下载并窗口解码，不跨调用缓存。
2. 资源阈值全部视为非内容上限：磁盘保留 512 MiB、信封解析上界 128 MiB、同一位置第 3 次失败跳过该单元、话题连续空页 3 页终止、单页 16 000 字符。
3. 内层视频与 >50 条话题的分页在实施阶段补测（tasks 6.6、6.7）。
4. `interactive` 等卡片只交付元数据，计为已交付，不计失败。

## Risks / Trade-offs

- [本群成员可借链接让 bot 读出其本人看不到的群消息] → 所有者已接受「带进本群即可读」；平台 `is_authorized` 与原始读取为上限；真机验收包含一条 bot 不在的群的链接。
- [`message_links/query` 无公开文档且返回子树不完整] → 只用于确定根与 `chat_info`；结构以 raw 为准；信封严格解析，畸形即失败。
- [续读只用快照，不检测两页之间的编辑、撤回、权限撤销] → 接受（见「Ponytail 精简」trade-off 3）。
- [内层视频以根 id 下载未实测] → tasks 6.6 探针；实现把它当未知，失败时记 `failed`，不换 id 猜。
- [快照表占用内存] → TTL 30 分钟，签发时清理过期项；单个快照以文字与资源元数据为主，视频与帧不常驻。
- [长视频每页重新下载，带宽随页数增长] → 只在模型继续读时发生；所有者已接受。

## Migration Plan

- 仅 dsh-pet 代码，无持久化格式变化。合入后 `dsh build`，由所有者决定是否重启 Host；重启使未读完的 cursor 失效（预期）。
- 依赖所有者已为 Pet 应用开通的 `im:message.message_link:read`；未开通时 `link-scope-missing`。
- 回滚：回退提交并重新 build。

## Open Questions

- 内层**视频** key 以根 id 下载是否成功（tasks 6.6）。
- 话题超过 50 条（≥2 页）的 `has_more` 真机分页（tasks 6.7）。
- Lark 国际品牌的 applink 主机名（当前只部署飞书，缺省白名单不含）。

## Ponytail 精简 2026-11-21

本轮按 ponytail（最小可实施）审查做了 12 项简化，固定所有者决定保持不变（完整上下文、无 Host 内容上限、续读游标、同位置第 3 次失败跳过单元、磁盘保留 512 MiB、信封上界 128 MiB、连续 3 个空页终止、单页 16 000 字符、交互卡片仅交付元数据）。

1. 视频下载超时 = 本页剩余时限，去掉每次 CLI 20 s 超时；新增「40 s 下载成功」测试。
2. 文本模型：每次调用判定一次 `canViewImages`；false 时所有资源合并为一条元数据行（计数），不是单元、不是失败、不影响 `complete`；去掉「模型不能看图」失败类及其 3 个场景与测试。
3. cursor 改为随机不透明 id，指向进程内快照表（不可变读取计划、位置、`attempt`、`failedCount`、caller）；TTL 约 30 分钟；未知 id → `cursor-invalid`；去掉签名 codec、`fp`、`urlSha256`、`cursor-stale` 子原因、容器重读、渲染绑定、精确键集与篡改矩阵；重放场景合并为一条。**接受的 trade-off：不检测读取期间的编辑与权限撤销。**
4. 话题：读到 `has_more=false`（读取期间的新消息按读到为止）；保留重复 token 与 3 个连续空页的终止；去掉边界、target-first、列表初始化、`targetDone`、−2 哨兵与 token 失效重扫；列表首页 final/第 3 次失败 → 回退为链接所指单条消息 + 一条 `topic-list` 失败项，不附话题 cursor；`230001` 为列表页 final 失败；只保留逐项 `chat_id`/`thread_id` 成员校验。
5. 账本：`complete: boolean`、`delivered` 计数、`failed:[{id,reason}]`（运行类失败用 `topic-page@`、`topic-list`、`container@` 等前缀）、可选 `cursor`；尝试次数写在文字中；去掉 `ledger.unread`、`scope`、结构化 `retry`、三态 `status`。测试只保留一个完整遍历 oracle；停止读取的测试断言无 cursor、`complete=false`、失败项存在。
6. 合并转发：文字单元 = 根 mget 渲染块整体，按 D8 分段；资源单元 = 去重后节点的资源（按遍历顺序），以根 id 下载。校验只留：首项 = 根、根的 chat 匹配、按 `message_id` 去重、访问集合防环；去掉节点级 mget 对齐、`renderSource`/`renderMismatch`、6 个信封非法子码、query/raw 对账（b)(c)(d)、`rawExtra`、snapshot-only。**接受的 trade-off：图片不与各子消息文字交错，顺序由 mget 标记体现。**
7. 视频帧：首帧加每个整秒的首帧（按 `floor(t)` 选择）；位置为整数秒 `k`；展示时间取 showinfo；失败槽位照常推进 `k`。去掉场景变化帧、PTS/time_base 位置、预滚与位置缺失。**接受的 trade-off：不做场景变化帧。**（**2026-11-23 经所有者决定撤销场景帧部分**：真机验收中 19 秒录屏的亚秒闪烁——约 1.5 s 与 6.4 s 处顶栏消失——整秒采样完全漏掉，旧的场景检测能抓到。现为整秒帧加窗口内场景帧；位置仍为整数秒、无 PTS/time_base 位置、无跨页场景状态，见 D10。）
8. 大信封：`execFile` `maxBuffer` 设为 128 MiB，溢出为 `envelope-too-large`；失败信封先读 stdout 后读 stderr（修正真机 stderr 问题）；磁盘监控只用 `statfs`，`ENOSPC` 归入 `disk-low`；去掉 stdout 落 spool 文件与目录大小轮询。
9. 页打包：固定预留开销（wrapper + 账本骨架 + 最大 cursor 长度）；测试保证最大 cursor 小于预留；去掉重签名/回退循环与 `page-capacity-too-small` 终态，只保留构造时检查。
10. 去掉历史包袱：design 中的轮次修订表（历史保留在 `review.md`）、删除线的废弃注释、已废弃的 D4 条目；v1 任务组 1–5 收为一行；⚪ 废弃测试行改为一条「删除旧测试」任务。
11. 变异检查压缩为 4 项：stderr 回退、根 id 下载、严格 `(位置, attempt)` 推进、转义大小打包；`tasks.md` 与 `test-plan.md` 一致。
12. 去掉「跨页严格递增则丢弃该页」与「列表缺目标时追加」两个分支（跨页位置仍在单页内检查）。

**接受的 trade-off 汇总**：
- 3：续读不检测读取期间的编辑、撤回与权限撤销。
- 6：图片不与子消息文字交错，顺序由 mget 标记体现。
- 7：~~不做场景变化帧，只按整秒取帧~~（2026-11-23 撤销：恢复窗口内场景变化帧，位置模型不变）。
