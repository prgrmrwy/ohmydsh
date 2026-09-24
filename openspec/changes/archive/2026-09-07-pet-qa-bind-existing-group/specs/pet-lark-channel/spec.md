# Pet Lark Channel Specification (Delta)

## MODIFIED Requirements

### Requirement: 触发消息按 default workspace 加覆盖 map 路由且失败关闭

系统 SHALL 维护 chat 到 workspace 的路由：存在该 chat 的显式绑定行时使用其
workspace；否则使用 default workspace，并将本次路由结果作为标记为自动来源的
绑定行写回，供用户后续在设置页查看与改绑。单聊与群聊 SHALL 共用同一路由模型。

绑定行 SHALL 区分 `kind`：`workspace`（既有语义）与 `qa`。`kind: qa` 行的路由
目标是其记录的 fork child 会话而非 workspace；此类行 SHALL 仅由 Q&A 动作或
`/bind` 绑定流程创建，MUST NOT 由入站消息自动写回产生，MUST NOT 参与 default
workspace 回退，设置页 MUST NOT 允许将其改绑为 workspace 目标。存量绑定行 SHALL
读作 `kind: workspace`。

群内命令 SHALL 在按既有规则丢弃或路由**之前**被识别，并 SHALL 发生在 mention、
去重、水位与消息类型防线**之后**：命令不豁免任何一道既有防线。

命令 SHALL 无论该群当前是否已绑定都被识别，由绑定流程给出确定性结果；
MUST NOT 因群的绑定状态而不识别命令、使其作为普通提问投递给 child。冲突与
「无可解绑」都是数据库事实，SHALL 由一次查询机械判定并立即回执，MUST NOT 交由
模型推理得出——委派给模型会使结果取决于该轮判断、耗费一次完整推理，且把命令
意图送入本不该由其裁决的上下文。

命令识别 MUST NOT 改变非 qa 群或单聊的任何既有行为。

路由目标 MUST 是当前 Host 已注册的 workspace（`kind: workspace`）或有效的 qa
绑定（`kind: qa`）。default workspace 未配置且无绑定行、或目标 workspace 已不
存在时，系统 SHALL fail closed：不创建 Task，并在触发消息上给出失败表情反馈。
qa 绑定已失效时按其失效语义处理。

#### Scenario: 未绑定的群首次触发
- **WHEN** allowlist 用户在一个没有绑定行的群中 @bot，default workspace 配置为 nexus
- **THEN** 本次触发路由到 nexus，并写回一行该群到 nexus 的自动绑定

#### Scenario: 已显式改绑的群触发
- **WHEN** 用户已在设置页把某群绑定到 dev-infra-server，随后在该群 @bot
- **THEN** 触发路由到 dev-infra-server，不受 default workspace 影响

#### Scenario: 路由目标不可解析
- **WHEN** 触发消息命中的 workspace 已在 Host 注销，或无绑定且 default 未配置
- **THEN** 系统不创建 Task 或 Invocation，在触发消息上打失败表情并记录诊断

#### Scenario: qa 群触发路由到 child
- **WHEN** qa 绑定的群中有成员 @bot
- **THEN** 消息路由到该绑定记录的 child 会话，不经 default workspace，也不写回自动绑定行

#### Scenario: qa 绑定不可被改绑为 workspace
- **WHEN** 用户在设置页查看一个 qa 绑定行
- **THEN** 该行展示其 qa 属性与源会话，不提供改绑到 workspace 的操作

#### Scenario: 未绑定群中的绑定命令被识别
- **WHEN** 一个无 qa 绑定的群中，allowlist 用户 @bot 发送 `/bind <前缀>`
- **THEN** 消息进入绑定流程，不按 default workspace 路由、不写回 workspace 自动绑定行

#### Scenario: 绑定命令不豁免既有防线
- **WHEN** 一条 `/bind` 消息未 mention bot、属重复投递或早于启动水位
- **THEN** 该消息按对应防线丢弃，绑定流程不被触发

#### Scenario: 已绑定群中识别解绑命令
- **WHEN** 一个已有 qa 绑定的群中，allowlist 用户 @bot 发送 `/unbind`
- **THEN** 消息进入解绑流程，不作为提问投递给 child

#### Scenario: 已绑定群中的 /bind 被机械拒绝
- **WHEN** 一个已有 qa 绑定的群中，allowlist 用户 @bot 发送 `/bind <前缀>`
- **THEN** 系统立即回执「本群已绑定」，该消息不投递给 child，不经模型推理

#### Scenario: 未绑定群中的 /unbind 被机械拒绝
- **WHEN** 一个无 qa 绑定的群中，allowlist 用户 @bot 发送 `/unbind`
- **THEN** 系统立即回执「本群没有绑定任何会话」，该消息不投递给 child
