## Context

`locus-read-message-media`（2026-11-12 归档）给 IM 入口子会话加了 `pet_locus_message({ messageId })`：Host 以 bot 身份原始读取消息，要求平台返回的 `chat_id` 等于入口 chat（`channel/media.ts` 的 `singleItem` 还要求恰好一条，否则 `message-not-unique`），再下载图片、视频封面与关键帧。

所有者 2026-11-12 确定的语义：**被带进本群的内容可以读**（逐条转发、合并转发、消息链接），不要求提问者在来源群，bot 也不主动翻别的群。逐条转发后是本群新消息，现有能力已覆盖；本 change 处理另外两种。

第 1 轮评审（REVISE）针对的是「去 bot 与提问者共同所在的群里搜候选」的旧方案；该方案已整体废弃，下文不再沿用其授权快照、成员核验与跨群历史。

### 已实测的平台事实（2026-11-12，Pet 应用 `--profile dsh-pet --as bot`，lark-cli 1.0.97）

1. `POST /open-apis/im/v1/message_links/query`，body `{"message_link_url": "<整条链接>"}`，权限点 `im:message.message_link:read`（所有者已申请；申请前返回 `99991672 app_scope_not_applied`）。返回 `data.chat_info{chat_id,is_authorized,name}` 与 `data.messages[].message{message_id,chat_id,msg_type,sender{id,id_type,sender_name,sender_type},create_time,body.content,deleted}`，为复制时刻的快照。lark-cli 未封装，开放平台公开文档无条目；接口线索来自另一个智能体。
2. 快照 body 的 `image_key/file_key` 与原消息不同；以快照 key 配 `message_id` 下载得 `234003 File not in msg`。以返回的 `message_id` 原始读取（`GET /open-apis/im/v1/messages/<id>`）后取原 key，封面 JPEG 与 MP4 都能下载。
3. 张勇那条触发消息为 `msg_type: text`，链接以纯文本出现在 `text` 中，没有结构化引用字段；主机为 `applink.larkoffice.com`。
4. 合并转发：lark-cli 文档写明子消息资源只能经**外层** `message_id` 下载，子消息 id 会被拒（234003）。外层原始读取的返回结构（是否附子消息、`upper_message_id` 字段）**尚未实测**，测试群近 50 条无合并转发。

## Goals / Non-Goals

**Goals:**
- 子会话能读到本群消息里的消息链接所指向的消息（正文与媒体），以及本群合并转发里的子消息。
- 保留不变量：模型不传 URL、token、chat；被读取的「入口」一律是本入口 chat 内、由平台 `chat_id` 证实的消息；跨入口的内容只经平台授权（`is_authorized`）与 bot 原始读取成功才可读；媒体 spool、限额、返回前删除、caller 重验、attachment 校验不变；装配与 prompt 共用一个判定；文档入口不装配。

**Non-Goals:**
- 跨群历史读取、成员核验、候选搜索。
- 递归展开（链接指向的消息里的链接、嵌套合并转发）。
- 要求答复标注来源群（所有者明确不要求；结果里仍带群名作为事实）。
- user token 路径。

## Decisions

**D1 新增 `pet_locus_linked_message({ messageId, linkIndex? })`，不扩展 `pet_locus_message` 的参数。**
- `messageId` 是**含链接的本群消息**，不是链接目标。这样授权的起点仍是本入口 chat：Host 先证实这条消息在本群，链接从平台正文里取，模型写不出 URL。
- 备选：让模型直接传 URL。否决：模型可构造任意链接，「带进本群」的前提就没了。
- 备选：`pet_locus_message` 读到含链接的消息时自动解析全部链接。否决：一次调用可能放大成多次跨会话读取与下载，输出预算失控；单独工具一次只读一个链接，更易限额与测试。
- `linkIndex` 从 1 开始，结果写明该消息共有几个链接，便于模型逐个读。

**D2 链接提取规则（M1 修正）。**
- 来源：该消息原始读取的 `body.content`：`text` 类型取 `text` 字段；`post` 取 `tag:text` 的文字与 `tag:a` 的 `href`。其它类型不提取。
- 用 WHATWG `URL` 解析，要求 `protocol === 'https:'`、`username/password` 为空、`hostname` 精确属于部署白名单（缺省 `applink.feishu.cn`、`applink.larkoffice.com`；Lark 品牌可配置追加）、`pathname === '/client/message/link/open'`、`searchParams.getAll('token')` 恰好一个且非空。按规范化后的完整 URL 去重。
- 每条消息最多提取 10 个链接，超出部分不编号。

**D3 读取与授权链路。**
1. 原始读取 `messageId`（复用 `readMessage` 的原始读取与 `chat_id` 判定），失败或不在本入口 → 对应失败原因。
2. 提取链接，取第 `linkIndex` 个。
3. `lark-cli api POST /open-apis/im/v1/message_links/query --as bot --data {message_link_url}`。错误码 `99991672` → `link-scope-missing`；其它平台错误 → `link-unresolved`；`is_authorized !== true` → `link-unauthorized`（不返回群名，避免向无权调用者暴露来源）；`messages.length !== 1` 或 `message_id` 缺失 → `link-unresolved`。
4. 以快照 `message_id` 原始读取，要求 `chat_id === chat_info.chat_id`，否则 `link-mismatch`。之后完全按 `pet_locus_message` 的单消息流程（图片、视频、合并转发）处理，资源 key 只取原始读取结果，以来源 `message_id` 下载。
5. 返回前重验 caller（与现有工具一致）。
- 授权依据：本群消息含此链接 + 平台判定 bot 对来源会话有读取权 + bot 原始读取成功。不维护任何 Host 侧授权状态，因此不存在旧方案的「Delivery 授权寿命」问题（第 1 轮 C1）；也不再自行证明成员关系（第 1 轮 C2）。
- 已知含义：本群任一成员贴出 bot 所在群的消息链接，bot 就能读出该消息，贴链接的人不必在来源群。这是所有者确认的语义，记入 Risks。

**D4 合并转发展开（`media.ts`）。**
- 原始读取返回多条时，若首条为请求 id、`msg_type === 'merge_forward'`、`chat_id` 在授权内（本入口，或 D3 第 4 步的来源 chat），其后的每条都必须 `upper_message_id === 外层 id`，否则 `envelope-invalid`。非合并转发返回多条仍是 `message-not-unique`。
- 子消息正文：原始读取的 body 只有 JSON；发送者显示名与渲染正文需要格式化读取。实施时先探针 `+messages-mget` 对合并转发是否展开子消息；若不展开，用原始 body 做与现有 `parseRawMessage` 同规则的文字摘录，发送者以 open_id 解析姓名或给明确占位。
- 媒体：子消息资源以外层 id + 子消息 key 下载，与图片额度共用；子消息条数上限 30；整次调用另受「单次读取的整体工作预算」约束：资源下载尝试 12 次（失败也计）、总时限 90 秒（AbortSignal 贯穿下载与抽帧）、文字与说明合计 16 000 字符（与入口历史一致，所有者 2026-11-12 确认）。
- 嵌套合并转发只给元数据。
- 若探针发现原始读取不返回子消息（需另一个接口），停下来更新本 design 并重新送评，不自行降级。

**D5 返回与披露。**
- 结果字段：来源群名（`chat_info.name`，去控制字符与换行、截断到 64 字）、类型、发送者、时间、正文，以 JSON 字符串值序列化，序列化后再把 `<` `>` `&` 转义为 `\u003c` `\u003e` `\u0026`，放在 Host 生成的 `<linked-message>` 数据块内（平台内容无法闭合该边界；预算按编码后文本计，截断不破坏 JSON），固定说明在数据块之外；带与 `pet_locus_message` 相同的不可信输入标签。
- 不要求答复标注来源（所有者 2026-11-12）。文字正文与本群消息一样交给模型（所有者 2026-11-12）。

**D6 装配与指引。**
- `selectLocusEntryReadTools` 在 `publishesLocusMessageTool` 为真时同时装配两个工具；prompt 与工具说明经同一判定渲染。
- `MESSAGE_LINK_GUIDANCE` 改为指向新工具；`MESSAGE_LINK_GUIDANCE_WITHOUT_TOOL` 不提两个工具。
- 触发消息含链接时（Host 用 D2 的同一提取函数判断触发消息正文），首投/续投 prompt 增一行「可用 `pet_locus_linked_message` 读取，messageId 用触发消息 id」。
- 历史工具：行尾 id 的判定从「媒体标记」扩展为「媒体标记、D2 可提取的链接、或 `merge_forward` / `[Merged forward]` 标记」。

**D7 平台调用形态。**
- `message_links/query` 走 `lark-cli api POST`，参数经 `petCliArgs`（固定 `--profile dsh-pet`），超时与现有原始读取一致；信封形状以本 design 的实测为准，测试用脱敏夹具（不含真实 open_id、token、群名）。

## Risks / Trade-offs

- [本群成员可借链接让 bot 读出其本人看不到的群消息] → 所有者已接受「带进本群即可读」；读取范围仍以 bot 自身在平台上的读取权为上限，平台无权即拒绝。真机验收需包含一条 bot 不在的群的链接，确认得到 `link-unauthorized`。
- [`message_links/query` 无公开文档，可能变化或下线] → 失败一律返回确定性原因并提示转发，不影响其它读取；信封解析严格，畸形即失败。
- [应用权限点被撤销] → `link-scope-missing`，答复提示转发。
- [合并转发返回结构未实测] → D4 探针先行，结构不符就回到设计，不猜。
- [来源群名、文件名、正文中的注入文字] → 作为数据块内的不可信输入，固定说明在数据块外；群名去换行并截断。
- [一次调用的平台开销增加（读源消息 + 解析 + 原始读取 + 下载）] → 每次只解析一个链接，沿用现有超时与额度。

## Migration Plan

- 仅 dsh-pet 代码，无持久化格式变化。合入后 `dsh build`，由所有者决定是否重启 Host；已有子会话冷恢复时经 `selectLocusEntryReadTools` 获得新工具。
- 依赖所有者已为 Pet 应用开通的 `im:message.message_link:read`；未开通的部署上该工具返回 `link-scope-missing`。
- 回滚：回退提交并重新 build。

## Open Questions

- 合并转发原始读取的实际结构（D4 探针）。
- Lark 国际品牌的 applink 主机名（当前只部署飞书，缺省白名单不含）。
