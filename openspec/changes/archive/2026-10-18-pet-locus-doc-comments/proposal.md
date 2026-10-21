## Why

Pet locus 目前只有飞书群和话题两种入口。研发与 PM 的大量协作发生在飞书云文档的评论里，例如技术方案、PRD、TRD 评审。现在要把一条文档评论交给已经理解上下文的主会话，只能手工把评论复制到群里。

`~/corp/session-links` 已经证明“在评论里 @机器人，由本地会话回到原评论作答”是可行的。但它的模型与 Pet locus 不同：它由本地会话主动挂载文档、状态只在内存里、回复目标由模型选择；Pet locus 则是持久入口加 caller-bound 出站。所以不能直接照搬。

所有者要求与现有 locus **同构**：
- 全文评论对应群；
- 划词评论对应话题；
- 在全文评论里 `/bind`，把整份文档绑定到一个已知会话。

2026-10-16 的两轮 spike 证据（见 `design.md` §Evidence E1–E16）决定了方案，其中三条直接改变了做法：

1. **事件分流会静默丢事件。** 同一应用如果同时有 `lark-cli event consume`（经 bus 的连接）和 `event +subscribe`（独立连接），飞书长连接会按集群模式把事件随机分给其中一条。实测群里 @ 了 10 条，bus 只收到 6 条；发了 6 条评论，subscribe 只收到 4 条；丢失的一方没有任何报错。而评论事件不在 `consume` 支持的 EventKey 里（1.0.97 和 1.0.98 都没有）。所以要接收评论，就必须把 Pet 整条入站链路迁到**一条** `+subscribe --compact` 连接上。lark-cli 源码表明，`--compact` 对群消息的输出与 `consume` 走的是同一套映射。
2. **独占可以证明，也能回收。** `GET /open-apis/event/v1/connection` 能直接查到该应用的连接数。旧 bus 在没有消费者后约 30 秒内会自然释放连接，Pet 不需要也不会执行 `event stop`。`+subscribe` 自带单实例锁。只给 npm shim 发信号会把原生进程留成孤儿，它会继续占着连接；必须按进程组回收。
3. **全文和划词可以区分，wiki 文档也能归一。** 评论查询结果里的 `is_whole` 能确定是全文评论还是划词评论。划词评论下的回复沿用同一个 `comment_id`。知识库文档的事件里给出的是底层 docx 的 token。

## What Changes

- **BREAKING（运行时）：入站传输迁移。** Pet 的入站订阅从 `event consume im.message.receive_v1` 改为单个 `event +subscribe --as bot --compact --event-types im.message.receive_v1,drive.notice.comment_add_v1`，在进程内按 `type` 分派。迁移是无条件的，不提供开关（所有者决定）。
- **新增连接门禁。**
  - 每次拉起子进程前，检查两项：lark-cli 版本不低于 1.0.97，以及连接计数为 0。计数不为 0 时最多等 40 秒，足够旧 bus 自然退出。
  - IM 的 dry-run 前置条件只在三种情况下检查：正式 Channel 启动（包括 Host 启动时恢复已启用的 channel）、用户启用、显式重连。监督器自动重启和仅为配对拉起时不检查。
  - Pet 只终止自己拉起的进程，不执行 `event stop`，不终止任何共享 bus，也不自动回收上一次 Host 遗留的进程，冲突诊断会给出排查线索。
  - 子进程按进程组启动和回收；启动水位每个进程只锁存一次；stderr 只做分类匹配，原文不落盘，因为其中含有连接凭据。
  - 运行期间不复查连接数。他方在运行期间连入造成的事件分流，作为已披露限制。
  - **行为变化**：Pet 运行期间，同一飞书应用下的其它 profile 不能再做事件订阅。建议 Pet 独占一个应用。
- **新增文档入口。**
  - 文档级入口：`chatId = doc:docx:<底层 token>`。
  - 评论级入口：在文档级基础上加 `threadId = comment_id`。
  - 建树时机、继承、显式来源、忙时拒绝、上下文变更警告、失效不回落等规则与群/话题一致。
  - 无法判定全文还是划词时 fail closed。
- **准入与群同构。** 任何能在文档里评论的人都可以提问；控制命令只限 allowlist。回执和管理面都会写明提问范围，文档和评论内容一律标为不可信输入。
- **出站与群同构。** `pet_locus_finish` 以 bot 身份答复：划词评论用 `drive +add-reply` 回复到触发评论；全文评论因飞书不允许回复，改为新建一条全文评论并 @ 提问者。表情反馈打在触发回复上：处理中 `Typing`、成功 `DONE`、失败或过期 `CRY`。shell 档的误发守卫增加评论写命令和文档正文写命令，并修复 `/open-apis` 前缀路径漏拦的问题。
- **IM 专属能力在文档入口逐项处置。** 媒体读取、读群探测、`pet_locus_chat_history`、显示名查询、出站 @ 渲染、待办跳转，在文档入口都有明确的规则，不会拿文档 token 去调 IM 接口。
- **只读上下文。** 新增 caller-bound 的 `pet_locus_doc_context`，读取当前评论线程和文档正文，有预算上限并带不可信标签。
- **持久化、升级与回滚。** domain version 升到 16。入口不新增字段；Delivery 新增一个可选字段 `docComment.quote`，保存划词原文，保证排队或 Host 重启后再投递时，prompt 仍然完整。升级的主要目的是阻止 v15 误读文档行。升级沿用现有的离线迁移命令 `dsh-pet-migrate-state --yes`，它会先备份。回滚的做法是停 DSH、用升级前的备份覆盖、再装回旧包；**升级后产生的全部 Pet 状态都会丢失**（所有者 2026-10-16 已接受）。

## Capabilities

### New Capabilities

- `pet-locus-doc-comments`：文档评论作为 locus 入口。覆盖寻址（文档/评论对应群/话题）、准入、控制命令、出站与反馈、IM 专属能力的处置、只读上下文、管理面、wiki 归一化。

### Modified Capabilities

- `pet-lark-channel`
  - 修改「入站通道」：从 consume 改为单连接 `+subscribe --compact`，并改为按进程组回收。
  - 新增「事件连接独占」要求。
  - 修改「未通过准入的诊断」：扩充封闭词表。
- `pet-locus-collaboration`
  - 修改「Locus 统一关联」：入口由带前缀的 `chatId` 区分类别，现有 IM 键保持不变。
  - 修改「投递与结算关联」：增加文档触发标识、回复目标规则，以及升级和回滚场景。
  - 修改「管理面短码」：增加文档入口（`doc·`）与评论入口（`cmt·`）两类。
  - 修改「自动主会话」：按群或按文档各自建立。
  - 修改「出站 @ 渲染」：只适用于 IM 入口，文档入口以纯文本发送。
- `pet-locus-intent-triage`
  - 修改「管理面呈现待办…跳转」：来源为文档的待办，跳转到 `drive +inspect` 返回的文档 URL。

## Impact

- **代码**：`packages/dsh-pet` 中以下文件及对应的测试与夹具：
  - `src/host/channel/`：`subscription`、`service`、`event`、`lark`、`locus-controller`、`feedback`、`media`；
  - `src/host/locus/`：`context`、`admission`、`aggregate`、`delivery`、`persistence`、`composition`、`lark-cli-egress-guard`、`management`；
  - `src/host/spec.ts`（v16）、新增的文档上下文工具；
  - `scripts/migrate-state-version.mjs` 和 `src/host/migrate.ts`：可接受的旧版本加入 15。
- **部署前置**：
  - 飞书应用后台开通长连接事件 `drive.notice.comment_add_v1`，并给 bot 开通评论读写和 docx 读取权限；
  - lark-cli ≥1.0.97；
  - dsh.yaml 中 Pet 的最低版本说明更新为 1.0.97，并写明升级 lark-cli 后要重测的条目；
  - 先 `dsh build`，再停 DSH，执行 `dsh-pet-migrate-state --yes`，最后启动。
- **运行风险**：`+subscribe` 是 lark-cli 的隐藏命令。契约以 v1.0.97 源码为准，集中在 `subscription.ts`；`consume` 一旦支持评论事件就切回去。订阅运行期间，如果另一台机器或带 `--force` 的进程连上同一应用，事件会被分流，Pet 不会主动发现，下次拉起子进程时的门禁会发现（已披露）。
- **不做**：主动新开评论、标记或恢复已解决、评论里的图片和附件、sheet/bitable/slides 的评论、doubao 域、管理面手工建立入口、订阅入群事件。
- **在途协调**：
  - `pet-locus-feishu-read-and-delivery-fixes` 与 `pet-locus-shell-tier` 应先归档，本 change 的 delta 以它们归档后的 current spec 为基线。
  - `pet-locus-independent-agent-inquiries` 修改的是同一条「投递与结算关联」要求。后归档的一方要基于先归档的文本 rebase：本 change 只在其中加入文档触发标识、回复目标和回滚场景，不改动 inquiry 引入的语义。
