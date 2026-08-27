# Design: Worktree Session pnpm support and clear unsupported-project diagnostics

## Context

现有 `worktree-session` 只有 npm 一条依赖路径，且都在**创建 Git 资源之后**才执行：`performStart`（`src/host/operation.ts`）先 allocate branch + 建 worktree（`phase: worktree-created`），随后 `prepareDependencyCache`（`src/host/dependencies.ts:57`）直接 `readFile(package-lock.json)` 才失败。pnpm 仓库（如 `dsh-cockpit`：`pnpm@10.23.0`、`pnpm-workspace.yaml` + `pnpm-lock.yaml`、无 `package-lock.json`）必然命中 `ENOENT`，卡在 `worktree-created` 且无 binding —— 前端只显示 `ENOENT: .../package-lock.json`，用户无法定位原因。

已完成的可行性 spike（`/tmp/ws-pnpm-spike*`，pnpm 10.23.0）关键事实：

- `pnpm install --frozen-lockfile --ignore-scripts` 在完整 workspace 副本上 1.5s 完成（348 包全部从全局 store 复用）。
- pnpm 布局：根 `node_modules` 只有 `.bin`、`.modules.yaml`、`.pnpm`（虚拟存储）、`.pnpm-workspace-state-v1.json` 与根依赖链接；每个 workspace 子包有自己的 `node_modules`，其中外部依赖为相对链接（如 `rxjs -> ../../../node_modules/.pnpm/rxjs@7.8.2/node_modules/rxjs`），workspace 内部依赖为链接（如 `@dsh-cockpit/shared -> ../../../shared`，解析到 sibling 源码）——**workspace 链接必须在真实源码旁才能语义正确**。
- pnpm v10 store 为内容寻址（CAS），安装产物可能以 hardlink 共享于全局 store；对缓存树做全量 chmod 只读可能污染共享 inode。

## Goals / Non-Goals

**Goals:**

- pnpm 单包/workspace 项目可完整走通 Worktree Session：探测、指纹、lean 准备、promote、status/CLI/UI 展示。
- 项目类型在创建任何 Git 资源与 operation 文件**之前**探测并校验；不支持的（无 lockfile / 混合 lockfile / yarn / bun / rush）返回明确 `UNSUPPORTED_PROJECT` 诊断，不留半成品。
- npm 既有行为、缓存格式兼容路径与全部安全门不变。

**Non-Goals:**

- 为 yarn / bun / rush 等其他包管理器实现支持（仍为 backlog，明确诊断即可）。
- 改变 lean/mutable 的既有权限规则与 source-session 绑定协议（wire 只增不改）。
- 跨仓库通用化（仍以仓库根 lockfile 判定，不做嵌套/可选根探测）。

## Decisions

### D1：项目类型判定：仓库根 lockfile 探测，且判定发生在 allocate 之前

`detectPackageManager(repoPath)` 在 `performStart` 的 repo 校验之后、`withMkdirLock` 的 allocate 之前调用（replay 路径对已存在 operation 跳过探测，沿用其记录值）：

- `package-lock.json` 存在 → `npm`
- `pnpm-lock.yaml` 存在 → `pnpm`
- 两者都不存在 → `WsError('UNSUPPORTED_PROJECT', '项目根目录缺少 package-lock.json 或 pnpm-lock.yaml：Worktree Session 目前仅支持 npm 或 pnpm 项目')`，不写 operation 文件、不建任何 Git 资源。
- 同时存在 → `WsError('UNSUPPORTED_PROJECT', '同时存在 package-lock.json 与 pnpm-lock.yaml：不支持混合 lockfile，请删除其中一个')`。

备选：在 `dependencies-ready` 阶段才探测（改动小）→ 否决：仍留下 worktree/branch 半成品，违背 fail-closed 早退；且复用 replay 校验逻辑简单。

### D2：pnpm lean 策略：worktree 内按 lockfile 真实安装，共享性由 pnpm 全局 store 提供

不为 pnpm 建立"克隆安装树 + symlink"式的共享缓存目录（npm 的 `cacheNodeModules` 模型）。原因：pnpm 的虚拟存储 + workspace 内部相对链接使其快照无法同时满足（a）跨任务共享、（b）workspace 内部包解析到 **worktree 源码**。被否决的替代：

- **完整快照共享（含源码副本）**：workspace 链接解析到缓存副本而非 worktree 源码 → lean 状态下修改 workspace 包源码后运行读到旧代码（npm lean 无此问题），语义错误。
- **快照共享 + 链接重写为绝对路径**：digest 与链接内容随 worktree 路径变化，缓存无法跨任务共享（每次重建），且可能跨任务错连；复杂且收益为负。
- **virtual-store-dir 外置**：虚拟存储独立于 node_modules 的布局与 pnpm 安装器假设不一致，属于未验证投机。

因此 pnpm 的 lean 语义为：**依赖以 lockfile 固定、在绑定 worktree 内真实安装**（依赖实体去重复用 `pnpm store path` 全局 store；node_modules 链接层随 worktree 存在）。这保留了 lean 的关键约束（不得改动依赖、变更前必须 promote），同时保住 workspace 源码可编辑的正确语义。prepare 用 `pnpm install --frozen-lockfile --ignore-scripts`，验证用 `pnpm list --json`（exit code 0）；promote 用 `pnpm install --frozen-lockfile`（不加 `--ignore-scripts`，与 npm promote 的 `npm ci` 对齐），再验证。

### D3：fingerprint 与 ready.json

- `dependencyFingerprint` 参数化：npm → `package-lock.json` + node major + npm major；pnpm → `pnpm-lock.yaml` + node major + pnpm major（`pnpm --version`）。
- `ReadyMetadata` 升级 `schemaVersion: 2`，增加 `packageManager: 'npm' | 'pnpm'` 与 CLI major；`cacheHealthy` 只认 v2 → 已部署的 v1 npm 缓存自动判定失效并重建（幂等，无迁移风险）。
- `OperationRecord` 新增可选 `packageManager`（旧的已 prepared operation 无字段 → 按 npm 处理，行为不变；`findBySourceSession` 等不受影响）。
- `StatusResult` / `PreparedOperationResult` 暴露 `packageManager`；CLI `status` JSON、前端状态栏（`⑂ <branch> <lean|mutable>` 追加项目类型标识）同步展示。

### D4：错误呈现与持久 diagnostics

- 新增 `WsErrorCode.UNSUPPORTED_PROJECT`；`http.ts` 状态映射：非 `*_NOT_FOUND`/`OPERATION_CONFLICT`/`INTERNAL_ERROR` → 400（默认分支已覆盖）。
- 前端不新增逻辑：`handoff.ts` 的 catch 已把 `WsError.message` 通过 `input.notify('error', 'Worktree Session: ...')` 与输入区阶段文本呈现（`controls.tsx` 的 `stage.error`）；`UNSUPPORTED_PROJECT` 不是 operation 启动失败（无 operation 文件），不会进入 `uncertain`，草稿保留。
- `operation.diagnostics` 对**已存在的 operation 阶段失败**（如 pnpm 安装网络错误）继续追加最后 20 条；对前置拒绝不产生 operation 文件。

### D5：clean 的既有安全门不变；孤儿失败残留由 operator 处置

`wsClean` 仍拒绝非 `prepared` phase 与无 source-session binding 的目标（fail-closed），本次不扩展 clean 语义。`dsh-cockpit` 现有残留（`759f5b7b...`：branch `ws/commit-prgrmr-prgrmr`、`.worktrees/commit-prgrmr-prgrmr`、无 binding 的 operation 文件）在实现验证后由 operator 手工处置：删除 Git worktree 与本地 task branch，operation 文件保留为失败审计记录（此后 `status`/`sessionStatus` 均不会把它当当前绑定）。

## Risks / Trade-offs

- [pnpm lean 不再共享 node_modules 目录（每个 worktree 有独立链接层）] → 磁盘占用以链接层为主（实体在全局 store），可接受；可在后续引入"pnpm 专用快照"时再优化（backlog）。
- [`pnpm install` 需要 pnpm CLI 存在] → `pnpm --version` 失败时抛 `DEPENDENCY_FAILED`（与 npm 缺失同等处理），明确诊断。
- [pnpm 安装可能执行 postinstall 钩子的变体（prepare 阶段用 `--ignore-scripts`，promote 后才跑 scripts）] → 与 npm 现有 lean/promote 语义完全对齐（npm 也是 cache 阶段 `--ignore-scripts`、promote `npm ci` 跑 scripts）。
- [mixed lockfile 判定可能干扰残留 `pnpm-lock.yaml` 的 npm 仓库] → 明确诊断为方向性拒绝（防歧义），用户可删除冗余 lockfile 恢复。
- [`ready.json` v2 使既有 npm 缓存重建一次] → 自动重建、幂等，无存量迁移成本。

## Migration Plan

1. 实现 + 单测（fake runner 与小型真实 pnpm fixture）→ `npm test`、typecheck、`node scripts/sync.mjs`（幂等两次）。
2. 在 `dsh-cockpit` 仓库端到端验证：新空白会话 start（lean 安装、status、promote）。
3. operator 清理 `dsh-cockpit` 现有孤儿残留（D5）。
4. 更新 `skills/ws/SKILL.md`：pnpm 移出 backlog 表述；声明 yarn/bun/rush 仍为 backlog。
5. 回滚：仅涉及单包内部字段与分支逻辑，恢复旧代码 + `dsh build` 即可；pnpm lean 不写共享缓存，无持久兼容负担。

## Open Questions

- 是否需要在 lean 状态 UI 区分 `pnpm` 与 `npm`（首版仅状态栏文本展示项目类型，不额外做不同图标/交互）。
- `pnpm list --json` 是否需要 `--depth 0`（首版取 exit code + 顶层校验；深度校验留作后续收紧）。
