## Why

跨边界协作标准（`packages/dsh-collab/docs/cross-boundary-collaboration-standard.md`）第 8 节要求协作层在 Locus 接入前预留三个扩展点，现在的内核和插件都还没有：

- **成员只能来自邀请。** 现有成员只能经 `invite` + `join` 产生，地址必须是 Host 能核验的普通一级会话。Locus 子会话由 Pet 按入口绑定、代际与退役管理，强行走邀请会形成第二份授权真相：台账说它是成员，Pet 说绑定已退役。
- **条目和消息只有自由文本。** 接入方（如 Pet）无法把来源消息 id、回复去向等结构化事实挂在记录上，只能塞进正文，模型和其他成员都会把它当成内容。
- **唤醒只有一种。** 所有唤醒都经 `followup` 排到下一回合。Pet 的询问需要独立轮次（不与 GUI 输入或其它工作混用），现在协作层无法表达。

调研纪要（分支 `ws/collab-pet-locus-collab` 的 `2026-10-22-locus-unified-collaboration-exploration.md`）第 6 节的开放问题也需要在接入前回答。本 change 只做协作层的加法，不改 Pet；Locus 真正接入另开 change。ADR-0006（Locus 留在 Pet 内）不禁止 Pet 消费独立协作内核，本 change 不改变 Locus 的归属，与它不冲突。

## What Changes

- **托管成员（内核）。**
  - Leader 可以按空间授权一个接入方 channel 托管成员（`allowManager`），也可以撤销（`revokeManager`，同一提交退役该 channel 的全部托管成员）。授权与撤销都写入台账，不唤醒任何人。
  - 被授权的接入方以新的 `manager` principal 执行 `admitMember`、`rebindMember`、`retireMember`：接纳成员、换代（成员名不变，绑定换成新地址，旧地址永不复用）、退役。
  - 托管成员不能成为 Leader，不能自己 `join`、`declineInvite` 或 `leave`；Leader 仍可 `markGone`。邀请与建空间的认领不再考虑托管 provider。
  - 台账中的托管成员只是必要条件：接入方每次调用时仍必须按自己的绑定解析出调用者，因此不存在第二份授权真相。
- **结构化附加数据 `ext`（内核）。** `createItem` 与 `sendMessage` 接受可选 `ext`：一个纯 JSON 对象，规范化后不超过 4 KiB。内核只校验和存储，不解读、不进入投影、话题计数与 `ref` 校验。创建后不可修改；条目修改时原样保留。来源由作者成员的绑定 channel 判断。
- **唤醒投递方式 `mode`（内核）。** `sendMessage` 接受可选 `mode`，只能与 `needsReply:true` 同用。收件人的 provider 必须声明支持该 mode，且发送者必须有资格使用它，否则拒绝且不写入。mode 写进投递记录和指针，不改变三种唤醒触发、话题计数与结束通知。
- **接入方 API（dsh-collab）。**
  - 宿主配置新增 `managedChannels`。
  - 插件为每个声明的 channel 注册一个中继 provider，并以 cordis 服务 `dshCollab` 提供 `attach(channel, adapter)`。接入方通过它认领地址、报告在线状态、投递唤醒、解析工具调用者、执行托管命令，并为普通会话收件人注册唤醒方式。
- **工具调用者解析（dsh-collab）。** 普通一级会话照旧映射为 `dsh-session` 成员。其它会话只有在恰好一个已接入的接入方认领它时，才映射为该 channel 上的成员；两者同时认领时拒绝。
- **工具面（dsh-collab）。** `collab_space` 增加 `allow_manager` / `revoke_manager` 两个 action（参数 `channel`）。工具数量仍为 11 个，体积仍在 4200 以内。`ext` 与 `mode` 不进入模型工具，只经接入方 API 使用。
- **文档。** 在 `design.md` 中回答调研纪要第 6 节的 7 个开放问题；更新协作标准第 8 节状态、dsh-collab 与 collab-kernel 的 README（中英），以及 `dsh.yaml` note。
- 不修改 Pet，不新增约定版本，不改存储格式版本。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `collab-kernel`：托管成员与 manager principal、命令授权表与幂等 scope、地址永不复用含历史绑定、Leader 接手跳过托管成员、`ext`、唤醒 `mode` 与指针字段。
- `dsh-collab`：`managedChannels` 配置、接入方服务与中继 provider、调用者解析、`collab_space` 的授权 action、带 mode 的投递、托管调用者的状态入口。

## Impact

- **代码。**
  - `packages/collab-kernel/src/{model,auth,spi,domain,service}`。
  - `packages/dsh-collab/src/{config,host,index,session-provider,tools,status}.ts`，新增 `integration.ts`。
- **持久数据。**
  - 新增事件 `manager/allowed`、`manager/revoked`、`member/rebound`。
  - 新增可选字段：`Member.managedBy`、`Member.previousBindings`、`message.ext`、`message.mode`、`item.ext`、`delivery.mode`、`pointer.mode`。
  - 不使用这些能力的空间，日志与之前完全相同。使用后回滚到旧内核时，旧内核会忽略新事件，托管成员的绑定可能不准，但旧插件没有接入方 provider，这些地址无法执行任何命令（见 design 迁移一节）。
- **API。**
  - `ChannelProvider` 增加可选的 `managed` 与 `supportsMode`；`principals` 增加 `manager`。
  - dsh-collab 新增 cordis 服务 `dshCollab`。
- **不受影响。** Pet、Locus 存储、约定 v1–v3 文本、现有 11 个工具的其余行为。
