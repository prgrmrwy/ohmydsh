## Why

同一需求跨仓库推进时，用户会开多个一级 DSH session（同机不同 workspace，未来跨机），各自是所属 workspace 的 owner，需要互相感知、协商边界、推进跨边界请求，并由人做最终决定。现有能力都不覆盖这个场景：

- 官方 `dsh-experimental-agent-team` 只能由 Lead 派生 teammate，真源绑在 Lead 会话日志，明确不支持多进程，也不能把已有 session 组成团队。
- pet locus 的协作圈固定为"一个主会话 + 它的 locus children"，并且绑定飞书入口。
- 2026-10-12 至 10-16 的实测（两个 session 共用目录 + 各自 `run_in_background` 挂轮询脚本）证明协议可行，但暴露了结构性问题：监听需要 agent 反复重挂、Host 重启后静默失效、STATUS 消息占 41/75、收件箱单文件超过 100KB、计数游标易错、人的决定没有可验证来源。

本 change 先交付与宿主无关的**协作内核**。它是首个消费者 `dsh-collab`（后续 change）所需的最小领域模型与规则；跨机、独立部署和更多通道需要的字段在数据模型里预留，但本期不承诺这些后续场景完全不需要修改内核。

## What Changes

新增本地包 `packages/collab-kernel`：一个不依赖 DSH 的 TypeScript 库，实现协作服务的规则部分。

- **协作空间**：一次协作对应一个协作空间，包含成员、条目、消息、决议和事件日志；生命周期包括创建、Leader 转交和关闭（无人可接手时关闭）。
- **成员模型**：人与 agent 平权，成员为 `{name, kind: human|agent, binding}`；本期每个成员恰有一个绑定 `{channel, address}`，地址在协作空间内唯一。人类唯一多出的是最终决定权。
- **条目与协商**：契约条款、边界划分和跨边界请求统一为带 `revision` 的条目，修改按 `expectedRevision` 做 CAS；ack 绑定 revision；agent 自动往返超限后转为 `escalated`；用一张"状态 × 命令"转换表约束全部状态变化。
- **人类决策**：`requestDecision` 由成员发起，每个条目同一时刻至多一个 open 请求；`confirmDecision` 只接受携带人类动作证据、且对应投递已成功的 provider 调用，决定人必须是 active 人类成员；`decided` 只能由这条路径产生，并且是终态（本期没有复议，需要改变时新建条目）。
- **API（调用方 → 内核）**：封闭的命令集合（创建与成员管理、条目、消息、决策、熔断重置）与纯读取；所有调用携带 principal（agent / provider / internal），按逐命令授权表授权，actor 由内核推导；写命令带 `cmdId` 幂等，收据持久化。
- **SPI（内核 → channel provider）**：`claim(address, kind)` 认领地址、`deliver(member, pointer)` 唤醒、`presence(member)`、`requestConfirmation(request)`；投递意图在命令事务内记账，外部调用在事务外执行，投递结果由服务内部调度器在同一协作空间串行队列中写回，不是公开命令。
- **唤醒策略**：只投结构化指针不投正文；按事件类型决定叫醒谁；按成员计数的熔断只限制普通唤醒，人类决定清零受影响成员的计数。
- **存储接口**：内核只依赖"按命令原子追加 + 按 seq 读取"；本期提供本地磁盘实现（每个命令一条带校验的 jsonl 记录，排他锁；内核不自动接管，只提供按实例 id 解锁的 `breakLock`，由宿主证明原持有者已不存在）。
- **状态投影**：纯函数生成面向人的 Markdown 当前值视图（单次转义）。协作空间记录 `serviceId` 供以后迁移；定位符与描述文件推迟到出现第二种接入方式时再加。
- **协作约定**：工作指南文本随包按版本发布，协作空间记录所用版本；规则部分由代码强制。

不在本期：复议、确认重新投递、一个成员多个绑定与跨 channel 身份合并、服务端已读位置、DSH 宿主集成与 agent 工具（`dsh-collab` change）、任何真实 channel provider、外部事件摄入（后续跨机中继将以命令形式经同一 API 入口转发）、事件订阅接口、refs、飞书卡片、跨机中继、独立服务部署、MCP/HTTP 传输与鉴权令牌、GUI。

## Capabilities

### New Capabilities

- `collab-kernel`: 协作内核的数据模型、状态转换、授权、人类决策证据规则、唤醒与熔断、原子存储、投影和协作约定的分发。

### Modified Capabilities

无。

## Impact

- 新增 `packages/collab-kernel`（独立 package.json、build、test、README），**不 import 任何 `@deepseek-ai/*`**，不引用 ohmydsh 特有路径，以便日后用 `git subtree split` 拆为独立仓库。
- 本期不登记到 `dsh.yaml`、不改变任何已部署行为；`dsh-collab` change 将以依赖方式引入它。
- 已知缺口：本期没有任何真实人类确认入口，`escalated` 条目在实际使用中无法关闭，直到第一个 human channel provider 交付；`confirmDecision` 仅以测试用 provider 验证。已决定条目是终态，只能新建条目替代。
- 参考与不复用：官方 Agent Teams 的 CAS、mailbox 不重发、journal 串行事务语义被借鉴，但不依赖其包；pet `host/collaboration/` 是同类模型，本期不修改 pet，后续由 locus 以成员来源方式接入。
