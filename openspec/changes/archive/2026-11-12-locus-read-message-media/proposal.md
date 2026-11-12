## Why

2026-11-10～11 的一次真实 Locus 交互（locus 主会话 `session-4726e493…`）中，子会话两次看不到请求里的关键材料：

1. **引用（被回复）消息里的图片**：投递 prompt 只给出 `replied message: om_…`，只读子会话既读不到这条消息的正文，也拿不到它的图片；入口历史里也没有消息 id。子会话 `07ccb416` 只能「按上下文推断」被回复的是哪条，并回复「截图我打不开」。直到用户把图片贴进触发消息本身（子会话 `454f87f0`），图片才作为 typed content 送达。
2. **话题消息里消息链接指向的视频**：触发消息带 `applink…/client/message/link/open?token=…`，子会话 `5c66506f` 没有任何读取手段，回复「只读模式下打不开飞书消息里的视频」。

根因是 `pet-locus-media-access` 只允许读取「当前触发消息」的图片，且模型不能指定要读的消息；视频只给元数据。实测：bot 身份可以下载帖子 `media` 元素的视频（`file_key`）和封面（`image_key`）；本机 `ffmpeg` 从 19s/6MB 的视频按场景变化抽 12 帧只需 0.6s，总共不到 1MB；消息链接的 token 不透明，没有公开 Open API 能把它解析成 `message_id`。

## What Changes

- **新增 caller-bound 只读工具 `pet_locus_message({ messageId })`**：子会话可以读**本入口所在 chat 内的单条消息**，得到有界的正文、发送者、时间和话题，消息里的图片以 typed image 返回。Host 先用 bot 身份读取该消息并核对其 `chat_id` 等于本入口 `chatId`，然后才下载；不是这个 chat、读取失败或核对不一致时一律拒绝（fail closed）。这有意放宽了现行「模型不得提供 message selector」的约束：selector 只能落在子会话本来就能读的 chat 内，信任边界不扩大（所有者 2026-11-11 决定）。
- **视频以「封面 + 场景关键帧」呈现**：Host 有可用的 `ffmpeg`/`ffprobe` 时，在私有 spool 内从下载的视频按场景变化抽取最多 N 帧，受时长、字节、帧数和超时限制，作为带时间戳说明的 typed image 交给模型；视频文件和中间产物在调用返回前删除。没有 ffmpeg 或超出限制时只返回封面，并明确说明未抽帧。文件、音频消息仍只返回元数据。
- **把子会话引到这个工具**：投递 prompt 的 `replied message` 行，以及当前消息「暂不支持的资源」说明，都改为指向 `pet_locus_message`。`pet_locus_chat_history` 在含媒体的行尾附上消息 id，子会话可以据此找到图片或视频所在的消息。
- **消息链接如实说明**：子会话遇到消息链接时，SHALL 说明链接本身无法解析；可以在本入口历史或被引用的消息里找候选消息，确认不了时请发送者直接回复那条消息或转发过来，不得猜测看到的是哪个视频。
- 当前消息的图片仍按原路径自动注入，行为不变；现有围栏和图片路由降级不变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-media-access`：从「只读当前触发消息的图片、无 selector」改为「当前消息图片自动注入，另加限定在本入口 chat 内的 caller-bound 单条消息读取（图片、视频封面与关键帧）」；同时调整视频降级规则、历史工具的消息 id 标注，以及消息链接的 prompt 指引。
- `pet-locus-doc-comments`：「IM 专属能力在文档入口按明确规则处置」表格加一行，写明文档子会话不装配 `pet_locus_message`。

## Impact

- 代码：`packages/dsh-pet/src/host/channel/media.ts`（单条消息读取、视频封面与抽帧）、新增 `packages/dsh-pet/src/host/locus-message-tool.ts`、`host/tools.ts` 注册、`host/locus/composition.ts` allowlist、`host/locus-history-tool.ts` 消息 id 标注、`host/locus/context.ts` prompt 文案、`index.ts` 装配，以及对应测试。
- 依赖：`ffmpeg`/`ffprobe` 成为 Host 的**可选**运行时依赖，启动时探测；没有它们时降级为只给封面。不新增 npm 依赖。
- 安全面：Host 会解析不可信视频，受协议和格式白名单、限额、超时、进程组终止与私有 spool 约束。子会话多了一个只能落在本 chat 内的 message selector。
- 不涉及：文档入口（`pet_locus_doc_context`）、locus 主会话、collab、出站。
