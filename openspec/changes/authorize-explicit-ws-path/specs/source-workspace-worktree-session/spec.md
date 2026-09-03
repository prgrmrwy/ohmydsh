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
模型可见的 `ws` 工具在 Agent 调用携带非空显式 `path` 时，SHALL 通过 DSH 平台 approval 能力向用户发起一次性授权询问，询问 MUST 明确包含被请求的 action 与确切路径，并关联到该次工具调用。仅当结果为一次性授权（`allowed-once`）时，系统 SHALL 将该显式路径作为本次调用的目标来源；`rejected`、`cancelled`、`unavailable` 及会话 approval policy 为 `never` 时，系统 MUST 拒绝该调用并保持与既有无授权拒绝一致的 fail-closed 行为，不得扫描、修改或删除任何 Worktree Session 资源。授权 MUST 只对当次调用生效，不得建立任何持久放权。省略 `path` 或空字符串 `path`（wire 兼容形态）的调用 MUST 保持既有解析语义完全不变。

#### Scenario: User grants one-shot authorization for an explicit path
- **WHEN** Agent 调用 `ws` 携带非空显式 `path`，用户对授权询问回答 `allowed-once`
- **THEN** 系统 SHALL 以该路径作为本次调用的目标来源继续执行，且后续全部既有安全门逐项照常评估

#### Scenario: User rejects the authorization
- **WHEN** Agent 调用 `ws` 携带非空显式 `path`，授权结果为 `rejected` 或 `cancelled`
- **THEN** 系统 SHALL 拒绝本次调用并返回明确诊断，不得对任何 Worktree Session 资源产生读写以外的影响

#### Scenario: No answerer is available or policy is never
- **WHEN** Agent 调用 `ws` 携带非空显式 `path`，而会话无可用 approval answerer（`unavailable`）或 approval policy 为 `never`
- **THEN** 系统 SHALL 确定性拒绝本次调用（fail closed），行为与授权被拒绝一致

#### Scenario: Authorization does not bypass safety gates
- **WHEN** 用户已对显式路径授权 `allowed-once`，但目标候选未通过既有安全门（如 dirty、active、in-flight、未归档、未合并或 schema 不支持）
- **THEN** 系统 SHALL 按既有安全门语义拒绝该候选并报告原因；授权 MUST 不构成任何安全门的豁免

#### Scenario: Authorization is single-use
- **WHEN** 同一 Agent 在一次 `allowed-once` 授权后再次调用 `ws` 携带显式 `path`
- **THEN** 系统 SHALL 重新发起授权询问，不得复用先前授权

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

### Requirement: Explicit-path authorization is audited on the calling session
每次显式路径授权询问及其结果 SHALL 通过平台既有 approval 审计事件成对记录在发起调用的会话日志中，包含工具名、关联的工具调用与包含确切路径的原因说明；系统 MUST 不在无审计记录的情况下采纳任何显式路径。

#### Scenario: Ask and outcome are logged as a pair
- **WHEN** Agent 携带显式 `path` 调用 `ws` 触发授权询问
- **THEN** 调用会话日志 SHALL 出现成对的 approval 审计事件，且原因说明包含被请求的 action 与确切路径

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
