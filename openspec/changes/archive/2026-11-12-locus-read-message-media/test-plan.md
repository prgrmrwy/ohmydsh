## Test Plan

前提：review.md 为 `VERDICT: APPROVE_WITH_CHANGES` 且 `CHANGES_APPLIED: yes`（2026-11-11 定向复核）。

测试文件均位于 `packages/dsh-pet/test/`。新增场景初始为 🔴 red；delta 中**原样保留**的既有场景映射到已有测试（「🟡 existing」）。2026-11-11 apply 阶段：全部行已回填实际用例名并确认为绿，现状态列为 🟢（`(existing)` 表示该用例在本 change 之前就存在）。

| Requirement | Scenario | Test File | Test Name | State |
|-------------|----------|-----------|-----------|-------|
| specs/pet-locus-media-access/spec.md → 当前 Delivery 的图片由 Host caller-bound 取得 | 官方 CLI 与私有落盘目录已证明 | locus-media.test.ts | `downloads multiple images in occurrence order and leaves the spool empty`；`writes only through the guarded spool, never through an invented path` | 🟢 (existing) |
| 同上 | 更高版本无需改动即放行 | lark-cli-compat.test.ts | `accepts newer versions without a code change` | 🟢 (existing) |
| 同上 | CLI 或私有目录不可用 | locus-media.test.ts | `is unavailable with zero side effects when the CLI is absent or below the version floor` | 🟢 (existing) |
| 同上 | Delivery 结算后迟到下载 | locus-controller-races.test.ts；locus-media.test.ts | `drops downloaded image content when the exact Delivery stops being current before typed queueing`；`refuses a non-zero CLI exit and a fake MIME without saving`（stale-delivery 段） | 🟢 (existing) |
| 同上 | 被回复消息不自动注入 | locus-media.test.ts；locus-context.test.ts | `does not inject replied message media or text`（端口只读触发消息）；`replied message line points to pet_locus_message in first and follow-up prompts`（prompt 半句） | 🟢 |
| specs/pet-locus-media-access/spec.md → 媒体下载在私有目录内有界完成并在结算前删除 | 下载期超过字节上限 | locus-media.test.ts | `kills the whole process group and leaves nothing when the download grows past the limit` | 🟢 (existing) |
| 同上 | 取消、超时与进程失败 | locus-media-video.test.ts | `kills downloader or frame extractor on abort/timeout/nonzero and leaves nothing` | 🟢 |
| 同上 | 崩溃残留清扫 | locus-media.test.ts | `sweeps crash debris out of the spool at startup` | 🟢 (existing) |
| 同上 | child 无法读取私有目录 | locus-project-read-guard.test.ts | `refuses the media spool, so a child can never read what Pet downloaded for it` | 🟢 (existing) |
| 同上 | 工具调用返回后不留视频 | locus-media-video.test.ts | `leaves no video or frame files after readMessage returns` | 🟢 |
| specs/pet-locus-media-access/spec.md → 非图片媒体保守降级 | 普通附件尚无解析器 | locus-media.test.ts | `returns bounded metadata for file and audio`；`keeps bounded non-image metadata without downloading it` | 🟢 |
| 同上 | 当前消息含视频 | locus-media.test.ts | `current video yields metadata and points to pet_locus_message without download`；`downloads the image of a post that also carries a video, but not the video` | 🟢 |
| specs/pet-locus-media-access/spec.md → 子会话按消息 id 读取本入口 chat 内的单条消息 | 读取被回复消息中的截图 | locus-message-tool.test.ts；locus-message-tool-runtime.test.ts | `returns text and typed image for same-chat post`；`executes through the runtime: text and a real image block, schema-valid` | 🟢 |
| 同上 | 其它 chat 的消息被拒绝 | locus-message-tool.test.ts | `refuses foreign chat without download` | 🟢 |
| 同上 | 话题入口读取所在群的消息 | locus-message-tool.test.ts | `topic entrance reads group main-line message` | 🟢 |
| 同上 | 读取失败不冒充空消息 | locus-message-tool.test.ts | `read failure, deleted or unparseable is a failure not empty` | 🟢 |
| specs/pet-locus-media-access/spec.md → 单条消息读取按模型图片能力与额度返回并重验 caller | 模型不支持图片 | locus-message-tool.test.ts；locus-message-tool-runtime.test.ts | `text-only route returns text and downloads nothing`；`a text-only model route gets text and no download through the runtime`；`model route image capability probe` | 🟢 |
| specs/pet-locus-media-access/spec.md → 单条消息读取工具的装配与参数 | 不接受额外目标参数 | locus-message-tool.test.ts | `rejects any argument besides messageId before platform read` | 🟢 |
| 同上 | 文档入口不装配 | locus-message-tool-runtime.test.ts | `doc child surface excludes pet_locus_message` | 🟢 |
| 同上 | 媒体能力不可用时不装配 | locus-message-tool-runtime.test.ts；locus-message-publication.test.ts | `media unavailable: an IM child is published without pet_locus_message and still attests`（经生产选配 `selectLocusEntryReadTools` 与真实 tool runtime，IM/话题 × 可用/不可用，含 attestation、历史说明与同一判定渲染的 prompt）；`media unavailable: an IM child gets no pet_locus_message and still attests` | 🟢 |
| specs/pet-locus-media-access/spec.md → 视频以封面与有界场景关键帧呈现 | 有 ffmpeg 时返回封面与关键帧 | locus-media-video.test.ts | `returns cover, ordered keyframes with times and sampling note` | 🟢 |
| specs/pet-locus-media-access/spec.md → 视频关键帧的尺寸、校验与时间点 | 非均匀抽样的帧逐一配对时间点 | locus-media-video.test.ts；locus-media-video.ffmpeg.test.ts | `pairs showinfo pts_time to output frames without interpolation`；`pairs real showinfo times with output frames at scene cuts` | 🟢 |
| 同上 | 时间点缺失时不伪造 | locus-media-video.test.ts | `missing or mismatched timestamps fall back to cover` | 🟢 |
| 同上 | 横屏、竖屏与窄长帧的最长边约束 | locus-media-video.ffmpeg.test.ts | `bounds longest edge for landscape, portrait, narrow-tall, small` | 🟢 |
| 同上 | 帧未通过 attachment 校验 | locus-media-video.test.ts | `any frame admission failure returns cover only and no refs` | 🟢 |
| specs/pet-locus-media-access/spec.md → 视频以封面与有界场景关键帧呈现 | 无 ffmpeg 时只给封面 | locus-media-video.test.ts | `no extractor returns cover with reason` | 🟢 |
| 同上 | 视频超出上限 | locus-media-video.test.ts | `oversize bytes or duration skips frames with reason` | 🟢 |
| 同上 | 抽帧超时 | locus-media-video.test.ts | `extractor timeout kills group and returns cover` | 🟢 |
| specs/pet-locus-media-access/spec.md → 入口历史为含媒体的消息标注消息 id | 视频消息行带 id | locus-chat-history-tool.test.ts | `appends message id to media lines within budget` | 🟢 |
| specs/pet-locus-media-access/spec.md → 引用消息与消息链接的读取指引 | 续投 prompt 指向工具 | locus-context.test.ts | `replied message line points to pet_locus_message in first and follow-up prompts` | 🟢 |
| 同上 | 未装配工具时不提及（第 2 轮附录 AM2 补充：生产渲染矩阵） | locus-message-tool-runtime.test.ts | `surface, attestation and Host-rendered prompts agree for IM/topic/doc × media available/unavailable`；`a cold-restored active child is composed through the same selection and runtime` | 🟢 |
| 同上 | 未装配工具时不提及 | locus-context.test.ts；locus-message-tool-runtime.test.ts | `does not name pet_locus_message when the Host has not published it`；`history description names pet_locus_message only when the tool is registered` | 🟢 |
| 同上 | 无法确认链接指向的消息 | locus-context.test.ts；locus-message-tool-runtime.test.ts | `prompt and tool description state message links are unresolvable`；`the description states that message links are unresolvable` | 🟢 |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 文档子会话的工具面 | locus-message-tool-runtime.test.ts；locus-composition.test.ts | `doc child surface excludes chat history and pet_locus_message`；既有 `the doc read is reviewed in both access modes, and the per-kind choice is exclusive in the Host wiring` | 🟢 |
| 同上 | 文档 Delivery 不调用 IM 接口 | locus-on-demand-provisioning.test.ts；locus-delivery-prompt.test.ts | `a doc Delivery reaches neither media, chat-bot nor IM member lookups with a doc id`；`spec Scenario "文档 Delivery 不调用 IM 接口" (prompt side)…` | 🟢 (existing) |
| 同上 | 触发者姓名查询失败 | locus-delivery-prompt.test.ts | `a doc prompt with no resolved name shows only the open id and still renders` | 🟢 (existing) |
| 同上 | 文档待办跳转 | ledger-view.test.ts | `spec Scenario "文档评论待办跳到文档": the inspected url, the comment id noted, never a topic` | 🟢 (existing) |
| 同上 | IM 入口不受影响 | locus-composition.test.ts | `IM child surface equals previous plus pet_locus_message` | 🟢 |

## Coverage Notes

- 「🟡 existing」行的测试名是占位，apply 第一步按实际文件里的用例名回填；找不到对应用例就补一个，并改为 🔴 red 走 TDD。
- `locus-media-video.test.ts` 用替身 runner/替身进程（可控 stdout/stderr、退出码、挂起），不依赖本机 ffmpeg；覆盖进程组终止、超时、时间戳配对与降级。
- `locus-media-video.ffmpeg.test.ts` 依赖本机 `ffmpeg`/`ffprobe`：测试内用 `testsrc` 生成 1920×1080、1080×1920、200×3000、640×360 的短视频并断言实际帧尺寸与无残留；缺 ffmpeg 时 `skip` 并打印原因，verify 时须在有 ffmpeg 的机器上跑绿。
- 2026-11-11 实施中发现规范漂移（媒体能力不可用时工具不装配、prompt 仍提及工具），按 anvil 规则补了 spec 场景「媒体能力不可用时不装配」「未装配工具时不提及」，并做定向复核（见 review.md）。第一次附录复核 REVISE（AM1 旧场景缺可用前提、AM2 装配只有源码文本断言）后：旧成功路径场景加上「媒体能力可用/已装配」前提；per-entry 读工具选配抽为 `selectLocusEntryReadTools` 并经真实 runtime 测试 doc/IM × 可用/不可用；`renderLocusDeliveryFor` 的 `messageToolAvailable` 改为必填；`&&`→`||` 变异会使 3 个测试失败。第 2 轮附录 REVISE（AM2 未覆盖完整 prompt 矩阵、文档面 attestation 与冷恢复）后经所有者同意补测：群/话题/文档 × 可用/不可用 × 首投/续投的生产渲染与工具面、attestation 一致；冷恢复 active 组合经 `handleLocusAgentCreated` 取得行上 endpoint 后走同一选配与 runtime。变异：`&&`→`||` 失败 3 项，prompt 忽略 availability 失败 2 项。
- 「无法确认链接指向的消息」的 THEN 是模型行为，代码测试只能断言 prompt 与工具 description 含该指引；真实答复在预览验收（tasks 最后一组）中人工核对。
- 平台信封形状来自 tasks 1.1 的实测 fixture，存为测试内常量，不提交 raw 消息内容。
