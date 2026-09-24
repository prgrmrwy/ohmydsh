## ADDED Requirements

### Requirement: current Delivery capability 拒绝可判定且不削弱来源隔离

系统 SHALL 将 caller-bound finish/wait/track 授权建立在同一份当前执行证明上：实际 caller 必须对应唯一 active locus/generation/child，当前执行必须由唯一 current Delivery 发起或由其已证明的 Host/agent-message 连续轮次恢复，且不得含 GUI/user、来源不明参与者、第二个 Delivery 或旧代际污染。持久层中“存在 current”只是必要条件，MUST NOT 单独授予 capability。

授权拒绝 SHALL 返回机器可判定的稳定原因类别，至少区分：`no-current`、`claim-unbound`、`mixed-source`、`stale-delivery`、`generation-mismatch`、`association-unproven` 与 `capability-unavailable`。对模型的文字可以概括，但诊断 MUST 保留类别以及不含其它入口标识的本地证据；MUST NOT 把所有拒绝折叠成“没有 current”。

claim-before-bind、expiry→promotion、Host 恢复和 next-step/next-turn batching 的修复 MUST 通过补齐/恢复正确证明完成；系统 MUST NOT 通过允许 GUI/user mixed turn、只查数据库 current 或猜测最近 Delivery 来消除拒绝。

#### Scenario: claim 先于 durable bind 后恢复
- **WHEN** current Delivery 的 turn claim 先到达，随后同一 Delivery 完成 durable bind 且期间没有其它来源污染
- **THEN** capability 从 `claim-unbound` 收敛为可用，不把暂时未绑定永久记为 mixed

#### Scenario: GUI steer 继续 fail closed
- **WHEN** current Delivery 存续期间同一 child 收到 GUI/user steer
- **THEN** 该执行得到 `mixed-source` 拒绝，不能 finish、wait 或 track 当前 Delivery；系统不得为修复历史误拒而放宽此规则

#### Scenario: 到期晋升后迟到执行可辨别
- **WHEN** A 已到期、B 已晋升 current，而 A 的旧执行调用 finish
- **THEN** 调用以 `stale-delivery` 拒绝，不消费 B，诊断可与“当前根本没有 Delivery”区分

#### Scenario: 冷恢复关联无法证明
- **WHEN** Host 恢复时不能唯一证明 child、locus generation 和 current Delivery 的关联
- **THEN** capability 以 `association-unproven` 保持不可用并暂停派发，不猜测最近记录

### Requirement: Locus 业务出站只能经受管 finish

Locus child 的飞书业务正文与撤回动作 SHALL 只能由 caller-bound `pet_locus_finish` 的 Host 实现产生。child 的已发布能力集合 MUST NOT 提供可经 Skill、shell、脚本、CLI、通用 HTTP、子委派或其它执行身份直接发送或撤回飞书消息的路径；普通 assistant 文本仍不得外发。

该边界 SHALL 由工具/执行 authority 隔离强制执行，MUST NOT 仅依赖 prompt、Skill 省略、命令字符串黑名单、PATH/HOME 隐藏或 read-only 文件沙箱。若当前 pinned runtime 无法证明在保留通用进程执行时隔离飞书凭据与 Lark 网络出口，发布的 Locus safe composition SHALL 移除 `bash`、`pwsh`、任意代码执行和可代为执行的子委派能力，只保留受控只读工具与 caller-bound Pet 工具。

Locus child 创建和冷恢复 SHALL 使用同一份持久、不可由 parent/user preset 漂移的 safe composition。Host 无法证明该 composition 已安装时 SHALL 拒绝创建、恢复或派发；MUST NOT 静默回退到继承父 preset 的 child。任何为满足本条所需的 DSH compatibility seam SHALL 针对 manifest 中的精确 pin 做运行时探针并 fail closed。

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

#### Scenario: 升级前的 legacy child 不可恢复服务
- **WHEN** 一个历史 active locus 的 durable child 没有 Host attested safe-composition marker
- **THEN** 启动恢复或派发前将该 locus 标记为不可服务并要求显式重建，MUST NOT adopt 或冷恢复该 child 后继承父 preset

### Requirement: Delivery 保留有界结构化 addressing 事实

对合格的群消息，系统 SHALL 在 durable Delivery 中保存有界、顺序化的 normalized addressing projection，至少标识每个 mention occurrence 的 `kind`（`self-bot`、`other-bot`、`human` 或 `unknown`）与可显示名称，并汇总 `selfMentioned` 和 `otherBotCount`。Host 可在内部保存重验所需稳定标识，但注入 child 时 MUST NOT 暴露 app secret、无关 open ID 或原始 transport event。

分类 SHALL 基于入站 mention 结构与 Host 可证明的 chat bot 成员事实；无法证明 bot/human 或 occurrence 顺序时 SHALL 标为 `unknown`，MUST NOT 从压平文本猜测。缺少新字段的旧 Delivery SHALL 保持可读并明确按 addressing unknown 处理，MUST NOT 回填猜测值。

这些事实只供 child 做自然语言意图判断；Host MUST NOT 因出现另一个 bot、某个关键词或 reference-only 猜测而在 durable Delivery 前静默丢弃已经合格的本 bot mention。

#### Scenario: 同时 at 多个 bot
- **WHEN** 一条消息同时 mention 本 bot 和两个可证明的其它 bot
- **THEN** Delivery 保存相应 `self-bot`/`other-bot` addressing 投影并交给 child 判断，不由 Host 自动回复或丢弃

#### Scenario: mention 身份不可证明
- **WHEN** 某 mention 无法由当前 bot 成员事实判定为 bot 或 human
- **THEN** 该 occurrence 以 `unknown` 注入，不从显示文本猜测其类型

#### Scenario: 旧 Delivery 兼容读取
- **WHEN** Host 恢复一个没有 addressing projection 的历史 Delivery
- **THEN** 将 addressing 视为 unknown 并继续既有安全恢复，不伪造 mention 结构
