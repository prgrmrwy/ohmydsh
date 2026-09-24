# Send CR Skill Specification

## Purpose
仓库级普通 Send CR Skill：从来源 session 提取 MR、读取 Codebase 评审人与描述、经 lark-cli 发送 CR 请求，发送前必须用户确认。

## Requirements

### Requirement: Send CR 是一个普通的独立 Skill

系统 SHALL 以仓库级普通 Skill `skills/send-cr/` 提供 Send CR，并在 `dsh.yaml` 声明
`type: skill` 条目，随 sync 幂等部署到 `~/.dsh/skills/send-cr`。它与 `skills/ws`
同等角色：可在任意普通 DSH 会话中独立使用，也可被用户导入 Pet 后作为能力消费。

该 Skill SHALL 是一个不含任何 Pet 专属声明的普通 Skill，其 frontmatter 只包含
DSH 通用字段（`name`/`description`/`whenToUse`）。它 MUST NOT 依赖 Pet 提供的任何
特殊呈现或门禁，因此在普通会话与 Pet 中的行为一致。

#### Scenario: 随 sync 部署
- **WHEN** manifest 含 send-cr 条目且 `skills/send-cr/SKILL.md` 存在
- **THEN** `node scripts/sync.mjs` 幂等同步到 `~/.dsh/skills/send-cr`，二次运行无漂移

#### Scenario: 在普通会话中独立使用
- **WHEN** 用户在一个普通 DSH 会话中调用 `/send-cr`
- **THEN** Skill 正常加载并执行，不要求 Pet 存在

#### Scenario: 被 Pet 导入消费
- **WHEN** 用户在 Pet Settings → Skills 导入 `~/.dsh/skills/send-cr` 并启用
- **THEN** 它出现在 Pet 能力列表，标签为 `send-cr`，描述取自其 `description`

### Requirement: Send CR 自行校验执行前提

Pet 不为任何能力施加上下文门禁，因此 Skill SHALL 自行把关执行前提：正文 SHALL
要求 Agent 在执行开始时调用 `pet_context`（在 Pet 中运行时）确认来源快照，并在
缺少所需信息时停下来询问用户，而不是继续猜测。在普通会话中运行（无 `pet_context`）
时，SHALL 依据用户当前提供的信息执行同样的校验。

Skill SHALL 从 `$DSH_PET_CR_GROUP` 读取目标群。该变量由 Pet 按「workspace 覆盖
全局」的优先级解析后注入，Skill 只读取最终值，MUST NOT 自行判断其来自哪个作用域，
也 MUST NOT 尝试读取其它作用域的值。该变量不存在或为空时 SHALL 停止并提示用户去
Pet 设置的「环境变量」页配置（全局或对应 workspace 均可），或由用户在本次对话中
明确给出目标群。Skill MUST NOT 发明、猜测或复用无关上下文中出现过的群 id。

#### Scenario: 变量缺失时停止
- **WHEN** `$DSH_PET_CR_GROUP` 未设置且用户未给出目标群
- **THEN** Skill 停止并说明缺少目标群配置及配置位置，不向任何群发送

#### Scenario: 缺少 MR 链接
- **WHEN** 用户未提供 MR 链接且无前序产出可用
- **THEN** Skill 询问用户，不编造链接

### Requirement: Send CR 发送前必须用户确认

Skill SHALL 在调用发送命令前向用户展示完整消息文本与目标群，并等待用户明确确认；
未确认 MUST NOT 发送。消息不可撤回，因此这是强制步骤。

#### Scenario: 展示并等待确认
- **WHEN** Agent 已确定消息与目标但尚未发送
- **THEN** Agent 展示两者并等待用户确认，确认前不执行发送命令

#### Scenario: 用户拒绝
- **WHEN** 用户拒绝发送
- **THEN** Agent 停止并如实报告，不绕过确认

### Requirement: Send CR 经 lark-cli 有界发送

Skill SHALL 使用 `lark-cli im +messages-send` 发送，`--chat-id` 取
`$DSH_PET_CR_GROUP` 或用户确认的值。`--idempotency-key` SHALL 由当前 Invocation id
派生（≤50 字符），使重试不重复投递。发送后 SHALL 回显实际使用的 chat id 供核验；
失败 SHALL 如实报告 CLI 错误，不伪造成功、不改用其它目标重试。

完成一次 Send CR 不结束所属 Pet Task。

#### Scenario: 发送成功
- **WHEN** 用户确认且 lark-cli 返回成功
- **THEN** Skill 报告成功并回显 chat id 与消息摘要

#### Scenario: 发送失败
- **WHEN** lark-cli 返回错误（群不存在、权限不足等）
- **THEN** Skill 如实报告该错误，不伪造成功也不换目标重试

#### Scenario: lark-cli 不可用
- **WHEN** 本机没有 lark-cli
- **THEN** Skill 明确说明该前提缺失并停止，不替换为其它发送机制
