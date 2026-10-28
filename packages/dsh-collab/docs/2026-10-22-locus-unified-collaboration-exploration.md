# dsh-collab / Locus 统一协作模型探索纪要

- 日期：2026-10-22（Asia/Shanghai）
- 分支：`ws/collab-pet-locus-collab`
- 性质：讨论导出与源码调研摘要，**不是已接受 ADR、OpenSpec proposal 或实施授权**。
- 范围：讨论 dsh-collab 是否可以同时支持跨主 session 与 Locus 主子协作，以及 collab-kernel 应承担的通用协作机制。
- 未做：没有修改产品代码，没有进行新接入、迁移、部署或真实模型/飞书测试。

## 1. 用户目标与本轮澄清

用户最初询问：此前开发 Collab 时曾考虑将 Pet Locus 的协作模型换成 Collab，现在是否可行。

后续澄清的目标不是“Pet 与 dsh-collab 各自消费同一个 kernel 就算完成”，而是：

> dsh-collab 本身同时支持跨 session 协作与 Locus 主子结构协作；对两者建立同构模型，再统一消费底层 collab-kernel。kernel 原本就是为了“协作空间 + 协作方式”而建立。

典型拓扑：

```text
协作空间
├─ root A：主 session，推进自己的工作
│  ├─ sub A1：对接某个群
│  └─ sub A2：对接某个话题
└─ root B：另一个主 session
   └─ sub B1：对接另一个入口
```

- 只有一个 root 和若干 children，对应 Locus 主子协作。
- 只有多个 root，对应现有跨 session 协作。
- 多个 root 各自带 children，是两者的组合。
- Locus 主 session 负责自身工作，children 服务群消息/话题，可通过查阅主上下文、记录待办等协作。
- 不应将协作默认理解为委托执行。大部分协作可能是成员记录自己做了什么、进度和上下文，其他成员按需查阅；不足时才进一步联系。

### ref 工作的边界

用户说明另一个 session 正在推进串行协作记录：在 JSONL 协作空间补充 `ref`，关联同一事情的“盖楼”过程，通过引用链取得前后上下文。用户要求此部分稍后讨论，完成后会提供成果。

因此本纪要不规定 ref schema、读取接口、链长或迁移方式；也不声称另一分支已经实现或验收。当前 worktree 的旧实现不能作为否定该工作的证据。

## 2. 初始可行性判断及其修正

### 已核实的基础

1. collab-kernel 已是宿主无关的独立库，提供空间、成员、条目、revision/CAS、ack、request 进度、消息、幂等收据、日志与投递规则。
2. dsh-collab 已有真实普通会话消费者，并在 manifest 启用。
3. Pet inquiry 已从历史“accepted 但未实际派发”的半通道恢复为生产链路；既有记录包含 child→main 显式问答、结果回 child 并成功回群。
4. 原 collab-kernel 规划明确预留 Locus 后续作为成员来源接入。

证据：
- [manifest](../../../dsh.yaml#L99-L110)
- [kernel 当前规范](../../../openspec/specs/collab-kernel/spec.md)
- [dsh-collab 当前规范](../../../openspec/specs/dsh-collab/spec.md)
- [原 kernel 规划](../../../openspec/changes/archive/2026-10-20-collab-kernel/proposal.md#L38-L43)
- [Pet 询问生产验收与收尾记录](../../../openspec/changes/archive/2026-10-22-restore-pet-inquiry-runtime-channel/checkpoint.md#L26-L71)

### 不能直接替换的现状

- 现有 dsh-collab 的 SessionAccess 明确拒绝 subagent / 非零 delegationDepth，恢复走普通 session 入口；不能只删除拒绝判断就接入受管 child。
- Collab 成员通过 invite/join/leave/gone 持久管理；Locus 成员来自唯一当前绑定、正反索引及 generation。接入不能产生第二份独立授权真相。
- Collab 普通 followup 通知不具备 Pet inquiry 的独立 claim、原工作、Delivery、受众和结果续进证明。
- Collab active 成员可以读取整个空间日志；Pet 当前公共事实、定向问答正文及 owner 审计具有不同可见范围。
- 不能直接把长期公共事实映射成一个反复修改的 charter：旧 kernel 的 agentEditCount 超限会 escalated，现有消费者又没有真实 human confirmation provider。此规则可能受另一 session 的演进影响，后续需重新核验。
- kernel 的 claim SPI 当前只收 address/kind，不收 space，不能想当然地仅靠 provider 完成同圈准入。

证据：
- [普通会话身份与投递](../src/session-provider.ts#L23-L106)
- [kernel 模型](../../collab-kernel/src/model/index.ts)
- [kernel 条目修改](../../collab-kernel/src/service/index.ts#L279-L291)
- [Locus caller 校验](../../dsh-pet/src/host/collaboration/caller.ts)
- [询问当前规范](../../../openspec/specs/pet-inquiry-runtime-channel/spec.md)

### 讨论中的修正

最初建议是“先复用 kernel 通用条目能力，保留 Pet inquiry”。用户进一步明确要统一 dsh-collab 产品层模型后，建议调整为：

> 先明确并补齐 kernel 的统一协作语义，再由 dsh-collab 接入普通 root 与 Locus 主/子成员，最后迁移 Pet 中真正重复的协作逻辑。

这不意味着一次性替换所有 Pet 子系统，也不意味着必须完整复刻官方 Agent Teams。

## 3. 官方 DSH Agent Teams 深入调研

### 取证范围

核查官方 npm 发布的两个精确版本包：

- `@deepseek-ai/dsh-experimental-agent-team@0.2.0-rc.2`
- `@deepseek-ai/dsh-experimental-tool-agent-team@0.2.0-rc.2`

通过 npm registry 获取 tarball 和 integrity，下载后以 SHA-512 校验一致；未安装依赖、未更改 lockfile。阅读发布包 README、服务编译实现、类型和工具实现。

官方包入口：
- https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-agent-team/v/0.2.0-rc.2
- https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-tool-agent-team/v/0.2.0-rc.2

完整性：

```text
agent-team:
sha512-ds9BrnyJ+BAbxaH3J81c/+JJpk8jUtnpzUCyTXxrDW2nZOnFWqdPH/TZKAI1ttCuls218+RF4PPFPbhYaXNl6g==

tool-agent-team:
sha512-iwaUH4Ev4jz56iV9Zm1IkY/34c0NoUe3gFDKDzw8UQfy8S87uNoTOR5z4//ycdN0uuHQ01MfP7U0zKkdIuYjoA==
```

临时下载内容不提交，不 vendor 上游源码。以下行号指上述精确发布包中的 `lib/index.js`，可按同一 tarball 重现。

### 3.1 总体架构

官方 Team 不是自动派工引擎，而是：

```text
一个 Lead 拥有的持久团队
  + 共享任务板
  + 点对点 mailbox
  + 运行状态观察 / 等待变化
  + 模型层协作约定
```

服务由 Roster、TaskBoard、Mailbox、Journal、Activity、Lifecycle 等模块组成。

- `teamId = Lead sessionId`，普通 root 隐式成为自己的 Lead。
- 团队唯一真源是 Lead 的 Session 日志。
- 主要事件为 `team/member`、`team/task`、`team/message/queued`、`team/message/delivered`。
- 管理结构是星形，但通信是网状：成员可直接联系兄弟或 Lead，不需要 Lead 模型转述。
- sibling 投递由 Host 使用 Lead-to-child 所有权路径完成，同时保留真实发送者 source。

定位：agent-team `lib/index.js` 397–426、909–938、1712–1729。

### 3.2 成员生命周期

只有 Lead 可以 spawn 或 interrupt teammate。成员只能新建为直接 continuable child，不支持邀请已有独立 session。

创建顺序：

1. 预留 child ID 和永久唯一名字。
2. Lead 日志提交并 flush `provisioning`。
3. 调 `subagents.startContinuable` 创建 child、投递初始任务。
4. 验证初始消息在目标 Session 已持久接受。
5. 提交 `active`；失败则提交 `failed`。

恢复对照 child 的直接 parent、continuable descriptor/provider 和初始用户消息；不凭 API 曾成功猜测创建完成。失败成员也保留名字，名字不可复用。

必须区分：
- 持久阶段：provisioning / active / failed。
- 实时状态：running / inactive。

inactive 只表示当前没有 running 轮次，不意味着任务完成、失败、离队或等待某个特定对象；也可能是冷态未加载。

定位：agent-team `lib/index.js` 544–684、727–729。

### 3.3 任务板与责任

任务是完整版本化快照：subject、description、revision、status、ownerId、blockedBy、writeScopes。

状态及动作：

```text
create → pending（无 owner）
claim → in_progress（自己为 owner）
Lead reassign → in_progress（指定 owner）
release → pending（无 owner）
complete → completed
reopen → pending（无 owner）
delete → tombstone
```

Host 强制：
- 更新必须携带 expectedRevision。
- claim 不能抢走他人任务，且全部依赖须完成。
- edit/complete/release 等要求 owner 或 Lead。
- reassign 仅 Lead。
- 依赖存在性、自依赖、重复依赖、全图环检查。
- 删除保留 tombstone，ID 不复用。
- writeScopes 是 workspace 相对前缀，只报告重叠，不锁文件、不授予权限。

**重要：任务操作只写日志，不唤醒 owner，不自动调度。** 依赖完成只改变 ready 派生值。inactive、interrupt、失败或进程退出均不自动释放 owner。complete 也不校验代码或测试，只是获授权成员的状态提交。

定位：agent-team `lib/index.js` 1010–1085、1466–1489、1521–1629。

### 3.4 mailbox 与唤醒

工作接续通常是“登记/分配任务 → 显式 send_message → 对方读取任务并工作”，不是任务板自动驱动。

消息流程：

```text
Lead 日志 queued + flush
  → 按目标串行投递
  → target steer / 冷恢复
  → 核对目标 pending inbox 或历史中的稳定 messageId
  → target flush
  → Lead 日志 delivered
```

- running 目标走 steer，在最近步骤边界收到，不是下一回合 followup。
- inactive 目标启动或恢复。
- 投递暂不可用保留 queued。
- 恢复 queued-minus-delivered，并核验目标自身记录防重。
- delivered 证明目标持久持有消息，不证明模型回答或任务完成。
- 每次 send 生成新 UUID；没有调用者 cmdId 收据，因此模型重调 send 仍可能造成业务重复。
- 保证是单进程重试加目标去重，不是跨进程 exactly-once。

定位：agent-team `lib/index.js` 815–849、878–981。

### 3.5 上下文共享

官方没有另建团队公共知识库，也不自动汇总成员结论。

- roster、task、mailbox 管理事件只存在日志/投影，不自动进入模型历史。
- roster 和任务通过工具按需读取。
- peer 消息正文进入目标历史。
- fresh 不带 Lead 历史，fork 继承创建时 Lead 已完成轮次前缀。
- 不自动共享其他成员完整历史。

因此任务板是共同工作状态，而非天然共享认知。

定位：agent-team README.zh.md 145–151、183–195。

### 3.6 Host 保证与模型约定

Host 保证身份、Leader 操作权限、revision/CAS、DAG、owner、持久消息、目标去重和等待事件。

模型自行负责拆任务、选择成员、补通知、协调写范围、汇报结果、检查最终 diff、运行测试和等待所需队友。

工具 POLICY 明确：
- 用户显式要求才创建 teammate。
- 分配/ready 不启动 owner。
- 不重复发送已 queued 的消息。
- wait 之前先确认有其他 running/provisioning 成员；否则先 send_message。
- Lead 负责最终检查和等待必要成员。

`wait_agent` 仅观察调用之后的变化，不唤醒；工具层无活跃 peer 时直接返回 noProgress。`interrupt` 保留 inbox 和任务 owner。

定位：tool-agent-team `lib/index.js` 20–29、331–350；agent-team 503–516。

### 3.7 官方能力边界

单 Lead、扁平不可变 roster、直接 child、单进程、共享 checkout；不支持已有 session 加入、多 root、嵌套 Team、Lead 转交、独立 worktree 或自动回收任务。

这些是其产品实现约束，不应作为通用 kernel 的默认规则。

## 4. 建议的 kernel 边界（尚待正式设计）

判断标准：不提 DSH/session/飞书，这条协作规则是否仍成立？成立的通常属于 kernel；依赖实际运行时的执行属于接入层。

| 能力 | 建议归属 |
|---|---|
| 空间、成员、角色、领域操作权限 | kernel |
| 工作事实、责任人、进度、claim/释放/转交 | kernel，先检查现有 request 是否可统一表达 |
| revision/CAS、依赖和 ready 派生 | kernel |
| 消息持久记录、通知意图与结果语义 | kernel |
| 实际调用 session 身份核验、成员发现 | dsh-collab 宿主接入 |
| 创建、恢复、中断 session | DSH 运行时接入 |
| steer / followup 的实际选择与实现 | 运行时接入及明确投递策略 |
| 飞书入口、Delivery、精确回复权 | Pet/Locus 接入 |

最值得吸收的原则：

1. 成员归属不等于通信路径。
2. 工作状态、运行状态、通知状态独立。
3. 登记或分配不等于唤醒或执行。
4. 管理事实可持久可查询，不必每次变更都唤醒所有成员。
5. 归属关系、管理权限、工作责任不能合成一个“主子”概念。

不应搬入：Lead 日志作为唯一存储、单 root 限制、只能 spawn 加成员、主节点天然指挥所有成员、权限继承或所有消息必须 steer。

### 现有模型优先，不新增平行任务系统

kernel 已有 request/assignee/progress、条目和消息；不能仅因为官方叫 task，就再加一套 TeamTaskBoard。

需要区分：
- 自记工作：“我正在处理 X，目前进度到这里”。
- 协作请求：“有一个 X，希望某成员承接”。

两者可能共享工作记录和责任模型，但自记工作不应被迫走请求/接受流程。哪些状态、依赖和动作真正需要，仍应从用户场景出发。

## 5. 推荐目标结构

```text
collab-kernel
  空间、成员、工作事实、责任、协商、消息和一致性规则
                         ↑
dsh-collab
  统一 DSH 协作入口、工具、发现与运行时接入
             ┌───────────┴───────────┐
        已有主 session           Locus 主/子 session
                                     ↑
                               Pet 提供入口绑定、
                               生命周期与回复能力
```

此为建议，不代表已批准模块划分。Pet 的现役 inquiry 独立执行、原工作关联、守卫和回复权不能因引入通用消息就删除；后续需要证明统一模型如何承接，再迁移。

[ADR-0006](../../../docs/adr/ADR-0006-keep-locus-inside-dsh-pet.md) 要求完整 Locus 留在 Pet 内，不禁止消费独立协作内核；本讨论不自动废止该 ADR。

## 6. 尚待讨论的问题

1. 空间是整个多 root/child 的共享边界，还是 root 各有内部现场、跨 root 发布选定记录？用户尚未选择。
2. 群/话题内容哪些适合提交到共享空间？不等于自动收录原始聊天或全部 session 历史。
3. Host 管理的 Locus 成员如何进入、退出和换代，同时避免双份授权真相？
4. 现有 request 能否统一表达自记工作与待承接事项，是否确需依赖和 claim？
5. 通用通知与需要原请求续进的 inquiry 如何区分，何时允许唤醒？
6. kernel 的日志存储与 Pet 原子 domain 的交界如何处理，不能假定跨存储原子提交。
7. 等另一 session 的 ref 工作完成后，重读实际成果并对齐，不在此重复设计。

建议下一步先做统一语义差量设计，再扩展 dsh-collab 成员接入，最后替换 Pet 重复逻辑。本轮未创建正式 change，也未授权实施。
