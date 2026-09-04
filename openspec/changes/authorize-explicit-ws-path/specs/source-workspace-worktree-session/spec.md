## ADDED Requirements

### Requirement: Agent explicit ws path is model-visible and gated by authorization
模型可见的 `ws` 工具 SHALL 在其参数 schema 中声明可选的 `path` 参数，使该通道可被发现，而不依赖“参数根开放、未声明参数亦可到达执行”的未公开行为；参数描述 MUST 说明它接受绝对路径且每次使用都需要用户一次性授权。工具描述 MUST 相应说明显式路径对 Agent 可用但受授权把关，不得再表述为仅经 `dsh-ws` 或 Skill shell wrapper 可用。

#### Scenario: Explicit path is discoverable in the tool schema
- **WHEN** 模型读取 `ws` 工具的参数 schema
- **THEN** schema SHALL 包含可选的 `path` 参数，且其描述说明该路径需要用户一次性授权

#### Scenario: Operator CLI remains available unchanged
- **WHEN** operator 使用 `dsh-ws` 或 Skill shell wrapper 的显式路径命令
- **THEN** 系统 SHALL 按既有 operator 语义执行，不因模型可见 `path` 的引入而改变目标解析或安全门

### Requirement: Agent explicit ws path is trusted only through one-shot user authorization
模型可见的 `ws` 工具在 Agent 调用携带非空显式 `path` 时，SHALL 通过 DSH 平台的用户提问能力（`ctx.userQuestions`）向用户发起一次性确认，询问 MUST 明确包含被请求的 action 与确切路径，并提供可直接选择的同意与拒绝选项。系统 MUST NOT 使用 approval（沙箱提权授权）能力承载该确认：该能力在 `danger-full-access` 部署下 policy 为 `never`，会在无人应答的情况下自动拒绝，使确认在最需要它的部署中不可达。仅当用户明确选择同意项时，系统 SHALL 将该显式路径作为本次调用的目标来源；用户拒绝、未作答、仅给出自由文本、无可用提问 provider 或询问抛错时，系统 MUST 拒绝该调用并保持与既有拒绝一致的 fail-closed 行为，不得扫描、修改或删除任何 Worktree Session 资源。同意 MUST 只对当次调用生效，不得建立任何持久放权。省略 `path` 或空字符串 `path`（wire 兼容形态）的调用 MUST 保持既有解析语义完全不变。

#### Scenario: User agrees to an explicit path
- **WHEN** Agent 调用 `ws` 携带非空显式 `path`，用户在确认中选择同意项
- **THEN** 系统 SHALL 以该路径作为本次调用的目标来源继续执行，且后续全部既有安全门逐项照常评估

#### Scenario: User declines the confirmation
- **WHEN** Agent 调用 `ws` 携带非空显式 `path`，用户选择拒绝项
- **THEN** 系统 SHALL 拒绝本次调用并返回明确诊断，不得对任何 Worktree Session 资源产生读写以外的影响

#### Scenario: Confirmation is unreachable or unanswered
- **WHEN** 会话未组合用户提问 provider、询问抛错（如步骤被中止），或用户未选择任何选项
- **THEN** 系统 SHALL 确定性拒绝本次调用（fail closed），且 MUST NOT 把沉默或自由文本当作同意

#### Scenario: Full-access deployment still receives the prompt
- **WHEN** 部署以 `danger-full-access` 运行（approval policy 为 `never`），Agent 调用 `ws` 携带非空显式 `path`
- **THEN** 系统 SHALL 仍通过用户提问能力向用户展示确认，MUST NOT 因 approval policy 而自动拒绝

#### Scenario: Agreement does not bypass safety gates
- **WHEN** 用户已同意显式路径，但目标候选未通过既有安全门（如 dirty、active、in-flight、未归档、未合并或 schema 不支持）
- **THEN** 系统 SHALL 按既有安全门语义拒绝该候选并报告原因；同意 MUST 不构成任何安全门的豁免

#### Scenario: Agreement is single-use
- **WHEN** 同一 Agent 在一次同意后再次调用 `ws` 携带显式 `path`
- **THEN** 系统 SHALL 重新发起确认，不得复用先前同意

#### Scenario: Omitted or empty path keeps existing resolution
- **WHEN** Agent 调用 `ws` 省略 `path` 或传入空字符串
- **THEN** 系统 SHALL 按既有语义解析目标（`status`/`promote` 按调用 Session binding，`clean` 按调用 Session 主 checkout cwd），且 MUST 不发起授权询问

### Requirement: Authorized explicit path selects existing target semantics per action
一次性授权通过后，显式路径 MUST 只替换“目标来源信任”，不得引入新的目标语义：`clean` 携带授权路径 SHALL 等价于从该路径对应仓库主 checkout 的普通无绑定 Session 发起的仓库级清理扫描（含既有主 checkout 校验、归档前置条件、逐项安全门与批量汇总）；`status` 与 `promote` 携带授权路径 SHALL 等价于既有显式路径 operator 维护的单 operation 语义。授权路径无法被证明为有效目标（非仓库主 checkout、无有效 operation metadata 等）时，系统 MUST 按既有诊断拒绝。

#### Scenario: Authorized clean scans the named repository main checkout
- **WHEN** 用户授权后，`ws clean` 以某仓库主 checkout 的绝对路径为 `path` 执行
- **THEN** 系统 SHALL 对该仓库执行与主 checkout 普通 Session 发起完全一致的仓库级扫描与批量清理，逐项报告 cleaned/refused/ignored

#### Scenario: Authorized clean path is not a repository main checkout
- **WHEN** 用户授权的 `path` 不能被证明精确对应某仓库主 checkout
- **THEN** 系统 SHALL 拒绝整次清理并返回明确诊断，不得扫描或删除任何 Worktree Session 资源

#### Scenario: Authorized status or promote targets one operation
- **WHEN** 用户授权后，`ws status` 或 `ws promote` 以有效 worktree 绝对路径为 `path` 执行
- **THEN** 系统 SHALL 按既有显式路径单 operation 语义解析并执行，安全门与诊断不变

### Requirement: The confirmation is answerable and self-evident to the user
每次显式路径确认 SHALL 由发起调用的会话中的真人作答，询问 MUST 自带判断所需的全部事实（被请求的 action 与确切绝对路径），MUST NOT 要求用户另行查阅上下文才能理解自己在批准什么，且 MUST 提供可直接选择的拒绝项，使拒绝无需输入自由文本。询问与作答由平台用户提问能力记录在该会话的对话中，构成可回溯的决定记录；系统 MUST NOT 在没有用户明确同意的情况下采纳任何显式路径。

#### Scenario: The question carries the deciding facts
- **WHEN** Agent 携带显式 `path` 调用 `ws` 触发确认
- **THEN** 询问 SHALL 包含被请求的 action 与确切路径，并说明同意仅对本次调用生效

#### Scenario: Declining requires no free text
- **WHEN** 用户希望拒绝一次显式路径确认
- **THEN** 询问 SHALL 提供可直接选择的拒绝项，且选择它 MUST 使调用按 fail-closed 拒绝

## MODIFIED Requirements

### Requirement: Repository cleanup is initiated from an ordinary main-checkout Session
模型可见的 `ws clean` SHALL 从调用 Session 的仓库主 checkout 发起仓库级清理，而不是要求调用 Session 自身具有 Worktree Session binding。调用 Session MUST 是 cwd 精确对应仓库主 checkout、且没有当前 Worktree Session binding 的普通 Session。系统 SHALL 只扫描该仓库的 Worktree Session operation；未经用户一次性授权时，不得接受模型指定任意路径、其他 Session 或其他仓库作为清理目标，经用户一次性授权的显式路径 SHALL 按授权路径目标语义处理。`ws status` 与 `ws promote` MUST 继续按当前调用 Session binding 解析目标（授权显式路径除外）。

#### Scenario: Ordinary main Session starts repository cleanup
- **WHEN** 一个 cwd 精确对应仓库主 checkout、且没有 Worktree Session binding 的普通 Session 调用 `ws clean`
- **THEN** 系统 SHALL 扫描该仓库的 Worktree Session operation，而不得因调用 Session 没有 binding 报错

#### Scenario: Bound Worktree Session attempts cleanup
- **WHEN** 一个仍具有当前 Worktree Session binding 的 Session 调用 `ws clean` 且未携带经授权的显式 `path`
- **THEN** 系统 SHALL 拒绝清理自身及其他任务，并明确提示用户切换到同仓库的普通主仓 Session 执行清理

#### Scenario: Unbound caller is not at the main checkout
- **WHEN** 一个无 binding Session 的 cwd 不能被证明精确对应仓库主 checkout，且调用未携带经授权的显式 `path`
- **THEN** 系统 SHALL 拒绝整次清理，且不得扫描或删除任何 Worktree Session 资源

#### Scenario: Status and promote retain binding semantics
- **WHEN** 无 Worktree Session binding 的普通主仓 Session 调用 `ws status` 或 `ws promote` 且未携带经授权的显式 `path`
- **THEN** 系统 SHALL 保持现有无绑定诊断，且不得把这两个动作改为仓库级扫描
