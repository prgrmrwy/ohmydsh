## Why

协作内核与目录构建输入已经实现，但已有独立 DSH 会话仍不能通过宿主管理的工具加入同一协作空间、收到定向唤醒或在 Host 重启后恢复协作。用户选择这一阶段先接通同机已有会话，而不是提前接入人类通道或把一级会话改造成 Agent Teams 子会话。

## What Changes

- 新增 `packages/dsh-collab` 宿主插件，构建时内联 `collab-kernel` 当前源码；提供从真实调用会话推导 principal 的具名协作工具，不接受模型传入 actor、principal 或调用者 sessionId。
- 同一 DSH profile、同一 Host 内的已有普通一级会话可跨 workspace 创建/邀请/加入协作空间；宿主配置明确许可完整 session ID（用户已选择许可名单方案），agent不能自行扩展。用完整 ID 寻址，不按标题、路径或短前缀猜测；发现仅列许可目标的必要元数据，不返回会话内容。许可名单是人的接入选择，不宣称自动证明或排除所有Pet/团队归属。
- 提供唯一真实 channel `dsh-session`，只认领 agent 会话；通过官方冷恢复入口保留原 preset/工具装配，再用 followup 投递带来源的结构化协作指针。运行中会话下一回合收到，不插入当前回合。
- 生命周期由 Host 管理：profile 级共享存储、加载既有日志、dispose 封禁准入并关闭存储；残留锁仅在宿主可证明旧持有者死亡后按精确实例 ID 恢复，未知状态不接管。
- 不增加真实人类通道、确认工具、内核 internal/reset 工具或 GUI。没有 active 人类成员时 `requestDecision` 保留内核 `COLLAB_NO_DECIDER`；若读取到有 active 人类但无可用确认通道的合法历史空间，应保留 `awaitingChannel`，不能把 agent 冒充 human 来凑出该状态。
- 新增隔离 Host 接缝验收：身份、空闲/运行中唤醒、真实冷恢复装配、正常 dispose、预算耗尽/强退残锁、部署包在无源码目录时加载，以及使用当前内核源码/约定资源的构建验证。

## Capabilities

### New Capabilities

- `dsh-collab`: 已有会话协作工具、DSH session provider、profile 级生命周期、残锁恢复、源码内联构建和真实宿主验收边界。

### Modified Capabilities

无。`collab-kernel` 的授权、状态机、SPI 和存储格式保持现状；目录输入直接消费已实现能力。

## Impact

- 预计新增独立 package、bundle composition、工具适配器、session provider 与隔离测试；复用现有 DSH 0.2.0-rc.2 官方宿主 API，不修改 Pet、不依赖 Agent Teams、不创建子会话或派生工作区。
- 构建声明内核源码目录、包配置和实际编译/打包配置输入，处理约定 Markdown 的运行时可达性；部署产物不依赖本机 workspace 包或陈旧 lib。
- 本轮规划不授权日常部署、会话注入、模型付费调用、提交、合并或归档。实现期真实 Host 探针只针对新建隔离 profile/合成会话，须在可控本地模型端点执行，不触碰用户现有会话。
- 上一轮严格 Anvil 验收的 TDD 历史偏差和两个既有 MCP 探针 skip 仍保留，不因继续消费者规划而被接受或改成 PASS。本 change 使用仓库默认 `spec-driven` schema，并额外提供独立评审与场景测试账本，不迁移旧 change 的 schema。
