## Why

Worktree Session 目前只按**文件存在性**判定项目类型：仓库根同时存在 `package-lock.json` 与 `pnpm-lock.yaml` 即返回 `UNSUPPORTED_PROJECT` 并前置拒绝（`packages/worktree-session/src/host/project.ts:18`）。fail-closed 本身是正确的不变量，但它把**真混合**（两套锁都被仓库维护）和**误留**（一套锁被 git 跟踪、另一套只是本机跑过一次 `npm install` 的未跟踪残留）当成同一件事。

真实命中：`dev-infra-server` 从 `feat: init` 起就是 pnpm workspace（`pnpm-workspace.yaml` 含 pnpm 10 专有 `allowBuilds`，`pnpm-lock.yaml` 覆盖 `.` 与 `packages/web` 两个 importer，CI 只跑 `pnpm install --frozen-lockfile`），历史上有人加过 `package-lock.json`（`afe1772`）并在同一天通过 MR !83 显式 revert（`08578e6`）。用户本机残留的那份 `package-lock.json` 未被 git 跟踪、`origin/master` 与 `HEAD` 都不含它，仓库意图毫无歧义，但 Worktree Session 仍拒绝启动，只能手工删文件才能继续。

git 跟踪状态是一个**客观、零猜测**的意图信号。当前实现没有采集它，于是在意图其实可证明的场景下也停在"无法证明"。

## What Changes

- `detectPackageManager()` 在两个 lockfile 同时存在时，不再无条件拒绝，而是先采集**可证明的意图信号**并按固定优先级裁决：
  1. `package.json` 的 `packageManager` 字段（Corepack 标准声明）若指向 npm 或 pnpm，直接采信；
  2. 否则比较两个 lockfile 的 git 跟踪状态，恰好一个被跟踪时采信被跟踪的那个；
  3. 两个信号都无法区分（都被跟踪、都未被跟踪、或 `packageManager` 指向 yarn/bun 等不支持的管理器）时，**维持现有 `UNSUPPORTED_PROJECT` 前置拒绝**。
- 混合场景被采信时，诊断不静默：系统需要把"采信了哪个、依据哪个信号、另一个 lockfile 被忽略"作为可见信息暴露，避免用户以为两套锁都在生效。
- 单 lockfile、无 lockfile 与非 git 仓库（含 git 查询失败）的现有行为完全不变；git 查询失败在混合场景下退化为"无信号"，即继续拒绝，而不是猜测。
- 不改变 fail-closed 不变量：裁决全部发生在创建任何 operation 文件、task branch、worktree 或绑定**之前**，被拒绝的请求仍不留任何半成品资源。
- 非目标：不新增对 yarn/bun/rush 的支持；不改变依赖指纹、lean/promote 语义或 wire/持久格式；不为混合仓库同时准备两套依赖。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `source-workspace-worktree-session`: 「Project type is resolved before any Worktree resource is created」需求当前规定"二者同时存在或均不存在时……拒绝请求"。改为：均不存在时仍拒绝；二者同时存在时先按 `packageManager` 字段与 git 跟踪状态裁决，仅在无可证明信号时拒绝，并要求采信结果对用户可见。

## Impact

- `packages/worktree-session/src/host/project.ts`：`detectPackageManager()` 签名与实现（需要 git 查询能力与 `package.json` 读取，因此从纯 fs 判定变为可注入 `GitClient`/`ProcessRunner` 的判定）。
- `packages/worktree-session/src/host/operation.ts:126`：唯一调用点，需按新签名传入 git 依赖。
- `packages/worktree-session/src/host/git.ts`：可能新增一个"路径是否被跟踪"的查询（`git ls-files --error-unmatch`）。
- `packages/worktree-session/test/project.test.ts`：新增混合场景用例（tracked+untracked 两种朝向、都 tracked、都 untracked、`packageManager` 字段优先、git 失败退化拒绝）。
- `skills/ws/SKILL.md:135` 与 `packages/worktree-session/README.md`：混合 lockfile 的说明需与新行为一致。
- 不影响 `dsh.yaml`、sync 物化流程与部署产物；不影响 npm/pnpm 已有的依赖准备与 promote 路径。
