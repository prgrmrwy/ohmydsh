## MODIFIED Requirements

### Requirement: 显式绑定可替换自动关联并警告上下文改变

`-b/--bind <prefix>` 及 `/bind <prefix>` SHALL 只由 allowlist 触发。前缀 SHALL 至少六位，唯一匹配未归档主会话；无匹配/多匹配 SHALL 同一句回执，不暴露其它会话。主会话运行的 Agent preset MUST NOT 成为绑定条件：locus 子会话的组合与主会话 preset 无关（见「Locus 业务出站只能经受管 finish」），因此用户自己的 `standard` 等会话与 Pet 自建主会话同样可绑定。拒绝绑定 SHALL 给出真实原因；只有「前缀命中子会话」按无匹配同一句回执。群名 SHALL 取平台事实，未知留空，不承诺管理不属于自己的群。

尚未建立 locus 的入口收到 `/bind` 时 SHALL 直接以指定主会话建立该入口的 locus，MUST NOT 先建立自动来源再改绑：入群不预建关联，因而不存在需要被替换的自动归属。此时 MUST NOT 发出上下文变更警告——没有发生来源变化。

自动建立或默认继承的 locus 在空闲时 SHALL 允许显式切换到 S1；已显式绑定的不同来源 SHALL 拒绝直接覆盖并指向解除，同源重试 SHALL 幂等。存在运行或已接受待处理消息时 SHALL 拒绝切换并提示稍后。

切换 SHALL 建立新子会话、新代际且默认 read；旧子会话历史保留。当前入口 MUST 明确收到“从 S0 切换到 S1，上下文来源发生变化，旧对话未自动合并”的提示，使用标题或短标识；通知未送达时 MUST NOT 无提示开始新来源工作。已有话题 MUST NOT 自动迁移，新话题 SHALL 默认使用新群主会话。

#### Scenario: 首次绑定一次建对
- **WHEN** bot 已在群内但该入口尚无 locus，allowlist 发送 `/bind S1`
- **THEN** 直接建立以 S1 为主会话的 locus，`mainSource` 记为显式来源，不产生自动 main、不执行改绑、不发送上下文变更警告

#### Scenario: 绑定用户自己的 standard 会话
- **WHEN** allowlist 发送 `/bind S1`，S1 是运行 `standard` preset 的未归档用户主会话
- **THEN** 建立以 S1 为主会话的 locus；子会话仍以 Pet 指定的 safe preset 组合，不获得 `subagent` 等委派工具

#### Scenario: 自动来源显式切换
- **WHEN** 空闲自动 locus S0 收到 allowlist `/bind S1`
- **THEN** 创建 S1 的新 read 子会话并切换，当前入口收到明确的 S0→S1 上下文警告，旧历史不自动合并

#### Scenario: 群切换不迁移旧话题
- **WHEN** 群从 S0 切换到 S1，存在话题 A 且随后新建话题 B
- **THEN** A 继续 S0，B 默认 S1，管理视图如实展示不同来源

#### Scenario: 显式来源被覆盖
- **WHEN** 已显式绑定 S1 的 locus 收到绑定 S2
- **THEN** 拒绝并说明需先解除；同 S1 重试只返回既有结果

#### Scenario: 忙时切换
- **WHEN** 当前子会话有执行中或排队消息时收到改绑
- **THEN** 不强杀、不改来源，提示稍后重试

#### Scenario: 非 allowlist 控制请求
- **WHEN** 群成员不在 allowlist 但发送绑定、解绑或 scope 命令
- **THEN** 静默丢弃，不把命令作为普通问题送给子会话

### Requirement: Locus 业务出站只能经受管 finish

Locus child 的飞书业务正文与撤回动作 SHALL 只能由 caller-bound `pet_locus_finish` 的 Host 实现产生。child 的已发布能力集合 MUST NOT 提供可经 Skill、shell、脚本、CLI、通用 HTTP、子委派或其它执行身份直接发送或撤回飞书消息的路径；普通 assistant 文本仍不得外发。

该边界 SHALL 由工具/执行 authority 隔离强制执行，MUST NOT 仅依赖 prompt、Skill 省略、命令字符串黑名单、PATH/HOME 隐藏或 read-only 文件沙箱。若当前 pinned runtime 无法证明在保留通用进程执行时隔离飞书凭据与 Lark 网络出口，发布的 Locus safe composition SHALL 移除 `bash`、`pwsh`、任意代码执行和可代为执行的子委派能力，只保留受控只读工具与 caller-bound Pet 工具。

Locus child 创建和冷恢复 SHALL 使用同一份持久、不可由 parent/user preset 漂移的 safe composition。该 composition 的 preset SHALL 由 Pet 在创建时显式指定并持久化，MUST NOT 从主会话当前或创建时的 preset 派生；冷恢复 SHALL mount 持久化的该 preset，MUST NOT 经父组合（`composeFrom`）重建；持久记录缺失该 preset 时 SHALL 拒绝恢复。每个成功完成 independent marker 与精确 durable toolFilter 装配的新建/重建 child，SHALL 在对应 Locus 行发布 Host 证明的 `safe-v1` composition marker；该 marker 只能在 child 创建成功返回后、active locus 发布时写入。缺少 marker 的旧行仍 SHALL 可被 schema/persistence 读取，但 startup reconciliation SHALL 将其置为 invalid，resolution、adoption 与 dispatch SHALL 在任何 parent/child cold resume 之前拒绝；非 `safe-v1` 值亦同。Host 无法证明该 composition 已安装时 SHALL 拒绝创建、恢复或派发；MUST NOT 静默回退到继承父 preset 的 child。任何为满足本条所需的 DSH compatibility seam SHALL 针对 manifest 中的精确 pin 做运行时探针并 fail closed。

#### Scenario: 受管 finish 正常发送
- **WHEN** safe child 对其已证明的 current Delivery 调用 `pet_locus_finish(reply)`
- **THEN** Host 按 durable CAS 和固定触发消息发送一次正文并记录结果

#### Scenario: shell 旁路不可达
- **WHEN** child 尝试以 `lark-cli`、绝对路径脚本、`msg.py`、Python/Node/curl 或复制后的可执行文件直接调用飞书接口
- **THEN** 已发布执行 authority 不能产生飞书业务消息，且 Delivery 状态不因尝试而改变

#### Scenario: 子委派不能洗白权限
- **WHEN** child 尝试通过 subagent、workflow、Ralph 或 agent message 让另一执行身份代发
- **THEN** safe composition 不提供该旁路，或接收方同样无飞书出站 authority；业务正文仍只能由原 current 的 finish 产生

#### Scenario: 隔离能力无法证明时不发布
- **WHEN** runtime 既不能持久固定无进程执行的 safe composition，也不能提供隔离凭据与 Lark egress 的独立 execution world
- **THEN** Locus intake/child 能力保持 unavailable 并给出确定性诊断，MUST NOT 以字符串过滤或 prompt 警告宣称安全

#### Scenario: 主会话 preset 不影响子会话工具面
- **WHEN** 主会话运行一个把委派工具注册进 agent 自有层的 preset（如 `standard`）
- **THEN** 该主会话下的 locus child 仍以 Pet 指定的 preset 创建，其已发布工具面与 Pet 自建主会话下的 child 相同

#### Scenario: 冷恢复不回落到父组合
- **WHEN** Host 重启后首次向一个 independent locus child 投递
- **THEN** runtime mount 其持久化的 preset 恢复组合，不调用父会话的组合继承；运行时不支持显式 child preset 时 locus child 能力保持 unavailable

#### Scenario: 升级前的 legacy child 不可恢复服务
- **WHEN** 一个历史 active locus 的 durable child 没有 Host attested safe-composition marker
- **THEN** 启动恢复或派发前将该 locus 标记为不可服务并要求显式重建，MUST NOT adopt 或冷恢复该 child 后继承父 preset
