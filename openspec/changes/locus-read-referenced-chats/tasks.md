## 0. 平台探针与夹具（gate：结果与 design 不符则停下回到 design）

> v1 任务组 1–5（链接提取、合并转发首版、链接工具首版、装配与指引首版、首版验收）已完成，由下列新组替代；不再逐项追踪。

- [x] 0.1 合并转发探针（2026-11-13）：结构与首版 D5 一致；夹具 `lark-merge-forward-envelopes.ts`。
- [x] 0.2 消息链接夹具（2026-11-12）：`message_links/query` 与原始读取脱敏夹具，含 `99991672` 信封。
- [x] 0.3 平台探针（2026-11-21）：嵌套树、根 id 唯一下载、query 少一层、话题信封、stderr 失败信封、信封大小（design「已实测的平台事实」1–7）。
- [ ] 0.4 内层**视频** 探针：所有者在测试群转发一条「嵌套合并转发且含视频」的消息，验证根 id 能否下载内层视频 key（`--type file`）；失败则视频单元记入 `failed`，不换 id 猜测。结果记入 design 事实 2。
- [ ] 0.5 话题超过 50 条探针：`+threads-messages-list --page-size 50` 跨 ≥2 页的 `has_more` 与 `page_token`，确认 design D6 的分页。
- [x] 0.6 脱敏夹具：`lark-merge-forward-nested-envelopes.ts`（raw 29 节点含跨群层级与 `interactive` 占位、query 26 节点、mget 嵌套渲染）、`lark-thread-list-envelopes.ts`（第 1 页含 token、第 2 页、非法 token、外来项）、stderr 失败信封（10077、99991672、230002、234003）。不含真实 open_id、token、群名、正文或人名。

## 1. 删除旧测试

- [x] 1.1 删除 `test-plan.md` 中 ⚪ 废弃测试所指的旧用例（旧上限、旧 cursor 签名与 cursor-stale、旧 target-first、旧 query 恰一条、旧同页重放、旧预算与总时限）；确认它们的绿色不再计入。

## 2. CLI 运行器：失败信封、大信封、statfs 监控（TDD）

- [x] 2.1 Red（`locus-media-spool.test.ts`，覆盖 R22、R23）：stderr-only 失败信封映射 `99991672`、`10077`、`230002`，stdout 形态映射相同；3 MiB 合成信封完整读取；超过 `maxBuffer` 为 `envelope-too-large` 且带字节数；低于保留值时在下载与抽帧阶段终止进程组并删除调用目录；`ENOSPC` 为 `disk-low`；两个并发调用各自清理；取消与单页时限路径的 spool 为空。
- [x] 2.2 Green：`execFile` 的 `maxBuffer` 为 128 MiB；失败信封先读 stdout、为空则读 stderr（取最后一个可解析 JSON）；单个 `statfs` 监视器每 50 ms 测卷可用空间，保留值 512 MiB 可配置；替换 1 MiB 缓冲与目录大小轮询。
- [x] 2.3 Refactor；全量测试保持绿（含既有 spool、字节上限与看门狗测试）。

## 3. 续读快照表（TDD）

- [x] 3.1 Red（`locus-media-cursor.test.ts`，覆盖 R16 b–c、R21 b）：未知、过期、重启前的 id → `cursor-invalid`；跨 caller、`messageId` 或 `linkIndex` 不符 → `cursor-mismatch`，均零平台调用；TTL 30 分钟，签发时清理过期项；每个签发的 cursor 长度小于预留。
- [x] 3.2 Green：`locus/media-cursor.ts`：进程内 `Map`，128 位随机 id（base64url），快照字段 `{ caller, containerId, linkIndex?, kind, units, position, attempt, failedCount, topic? }`，每页新建条目。
- [x] 3.3 Refactor。

## 4. 合并转发树与校验（TDD）

- [x] 4.1 Red（`locus-media-tree.test.ts` 与 `locus-media-merge.test.ts`，覆盖 R8、R9；「续读不再读取容器」随游标落在 `locus-media-pages.test.ts`）：嵌套 F/G/H（文字为一个根渲染块，L2/L3 图片以根 id 下载）；120 子消息分页；交互、文件、音频为元数据行；内层 `234003` 不换 id；乱序输入的前序遍历；重复 `message_id` 保留首次；首项不是根或根不属本入口；环；任一不可达条目使容器整体 `envelope-invalid(unreachable)`，mget 渲染块含不可达节点正文的夹具同样整体失败。夹具来自 0.6。
- [x] 4.2 Green：根原始读取 → 校验（首项为根、根的 chat、按 `message_id` 去重、访问集合防环、不可达即整体失败）→ 前序遍历；文字单元为根 mget 渲染块整体；资源单元按遍历顺序，以根 id 下载；去掉节点级 mget 对齐、`renderSource`、query/raw 对账。
- [x] 4.3 Refactor；删除 `LOCUS_MERGE_MAX_CHILDREN`、`boundMergeText`、嵌套元数据路径。

## 5. 单元、分段、页打包与账本（TDD）

- [x] 5.1 Red（`locus-media-pages.test.ts`，覆盖 R2、R16 a、R17、R18、R19、R20、R21）：模型不能看图的元数据行（一次判定）；20 图 limit 8 → 8、8、4；40 图 → 五页；一次瞬时失败后恢复；同位置第 3 次跳过；已有交付后的瞬时失败；final 不中断；补充不变量（注入失败序列下 `(位置, attempt)` 严格递增、`attempt ≤ 2`、有限终止）；重放与并发的起点与 id 稳定；完整遍历与停止读取两条独立断言；首次读取计划前失败；5000 字符完整；转义分段不超预算；分段边界不随页开销变化；16 000 `<` 按最终大小分页且每块可解析；构造时容量过小抛错；1000 张终态失败的分页与终止；合并续读零原始读取与 mget 调用；停止读取以话题第二页三次失败为夹具（R19）。
- [x] 5.2 Green：单元序列（文字固定分段、资源单元、视频单元）；位置为序号加视频 `k`；推进规则（瞬时失败 `attempt` 1、2，第 3 次跳过；final 跳过；不可跳过的话题列表页结束读取）；账本 `{complete, delivered, failed, cursor?}`；固定预留打包（失败明细与单元原子）；JSON 转义呈现；快照条目在计划建立后不可变。
- [x] 5.3 Refactor；删除 `boundBody`、4000 字符常量、「省略 N 张」文字与 cursor 重签名循环。

## 6. 工具契约（TDD）

- [x] 6.1 Red（`locus-message-tool.test.ts`、`locus-linked-message-tool.test.ts`、`locus-message-tool-runtime.test.ts`、`locus-context.test.ts`，覆盖 R1 e、R3、R5 c 与 e、R10 a–d、R20 伪造边界）：参数只接受 `messageId`、`cursor`、`linkIndex`；未知键与非法值在平台读取前拒绝；`ToolRuntime` 矩阵执行成功、失败与分页结果，并校验 `output.schema`（`complete`、`delivered`、`failed`、`cursor` 为纯 JSON，见 pitfalls §16）；指引文字要求续读，不声称读完。
- [x] 6.2 Green：`host/locus-message-tool.ts` 与 `host/locus-linked-message-tool.ts` 参数与 output schema；`LOCUS_CALLER_BOUND_TOOLS`、`executor-scope.test.ts` 计数与 `locus-composition` allowlist 同步；`message-guidance.ts`、`context.ts` 文案。
- [x] 6.3 Refactor。

## 7. 链接读取（TDD）

- [x] 7.1 Red（`message-link-extract.test.ts`、`locus-linked-message-tool.test.ts`，覆盖 R11 b–c、R12、R23 c、R24 c）：12 个链接全部编号、`linkIndex: 12` 可读；百分号编码 token 逐字节送入 query；`99991672` 与 `10077` 在 stderr 形态映射正确；26 节点 query 与 29 节点原始读取读全部；空 `messages` 与缺 `message_id` 为 `link-unresolved`；原始 chat 不一致或失败不下载；20 000 字符正文无损、群名不超过 64 字。
- [x] 7.2 Green：`message-link.ts` 去掉 10 个上限、保留百分号编码；`readLinkedMessage`：原始读取 → 提取 → query（只用根与 `chat_info`）→ 根原始读取 → 同一单条、合并转发或话题流程；去掉 `messages.length !== 1` 规则。
- [x] 7.3 Refactor。

## 8. 话题读取（TDD）

- [x] 8.1 Red（`locus-topic-reader.test.ts`，覆盖 R13、R14、R15、R17 的列表失败）：根与 5 条回复标注链接所指；120 条三页读完；读取期间新增的消息；20 图回复 8、8、4 后续回复按序交付；重复 token 为 `pagination-loop`；三个连续空页为 `pagination-stalled`；外来项整页作废；`230001` 为列表页失败；首页瞬时失败 attempt 1 附 cursor、`failed` 为空且不交付；首页 `230002` 回退到单条读取并记 `topic-list`；中间页权限失败保留已读页；链接所指只标注一次，缺失时不追加；列表页第 3 次失败结束读取。
- [x] 8.2 Green：话题读取器：每次 CLI 调用只取一个页（`--order asc --page-size 50`），读到 `has_more` 为 `false`；页合约（成员校验、页内严格递增）；token 循环与空页计数；首页回退与重试；话题项的媒体单独原始读取、以自身 id 下载。
- [x] 8.3 Refactor；确认代码中不存在边界、target-first、列表初始化、−2 哨兵与 token 失效重扫。

## 9. 视频（TDD）

- [x] 9.1 Red（`locus-media-video.test.ts` 与 `locus-media-video.ffmpeg.test.ts`，覆盖 R6、R7、R17 的视频跳过、R25、R26）：19 秒静止视频时间点恰为 {0..18}；VFR 与 `start_time` 2.0；19 秒按每页 8 帧读为 8、8、3；40 秒下载在 90 秒页时限内成功；100 秒下载在本页无交付时 `video-download-exceeds-window` 跳过；已有交付时视频留到下一页；无记录的文件作废窗口；中间文件缺失只让该槽位失败；超时保留已验证前缀；单帧保存失败的槽位推进；150 帧配对正确；20 分钟 500 MB 视频不因大小跳过。
- [x] 9.2 Green：单次 `select` 取每个整秒首帧（不做场景检测、不用 `fps`）；`showinfo` 配对；逐槽位规则；每页从 `k` 解码（输入 seek 并保留源时间轴）；超时保留已验证前缀；下载超时为本页剩余时限，去掉单独的 20 秒 CLI 超时；每次返回前删除视频与帧。
- [x] 9.3 Refactor；既有尺寸测试保持绿。（media-video.ts 层完成：`extractSecondFrames` 与 ffmpeg 集成测试；下载页时限三行（R25 的 40 s / 100 s / 已有交付）与 R6 media 层行由 core 在 media.ts 接线后验证；旧 `extractKeyframes`/`buildFrameFilter` 待 media.ts 接线后删除。）

## 10. 装配、指引、历史与文档入口

- [x] 10.1 Red（`locus-context.test.ts`、`locus-chat-history-tool.test.ts`、`locus-on-demand-provisioning.test.ts`、`locus-delivery-prompt.test.ts`，覆盖 R4、R5、文档入口）：装配矩阵（IM 与话题 × 创建与冷恢复 × 媒体可用与否）；文档 Delivery 不产生 `message_links/query`、`+threads-messages-list`、原始读取或资源下载调用。
- [x] 10.2 Green：`selectLocusEntryReadTools` 同时装配两个工具，`publishesLocusMessageTool` 与 prompt 共用判定；历史行尾 id 判定扩展到链接与合并转发标记；文档入口不装配。
- [x] 10.3 Refactor。

## 11. 文档

- [x] 11.1 dsh-pet README（中文与英文）：链接读取、授权前提 `im:message.message_link:read`、续读与账本、资源阈值（512 MiB、128 MiB、90 s、16 000 字符）与风险说明。
- [x] 11.2 `docs/architecture/dsh-plugin-integration-pitfalls.md` 新增 §17：快照 key 返回 `234003`、只有根 id 能读与下载、`message_links/query` 少一层、lark-cli 失败信封在 stderr、话题列表 `total` 是页内条数。

## 12. 变异检查与验收

- [x] 12.1 变异检查（4 项，见 `test-plan.md`）：① 还原 stderr 回退；② 还原根 id 下载；③ 还原严格 `(位置, attempt)` 推进；④ 还原转义大小打包。每一项都必须让至少一条 🔴 行变红，验证后恢复。
      - 2026-11-23：①去掉 stderr 回退 → 13 红；②内层图片改用节点自身 id 下载 → 3 红；③取消第 3 次跳过（attempt 判定恒假）→ 2 红；④去掉 `<>&` 转义 → 3 红。每项验证后已还原 media.ts。
- [x] 12.2 dsh-pet 的 `npm run typecheck` 与 `npm test`；仓库根的 `npm test`、`npm run check:artifacts`、`openspec validate locus-read-referenced-chats --strict`；`test-plan.md` 中所有非废弃行为为 🟢。
      - 2026-11-23：dsh-pet typecheck 0 错；全量 vitest 连续 3 次均 3472 通过 / 4 跳过 / 0 失败（真实 ffmpeg 8 条实际运行）；仓库根 npm test 808 通过 / 0 失败；check:artifacts 通过；strict validate 通过。
- [ ] 12.3 真机验收（所有者授权的测试群）：重跑 2026-11-19 的失败场景——19 秒视频（整秒帧覆盖 0–18）、链接指向整个话题、链接指向嵌套合并转发（29 节点，L2/L3 图片）；另测 bot 不在的群（`link-unauthorized`）、应用无权限点或桩部署（`link-scope-missing`）、含视频的合并转发（0.4）与纯文字链接。确认返回后 spool 无残留，并记录磁盘可用空间前后。
- [ ] 12.4 写 verify artifact。
