## MODIFIED Requirements

### Requirement: Project type is resolved before any Worktree resource is created
系统 SHALL 在创建任何 operation 文件、task branch、worktree 或绑定之前，依据仓库根目录的 lockfile 解析项目类型：仅存在 `package-lock.json`（npm）、仅存在 `pnpm-lock.yaml`（pnpm）。

二者同时存在时，系统 SHALL NOT 直接拒绝，而是先按以下固定优先级采集**可证明的仓库意图信号**：

1. 仓库根 `package.json` 的 `packageManager` 字段：其声明的包管理器为 npm 或 pnpm 时，系统 SHALL 采信该声明；
2. 否则比较两个 lockfile 的版本控制跟踪状态：恰好一个被仓库跟踪时，系统 SHALL 采信被跟踪的那个 lockfile 对应的包管理器；
3. 以上信号均无法区分时（两个 lockfile 都被跟踪、都未被跟踪、`packageManager` 声明的是不支持的包管理器、或跟踪状态无法查询），系统 SHALL 拒绝请求。

二者均不存在时，系统 SHALL 拒绝请求。

被拒绝的请求 SHALL 返回明确诊断，MUST NOT 创建或修改任何 Git 资源、operation 文件或绑定，且不发送首条消息。裁决 SHALL 全部发生在创建任何资源之前，无论结果是采信还是拒绝。

#### Scenario: Unsupported project refuses before any resource
- **WHEN** 空白 Session 的仓库根目录既无 `package-lock.json` 也无 `pnpm-lock.yaml`，用户启用 Worktree 并发送首条消息
- **THEN** 系统 SHALL 返回明确的 `UNSUPPORTED_PROJECT` 诊断（说明仅支持 npm/pnpm 锁文件项目），且不创建 task branch、worktree、operation 文件或绑定

#### Scenario: Mixed lockfiles adopt the tracked one
- **WHEN** 仓库根目录同时存在 `package-lock.json` 与 `pnpm-lock.yaml`，其中恰好一个被仓库跟踪、另一个未被跟踪，且 `package.json` 未声明 `packageManager`
- **THEN** 系统 SHALL 将被跟踪的那个 lockfile 对应的包管理器识别为项目类型并继续既有启动流程，未被跟踪的 lockfile SHALL 被忽略且不参与依赖指纹计算

#### Scenario: Mixed lockfiles defer to the packageManager declaration
- **WHEN** 仓库根目录同时存在两个 lockfile，且 `package.json` 的 `packageManager` 字段声明了 npm 或 pnpm
- **THEN** 系统 SHALL 采信该声明作为项目类型，即使跟踪状态指向另一个包管理器

#### Scenario: Mixed lockfiles refuse with a clear diagnostic
- **WHEN** 仓库根目录同时存在 `package-lock.json` 与 `pnpm-lock.yaml`，且二者跟踪状态相同（都被跟踪或都未被跟踪），且 `package.json` 未声明受支持的 `packageManager`
- **THEN** 系统 SHALL 在创建任何资源前拒绝请求并返回明确诊断，说明存在混合 lockfile 且无法判定仓库意图，且不创建 task branch、worktree、operation 文件或绑定

#### Scenario: Unqueryable tracking state refuses instead of guessing
- **WHEN** 仓库根目录同时存在两个 lockfile，`package.json` 未声明受支持的 `packageManager`，且跟踪状态无法查询（例如目标不是 Git 工作树或查询失败）
- **THEN** 系统 SHALL 拒绝请求并返回明确诊断，MUST NOT 退化为任何默认包管理器

#### Scenario: npm project is recognized unchanged
- **WHEN** 仓库根目录存在 `package-lock.json`
- **THEN** 系统 SHALL 按 npm 项目继续既有启动流程，行为与变更前一致

#### Scenario: pnpm project is recognized
- **WHEN** 仓库根目录存在 `pnpm-lock.yaml`
- **THEN** 系统 SHALL 将该项目识别为 pnpm 项目并继续按其语义执行后续准备工作

## ADDED Requirements

### Requirement: An adopted mixed-lockfile resolution is visible, never silent
当系统在混合 lockfile 场景下采信某个包管理器并继续启动时，系统 SHALL 使该裁决对用户可见：记录采信的包管理器、依据的信号（`packageManager` 声明或跟踪状态）以及被忽略的 lockfile。该信息 SHALL 随 operation 一起持久化，使用户在启动后仍可复核为何只有一套锁生效。可见性 MUST NOT 改变启动是否成功，也 MUST NOT 阻塞首条消息。

#### Scenario: Adoption is recorded on the operation
- **WHEN** 系统按跟踪状态或 `packageManager` 声明采信了混合 lockfile 中的一个
- **THEN** 该 operation 的持久诊断 SHALL 包含采信的包管理器、依据的信号与被忽略的 lockfile 名称

#### Scenario: Single-lockfile projects add no noise
- **WHEN** 仓库根目录只存在一个受支持的 lockfile
- **THEN** 系统 SHALL NOT 记录任何混合 lockfile 裁决信息
