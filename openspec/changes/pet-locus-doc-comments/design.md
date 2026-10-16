## Context

现有 locus 只服务飞书 IM：
- 入口是 `chatId` 加可选的 `threadId`（`packages/dsh-pet/src/host/locus/context.ts` 中的 `LocusEndpoint`）。
- 回复目标是 `{chatId, messageId, threadId?}`，`isSafeLocusReplyTarget` 要求它与入口同属一个 chat。
- 入站由 `ChannelSubscription` 运行 `lark-cli event consume im.message.receive_v1 --as bot`（`channel/subscription.ts`）。`event consume` 经过 lark-cli 的每应用 bus daemon：bus 持有到飞书的唯一一条 WebSocket，并在本机向各 consume 广播。
- 入群事件 `im.chat.member.bot.added_v1` 在 `ChannelService` 里有一条可选订阅，但生产装配刻意不启用（`src/index.ts` 约 L3546：`botLifecycleInitializer` 不设置，于是该订阅从不启动）。

参考实现 `~/corp/session-links`（Claude 插件）的做法：用隐藏命令 `lark-cli event +subscribe --event-types drive.notice.comment_add_v1` 接收评论事件，用 `drive +batch-query-comments` 取正文，用 `drive +add-reply` 回复。它把 `+subscribe` 与 `event consume` 混用，没有量化过丢失。

### Evidence

以下实验均为 2026-10-16 实测，lark-cli 1.0.97。除注明外都在测试应用 `cameo` 上进行，不是生产 dsh-pet 应用。源码引用出自 `github.com/larksuite/cli` tag `v1.0.97`（commit `72579c8`）。

| # | 实验 / 来源 | 结果 |
|---|---|---|
| E1 | 单个 `+subscribe --event-types im.message.receive_v1,drive.notice.comment_add_v1` | 群 @、全文评论、划词评论、划词评论下的回复全部收到；stderr 出现就绪标记 `Connected.` |
| E2 | 用 `+batch-query-comments` 查询 E1 中的评论 | 全文评论 `is_whole=true, quote=null`；划词评论 `is_whole=false, quote="cameo"`；回复沿用同一 `comment_id`、带新的 `reply_id`，事件为 `notice_type=add_reply` |
| E3 | 先启动 bus `consume im.message.receive_v1`，再启动只订评论的 `+subscribe` | 群 @ 10 条，consume 只收到 6 条；`+subscribe` 的 stderr 打印 9 次 `im.message.receive_v1, not found handler`（同一 message 被平台重推回同一连接）。评论 6 条，`+subscribe` 只收到 4 条，另 2 条落到 bus 上无人消费，而 `event status` 显示 DROPPED=0 |
| E4 | 先启动 `+subscribe`，再启动 `consume` | `consume` 拒绝启动：`another event bus is already connected to this app (1 remote event connection(s) detected via API)` |
| E5 | 在知识库文档里发划词评论 | 事件中 `file_token` 为底层 docx 的 obj token，`file_type=docx`；`drive +inspect` 解析出的 `wiki_node.obj_token` 与之相同 |
| E6 | 1.0.97 的 `event list`、`event consume drive.notice.comment_add_v1`；1.0.98 changelog | consume 不支持该 EventKey；1.0.98 changelog 中没有 event/drive 相关条目 |
| E7 | `+subscribe` 的输出形态 | 原始 v2 信封：`{schema, header:{event_id,event_type,create_time,...}, event:{message:{...,content:"{\"text\":\"@_user_1 ...\"}", mentions:[{key,id:{open_id,..},mentioned_type,name}]}, sender:{sender_id:{open_id},sender_type}}}` |
| E8 | 直接调用 `lark-cli --profile cameo api GET /open-apis/event/v1/connection --as bot`（即 consume 远端预检使用的接口，见 `internal/event/consume/remote_preflight.go`） | 空闲时 `online_instance_cnt=0`；`+subscribe` 运行时为 1；对其发送 SIGTERM 约 3 秒后回到 0。另在生产应用上做了一次只读调用：当时只有一条既有 consume，返回 `online_instance_cnt=1` |
| E9 | 启动 `consume --timeout 1s` 后立即 `event stop` | 远端计数随即回到 0：`event stop` 会立刻释放 bus 的连接，不必等 30 秒的空闲退出 |
| E10 | 同一应用启动第二个 `+subscribe` | 立即以 exit 2 退出，报错 `another event +subscribe instance is already running for app …` 并附 hint（源码 `shortcuts/event/subscribe.go` 中的 `lockfile.ForSubscribe(appID)`）。`--force` 可以绕过这把锁 |
| E11 | 让 `+subscribe` 的 stdin 立即 EOF（`</dev/null`） | 进程继续运行；EOF 不会让它退出（与 consume 不同，参见 pitfalls §2） |
| E12 | 对 npm shim（node 进程）发送 SIGTERM | shim 以 `execFileSync(bin, args, {stdio:'inherit'})` 拉起原生二进制，**不转发信号**：shim 退出后，原生 `+subscribe` 被 init 收养，继续持有连接和锁（实测 PPID=1，远端计数在 330 秒后仍为 1）。对原生进程本身发 SIGTERM 才会干净退出，计数在 3 秒内归零。生产环境里 Pet 的 consume 同样是「node shim → 原生」两层 |
| E13 | `+subscribe` 源码（`subscribe.go`） | `Connected.` 在 `cli.Start` 之前**只打印一次**，不等握手成功；SDK 内部重连不会重印该行。SIGINT/SIGTERM 时正常返回并释放锁 |
| E14 | consume 的 `im.message.receive_v1` 处理源码（`events/im/message_receive.go` 中的 `processImMessageReceive`），以及 `+subscribe --compact` 的 `ImMessageProcessor` | 两者使用同一套映射：`message.*` 提到顶层、`parent_id→reply_to`、`sender.sender_id.open_id→sender_id`、`mentions[].id.open_id→id`；`content` 由 `convertlib.ConvertBodyContent(message_type, {RawContent, MentionMap})` 渲染。唯一差异是 `interactive`：consume 调用 `ConvertInteractiveEventContent`，`--compact` 原样返回信封并打印 hint |
| E15 | 以 bot 身份对评论回复调用 `drive +react-reply` 的 add/delete | `DONE`、`CRY`、`Typing`、`Get` 的 add 与 delete 都成功；`OnIt` 被本地拒绝（不在 drive 的 reaction 枚举中） |
| E16 | `+batch-query-comments` 的回复列表 | 该命令不分页；评论卡片上的 `item.has_more=true` 表示还有回复没返回，需要用 `drive +list-replies --comment-id` 分页取全（见 lark-drive 文档） |

飞书官方文档也写明长连接是集群模式、不支持广播（[使用长连接接收事件](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case?lang=zh-CN)）。

## Goals / Non-Goals

**Goals:**
- 把文档评论作为 locus 入口，规则与群/话题同构：全文评论对应群，划词评论对应话题，在全文评论里 `/bind` 绑定的是文档根。
- 每个应用只有一条入站事件连接，群消息与评论都不丢；拉起订阅前能发现并存的连接，发现即 fail closed；运行期间出现的冲突作为已披露限制。
- 既有 IM locus 的持久数据、键与行为保持不变；升级走现有离线迁移，回滚为整库备份恢复。

**Non-Goals:**
- 主动新开评论、标记或恢复已解决、评论里的图片与附件、非 docx 文件类型、doubao 域、管理面手工建立入口。
- 修改现有 IM 的准入、授权、档位或权限语义。
- 让 child 获得任何飞书写能力（仍然只有受管的 finish）。
- 给 IM 入站加开关。所有者在 2026-10-16 明确选择无条件全量迁移，见 `review-round2.md` 的 Rebuttals M1。

## Decisions

### D1 传输：单个 `+subscribe --compact` 承载全部事件

把 `ChannelSubscription` 从 `event consume <key>` 改为 `event +subscribe --as bot --compact --event-types im.message.receive_v1,drive.notice.comment_add_v1`，按每行的 `type` 分派。

- **不订阅 `im.chat.member.bot.added_v1`**：生产环境本来就不启动这条订阅，也没有消费者（这是 R1-S1 指出的问题）。现有 `BOT_ADDED_EVENT_KEY` 的可选订阅保留现状、不启用。今后若要启用，只能并入同一条 `+subscribe`，不得另开连接。
- **使用 `--compact`，不自写规范化**：E14 表明 compact 模式与 consume 用的是同一组源码映射和同一个 `convertlib`。对 `im.message.receive_v1`，compact 的输出字段集与 consume 相同（`type,event_id,timestamp,id,message_id,create_time,update_time,chat_id,chat_type,message_type,sender_id,sender_type,root_id,thread_id,reply_to,content,mentions`），所以 `parseInboundLine`、`admitLocusEvent` 等纯函数可以原样复用。这样 R1-M4 中的“无法取得同一条消息的成对夹具”和“`parent_id` 映射缺失”两个问题都不存在了。剩下的唯一差异是 `interactive`：compact 返回原始信封（含 `header` 与 `event`，没有顶层 `chat_id`），现有 `parseInboundLine` 会因缺少顶层 `message_id`/`chat_id` 而返回 undefined。也就是说，卡片消息变成静默不处理，这与现行准入只放行 `text`/`post` 的结果一致。
- **评论事件在 compact 下走 `GenericProcessor`**（drive 事件没有注册专用处理器）：输出为 `event` 的扁平 map 加上 `type/event_id/timestamp`。评论分支直接读取 `comment_id/reply_id/is_mentioned/notice_meta.*`。
- **就绪与水位**：E13 表明 `Connected.` 每个进程只打印一次，而且打印时连接还没握手成功。因此 `readyAt` 在每个子进程中只锁存一次（这修正了 R1-M5 指出的“每块 stderr 都会刷新 readyAt”）。channel 的 `connected` 状态还要求 stderr 出现 SDK 行 `connected to wss://`；如果 30 秒内没有出现，就判定启动失败。
- **进程树**：子进程以 `detached: true` 启动，自成一个进程组。停止时向**进程组**发送 SIGTERM（`process.kill(-pid,'SIGTERM')`），并等待组内进程全部退出，上限 5 秒；超时再对进程组发 SIGKILL 并记录诊断。原因是 E12：只给 shim 发信号会留下孤儿原生进程，它会继续占着连接和锁。这一点同样修复了现有 consume 的潜在孤儿问题。
- **锁冲突**（E10）：`+subscribe` 以 `failed_precondition` 加 `another event +subscribe instance` 退出时，判定为“同应用已有订阅者”冲突，直接进入 down（理由 `subscribe-lock-held`），不做退避重试。永远不传 `--force`。

备选及否决理由：
- *A2：保持 consume，另加一个 `+subscribe` 只订评论。* E3 实测两侧都会静默丢失，否决。
- *A3：评论用一个独立的飞书应用。* 用户要配两个 bot，评论里出现的 bot 身份也和群里不同，违背“同构”。保留为 `+subscribe` 失效时的退路说明，不实现。
- *A4：轮询 `+list-comments`。* 无法发现尚未建立 locus 的文档，与“首条合格 @ 即建树”冲突，否决。
- *A5：默认仍用 consume，打开开关才切到 `+subscribe`（R1-M1 的建议）。* 所有者拒绝，见 `review-round2.md` 的 Rebuttals。理由：维护两套传输、切换时的迁移路径加倍；单一传输的风险已由 D2、D3 的门禁覆盖。
- *A6：等 consume 支持评论事件。* 时间不确定（E6）。传输细节已收在 `subscription.ts` 里；一旦 consume 支持，只需替换传输层，compact 契约不变。
- *A7：拆成「只换传输」与「文档入口」两个 change。* 所有者在 2026-10-16 选择不拆。代价是：一旦回滚，升级后的数据会随整库备份恢复一起丢失（见 D11）。

### D2 前置门禁

每次拉起订阅子进程前，Host 依次执行以下两项检查：

1. **版本**：`lark-cli --version` 不低于 **1.0.97**，否则为 `lark-cli-too-old`，channel 进入 down。dsh.yaml 中 Pet 的最低版本说明同步改为 1.0.97。达标版本必然带有 `+subscribe`，因此不再单独检查该命令是否存在（ponytail-2 #7）。
2. **独占**：见 D3。

**IM 前置条件只在以下三种情况检查**（ponytail-2 #5；R4-RC3）：正式 Channel 启动（包括 Host 启动时恢复一个已启用的 channel，即 `service.ts` 中 `start()` → `setEnabled(true)`）、用户启用、显式重连。监督器自动重启和仅为配对而拉起订阅时都不检查。检查并入既有的启用前验证，执行 `lark-cli event consume im.message.receive_v1 --as bot --dry-run`：
- 任一前置条件为 `blocked` 时，拒绝启用并给出 lark-cli 报告的原因；
- `unknown` 视为通过，因为 lark-cli 真实运行时遇到 `unknown` 也会继续（`decision.go:36-38`）。

dry-run 既不建 bus，也不建连接。监督器自动重启时不跑 dry-run：凭据和权限在两次重启之间通常不会变化；即使变化了，`+subscribe` 自身也会报错退出，进入既有的退避流程。

**评论侧不做启动前判定**：评论事件没有对应的 dry-run（E6）。评论侧缺权限只会让文档入口不可用，不应连带停掉 IM。部署前置条件写在 dsh.yaml 的 note 和 Migration Plan 中，不在设置页单独设 onboarding 步骤（ponytail-2 #3）。

### D3 连接独占

连接数统一通过 `lark-cli api GET /open-apis/event/v1/connection --as bot` 返回的 `online_instance_cnt` 读取（E8）。

- **门禁**：每次拉起子进程前都执行，包括首次启动、显式重连和监督器自动重启。
  1. 读取连接数，为 0 则启动子进程。
  2. 不为 0 时，每 2 秒复查一次，最多等 **40 秒**，归零即启动。这段等待覆盖两种会自然消失的连接：
     - 上一个子进程的连接，约 3 秒后释放（E8）；
     - 升级后首次启动时，旧 consume 留下的空闲 bus，约 30 秒后自动退出（`subscription.ts:5-7`）。
  3. 40 秒后仍不为 0，记为 `event-connection-conflict`，channel 进入 down。
  4. 接口调用失败或结果无法解析时，记为 `connection-check-failed`，channel 进入 reconnecting，沿用既有的指数退避，并计入 `maxFailures`（R3-M-1）。如果失败原因是 lark-cli 认证失败或未登录，诊断沿用既有的“重新登录”说明（R4-RC5）。
  5. 停止、停用或显式重连会取消正在进行的门禁等待；等待被取消后不再拉起子进程（R4-RC4）。
  6. 冲突诊断写明四点：
     - 当前计数；
     - “同一应用只能有一条事件连接”；
     - 排查线索：`lark-cli event status` 查看本机 bus，`pgrep -fl "event +subscribe"` 查看本机订阅进程；
     - Pet 不会终止他方。
- **Pet 只终止自己拉起的子进程**，范围是当前 Host 进程内持有句柄的进程组。Pet 不执行 `event stop`，不解析 `event status`，不终止共享 bus daemon，也不尝试识别或回收上一次 Host 遗留的进程（ponytail-2 #1）。
  - 遗留进程的来源：Host 崩溃后，原生 `+subscribe` 会被收养。它忽略 SIGPIPE（lark-cli `sigpipe_unix.go`），所以可能继续存活。
  - 处理方式：门禁会因计数不为 0 判定冲突，诊断给出 `pgrep` 线索，由用户手动终止。
  - 之所以不做自动识别：自动识别需要 pid 文件、argv 比对，还要处理 pid 复用；而且它对升级后第一次启动无效，因为旧版本没写 pid 文件。为一个罕见场景引入这些不值得。
  - 预防孤儿进程的主要手段是按进程组拉起和回收，D1 已覆盖。
- **不做运行期复查**（ponytail-2 #4）。门禁在每次拉起子进程前都会执行；`+subscribe` 的单实例锁拦住同机的第二个订阅；consume 在已有远端连接时拒绝启动（E4）。剩下唯一防不住的情况是：订阅运行期间，另一台机器或有人带 `--force` 连上了同一应用。对一个用户、一台机器、一个应用的部署来说，这种情况罕见。为它付出定时器、静默期和误报的复杂度不值得，所以作为已披露限制处理。
- **stderr**：SDK 的 Info 行带有 `access_key` 和 `ticket`（R2-M-f）。Host 只用固定模式做分类匹配：
  - 就绪：`connected to wss://`
  - 单实例锁：`another event +subscribe instance is already running`
  - `not found handler`

  stderr 原文 MUST NOT 写入日志、持久层或诊断。Pet 不传 `--quiet`，因为它会连就绪行一起吞掉。
- **已知限制**：
  - 订阅运行期间，若另一台机器或带 `--force` 的进程连上同一应用，事件会被分流，Pet 不会主动发现。下次拉起子进程时，门禁会发现。
  - 迁移后，同一应用的其它 profile 不能再用 `event consume`（会被 lark-cli 拒绝），也不能用 `+subscribe`（会被单实例锁拒绝）。本机默认 profile 与 dsh-pet 目前共用 `cli_a91b…`。proposal 和 dsh.yaml 的 note 中写明这一点，并建议 Pet 独占一个飞书应用。

### D4 入口模型：在 `chatId` 中存带前缀的值

采纳 R1-M3 的方案 (a)：

- 文档级入口：`chatId = "doc:docx:<token>"`，不设 `threadId`。
- 评论级入口：`chatId = "doc:docx:<token>"`，`threadId = <comment_id>`。
- IM 入口不变，仍为 `oc_…`。
- 不新增 `surface` 字段。入口类别由前缀判断：`isDocEndpoint(e) = e.chatId.startsWith('doc:')`。

这样做的结果：

- 现有的规范化、键计算、授权解析、相关性比较、管理面和待办台账路径，天然得到互不相交的键。R2 已确认 `petLocusEndpoint` 只检查分隔符（`spec.ts:529-539`）。
- 如果 IM 出口误收到文档值，会在本地抛错，请求不会发到平台：`lark.ts` 的 `requireChatId` 要求 `^oc_`，`requireMessageId` 要求 `^om_`（R2-S-f）。
- 原始 token 只在文档出口函数中通过 `parseDocChatId()` 解析得到。
- `PET_CHAT_ID_PATTERN` 只用于 legacy 的 `petChatBinding` 和 `petInvocationChannel`，文档入口不会写入它们。

备选及否决理由：
- *新增 `surface` 字段，`chatId` 存原始 token。* R1-M3 证明各层规范化都会丢掉这个字段，否决。
- *新增独立的 `docToken` / `commentId` 字段。* 层级逻辑需要全部重写，否决。

### D5 Delivery 的触发标识与回复目标

- 文档 Delivery 的 `messageId` 为 `doc:docx:<token>/<comment_id>/<reply_id>`，前缀与 `chatId` 一致（R2-S-b）。它同时是持久去重键和接受顺序标识，不会被当作 IM 消息 id 使用。R2 已确认它能通过 `assertIdentifier` 以及 replyTarget/feedbackTarget 的一致性校验。
- `replyTarget` 和 `feedbackTarget` 的形状不变。
- **入站时才有的评论事实随 Delivery 持久化**（R5，所有者 2026-10-16 指出）。积压的 Delivery 会在排队轮到时、或 Host 重启后，由 `dispatchNext` 从持久记录重建消息（`locus-controller.ts:1086`），这时手里没有入站事件，只存在内存里的事实会丢失。逐项处理如下：

  | 事实 | 能否从持久数据推出 | 处理 |
  |---|---|---|
  | 来源（IM / 文档评论） | 能，看 `chatId` 前缀 | 不另存；由 `doc-endpoint.ts` 的 `isDocEndpoint` / `sourceOf` 推导 |
  | token、`comment_id`、`reply_id` | 能，就是 `messageId` 本身 | 不另存 |
  | 全文还是划词 | 能，看入口有没有 `threadId` | 不另存 |
  | 触发回复正文、发送者姓名 | 已存在现有的 `text`、`senderName` | 不变 |
  | 发送者是否在 allowlist（D12 “不要粘贴私密内容”） | 能，渲染时用持久的 `senderOpenId` 对照当前 allowlist | 不另存；按渲染时的 allowlist 判断，与群一致 |
  | 表情目标 | 能，`reply_id` 就是 `messageId` 第三段 | 不另存；`drive +react-reply --action delete` 删除的是 bot 自己的表情，不需要表情 id |
  | 是否发过披露回执 | 不需要重建：在 locus 建立时（入站路径）判断并发出 | 不另存；`dispatchNext` 从不发披露回执 |
  | **划词原文 `quote`** | **不能** | **新增可选字段 `docComment.quote`** |

  - `docComment` 是可选对象，其中 `quote` 必填。它与现有的 `addressing` 同类，都是入站事实的有界投影，接受时写入一次，此后不再修改。全文评论不写入 `docComment`。
  - `quote` 上限 2 000 个 UTF-16 码元，**截断标记计入上限**：超长时截到 `2000 − 标记长度` 再追加标记 `…（已截断）`，所以写入值永远不超过 2 000。
  - 上限在入站截断时保证，并由持久写入路径（`persistence.ts` 的 `assertDeliveryInput`）再校验一次，违反即拒绝写入（R5-RC1）。原因是存储层 `put` 不校验 schema；而下次打开存储时 schema 校验失败会让整个 Pet 存储打不开，因为 `petDomainSpec` 没有设置 `invalidRecords`。所以超长值绝不能落盘。
  - 投影点（pitfalls §11）。以下几处都必须带上 `docComment`，或按来源重建：
    - `locus-controller.ts` 的入站接受输入（约 :1306-1320）；
    - `dispatchNext` 的两处消息重建（约 :1041-1051、:1086-1098），这两处还要去掉写死的 `chatType: 'group'`；
    - `index.ts` 的 render 钩子（约 :3042-3066），它从 `findDeliveryByMessageId` 取 `current.docComment`；
    - `locus/context.ts` 的 prompt 事实投影（约 :498-506、:568-580）。
  - 不把来源本身存成字段：前缀已经决定了身份，另存一份会出现两份真相（例如 `source:'im'` 而 `chatId` 为 `doc:docx:…`），每个读取点都要校验以哪份为准。
  - `dispatchNext` 重建消息时：读出 `docComment`；原先写死的 `chatType: 'group'` 改为按 `sourceOf(endpoint)` 决定。
- 内存里的消息形态改为按 `source` 区分的联合类型（共有核心 + `im` / `doc-comment` 两个分支），这是所有者 2026-10-16 提出的要求：“既有消息形态更通用一点，用字段做标记”。
  - 准入：D7 的 `admitDocCommentEvent` 是 `doc-comment` 分支的入口。它只做来源专属的前置判断（是否 @bot、`file_type`、bot 或 agent 发送者），然后调用与 IM 共用的同一组准入规则：allowlist、授权状态、shell 档仅所有者可用、退役判定、水位、去重、控制命令解析。规则本身不复制。
  - 其余按 `source` 分支的点都穷举处理：媒体、读群探测、姓名、@ 渲染、回执与表情、prompt 前言、工具装配。新增来源时，编译器会报出所有漏掉的分支。
  - 前缀判断集中在 `doc-endpoint.ts`（`isDocEndpoint` / `sourceOf` / `parseDocChatId`）。唯一的例外是 `lark.ts` 中 IM 出口的兜底守卫：它有意独立判断，防止有人绕过 `doc-endpoint.ts` 时守卫跟着失效。
  - 这是实现层的类型设计，不影响持久形状。
- 文档出口发送前做两项校验，任一不符即拒绝，capability 拒绝类别为 `association-unproven`（R2-S-a）：
  - `messageId` 中的 token 与 `chatId` 中的 token 相同；
  - 若为评论级入口，`messageId` 中的 `comment_id` 与 `threadId` 相同。

### D6 评论范围判定（全文 / 划词）

事件本身不带 `is_whole`，接受前必须以 bot 身份查询一次：`drive +batch-query-comments --token <t> --type docx --comment-ids <c>`。

- 从结果中取 `is_whole`、`quote`、回复列表和 `item.has_more`。
- 触发回复不在列表中、且 `has_more=true` 时，用 `drive +list-replies --comment-id <c>` 分页查找，最多 10 页。
- 查询调用失败（平台错误、超时、无法解析）时，在进程内重试最多 2 次，间隔 2 秒、5 秒（ponytail-2 #2）。原因是飞书长连接事件处理完即视为确认，不会重推；不重试的话，一次抖动就会让这条评论永久丢失。重试不持久化。停止或停用 channel 会取消尚未完成的重试；channel 停止后才返回的结果一律丢弃（R4-RC4）。
- 仍然找不到时，记为 `comment-reply-missing`。重试用尽仍失败，或 `is_whole` 不是布尔值时，记为 `comment-scope-unknown`。两种情况都 fail closed。
- 如果该 `comment_id` 已经有评论级 locus，可以直接推定为划词，但仍要查询正文。
- **水位**（ponytail 第 10 条）：评论事件的 compact 输出没有 `create_time`，水位改用顶层的 `timestamp`（取自 `header.create_time`，单位毫秒）。`timestamp` 缺失或无法解析时，不做水位判断，只依赖持久去重。

### D7 准入

新增 `admitDocCommentEvent` 作为 `doc-comment` 来源的准入入口（见 D5 末条）。它先做来源专属的前置判断，再调用与 IM 共用的准入规则：allowlist、授权状态、控制命令解析、shell 档仅所有者可用、退役/legacy 判定、启动水位、持久去重。规则不复制。

**提问资格与群同构**：入口已授权时，任何能评论的人都可以提问（所有者已确认）。补偿措施有三项：

1. **披露回执**。由 Host 以控制回执的形式发出，即一次独立的 `drive +add-reply`，与群里的控制回执走同一条路，不算业务正文。发送时机有两个：
   - 该文档的任一入口首次建立时，包括文档级和评论级、自动建立和 `/bind` 建立，同一文档只发一次（R3-M-4）；
   - `/bind` 成功时，附在命令回执里。

   内容为：“本文档的评论者均可向我提问；只有 allowlist 成员能控制”，发在触发该次建立或命令的那条评论下。
2. 管理面在文档入口行标注同样的说明。
3. 文档正文、评论正文和划词原文，一律以“不可信输入”标签进入 prompt 和工具结果。

**文本渲染**：评论回复由多个 `elements` 组成。`text_run` 取其文本；`person` 若是 bot 本身，渲染为 `@<bot 名>`，否则渲染为 `@<user_id>`；`docs_link` 取其 URL。渲染完成后，再像群侧一样解析控制命令。

### D8 出站与反馈

`LarkClient` 新增三个方法：

| 方法 | 实现 |
|---|---|
| `replyComment(token, commentId, text)` | `drive +add-reply --as bot --token <t> --type docx --comment-id <c> --content '[{"type":"text","text":…}]'` |
| `reactCommentReply(token, replyId, emoji, action)` | `drive +react-reply` |
| `inspectDoc(token)` | `drive +inspect --as bot --url <token> --type docx`，返回 `{title, url}`。cameo 实测返回了 `title` 和 `https://www.feishu.cn/docx/<token>` |

finish 和控制回执按 `isDocEndpoint` 分派。结果分类与 IM 相同，分为明确成功、明确失败、未知三类。

表情映射（E15）：进行中用 `Typing`，完成用 `DONE`，失败、过期或未知终态用 `CRY`。表情调用失败时只记诊断，不影响 Delivery。

### D9 只适用于 IM 的能力在文档入口的处置

下表每一行都在 spec 中有对应落点：要么是 MODIFIED，要么是 doc 能力里新增的要求（R2-M-e）。

| 能力 | 文档入口的处置 | 规范落点 |
|---|---|---|
| 媒体读取（`im +messages-mget`） | 不调用；投递 prompt 不提及媒体 | doc spec 新增 |
| 读群探测、shell 档的读群说明 | 不调用、不渲染；改为说明 `pet_locus_doc_context` | doc spec 新增 |
| `pet_locus_chat_history` | 文档子会话不装配；composition 按入口类别选择工具集 | doc spec 新增 |
| 触发者显示名 | 以 bot 身份按 open_id 查询联系人姓名；失败时只呈现 open_id，不阻断投递 | doc spec 新增 |
| 出站 @ 渲染 | 不渲染，以纯文本发送；prompt 不承诺提醒 | MODIFY collab「出站业务回复的 @ 引用渲染为平台真实提醒」 |
| 待办“跳飞书” | 跳到 `inspectDoc` 返回的 `url`，不自行拼 tenant 域名；评论级待办旁注评论 id；`inspectDoc` 失败时不提供链接，并就地说明原因 | MODIFY intent-triage「管理面呈现待办并提供由固定标识派生的跳转」 |
| 自动主会话 | 每个文档根各建一个专属主会话 | MODIFY collab「自动主会话按群建立且只使用 default workspace」 |

### D10 只读工具

新增 `pet_locus_doc_context`，与 `pet_locus_chat_history` 对称：

- 读取内容有两部分：当前评论的全部回复（`+batch-query-comments`，必要时补 `+list-replies`），以及 `docs +fetch --doc <token> --doc-format markdown` 返回的正文。
- 预算按 UTF-16 码元计，线程与正文合计 28 000，线程在前（ponytail-2 #6）。超出部分截断，并显式标出截断位置和原始总长度。
- 结果以固定的不可信内容标签开头。
- 只在文档子会话的组合中装配，并同步更新 attestation 白名单。

### D11 持久化、升级与回滚（R1-C2、R2-C-a、R2-M-a；所有者 2026-10-16 决定）

- **版本**：`PET_DOMAIN_VERSION` 从 15 升到 16。入口不新增字段（见 D4）；Delivery 新增一个可选字段 `docComment`（见 D5）。旧记录没有这个字段，读取时视为缺省，照常可用，是纯增量变化。升版本的主要目的仍是让 v15 代码在打开存储时以 `version-mismatch` 停下，而不是把 `doc:` 前缀的行当作群入口误读。zod 会丢弃不认识的键，所以对 v15 来说 `docComment` 只会丢失，不会导致出错。R2 已确认这个理由成立。
- **升级**：沿用现有的离线迁移。
  - `scripts/migrate-state-version.mjs`：脚本内常量 `PET_DOMAIN_VERSION` 改为 16，`RESTAMPABLE` 加入 15，过时的说明文字“v2..v13”同步修正。`src/host/migrate.ts` 接受的版本加入 14、15，与脚本一致。对应的测试范围也一并更新（R3-S-3）。
  - 脚本在改版本戳之前已经会写出备份 `state.sqlite.v15.bak-<ms>`（`migrate-state-version.mjs:189`）。
  - 迁移计划把“停 DSH → `dsh-pet-migrate-state --yes` → 启动”列为必做步骤。漏做时，Host 会以 `version-mismatch` 停下，并由 `migration-guidance.ts` 给出可直接复制的命令，这是现有机制。
- **回滚**：恢复整库备份。步骤是：停 DSH；删除可能残留的 `state.sqlite-journal`；用升级时生成的 `state.sqlite.v15.bak-<ms>` 覆盖 `state.sqlite`；装回旧版本的包；启动。代价是升级之后产生的所有 Pet 状态都会丢失，包括 IM 投递、待办和 locus 变更。迁移计划和 proposal 都写明了这一点。
- **不再做**：降级脚本、隔离表、启动时恢复。第二轮的 D11 方案整体删除，R2-C-a 随之消失。

### D12 投递 prompt

文档 Delivery 的前言写明以下内容：

- 这是一条飞书文档评论；
- 它是全文评论还是划词评论；
- 划词原文（标为不可信），取自持久 Delivery 的 `docComment.quote`，不取入站事件。这样首次投递、排队后投递、重启后再投递渲染出来的内容完全一样；
- 回复会追加在该评论下，评论区所有人都能看到；
- 读取上下文用 `pet_locus_doc_context`；
- 回复里的 @ 不会产生提醒；
- 除非提问者在 allowlist 中，否则不要在回复中粘贴项目的私密内容。

### D13 诊断词表

规范的封闭词表新增以下理由，分两类处理（R4-S-4）：

- 评论链路的理由，描述单条事件为什么被忽略，加入 `SAFE_IGNORED`：
  - `comment-scope-unknown`
  - `comment-reply-missing`
  - `unsupported-file-type`
- 门禁理由，描述 channel 状态，只记在 channel 诊断里，不加入 `SAFE_IGNORED`：
  - `event-connection-conflict`
  - `subscribe-lock-held`
  - `lark-cli-too-old`
  - `connection-check-failed`

capability 拒绝不新增类别，复用 `association-unproven`。

### D14 管理面短码（R2-M-d）

现有的 `handleSource('endpoint')` 取第一个 `_` 之后的部分，而文档 id 中没有 `_`，所以需要单独的规则：

| 入口 | 源子串 | 标签 |
|---|---|---|
| 文档入口 | `doc:docx:` 之后的 token | `doc·` |
| 评论入口 | `comment_id` 的逆序（取末尾数字，R3-M-3） | `cmt·` |

- 碰撞时沿用现有的按类别加长规则。
- `doc·X` 与 `oc·X` 靠标签区分。
- 兜底名为 `文档 · <短码>` 或 `评论 · <短码>`。
- 标题取自 `inspectDoc` 返回的 `title`。

## Risks / Trade-offs

- **`+subscribe` 是隐藏命令。**
  - 传输细节全部收在 `subscription.ts`；D2 门禁检查版本（≥1.0.97）。
  - 契约以 v1.0.97 源码为准，契约测试固定 compact 的字段集。
  - 升级 lark-cli 后需重测 E1、E8、E10、E12、E13，这一要求写入 dsh.yaml 的 note。
  - 连接层与 consume 的 bus 用的是同一个 SDK client（oapi-sdk-go v3.7.2 的 `ws.Client`，默认无限次自动重连），所以长连接的可靠性与现状相同。
- **同一应用的其它事件消费者会被挡住**（D3 已知限制）。→ proposal 和 dsh.yaml 的 note 中写明，建议 Pet 独占一个应用；冲突诊断会给出排查命令。
- **订阅运行期间出现的跨机器或 `--force` 冲突不会被主动发现。** → 在 spec 中写明；下次拉起子进程时，门禁会发现。
- **回滚会丢失升级后的全部状态**（D11）。→ 所有者已接受，迁移计划中写明。
- **评论缺权限时，文档入口静默不可用。** → dsh.yaml 的 note 和 Migration Plan 中列为部署前置条件。
- **评论者范围比群更广。** → 所有者的决定；以披露回执、管理面标注、不可信标签和 prompt 提醒作为补偿。
- **bot 无权读取的文档里有人 @ 它时，可能收不到事件。** → 作为已知限制写入文档。

## Migration Plan

1. 部署前，在飞书应用后台开通长连接事件 `drive.notice.comment_add_v1`，并为 bot 开通评论读写、docx 读取，以及联系人基本信息读取权限。联系人权限用于显示评论者姓名；缺少时只显示 open_id，不影响其它功能（R3-S-6）。
2. 把 lark-cli 升到 1.0.97 或更高（生产环境现为 1.0.97）。建议 Pet 独占一个飞书应用；否则本机同一应用下的其它 profile 将不能再使用事件订阅。
3. 执行 `dsh build`。
4. **停 DSH**，执行 `dsh-pet-migrate-state --yes`。它会先写出备份 `state.sqlite.v15.bak-<ms>`，再把版本戳改为 16。
5. 启动 DSH。Pet 按 D2、D3 先等连接数归零（最多 40 秒，足以让旧 bus 自然退出），再启动 `+subscribe`。如果旧 consume 的原生进程在 Host 崩溃后成了孤儿，门禁会判为冲突，诊断里给出 `pgrep` 排查线索，由用户手动终止。
6. **回滚**：停 DSH → 删除可能残留的 `state.sqlite-journal` → 用第 4 步生成的备份覆盖 `state.sqlite` → 装回旧版本的包 → 启动。升级后的 Pet 状态全部丢失。

## Round 2 → Round 3

| R2 条目 | 处置 |
|---|---|
| C-a 隔离不完整，恢复步骤违反离线约束 | 所有者决定改为整库备份恢复，删除隔离与恢复逻辑（D11） |
| M-a 缺少 15→16 升级路径 | `RESTAMPABLE` 和 `migrate.ts` 加入新版本；迁移计划第 4 步写明离线迁移（D11） |
| M-b 运行期计数差一 | 每次拉起子进程前走启动门禁，等计数归零；运行期只在 `connected` 之后检查，且连续两次大于 1 才判冲突（D3） |
| M-c bus 规则矛盾，M1 后续项缺失 | 删除 `event stop` 分支，改为等旧 bus 自然退出，保留“不终止共享 bus”的约束；补上 IM dry-run 门禁，补上 `subscribe-unavailable` 和评论缺权限两个场景；MODIFY onboarding（D2、D3） |
| M-d 短码 | 写明文档和评论入口的源子串与标签（D14） |
| M-e 改了行为但未 MODIFY | MODIFY 出站 @、自动主会话、待办跳转三条；URL 取自 `drive +inspect`（D9） |
| M-f stderr 含凭据 | 只做分类匹配，原文不落盘（D3） |
| S-a | 统一使用 `association-unproven` |
| S-b | messageId 前缀改为 `doc:docx:` |
| S-c | 披露由 Host 以控制回执发出（D7） |
| S-d | Rebuttals 已更新 |
| S-e | spec 中三处无法机械判定的 THEN 已改写 |
| S-f | 设计中改为“本地抛错”（D4） |
| ponytail #10 | 评论水位改用 `timestamp`（D6） |

## Round 3 → Round 4（ponytail-review 2，所有者 2026-10-16 采纳 1–7）

| # | 处置 |
|---|---|
| 1 | 删除 `subscription.pid`、argv 比对和遗留进程自动回收；遗留进程一律按冲突处理，诊断给出 `pgrep` 线索（D3） |
| 2 | 评论查询失败时，在进程内重试最多 2 次（间隔 2 秒、5 秒），之后再 fail closed（doc spec，D6） |
| 3 | 删除 onboarding 中的“文档评论入口”步骤和评论事件计数，撤回对 onboarding 的 MODIFY；部署前置写进 dsh.yaml 的 note（D2） |
| 4 | 删除运行期复查（60 秒定时、300 秒静默期、连续两次判定）；改为已披露限制（D3） |
| 5 | IM dry-run 只在启用和显式重连时执行，监督器自动重启时不跑（D2） |
| 6 | 只读工具预算合并为 28 000 码元（D10） |
| 7 | 删除 `subscribe-unavailable`、`im-preconditions-unmet` 两个理由，以及 `+subscribe --help` 门禁（D2、D13） |

## Round 4 → Round 5（所有者 2026-10-16 指出：重连或重启后内存事实丢失）

| 问题 | 处置 |
|---|---|
| 划词原文只在入站时查询得到。积压或重启后由 `dispatchNext` 从持久记录重建消息时会丢失；该处还把 `chatType` 写死为 `'group'` | Delivery 新增可选字段 `docComment.quote`（D5）；v16 由“不新增字段”改为“新增一个可选字段”（D11）；prompt 的划词原文改为取自持久 Delivery（D12）；`dispatchNext` 改为按 `sourceOf(endpoint)` 重建 |
| 是否把“来源”也存成字段 | 不存。可以从前缀推出，另存会出现两份真相（D5 表格） |
| R5 评审 RC1–RC5 | 截断标记计入 2 000 上限，并由持久写入路径再校验；修正已落地代码中“v16 不新增字段”的旧说法；补 test-plan 行、tasks 条目和投影点清单；D5 表补 allowlist、表情目标、披露回执三行；准入入口与前缀读取位置的说法和 D7 对齐 |

