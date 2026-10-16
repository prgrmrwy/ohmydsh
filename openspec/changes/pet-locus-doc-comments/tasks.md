## 0. 前置与基线

- [x] 0.1 在途协调（2026-10-16 核对）：
  - `pet-locus-feishu-read-and-delivery-fixes`：卡在 7.5 真机验收，需所有者批准重启 Host。
  - `pet-locus-shell-tier`：卡在 1.2 bot 读群权限，以及 7.4 待确认归档。
  - 以上两个均不能直接归档，所有者选择不等待，直接开工。
  - 需求级重叠只有一处：本 change 与 `pet-locus-independent-agent-inquiries` 都修改了“投递与结算关联独立于会话运行状态”。按 proposal §在途协调处理：后归档的一方 rebase，本 change 只追加文档触发标识、回复目标和升级/回滚场景。
  - 另外两个前置 change 修改的需求与本 change 互不重叠（feishu-read：会话内容自取、入口群只读等；shell-tier：工具档位、业务出站只经 finish），文本层面无冲突。
- [x] 0.2 基线（2026-10-16，worktree lean 模式，HEAD `1fc90c2d7` 只新增本 change 的 openspec 文档，没有改任何代码）：
  - `packages/dsh-pet` 下跑 `npx vitest run`：结果 3046 passed / 1 failed / 43 skipped，共 171 个文件，耗时 61s。唯一失败的是 `loader-composition.test.ts`，原因是还没构建 `lib/client.js`（用例自己提示“run npm run build before this suite”），属于环境前置条件，与本 change 无关。
  - 仓库根跑 `npm test`：结果 416 pass / 8 fail / 2 skip。失败分两类，都在基线提交 `68bc1a188` 时已存在，与本 change 无关：
    - `repo-facade` 报 README 没有列出 `ponytail` / `ponytail-skills`，来自刚接入 ponytail 的那次提交；
    - 7 个 sync 类测试把仓库复制到临时目录后执行 `npm run build --workspace dsh-openspec` 失败。在 worktree 内直接跑 `tsc --noEmit` 是通过的，判断是 lean 模式下复制出去的临时仓库拿不到 `node_modules` 软链接。
  - 以后每组都以这组数字为准，比较“失败数没有增加”。
- [x] 0.3 建立测试设施：
  - 共享夹具 `test/fixtures/lark-subscribe.ts` 已完成，取自 spike 抓包并脱敏（规则同 `real-lark-events.ts`），内容包括：
    - compact IM 行、interactive 原始信封、评论事件；
    - stderr 行（含凭据哨兵 `STDERR_SECRETS`）与锁冲突报错；
    - batch-query 卡片、`+inspect`、连接计数、dry-run 决策。
  - 下列设施依赖被测接口，随所在组一起写，不提前凭空设计：
    - shim→native 两层 fake 子进程：第 1 组，扩展 `channel-subscription.test.ts` 的 `FakeChild`；
    - 门禁假端口与可控时钟：第 2 组；
    - v15/v16 存储夹具：第 3 组。

## 1. 传输：单条 `+subscribe --compact`（D1）

- [x] 1.1 写失败测试，对应 test-plan「飞书入站通道…凭据零接触」中 `channel-subscription.test.ts` 的以下几行：
  - 启用 channel 后启动订阅：argv 断言为 `event +subscribe --as bot --compact --event-types im.message.receive_v1,drive.notice.comment_add_v1`，且没有 consume；
  - 停止时回收整个进程组；
  - stderr 原文不落盘；
  - 内部重连不推进水位；
  - 就绪以 `connected to wss://` 为准，不以 `Connected.` 为准。

  确认失败原因是 argv 不对、或只对 shim 发了信号，而不是 import 错误
- [x] 1.2 实现 `ChannelSubscription`：
  - spawn 改为 `+subscribe --compact`，`detached: true`；
  - stop 同步对进程组发 SIGTERM，等待最多 5 秒，超时再发 SIGKILL 并记诊断。SIGKILL 只对本 Host 仍持有存活句柄的 pgid 发出，防止 pgid 被复用后误杀；Host 退出时这一步尽力而为（R4-S-2）；
  - 就绪行判定、`readyAt` 每个子进程只锁存一次；
  - stderr 只做三类模式匹配，原文不外泄；
  - 不传 `--quiet`。

  直到 1.1 通过
- [x] 1.3 写失败测试：
  - 单连接同时承载群消息与评论（`channel-service.test.ts`）；
  - compact 群消息与既有准入兼容（`channel-event.test.ts`）；
  - 卡片消息静默丢弃，诊断为 `unparsable`（`channel-pipeline.test.ts`）
- [x] 1.4 实现按 `type` 分派：`im.message.receive_v1` 走现有 `parseInboundLine`，`drive.notice.comment_add_v1` 走评论链路（第 4 组接入前先落一个可观测的桩）。移除 bot-added 的独立订阅：生产环境本来就不启动它，保留可选构造，但不再单独 spawn
- [x] 1.5 回归行改名并跑通，然后翻 🟢：lark-cli bot 身份不可用、升级后默认不消费事件、Channel 关闭时为配对临时订阅、配对结束后按运行原因回收
- [x] 1.6 重构：把 lark-cli argv 和就绪模式集中成常量，作为唯一的契约点（`SUBSCRIBED_EVENT_TYPES`、`READY_MARKER`、`LOCK_HELD_MARKER`）。全量测试结果为 3058 passed / 1 failed，唯一失败的是基线中已有的 `loader-composition` 用例，需先构建 lib，与本次改动无关。另外 1.4 已删除独立的 bot-added 订阅，并新增 `ChannelServiceDeps.commentIntake` 接收评论行；接收到的评论在第 4 组接入真实处理之前只占位，不做处理。

## 2. 连接门禁（D2、D3）

- [x] 2.1 写失败测试 `channel-connection-gate.test.ts`，覆盖 test-plan「事件连接独占在拉起订阅前被证明」的全部 14 行，使用门禁假端口和可控时钟驱动
- [x] 2.2 实现门禁，每次拉起子进程前（含监督器自动重启）执行：
  - 先检查版本 ≥1.0.97，再检查连接计数；计数不为 0 时每 2 秒复查一次，最多等 40 秒；
  - 失败时分两类处理：
    - `connection-check-failed`：进入 reconnecting，计入失败上限；
    - 版本过低、冲突：进入 down；
  - 单实例锁被占：直接 down，不退避；
  - 冲突诊断给出计数、`lark-cli event status` 和 `pgrep -fl "event +subscribe"` 三条线索
  - `connection-check-failed` 若由认证或未登录引起，沿用既有的重新登录诊断（R4-RC5）
  - 停止、停用或重连时，取消门禁等待，被取消后不再拉起（R4-RC4）
  - 把 `channel/lark.ts` 中 `cliVersion` 的支持阈值（目前 patch≥93）以及 `service.ts` 三处 “upgrade to 1.0.93” 文案统一提升到 1.0.97，避免启用或配对时接受 1.0.93–1.0.96，而门禁随后又把 channel 判为 down（R4-RC6）
- [x] 2.3 IM dry-run 并入现有的启用前验证。执行时机：正式 Channel 启动（含 Host 启动时恢复已启用的 channel）、用户启用、显式重连；结果为 `blocked` 拒绝，`unknown` 放行。监督器自动重启和仅为配对拉起时不执行
- [x] 2.4 诊断词表（D13）：评论链路的理由（`comment-scope-unknown`、`comment-reply-missing`、`unsupported-file-type`）加入 `SAFE_IGNORED` 和 `safeIgnoredReason`；门禁理由属于 channel 状态，不属于单条消息被忽略的原因，记在 channel 诊断里，不进 `SAFE_IGNORED`（R4-S-4）。先写失败测试“评论范围无法判定”：期望记为 `comment-scope-unknown` 而不是 `other`，再实现。回归行翻 🟢：Channel 关闭时收到消息、非 allowlist 用户 @ Bot、目标群调用因权限失败
- [x] 2.5 重构：把门禁做成可注入的端口，不在 `service.ts` 里内联子进程调用。全量测试保持绿色。完成后的结构：
  - 门禁是纯模块 `channel/connection-gate.ts`，通过 `ConnectionGatePort` 端口注入；
  - `ChannelSubscription.gate` 在每次 spawn 前执行，由 `AbortController` 负责取消；
  - 就绪超时（30 秒）使用独立的定时器钩子；
  - `LarkClient` 新增 `eventConnectionCount` 和 `imPreconditions` 两个方法；
  - 版本下限在 `cliVersion` 与门禁中统一为 1.0.97。

  全量测试：3080 passed / 1 failed，失败的仍是基线中的 loader-composition。门禁核心逻辑做过变异检查：替换为空实现后有 3 条测试变红；dry-run 去掉后有 2 条测试变红。

## 3. 入口与持久化：带前缀的 `chatId`、v16、迁移（D4、D5、D11）

- [x] 3.1 写失败测试：
  - 既有群入口键不变、规范化不丢失文档前缀（`locus-repository.test.ts`）；
  - 文档与群标识不串键（`locus-admission.test.ts`）
- [x] 3.2 实现 `isDocEndpoint`、`parseDocChatId`、`docMessageId(token, commentId, replyId)`。逐一核查以下路径对带 `doc:docx:` 前缀的值能原样往返：`normalizeLocusEndpoint`、`endpointKeyOf`/`endpointFromKey`、admission 的 `locusEndpointKey`、授权解析器、`deliveryCorrelates`、`assertDeliveryRecord`。核查范围以 R1-M3 列出的位置为准，对缺漏的地方补测试
- [x] 3.3 写失败测试：
  - 升级需离线迁移并先备份（`migrate-cli.test.ts`）；
  - 未迁移时 v16 拒绝打开（`migration-guidance.test.ts`）；
  - v15 拒绝打开 v16 库（`pet-storage-backend.test.ts`，用 v15 描述符打开 v16 夹具）
- [x] 3.4 实现：
  - `PET_DOMAIN_VERSION` 改为 16，并在注释里写明理由；
  - `migrate-state-version.mjs`：常量改为 16、`RESTAMPABLE` 加入 15、修正“v2..v13”文案；
  - `migrate.ts` 接受 14 和 15；
  - 同步更新 `migrate-cli.test.ts` 的版本范围
- [x] 3.5 回归行翻 🟢：同一研发主会话服务多个现场、同群话题关联不同主会话、子会话不能作为绑定源
- [x] 3.6 IM 出口的兜底防线（D4）：
  - 没有用类型签名实现。原因是并非每个 IM 方法都校验 `oc_`/`om_` 格式：`reply`、`chatName` 等都直接透传参数。
  - 改为在唯一的 CLI 调用汇聚点 `callJson` 里检查：任何以 `doc:` 开头的参数一律直接抛错，不调用 lark-cli。
  - 有测试覆盖：`chatName` 和 `reply` 收到文档标识时都在本地抛错，零次调用 lark-cli。
  - 3.2 的实际结论：键、授权查找、`deliveryCorrelates` 都对带前缀的值原样往返，不用改代码，测试已证明。
  - 3.4 也已完成：`PET_DOMAIN_VERSION` 改为 16（附理由）；迁移脚本 `RESTAMPABLE` 增加 15；`migrate.ts` 接受 14、15；更新了版本契约测试。
  - 全量：3094 passed / 1 failed（基线 loader-composition）。

- [x] 3.7 修正第 3 组代码里“v16 不新增字段”的旧说法，改为“入口不新增字段；Delivery 新增可选 `docComment`”（R5-RC2），涉及三处：
  - `src/host/spec.ts` 的版本注释；
  - `scripts/migrate-state-version.mjs` 的头注释；
  - `test/intent-triage-domain-contract.test.ts` 的标题与注释。
- [x] 3.8 持久化 `docComment.quote`（D5，R5-RC1）：
  - zod schema 中 `quote` 必填，上限 2 000；
  - `persistence.ts` 的 `assertDeliveryInput` 和 `delivery.ts` 的状态机都拒绝缺失、空或超长的值；
  - 测试覆盖重启后读回、旧行可读、超长值拒绝写入。
## 4. 评论入站：范围判定与建树（D6）

- [x] 4.1 写失败测试 `doc-comment-intake.test.ts`，覆盖「文档评论按全文/划词同构映射…」的 10 行（含“评论查询一次失败后重试成功”“评论查询重试期间停用 channel”“重启后再投递排队中的划词评论”，后者在 4.6）和「评论范围无法判定」
- [x] 4.2 实现 `LarkClient`（同时补齐第 6、7 组需要的 drive/docs/contact 适配器：`replyComment` `reactCommentReply` `inspectDoc` `fetchDocMarkdown` `contactName`；`docs +fetch` 实际 flag 为 `--doc-format markdown`、正文在 `data.document.content`，依据 lark-cli v1.0.97 `docs_fetch_v2.go`；→ `test/channel-lark-drive.test.ts` 8 例）：
  - `batchQueryComments`：`drive +batch-query-comments`；
  - `listReplies`：`drive +list-replies`，分页，最多 10 页；
  - `inspectDoc`：`drive +inspect --url <token> --type docx`，返回 `{title, url}`。

  三者都用 bot 身份，并且要区分“调用失败”和“结果为空”。评论范围查询失败时，在进程内重试最多 2 次，间隔 2 秒、5 秒，重试不持久化
- [x] 4.3 实现评论事件解析（compact 的 GenericProcessor 形态，`notice_meta` 是嵌套字段）、`file_type` 过滤、全文/划词判定、`comment_id` 已有 locus 时的短路，以及按“首条合格事件”建树。按文档根建立专属自动主会话；划词评论先到时，先建文档根主会话，再建评论级子会话
- [x] 4.4 写失败测试「文档首次评论建立文档专属主会话」（`locus-on-demand-provisioning.test.ts`），然后实现。回归行翻 🟢：Project 群先行、首次消息补齐、重复初始化、default 不可用
- [x] 4.6 投影点逐个带上 `docComment`，并按来源重建（R5-RC3，pitfalls §11）。实现说明：两处 `dispatchNext` 重建统一改为调用 `messageFromDeliveryRecord`，按 `sourceOf` 区分；入站接受时传入 `docComment`；render 钩子只读 `current.docComment`；`context.ts` 的两处投影已补齐；`findCurrent*` 在第 7 组用到时再检查。测试 `locus-doc-redelivery.test.ts` 做过两次变异检查，分别撤掉“按来源重建”和“持久化写入”，测试都会失败：
  - `locus-controller.ts` 的 `dispatchNext` 两处消息重建（约 :1041-1051、:1086-1098）：带上 `docComment`，写死的 `chatType: 'group'` 改为按 `sourceOf(endpoint)` 决定；
  - 入站接受输入（约 :1306-1320）：把 `docComment` 传给 `acceptDelivery`；
  - `index.ts` 的 render 钩子（约 :3042-3066）：从 `findDeliveryByMessageId` 取 `current.docComment`，prompt 只使用持久值；
  - `locus/context.ts` 的 `LocusPromptMessageFacts` 与 `request` 投影（约 :498-506、:568-580）；
  - 若只读工具或管理面读取当前 Delivery，还要检查 `persistence.ts` 的 `findCurrent*` 投影（约 :2447-2461、:2485-2510）。

  测试：`test/locus-doc-redelivery.test.ts`。用真实 `LocusRepository` 在同一介质上重开，经真实 `dispatchNext` 投递排队中的划词评论；用计数的假 `LarkClient` 断言零次评论查询；比较重启前后渲染出的四项评论事实。
- [x] 4.5 重构：评论链路与 IM 链路共用同一个建树入口，不复制逻辑。实现方式：评论经 `admitDocCommentEvent` 准入后，直接交给控制器已有的 `handleAdmission`，和 IM 走同一套 resolveLocus / ensureForDelivery / 去重 / 队列 / 结算。模块与改动如下：
  - 解析与准入：`channel/doc-comment.ts`。
  - 驱动：`channel/doc-comment-intake.ts`，负责最多两次重试（2 秒、5 秒），停止时取消，迟到的结果直接丢弃。
  - `ChannelService`：用自己的停止信号、水位、去重和授权组装驱动；`formalReady` 改为只能经 `setFormalReady` 一处写入，退出正式运行时中止所有在途查询。
  - 已做的变异检查：成员提问、触发回复正文、迟到结果丢弃、仅对调用失败重试，这几处改坏后都有测试变红。
  - 全量：3134 passed / 1 failed（基线）。

## 5. 评论准入与控制命令（D7）

- [x] 5.1 写失败测试 `doc-comment-admission.test.ts`，覆盖 10 行，包括“划词评论先建立时也披露”和“建立回执披露提问范围”
- [x] 5.2 实现 `admitDocCommentEvent`：
  - 复用 allowlist、授权状态、shell 档仅所有者可用、退役/legacy 判定；
  - 去重键为 `messageId = doc:docx:<token>/<comment_id>/<reply_id>`；
  - 水位取顶层 `timestamp`，缺失时跳过；
  - 回复元素渲染为文本；
  - 披露回执用 Host 控制回执发出，同一文档只发一次，发送失败只记诊断
- [x] 5.3 写失败测试 `doc-comment-control.test.ts`，覆盖 4 行，然后实现：命令写在全文评论下作用于文档级入口，写在划词评论下作用于评论级入口；控制回执发到命令所在的评论；非 allowlist 用户发的命令静默丢弃
- [x] 5.4 重构。全量测试保持绿色

## 6. 评论出站与反馈（D5、D8）

- [x] 6.1 写失败测试：
  - `doc-comment-egress.test.ts` 的 7 行，含“文档回复不渲染 @”和“shell 档直接调用评论或文档写命令”；
  - `locus-delivery.test.ts` 的“文档评论回复回到触发评论”和“文档回复目标与入口不符”
- [x] 6.2 实现：
  - `replyComment`：`drive +add-reply`，纯文本；
  - `reactCommentReply`：`Typing` / `DONE` / `CRY`；
  - finish 与控制回执按 `isDocEndpoint` 分派；
  - 发送前校验 token 与 comment_id 一致，否则返回 `association-unproven`；
  - 结果分类沿用 IM 的三类；
  - 表情失败只记诊断（fail-soft）
- [x] 6.3 egress 守卫（S2）：补齐 `drive` 评论写命令与 `docs +update` / `+create`；`api` 写调用的正则同时匹配带和不带 `/open-apis` 前缀的路径；更新 `locus-lark-cli-egress-guard.test.ts`
- [x] 6.4 （已完成：“文档回复不渲染 @”在 doc-comment-egress.test.ts；channel-mentions 8 行均为具名测试）出站 @ 渲染只对 IM 入口生效：写失败测试“文档回复不渲染 @”（已含在 6.1），然后实现。回归行翻 🟢：`channel-mentions.test.ts` 的 8 行
- [x] 6.5 （已完成：13 个延续场景全部有具名测试，其中 2 行如实标为 partial）回归行翻 🟢：`locus-delivery.test.ts` 中 13 个延续场景（群级引用触发消息 … 宿主重启无法证明关联）
- [x] 6.6 重构。全量测试保持绿色。第 5、6 组完成情况：
  - 出站集中在 `channel/doc-comment-egress.ts`：
    - `finishDocReply` 先证明回复目标，再预约 `finishing`，然后发送并记录结果。生产环境的 `finishCurrentDelivery` 直接调用这一函数，所以测的就是实际运行的代码路径；
    - 表情：受理时加 `Typing`；结算时删除 `Typing`，再加 `DONE` 或 `CRY`；no-reply 只删除 `Typing`；
    - 控制回执经 `receipts.sendControl` 按来源分派。
  - 披露回执：在建入口之前，用持久 loci 判断这是不是该文档的第一个入口，不额外存标志；`/bind` 文档时回执始终附带这句披露。
  - 文档的“名称”取 `inspectDoc` 返回的标题，不会用文档 id 调 IM。
  - `/bind` 切换主会话时的警告，发在该入口最近一次触发的评论下面。
  - shell 档守卫补拦 drive 评论写命令、`docs +update`/`+create`，以及带或不带 `/open-apis` 前缀的 api 写调用。
  - 已做过变异检查：先预约后证明、只披露一次。
  - 全量：3168 passed / 1 failed（基线）。
  - 6.4、6.5 留到第 8 组和 10.2 一起处理，即 @ 渲染回归行和 13 个延续场景的命名。

## 7. IM 专属能力处置与只读工具（D9、D10）

- [x] 7.1 写失败测试：
  - `doc-comment-im-scoping.test.ts` 的 3 行；
  - `locus-composition.test.ts` 的“文档子会话的工具面”；
  - `locus-doc-context-tool.test.ts` 的 4 行
- [x] 7.2 实现：文档 Delivery 不调用媒体读取、读群探测、成员列表；触发者显示名改用 bot 身份按 open_id 查联系人，失败时降级（fail-soft）；投递 prompt 前言按 D12
- [x] 7.3 实现 `pet_locus_doc_context`：
  - caller-bound，不接受任何 selector；
  - 线程与正文合计 28 000 UTF-16 码元，线程在前；截断时标记截断位置及原始总长度；
  - 结果以固定的不可信标签开头；
  - 失败与空结果可区分。

  composition 按入口类别装配：文档子会话有 `pet_locus_doc_context`、没有 `pet_locus_chat_history`。同步更新 attestation 白名单，以及 `ledger-tool-scope` / `executor-scope` 的可见工具断言
- [x] 7.4 重构。全量测试保持绿色。第 7 组完成情况：
  - 文档 prompt：新增独立段落，写明文档评论类型、不可信的划词原文、回复在评论区公开可见、读取上下文用 `pet_locus_doc_context`、@ 不产生提醒；提问者不在 allowlist 时加一句不得粘贴私密内容的提醒。原有的群读取能力说明和 @ 渲染承诺只在 IM 入口出现。
  - 文档 Delivery 不调用媒体读取、群读取探测和群 bot 列表；姓名改用 `contact +get-user` 查，查不到就只显示 open_id，不阻断投递。
  - `pet_locus_doc_context`：不接受任何参数；读取目标由调用者的 locus 和当前 Delivery 推出；线程与正文合计 28 000 码元，线程在前；结果以不可信标签开头；读取失败时返回平台错误码。
  - 装配：按入口类别二选一，文档子会话拿 doc 读取工具，IM 子会话拿群历史读取工具。attestation 白名单已加入新工具，注册数量的约束从 8 改为 9，并写明理由。
  - 已做的变异检查：媒体守卫。
  - 全量测试：3184 passed / 1 failed（基线）。

## 8. 管理面与待办跳转（D14）

- [x] 8.1 写失败测试：
  - `locus-view.test.ts`：文档入口短码确定且与群可区分、多个文档入口短码互不相同、同前缀的评论入口短码可区分（`cmt·5186` / `cmt·0665`）、文档标题不可得；
  - `locus-management.test.ts`：3 行；
  - `ledger-view.test.ts`：文档评论待办跳到文档、文档 URL 不可得、文档待办跳转
- [x] 8.2 实现：
  - `handleSource` 增加 doc 与 comment 两种类别：doc 取 `doc:docx:` 之后的部分；comment 取 `comment_id` 逆序；
  - `endpointHandleLabel` 增加 `doc·` / `cmt·`；
  - 兜底名为 `文档 · <短码>` / `评论 · <短码>`；
  - 标题与 URL 来自 `inspectDoc`；
  - 提问范围标注；
  - 不新增任何建立入口的控件；
  - `resolveFeishuJumpTarget` 遇到文档入口返回 doc 类型，不再归为 thread
- [x] 8.3 （已完成）回归行翻 🟢：`locus-view` 3 行、`ledger-view` 10 行（含 4 个已命名用例重跑）
- [x] 8.4 重构。全量测试保持绿色。第 8 组完成情况：
  - 短码：
    - 文档入口取 `doc:docx:` 之后的 token，标签为 `doc·`；
    - 评论入口取 `comment_id` 的逆序，标签为 `cmt·`。代码中以内部标签 `cmt:` 作为映射键，避免与 IM 的 thread id 冲突；
    - 兜底名为 `文档 · <码>`、`评论 · <码>`，并标明这是兜底显示；
    - 评论入口优先用划词原文摘要命名。
  - 管理视图：新增仅用于显示的 `endpoint` resolver，由 Host 提供文档标题、URL 和最早一条划词原文。`inspectDoc` 结果带 TTL 缓存（成功 10 分钟、失败 1 分钟）。resolver 抛错时只省略这几项事实，不影响视图本身。
  - 面板：
    - 文档行的跳转链接用 inspect 返回的 URL，不使用 IM applink；
    - 文档根行标注“本文档的评论者均可提问”；
    - 待办跳转新增 `doc` 分支：带评论 id 旁注，URL 不可得时说明原因。
  - 全量测试：先 build 再跑，结果 3198 passed / 0 failed。基线里那条 loader-composition 失败只是缺少构建产物，build 后消失。

## 9. 文档

- [x] 9.1（已完成：note 有 600 码点上限，现约 540，只写最低版本、独占应用和 README 指引；部署前置与升级复测清单写入 `packages/dsh-pet/README.md`、`README.zh.md` 的“文档评论”一节。仓库根 `npm test` 回到基线的 8 个已有失败）`dsh.yaml` 中 Pet 的 note：lark-cli 最低版本改为 1.0.97；写明升级 lark-cli 后需重测 E1、E8、E10、E12、E13；补充飞书应用的部署前置——长连接事件、评论读写、docx 读取、联系人基本信息；写明“Pet 运行期间，同一应用的其它 profile 不能做事件订阅，建议 Pet 独占一个应用”。这条替代原 onboarding 步骤
- [x] 9.2（已完成：新增 §14，覆盖分流、shim 信号与就绪行，并补充评论查询必须重试）`docs/architecture/dsh-plugin-integration-pitfalls.md` 新增一节，写三条可复用的教训：
  - 同一应用的多个事件连接会被分流，而且两侧都不报错；
  - npm shim 不会转发信号，只杀 shim 会留下孤儿原生进程；
  - `+subscribe` 打出 `Connected.` 时还没有完成握手

## 10. 全量验证与真机验收

- [x] 10.1 （已完成：pet build + vitest 3210 passed / 0 failed；typecheck 通过；仓库根 416/8，8 个失败与基线完全相同；check:artifacts 通过）运行 `npm --prefix packages/dsh-pet test`、`npm --prefix packages/dsh-pet run build`，以及 typecheck（若有独立脚本）；运行仓库根的 `npm test` 和 `npm run check:artifacts`。记录命令和通过数
- [x] 10.2 （已完成：128/128 行为绿，其中 4 行 partial；逐行机械核对具名测试 missing 0；没有新增 skip/only；被删除的测试标题均为改名或有意替换，见 verify.md）核对 test-plan 128 行全部为 🟢；没有 skip 或 pending，也没有弱化或删除过的测试
- [x] 10.3 （已完成）`openspec validate pet-locus-doc-comments --strict` 通过
- [ ] 10.4 （受阻：worktree 隔离的 DSH home 没有配置 `@byted` registry，`dsh-traex-bridge` 的 preflight 两次都拒绝，且没有改动任何内容；需在 main checkout 上合入后运行）`node scripts/sync.mjs` 连续运行两次，第二次无变化（幂等）
- [ ] 10.5 在一次性飞书应用上做真机验收（不用生产 dsh-pet 应用），用构建产物复测：
  - E1：一条连接同时收群 @、全文评论、划词评论、回复；
  - E3 反向：Pet 运行时，另起一个同应用的 `+subscribe`，后者应被单实例锁拒绝；先占住连接再启动 Pet，Pet 的门禁应报 `event-connection-conflict`；
  - E8：连接计数；
  - E12：Host 被 SIGTERM 后没有原生孤儿进程；
  - E15：表情反馈；
  - 一次完整往返：全文评论 → 回复，划词评论 → 回复，`/bind`。

  结果记入 `verify.md`
- [ ] 10.6 真机升级演练（用一次性的状态目录副本）：执行 `dsh-pet-migrate-state --yes`，备份生成，v16 启动成功；再演练回滚：删除 journal、覆盖备份、v15 启动成功
- [x] 10.7 （已生成；DECISION: FAIL，因为第 6 轮评审、10.4–10.6 尚未完成）生成 `verify.md`，按 anvil 的 verify 指令写出 `DECISION`
