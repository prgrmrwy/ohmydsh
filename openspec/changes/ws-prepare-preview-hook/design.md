## Context

动机见 proposal.md。与设计相关的现状：

- ws start 的 `performStart`（`packages/worktree-session/src/host/operation.ts`）按以下阶段推进：`allocated → branch-created → worktree-created → dependencies-ready → environment-ready → prepared`。`prepareEnvironment`（`environment.ts:40-55`）对所有仓库一视同仁：把主 checkout 的 `.env.local` 复制到 worktree，写入托管块 `DSH_HOME=<git-common-dir>/ws/dsh-home/<operationId>`，并创建这个空目录。
- operation 元数据可以持久化。start、promote、clean 以及释放、归档等状态迁移，全部共用一把仓库级的锁 `ws/locks/repo.lock`（`operation.ts:119`、`maintenance.ts:74,126`）。等锁上限 30 秒，超过 5 分钟未释放的锁会被当作失效锁强行清除（`fs.ts:41-70`）。任何可能长时间运行的步骤都不能放进这把锁。
- ws clean 不删除 `dsh-home/<id>`。

## Goals / Non-Goals

**Goals:**
- 给接入仓库一个稳定、与项目无关、完全可选的扩展点，用于在验收前准备环境、在清理前收尾。
- hook 的执行可预期：只在显式调用时运行，只运行 Git 已跟踪的版本，结果可观测，失败不影响 worktree。
- 隔离 home 的生命周期由 ws 负责收尾。

**Non-Goals:**
- 不包含任何仓库的具体准备逻辑（复制什么、怎么启动预览）。这些由接入方各自的 change 负责。
- 不提供端口分配、进程管理等预览运行时能力。预览端口与项目的启动方式强相关（DSH launcher 和 cockpit 的 dev server 不同），由接入方处理。
- 不安装 git 原生 hook；ws start 也不自动执行 hook。
- 不批量清理已存在的历史隔离 home。

## Decisions

### D1：按需触发，不挂在 ws start 上

hook 只由显式的 `ws prepare-preview` 动作触发，ws start 的阶段机不变。理由：
- hook 的目的是准备验收环境。很多 worktree 只是改代码，不需要预览。按需执行不会让 ws start 变慢，也不会让它因为接入方脚本失败而失败。
- 接入方准备的快照（比如凭据）越接近验收时刻越新。
- 已经存在的 worktree 和新建的 worktree 走同一条路径，不需要迁移。

否决的备选方案：
- 在 start 中新增一个自动执行的阶段：每个 worktree 都会执行，与"有验收需要才准备"相悖。
- git post-checkout hook：`.git/hooks` 不受版本管理；切分支时也会触发；执行时还没写好 DSH_HOME；失败也不会进入 ws 的记录。

### D2：hook 契约（对接入方公开）

- **可选**：仓库不声明任何 hook 时，ws 行为与现在完全一致。`prepare-preview` 返回 `skipped`；clean 跳过 teardown。
- **位置**：固定为 `<worktree>/.ws/prepare-preview` 和 `<worktree>/.ws/teardown-preview`，不提供覆盖配置。目前所有接入方都能直接使用 `.ws/`；等真的有接入方需要其它位置时再加（评审第 7 项）。
- **执行判定**：`git ls-files --error-unmatch <path>` 成功，`lstat` 为普通文件且不是链接，并具有可执行位。文件不存在视为未声明，返回 `skipped`；文件存在但不满足条件时返回 `failed` 并写明原因，不执行。
- **执行方式**：`spawn(path, [], { cwd: worktree, shell: false, env })`。prepare-preview 超时 5 分钟，teardown-preview 超时 30 秒，超时后终止进程组。stdout 和 stderr 合并，只保留最后 4 KB。
- **环境变量**：全部取自持久化的 operation 记录和 Host 本身，不从 worktree 中的文件推断。
  - `WS_SOURCE_REPO` = `operation.repoRoot`
  - `WS_WORKTREE` = `operation.worktreePath`
  - `WS_GIT_COMMON_DIR` = `operation.gitCommonDir`
  - `WS_OPERATION_ID` = `operation.operationId`
  - `WS_DSH_HOME` = `operation.dshHome`
  - `WS_SOURCE_DSH_HOME` = 运行 ws 的 Host 进程自身的 DSH home（`process.env.DSH_HOME`，未设置时为 `~/.dsh`）
  - `WS_HOOK` = `prepare-preview` 或 `teardown-preview`，方便接入方用同一个脚本处理两个阶段
  - `DSH_HOME` 被覆盖为 `operation.dshHome`。Host 进程的 `DSH_HOME` 指向真实 home，如果原样继承，hook 里任何调用 DSH 工具的地方都会误写真实环境。
  - 其余环境变量从 Host 进程继承。
- **对接入方的要求**（写进 README，ws 不做强制检查）：幂等；只写 worktree 和 `WS_DSH_HOME`；需要写入的位置自行做路径校验；teardown 只停止本 worktree 自己的进程。
- **拒绝条件（prepare-preview）**：Session 未绑定、绑定已 cleaned，或 operation 的 phase 不是 `prepared` 时，拒绝执行，也不写元数据。
- **隔离 home 缺失**：执行 prepare-preview 前，如果 `operation.dshHome` 不存在，先确认它位于 `<gitCommonDir>/ws/dsh-home/` 下、basename 等于 operationId、上级目录不是链接，再以 0700 权限 `mkdir` 重建。这样用户手工删掉目录后，不会因为"找不到"而失败。
- **加锁方式**（评审第 3 项）：hook 绝不在仓库锁内运行。分三步：
  1. 短暂持有仓库锁：读取 operation，校验绑定和 phase，必要时重建隔离 home，然后释放。
  2. 不持锁执行 hook。同一 worktree 的互斥改用独占文件 `ws/locks/preview-<operationId>.lock`（复用 `touchExclusive`，`fs.ts:73`）：已存在就立即拒绝，hook 结束后删除。进程崩溃后残留的文件，以其中记录的 pid 是否存活来判断，不按时间判断，避免误删仍在运行的 hook 的锁。
  3. 短暂持有仓库锁：重新读取 operation，确认它仍是同一个绑定且未被 clean，再写入 `preview: {status, exitCode, outputTail, at}`。如果期间已被 clean，就丢弃这次结果，不写入。
  - 只更新 `preview` 这一个字段，不改变 phase、branch、依赖模式或绑定。

### D3：动作接入

在 tool schema 的 action 枚举、`dsh-ws` CLI 和 `skills/ws` 中加入 `prepare-preview`。目标解析与 `promote` 相同：默认取当前绑定；带显式 path 时走现有的一次性授权。tool 描述写明"仅在需要验收或预览时调用；具体做什么由仓库的 `.ws/prepare-preview` 决定"。`ws status` 在没有 `preview` 字段时显示"未准备"。

### D4：clean 的 teardown 与删除隔离 home

现有 clean 的顺序（`maintenance.ts`）：在仓库锁内依次检查 cwd、活动 Session、绑定、phase、dirty、合并证明 → 删除 worktree → 删除 branch → 写 cleaned tombstone。新增的两步插入在这个流程中：

1. **teardown-preview**：放在所有安全门之后、`git worktree remove` 之前。它处在 clean 的仓库锁内，所以超时只有 30 秒（评审第 4 项）。这个值和 launcher 停止进程最多 20 秒的上限（`process.mjs:163`）相当，再长就会拖住其它 ws 操作；批量清理时，每个候选也各自受这 30 秒约束。此时 worktree 和 hook 文件都还在，接入方可以读取自己的 `preview.json` 等记录来停止进程。按用户决定，**失败只告警，不阻断清理**：结果的 `warnings` 中写明原因和输出摘要，并提示"该 worktree 的预览进程可能仍在运行，请手动确认"。dry-run 时只列入 `actions`，不执行。
2. **删除隔离 home**：放在 worktree 删除成功之后。校验三项：realpath 位于 `<gitCommonDir>/ws/dsh-home/` 下；basename 等于 operationId；`lstat` 不是链接。三项都通过才执行 `rm -r`，结果写入报告。目录已不存在时按已删除处理；校验不通过时跳过并报告，不影响清理结论。

**删除后会不会出现"找不到"**（已对照代码核对）：
- cleaned 之后，`dshHome` 只作为 tombstone 中的审计字段保留。`validateResource` 只在 phase 为 `environment-ready` 或 `prepared` 时检查目录是否存在（`operation.ts:92-97`），而 cleaned 的 phase 不会走到这条分支。会话释放成普通 Session 的流程也不读取 dshHome。因此删除不会引发"找不到"。
- 清理被拒绝时，流程不会走到上面两步，目录原样保留。
- 未清理、但目录被手工删除的情况，由 D2 的"隔离 home 缺失则重建"处理。
- 清理时预览进程仍在运行的情况，由 teardown 处理；teardown 失败时，残留进程会被明确告警，不会静默发生。

## Risks / Trade-offs

- [执行仓库脚本] → 只在显式调用时执行，且只执行 Git 已跟踪、非链接的版本，信任边界与 `npm install` 的 lifecycle 脚本一致；`ws status` 记录最近一次结果。
- [接入方脚本写到 worktree 和隔离 home 以外的地方] → ws 无法从机制上阻止（hook 以用户权限运行）。通过把 `DSH_HOME` 覆盖为隔离 home、提供明确的环境变量，降低误写的可能；契约要求接入方自行做路径校验。
- [hook 卡住] → prepare-preview 5 分钟超时、teardown 30 秒超时，到时终止进程组，记为 failed。prepare-preview 不持有仓库锁，卡住时只影响它自己的 worktree。
- [teardown 失败后仍清理，残留预览进程] → 用户选择不阻断清理。结果中给出明确告警和进程排查提示；残留进程写日志可能在原路径重新创建目录，属于已知、可见的风险。

## Migration Plan

1. 实现并通过包内的 typecheck、test、build。用一个 fixture 仓库覆盖 hook 契约的各个场景。
2. 合入后，接入方 change（如 `ohmydsh-worktree-preview`）才能真正落地使用。
3. 回滚：从 action 枚举中移除 `prepare-preview`。clean 删除 home 是独立的改进，保留。
