## Why

2026-11-12，张勇在「群贤毕至」（`oc_1f75…`）贴了一条飞书消息链接，@ bot 问链接里的视频。locus 子会话读不到：`pet_locus_message` 只读本入口 chat 的消息，而子会话也没有办法把链接换成消息。

所有者 2026-11-12 拍板的语义是：**内容被带进本群，bot 就可以读**。带进来的方式包括逐条转发、合并转发和消息链接；不要求提问者在来源群里，也不让 bot 主动去翻别的群。

同日实测（Pet 应用 `--profile dsh-pet --as bot`，所有者已为应用申请 `im:message.message_link:read`）：`POST /open-apis/im/v1/message_links/query` 能把消息链接换成来源消息，返回 `chat_info.is_authorized` 表示 bot 对来源会话有无读取权；再按返回的 `message_id` 做原始读取，就能下载封面与视频。这让「链接带进来的内容」有了由平台判定、无需猜测的读取路径。

## What Changes

- **读取消息链接（新增）**：新增 caller-bound 工具 `pet_locus_linked_message({ messageId, linkIndex? })`。`messageId` 必须是**本入口 chat 内**的消息（由平台返回的 `chat_id` 判定，话题入口按所在群）。Host 从这条消息的平台正文里取出飞书消息链接（模型不传 URL），调用 `message_links/query` 解析，只有平台返回 `is_authorized: true` 才继续；再以 bot 身份原始读取来源消息，返回其正文、发送者、时间、来源群名，以及图片、视频封面与关键帧。
- **合并转发展开（修改）**：`pet_locus_message` 读到本入口 chat 内的合并转发消息时，按顺序返回其中的子消息（发送者、时间、正文与媒体）。子消息的媒体经外层消息 id 下载（平台只接受这种下载方式）。现在它会因平台返回多条而报 `message-not-unique`。
- **入口历史标注（修改）**：`pet_locus_chat_history` 中含消息链接或合并转发的行，行尾也附消息 id，子会话可据此调用上述工具。群里任意一条消息里的链接都可以读，包括话题和回复链上的消息。
- **链接指引（修改）**：prompt 与工具说明从「链接无法解析，请转发」改为「用 `pet_locus_linked_message` 读取；平台判定无权或解析失败时如实说明，请对方转发」。
- 文字正文与本群消息一视同仁地交给模型。答复不额外要求标注来源群，沿用默认的引用回复；工具结果里仍带来源群名，供模型判断语境。
- `pet_locus_chat_history` 的读取范围不变，仍只读本入口；不新增跨群历史、成员核验或候选搜索。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pet-locus-media-access`：单条消息读取支持合并转发展开；新增经本群消息读取其中消息链接的工具（装配、解析授权、返回内容三条 requirement）；入口历史为含链接与合并转发的行标注 id；改写引用消息与消息链接的读取指引。

## Impact

- 代码：`packages/dsh-pet/src/host/channel/media.ts`（`readMessage` 支持合并转发的多条返回；新增 `readLinkedMessage`：取链接 → `message_links/query` → 原始读取 → 下载）、新增 `host/locus-linked-message-tool.ts`、`host/locus/entry-read-tools.ts`（装配）、`host/locus/message-guidance.ts` 与 `host/locus/context.ts`（指引文案）、`host/locus-history-tool.ts`（标注 id）。
- 平台：新增依赖 `im:message.message_link:read`（所有者已为 Pet 应用申请并实测）。lark-cli 1.0.97 未封装该接口，经 `lark-cli api POST` 调用；该接口没有公开文档条目，返回结构以实测为准，测试用脱敏夹具固定。
- 信任边界：本群任何成员贴出一条 bot 所在群的消息链接，bot 就能把那条消息的内容读进本群，不要求贴链接的人在来源群。这是所有者确认的语义；授权判定交给平台的 `is_authorized` 与 bot 原始读取是否成功。
- 合并转发的返回结构尚未实测（测试群近 50 条里没有合并转发），实施第一步要在测试群做一次合并转发探针。
