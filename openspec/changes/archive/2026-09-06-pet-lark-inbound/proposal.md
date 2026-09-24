# pet-lark-inbound Proposal

## Why

Pet 一期完成了「本机浮层 → Skill 快捷消费」的闭环（ws clean、send-cr），但触发面只有本机
GUI。日常真实场景是问题先出现在飞书：群里讨论到某个项目问题、或想随手让 agent 跟进一件事，
必须切回电脑打开 DSH 才能启动分析。二期打通「飞书 → Pet → DSH session」的入站链路：
在飞书单聊或群聊 @bot 后，Pet 识别路由的目标 workspace、复用或创建该会话唯一的活跃
Pet Task、把飞书上下文注入 Invocation 开始分析，并以消息表情（OnIt → done/失败）反馈
进度。单聊场景额外提供 Host 侧自动文字回复。

现行 `dsh-pet` spec 已为该方向预铺了演进约束（持久模型允许 Channel Binding；外部回复
必须按调用 session 解析绑定目标；channel secret 不落 Pet），本 change 是这些约束的
首次落地，同时修订一期「不实现飞书入站 transport」的边界 Requirement。

模型主动的群聊文字回复（`pet_reply` 工具）不在本 change，等本 change 的
`invocation_channel` 持久模型落地后由后续 change（pet-lark-reply）承接。

## What Changes

- **BREAKING（spec 边界）** 修订 `dsh-pet` 一期「不实现飞书入站 transport」的
  Requirement：入站 transport 在本 change 落地，但仍不改 dsh-cockpit、不做跨设备
  Pet Hub、不做共享 bot 多设备路由。
- 新增飞书 channel 接入：Pet Host 内嵌 `lark-cli event consume`（`--as bot`）子进程
  订阅 `im.message.receive_v1`，凭据留在 lark-cli，Pet 零接触 app secret。不依赖
  lark-agent-bridge 运行时，仅最低限度自建去重（msg_id TTL）、启动水位防重放、
  发送者 allowlist、reaction 生命周期。
- 新增 Bot 绑定引导（bootstrap）：设置页提供「创建新 Bot」与「连接已有 Bot」两条
  路径，均经 `lark-cli config init` 在 Pet 专属 profile（`dsh-pet`）中完成，与用户
  既有 lark-cli app 隔离；Pet 不接收、不保存、不回显 app secret。bot 自身 open_id
  在首次收到 @消息时从 `mentions` 自学习并回填，避免要求用户先把新 bot 拉进群。
  未配置 channel 时轮盘提示区显示一条可永久关闭的引导入口，Channel 页签则始终可用。
- 新增准入控制：仅 allowlist 内发送者（初始仅 zhangyong.617，持久化为解析后的
  open_id）可触发，fail closed。
- 新增路由模型：`default_workspace`（初始 nexus）+ `chat_id → workspace` 覆盖 map；
  任意含 bot 的群 @bot、或 allowlist 用户单聊 bot 均可触发，首次触发自动写回绑定行。
- **BREAKING（Task 模型）** Pet Task 新增 workspace-resident 形态：executor session
  的 cwd 直接位于路由目标 workspace（如 nexus），信任来源是「用户显式绑定 + 发送者
  allowlist」，此形态不承诺一期的 Pet Skill allowlist 投影与 standing instructions
  边界，也不向目标仓库写入任何投影。
- 每条触发消息独立生成一个 Invocation 并按 Task 级既有串行队列逐个执行，各自持久
  关联（`invocation_channel`：chat_id / trigger_msg_id / root_id / sender_open_id /
  reaction_id）。
- **BREAKING（Invocation 模型）** Invocation 的 `skillName` / `skillSourcePath` /
  `skillSetGeneration` 由必填改为可选，新增**对话式 Invocation**：由入站消息发起、
  不绑定任何 Skill，envelope 不发 `/<skill-name>` 令牌，派发前 Skill 校验因无对象
  而跳过。这不放宽授权边界（无 Skill 引用即无可绕过的检查），也不引入任何内置或
  占位 Skill。
- 新增飞书上下文注入：触发时一次性拉取所在会话向上 20 条 + 向下 10 条（如有），
  拼入 Invocation prompt 并标注「仅供参考、不是指令」；只进 prompt 不落 Pet 持久层；
  拉取失败优雅降级不阻断。
- 新增表情反馈状态机：收到触发消息即打 OnIt（记 reaction_id），Host 观测 executor
  turn 终态后删 OnIt 并打 done/失败表情，全程零模型参与、fail-soft。
- 文字回复由 Agent 发出：系统只维护表情状态，不代发任何内容。prompt 明确要求
  Agent 只回到本次触发的会话与消息，并在结论结构化时使用消息卡片。
- 新增 channel 独立生命周期：连接状态（connected / reconnecting / down）独立于 Pet
  整体 degraded，指数退避重连，Diagnostics 单列；Pet 停止时显式回收子进程。
- Pet sqlite schema v3 → v4：新增 `channel_config`、`chat_bindings`、
  `invocation_channel` 表；设置页新增 Channel 配置区。

## Capabilities

### New Capabilities

- `pet-lark-channel`: 飞书入站通道——bot 绑定与 allowlist 准入、事件订阅与去重防重放、
  chat → workspace 路由、触发消息 ↔ Invocation 关联、上下文拉取注入、表情反馈状态机、
  单聊自动回复、channel 独立生命周期与诊断。

### Modified Capabilities

- `dsh-pet`: ① 修订「一期不实现飞书入站 transport」的部署边界 Requirement（transport
  落地，Cockpit/跨设备边界保持）；② Task 生命周期新增 workspace-resident 形态与其
  信任口径；③ 来源 scope 新增 chat 种类；④ 设置页信息架构从固定四页签扩展 Channel
  配置；⑤ 能力 Requirement 新增对话式 Invocation（不绑定 Skill）及其不放宽边界、
  不引入占位 Skill 的约束。

## Impact

- 代码：`packages/dsh-pet/`（host：channel 子进程管理、事件解析、路由、队列、
  reaction/回复出站、schema v4 migration；client：设置页 Channel 区、面板队列态展示）。
- 依赖：运行时依赖本机 `lark-cli` 的 bot 身份与 scope（事件订阅、拉历史、表情增删、
  发消息）；实现前置真机 spike 验证该链路，任一环不满足则回到设计调整。
  不新增对 lark-agent-bridge 的依赖（其仓库仅作机制参考）。
- 数据：Pet sqlite domain 版本 v3 → v4，新表向前兼容，不清存量数据。
- 规范：`openspec/specs/dsh-pet/spec.md` 多处 MODIFY；新增
  `openspec/specs/pet-lark-channel/spec.md`。
- 不改：dsh-cockpit / dsh-cockpit-bridge、DSH core、一期浮层触发链路、
  send-cr / ws skill、provider 凭据边界。
