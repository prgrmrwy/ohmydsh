## ADDED Requirements

### Requirement: Repository preview hooks are optional
仓库 MAY 声明两个预览 hook，路径固定为 worktree 下的 `.ws/prepare-preview` 与 `.ws/teardown-preview`。两者都是可选的；仓库不声明时，ws 的所有既有行为 MUST 保持不变。

hook 文件只有同时满足以下条件时，系统才 SHALL 执行：是 Git 已跟踪的普通文件、可执行、不是符号链接。文件不存在时视为未声明。文件存在但不满足条件时，MUST NOT 执行，并报告原因。

#### Scenario: Repository with no hooks is unaffected
- **WHEN** 仓库既没有 `.ws/` 目录，也没有任何 hook
- **THEN** ws start、status、promote、clean 的行为与引入本能力之前完全一致；调用 `ws prepare-preview` 时 SHALL 报告 `skipped`，并说明该仓库未声明 prepare-preview，不视为错误

#### Scenario: Untracked or symlinked hook is not executed
- **WHEN** hook 文件未被 Git 跟踪，或是符号链接
- **THEN** 系统 MUST NOT 执行它，并报告失败原因

### Requirement: Prepare-preview runs only on demand with a fixed context
ws start MUST NOT 执行任何仓库 hook，其流程与产物保持不变。`ws` SHALL 提供 `prepare-preview` 动作，对调用 Session 当前绑定的 worktree 执行 prepare-preview hook，cwd 为 worktree，并施加有限超时。

hook 的执行环境：
- 系统 SHALL 通过环境变量 `WS_SOURCE_REPO`、`WS_WORKTREE`、`WS_GIT_COMMON_DIR`、`WS_OPERATION_ID`、`WS_DSH_HOME` 传入取自持久 operation 记录的上下文，并通过 `WS_SOURCE_DSH_HOME` 传入运行 ws 的 Host 自身的 DSH home。
- hook 进程环境中的 `DSH_HOME` MUST 被设置为该 worktree 的隔离 home，不得继承 Host 的真实 home。
- 隔离 home 目录不存在时，系统 SHALL 先确认其路径位于 `<git-common-dir>/ws/dsh-home/` 下且目录名与 operationId 一致，然后以仅所有者可访问的权限重建该目录，再执行 hook；路径校验不通过时 MUST 拒绝执行。

调用约束：
- 该动作与 status、promote 一样以当前绑定为目标；携带显式 path 时 SHALL 适用既有的一次性用户授权规则。
- 对 cleaned 或未绑定的 Session，MUST 拒绝执行。
- 该动作 MUST NOT 改变 branch、依赖模式、phase 或绑定，可重复调用。
- hook 运行期间，系统 MUST NOT 持有仓库级的 ws 锁；其它 worktree 的 start、status、promote、clean MUST 不因此等待。同一 worktree 已有 prepare-preview 在运行时，新的调用 SHALL 立即拒绝并说明原因。

#### Scenario: ws start runs no hook
- **WHEN** 仓库存在 prepare-preview hook，用户通过 ws start 创建新的 Worktree Session
- **THEN** 系统 MUST NOT 执行该 hook，隔离 DSH home 保持 start 时的状态

#### Scenario: On-demand prepare-preview receives the managed context
- **WHEN** 用户或 Agent 在绑定 Session 中调用 `ws prepare-preview`，且仓库有可执行的 hook
- **THEN** 系统 SHALL 以 worktree 为 cwd 执行它，传入的 `WS_DSH_HOME` 与 `.env.local` 托管块中的 `DSH_HOME` 一致

#### Scenario: Hook never inherits the real DSH_HOME
- **WHEN** 运行 ws 的 Host 进程以真实 home 作为 `DSH_HOME`，用户调用 `ws prepare-preview`
- **THEN** hook 进程看到的 `DSH_HOME` SHALL 等于 `WS_DSH_HOME`，真实 home 只通过 `WS_SOURCE_DSH_HOME` 提供

#### Scenario: Missing isolated home is recreated, not reported as not found
- **WHEN** 绑定仍处于 prepared 状态，但隔离 home 目录已被手工删除，用户调用 `ws prepare-preview`
- **THEN** 系统 SHALL 在同一路径以仅所有者权限重建该目录并执行 hook，MUST NOT 因目录缺失而报错

#### Scenario: A running hook does not block other worktrees
- **WHEN** 一个 worktree 的 prepare-preview hook 正在运行，用户在同一仓库对另一个 worktree 执行 ws start、promote 或 clean
- **THEN** 这些操作 SHALL 正常完成，不因等待锁而超时

#### Scenario: Concurrent prepare-preview on the same worktree is refused
- **WHEN** 同一 worktree 的 prepare-preview 尚未结束，再次调用 `ws prepare-preview`
- **THEN** 新调用 SHALL 立即返回拒绝，MUST NOT 启动第二个 hook 进程

#### Scenario: Re-run after real-home configuration changed
- **WHEN** 用户再次调用 `ws prepare-preview`
- **THEN** 系统 SHALL 重新执行 hook 并报告新的结果，不改变 branch、依赖模式或绑定

### Requirement: Prepare-preview result is recorded and visible
每次 `ws prepare-preview` 结束后，系统 SHALL 在持久 operation 元数据中记录最近一次结果，包括状态（`ok`、`failed` 或 `skipped`）、退出码、时间和截断后的输出尾部，并在 `ws prepare-preview` 的返回值与 `ws status` 中报告。

- 输出写入元数据前 MUST 截断到有限长度。
- 执行失败 MUST NOT 影响 worktree、branch 或绑定的可用性。
- 从未调用过 prepare-preview 时，`ws status` SHALL 显示未准备。

#### Scenario: Failed prepare-preview leaves a usable worktree
- **WHEN** prepare-preview hook 以非零状态退出
- **THEN** Session SHALL 仍绑定到原 worktree 并可正常工作，`ws status` 显示 prepare-preview 失败与输出摘要

### Requirement: Cleanup runs teardown-preview before removing resources
安全清理一个 Worktree Session 时，系统 SHALL 在所有安全门通过之后、删除 worktree 之前，执行该仓库的 teardown-preview hook。执行条件与环境变量与 prepare-preview 相同，超时 MUST 为不超过 30 秒的短超时，用于让接入方停止该 worktree 的预览进程。

- 仓库未声明 teardown-preview 时，SHALL 直接跳过。
- hook 失败、超时或因校验不通过而未执行时，系统 SHALL 在清理结果中给出告警，写明原因与输出摘要，然后照常继续清理。这样处理的风险是：该 worktree 的预览进程可能仍在运行，结果 MUST 明确提示用户自行确认并停止。
- 清理被安全门拒绝时，MUST NOT 执行 teardown-preview。
- dry-run 时 MUST NOT 执行 hook，只在计划动作中列出。

#### Scenario: Teardown stops the preview before the worktree disappears
- **WHEN** 一个通过安全门的 Worktree Session 被清理，仓库声明了 teardown-preview
- **THEN** 系统 SHALL 先执行 teardown-preview，再删除 worktree 与隔离 home

#### Scenario: Teardown failure warns but does not block cleanup
- **WHEN** teardown-preview 以非零状态退出或超时
- **THEN** 清理 SHALL 继续完成，并在结果中给出告警，提示预览进程可能仍在运行，需要手动确认

#### Scenario: Dry run does not execute teardown
- **WHEN** 用户执行 dry-run 清理
- **THEN** 系统 MUST NOT 执行 teardown-preview，只在计划动作中列出它

### Requirement: Cleanup removes the operation's isolated DSH home
安全清理一个 Worktree Session 时，系统 SHALL 在删除 worktree 之后，一并删除该 operation 记录的隔离 DSH home。删除的前提是同时满足以下三项：真实路径位于 `<git-common-dir>/ws/dsh-home/` 之下；目录名与 operationId 一致；不是符号链接。

- 任一项不满足时，MUST 跳过删除并在清理结果中报告，不影响 worktree 与 branch 的清理结论。
- 隔离 home 已不存在时，SHALL 视为已删除，不报错。
- 清理被安全门拒绝时，MUST NOT 删除 home。
- 清理之后，cleaned 记录中保留的 `dshHome` 仅作审计用途；状态恢复与 Session 释放 MUST NOT 要求该目录存在。

#### Scenario: Clean removes the isolated home with seeded credentials
- **WHEN** 一个通过安全门的 Worktree Session 被清理，其隔离 home 中含有 prepare-preview 播种的凭据副本
- **THEN** 系统 SHALL 删除该隔离 home 目录，并在清理结果中注明已删除

#### Scenario: Released Session does not look for the removed home
- **WHEN** 清理完成后，用户重新打开该 Session，触发既有的 cleaned 绑定释放
- **THEN** 释放流程 SHALL 正常完成，MUST NOT 因隔离 home 不存在而失败或报错

#### Scenario: Home outside the managed root is never deleted
- **WHEN** operation 记录的 `dshHome` 不在 `<git-common-dir>/ws/dsh-home/` 之下，或目录名与 operationId 不符
- **THEN** 系统 MUST NOT 删除该路径，并在清理结果中报告已跳过

#### Scenario: Refused cleanup keeps the home
- **WHEN** 清理因 dirty、活跃执行或合并证明不足被拒绝
- **THEN** 隔离 home MUST 保持原样，teardown-preview MUST NOT 被执行
