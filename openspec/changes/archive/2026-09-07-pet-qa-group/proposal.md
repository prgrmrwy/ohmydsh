# pet-qa-group Proposal

## Why

Pet 二期1 打通了「飞书 → workspace 内新建 executor」的入站链路，但它回答不了另一类
日常场景：我在某个 DSH 会话里刚排查完一个问题，想把这份**已经建立的会话上下文**开放给
其他人提问——群友的问题应当由一个"记得这段对话"的 agent 来回答，而不是一个从零开始
读代码的新 executor。二期2（答疑群）补上这条出站链路：在源会话中点击 Pet 的 Q&A 动作，
Host 建一个只有本人与 bot 的飞书群并 fork 一个继承该会话上下文的常驻子代理；此后本人
拉任何人进群，任何群成员 @bot 的消息都由该子代理带着源会话的记忆回答或干活。

宿主能力已经过真机 spike 全绿验证（`spike/qa-subagent/FINDINGS.md`，零 stub）：宿主可
直接 `startContinuable(fork)` 建出以父会话完成 turn 前缀为种子的 continuable child、可经
`queueHostSubagentPrompt` 把消息排成 child 独立 turn、parent 可 resume 后继续喂、child
跨进程 coldResume 成立、child 出现在 `listChildren`（GUI 收纳展示）。

## What Changes

- 新增 Q&A 内置动作：Pet 轮盘在会话来源下提供 Q&A 动作（Host 内置，非导入 Skill，
  也不进 Skill allowlist 模型）。点击后 Host 对源会话 fork 一个 continuable child、
  以 bot 身份创建仅含本人与 bot 的飞书群、写入 `kind: qa` 的 chat 绑定行。三步失败
  即整体失败并回收已建资源，不留半成品绑定。
- **BREAKING（准入模型）** qa 绑定的群豁免全局发送者 allowlist：能在该群发言即
  被视为已被群主（本人）拉入，@bot 即可触发。非 qa 绑定的准入完全不变。其余防线
  （mention 命中、去重、启动水位、消息类型）对 qa 群原样适用。
- **BREAKING（Task 模型）** Pet Task 新增 qa-child 形态：其"executor"是源会话的
  fork continuable child（由 DSH continuation manager 组合与驱动），Pet 不再自建
  root session、不 mount preset、不装 Pet allowlist provider；child 继承父会话的
  组合与上下文。该形态沿用 workspace-resident 的信任口径：不承诺 Pet Skill 边界，
  信任来源是「本人显式建群 + 本人亲手拉人」。
- 新增消息投递路径：qa 群的触发消息经宿主 `queueHostSubagentPrompt` 排成 child 的
  独立 turn（FIFO），不经二期1 的 envelope/dispatch 通道；表情状态机（OnIt →
  DONE/失败）改挂 `subagent/end` 事件观测终态。
- 新增 parent 唤活与冷恢复：投递前 parent 非驻留时经 `agents.resume` 拉活；DSH
  重启后 child 经 continuation manager coldResume 继续服务（spike 已验证）。恢复
  路径要求 child descriptor 快照的 LLM provider 已注册，失败进 fail closed。
- 源会话不可用（归档/删除）时 qa 群 fail closed：不再触发工作，并在群内明示绑定
  已失效（qa 群内 bot 身份已公开，不适用"静默不暴露"原则）。
- GUI 侧零新增开发：child 以 continuable subagent 形态收纳在源会话名下（DSH 自带
  折叠列表），用户可展开直接对话；该私聊输入不产生飞书出站。
- fork 种子以源会话**最近一个完成 turn** 为界（in-flight turn 不进种子，spike Q5
  已验证），Q&A 动作入口对此明示。
- 群友能力口径沿用二期1：全量能力 + 诚实声明，child prompt 要求涉及修改工作区时
  先向提问者确认（防呆不防坏，spec 不制造虚假边界）。
- 明确不做：`/pet` 会话内通信面（直接进 child 会话对话即可）、多群绑定同一
  child、qa 群的重新 fork/同步动作（backlog）、群成员级细粒度权限。

## Capabilities

### New Capabilities

- `pet-qa-group`: 答疑群——Q&A 动作触发的建群与 fork child 事务、`kind: qa` 绑定
  与群成员准入豁免、消息经宿主队列投递 child、parent 唤活与 child 冷恢复、
  `subagent/end` 驱动的表情反馈、源会话失效的 fail closed 语义、GUI 收纳与私聊
  通道的边界。

### Modified Capabilities

- `dsh-pet`: ① Task 生命周期新增 qa-child 形态（executor 为 fork continuable
  child，不适用"专用 Workspace 中的普通 executor session"与 preset/allowlist 装配
  要求）；② 来源 scope 的 chat 种类扩展 qa 绑定（每 qa 群至多一个活跃 Task，复用
  同一 child）；③ 能力轮盘新增 Host 内置动作类别（不来自导入 Skill）。
- `pet-lark-channel`: ① 准入 Requirement 增加 qa 绑定豁免路径（全局 allowlist 仅
  约束非 qa 绑定）；② 路由 Requirement 增加 `kind: qa` 绑定行——目标是既有 child
  而非 workspace，且 qa 绑定只能由 Q&A 动作创建，不参与 default workspace 回退；
  ③ 触发消息关联 Requirement 扩展至 child turn 投递形态（表情终态改由
  `subagent/end` 观测）。

## Impact

- 代码：`packages/dsh-pet/`（host：qa 动作端点与建群/fork 事务、绑定模型
  `kind` 字段、pipeline 的 qa 分支、child 投递与 `subagent/end` 观测、parent
  resume/coldResume 接线、schema v4 → v5 migration；client：轮盘 Q&A 动作、
  设置页 qa 绑定展示）。
- 依赖：新增对 `ctx.subagents`（`@deepseek-ai/dsh-subagent` 及其 `internal`
  子路径）、`sessionPersistence`、`sessionQuery` 的注入；`dsh.yaml` dsh-pet 条目
  note 更新。fork provider（`dsh-subagent-fork-in-process`）须在部署组合中启用。
- 数据：Pet sqlite domain v4 → v5（`chat_bindings` 增 `kind` 与 child 引用字段，
  加表/加字段，不清存量；存量行读作非 qa 绑定）。
- 规范：`openspec/specs/dsh-pet/spec.md`、`openspec/specs/pet-lark-channel/spec.md`
  多处 MODIFY；新增 `openspec/specs/pet-qa-group/spec.md`。
- 不改：二期1 的非 qa 入站链路（allowlist、default workspace 路由、
  workspace-resident Task）、浮层一期能力、send-cr / ws skill、dsh-cockpit、
  provider 凭据边界。
