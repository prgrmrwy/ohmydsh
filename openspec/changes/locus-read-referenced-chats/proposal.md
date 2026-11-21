## Why

2026-11-12，张勇在「群贤毕至」（`oc_1f75…`）贴了一条飞书消息链接，@ bot 问链接里的视频。locus 子会话读不到：`pet_locus_message` 只读本入口 chat 的消息，子会话也无法把链接换成消息。

所有者确定的语义：**内容被带进本群，bot 就可以读**。带进来的方式包括逐条转发、合并转发和消息链接；不要求提问者在来源群，bot 不主动翻别的群。

第一版已部署。2026-11-19 真机验收暴露：19 秒视频只给 8 帧且都在前 7.6 秒；链接指向话题时只读那一条；链接指向嵌套合并转发时报 `link-unresolved`。所有者决定：**目标是拿全上下文，Host 不自设内容上限**，只受平台权限、部署 `AttachmentStore` 限额与模型上下文约束；到边界用续读（cursor）接上，不静默丢弃。2026-11-21 的平台探针提供了嵌套树、话题与失败信封的实测依据（见 design）。

## What Changes

- **读取消息链接（新增）**：`pet_locus_linked_message({ messageId, linkIndex?, cursor? })`。`messageId` 必须是本入口 chat 内的消息；Host 从其正文取出飞书消息链接（不设个数上限），经平台 `message_links/query` 解析，只有 `is_authorized: true` 才继续；再以 bot 身份原始读取根消息。
- **合并转发逐层展开（修订）**：`pet_locus_message` 读取合并转发时返回全部子消息（含嵌套各层），不设条数上限。文字取根的 mget 渲染块，资源以根消息 id 下载。
- **话题整体读取（新增）**：链接指向话题消息时，逐页读完该话题（`has_more` 为 false 为止）；列表首页失败时回退为链接所指消息的单条读取。
- **视频整秒截帧（修订）**：移除 64 MB / 300 s / 8 帧上限；每个整秒取一帧，展示时间取 showinfo；长视频按页续读，每页重新下载。
- **续读游标（新增）**：随机不透明 cursor 指向进程内快照表（TTL 30 分钟，重启失效）。每页返回 `complete`、`delivered`、`failed`（`[{id,reason}]`）与可选 `cursor`；同一位置第 3 次失败跳过该单元。
- **模型不能看图（修订）**：每次调用判定一次；不能看图时全部媒体合并为一条元数据行，不计失败，不影响 `complete`。
- **正文无损分段（修订）**：移除 4000 字符正文上限；正文按固定分段（4 000 转义后字符）与 16 000 字符页容量交付；平台文字统一以转义 JSON 呈现（两个工具同样）。
- **资源安全（新增）**：`statfs` 监控 spool 所在卷，保留空间 512 MiB，低于则终止并清理（`ENOSPC` 同样归为磁盘不足）；单页时限 90 s；CLI 信封 `maxBuffer` 128 MiB。
- **CLI 失败信封（修正）**：失败信封先读 stdout，为空则读 stderr，使 `99991672 → link-scope-missing` 在真机生效。
- **入口历史标注（修改）**：`pet_locus_chat_history` 中含消息链接或合并转发的行，行尾附消息 id。
- **工具参数契约（修改基线）**：`pet_locus_message` 的参数改为 `{ messageId, cursor? }`，图片超额由「标注省略数量」改为续读；两条基线 requirement 以 MODIFIED 整体改写并保留既有场景名。
- **链接指引（修改）**：prompt 与工具说明改为「用 `pet_locus_linked_message` 读取；返回 `cursor` 时继续读完；未读完或有失败项时如实说明」。
- `pet_locus_chat_history` 的读取范围不变，仍只读本入口；不新增跨群历史、成员核验或候选搜索。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pet-locus-media-access`：单条消息读取支持合并转发逐层展开、话题整体读取、续读游标与每页账本；视频整秒截帧与分页；新增消息链接读取工具（装配、提取、平台解析授权、话题分页）；入口历史为含链接与合并转发的行标注 id；改写引用消息与消息链接的读取指引。
- `pet-locus-doc-comments`：文档入口对两个消息工具与相关平台调用的处置（不装配、不调用）。

## Impact

- 代码：`packages/dsh-pet/src/host/channel/media.ts`（容器读取、合并转发遍历、单元与分页、CLI 运行器与 `statfs` 监控）、`channel/media-video.ts`（整秒选帧、时间轴、逐槽位校验）、新增 `host/locus/media-cursor.ts`（快照表）、话题读取器、`host/locus-message-tool.ts` 与 `host/locus-linked-message-tool.ts`（参数、output schema、转义 JSON 呈现、账本）、`host/locus/entry-read-tools.ts`（装配）、`host/locus/message-guidance.ts` 与 `host/locus/context.ts`（指引）、`host/locus-history-tool.ts`（标注 id）、`LOCUS_CALLER_BOUND_TOOLS` 与 `executor-scope`、`locus-composition` 守卫测试。
- 平台：依赖 `im:message.message_link:read`（所有者已为 Pet 应用申请并实测）。lark-cli 1.0.97 未封装 `message_links/query`，经 `lark-cli api POST` 调用；该接口没有公开文档条目，测试用脱敏夹具固定。
- 资源：本机可用磁盘有限（探针时约 3.4 GiB），视频与大信封受磁盘监控与上限保护；长视频每页重新下载，带宽随页数增长，只在模型继续读时发生。
- 信任边界：本群任何成员贴出一条 bot 所在群的消息链接，bot 就能把那条消息（及其嵌套内容、所在话题）读进本群，不要求贴链接的人在来源群。这是所有者确认的语义；授权判定交给平台 `is_authorized` 与 bot 原始读取是否成功。
- 本 change 不引入持久化、不新增清理契约；续读只使用进程内快照，trade-off 见 design「Ponytail 精简 2026-11-21」。
