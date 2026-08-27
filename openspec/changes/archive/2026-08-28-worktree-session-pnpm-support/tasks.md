# Tasks: Worktree Session pnpm support and clear unsupported-project diagnostics

## 1. Wire / contract

- [x] 1.1 `src/wire.ts`：`OperationRecord` 增加可选 `packageManager?: 'npm' | 'pnpm'`；`StatusResult`/`PreparedOperationResult` 暴露 `packageManager`；`WsErrorCode` 增加 `'UNSUPPORTED_PROJECT'`；`Reporter` 相关接口若需展示项目类型一并调整（保持 wire 向后兼容，旧 operation 无字段视为 npm）。
- [x] 1.2 `src/host/errors.ts`：确认 `wireError` 对 `UNSUPPORTED_PROJECT` 的输出与 retryable=false 语义（无需改动则记录验证）。

## 2. Project type detection（fail-closed 前置）

- [x] 2.1 新增项目类型探测函数（建议 `src/host/project.ts` 或并入 `dependencies.ts`）：`detectPackageManager(repoPath)` 依据 `package-lock.json`/`pnpm-lock.yaml` 存在性返回 `'npm' | 'pnpm'`，二者均无抛 `WsError('UNSUPPORTED_PROJECT', ...)"；二者同时存在抛 `WsError('UNSUPPORTED_PROJECT', '混合 lockfile...')`。
- [x] 2.2 `src/host/operation.ts` `performStart`：在 repo 校验与 `withMkdirLock` 内、allocate 之前调用探测；仅在新 operation 路径记录 `packageManager`；失败时不得写 operation 文件、不得建 branch/worktree（已有测试断言）。
- [x] 2.3 `replay`/已存在 operation 路径：`packageManager` 缺省按 npm 处理（兼容旧 operation），并对缺失 lockfile 的重新准备保持既有错误路径（不回归）。

## 3. pnpm 依赖准备与维护

- [x] 3.1 `dependencies.ts`：`dependencyFingerprint` 参数化（npm：package-lock.json + node/npm major；pnpm：pnpm-lock.yaml + node/pnpm major，`pnpm --version` 解析 major，失败抛 `DEPENDENCY_FAILED`）。
- [x] 3.2 `ReadyMetadata` 升级 `schemaVersion: 2`，增加 `packageManager` 与 CLI major；`cacheHealthy` 只接受 v2（旧 v1 视为失效自动重建）；npm 与 pnpm 的写入、校验路径分列。
- [x] 3.3 pnpm 分支：`prepareDependencyCache` 对 pnpm 在绑定 worktree 内执行 `pnpm install --frozen-lockfile --ignore-scripts` + `pnpm list --json` 验证；不创建 npm 式共享缓存目录与 lean link（operation 不写 `cacheNodeModules`/`lockFingerprint`，写 `packageManager: 'pnpm'` 与明确的 lean 标记）。
- [x] 3.4 `maintenance.ts` `wsPromote`：pnpm 分支删除 lean 约束后可执行 `pnpm install --frozen-lockfile`（不加 `--ignore-scripts`）+ 验证；npm 路径不变。
- [x] 3.5 `validateResource` / `prepareEnvironment` 对 pnpm 无回归（产物位置、`.env.local` 策略不变）。

## 4. Status / CLI / UI 展示

- [x] 4.1 `maintenance.ts` `statusOf` 与 `operation.ts` `resultOf`：输出 `packageManager`。
- [x] 4.2 `src/cli.ts`：status 输出含 `packageManager`（序列化自动包含；补充断言）。
- [x] 4.3 `src/client/controls.tsx`：状态栏在 lean/mutable 文本旁显示项目类型（npm/pnpm），无绑定时不显示；保持单行省略样式。

## 5. Tests

- [x] 5.1 探测单测：npm lockfile / pnpm lockfile / 均无（`UNSUPPORTED_PROJECT` 且不产生任何文件）/ 混合（明确诊断）。
- [x] 5.2 fingerprint 单测：pnpm 指纹随 lockfile 内容与 pnpm major 变化；npm 指纹回归不变。
- [x] 5.3 `cacheHealthy` v1 → 失效重建；v2 正常判定（npm 与 pnpm）。
- [x] 5.4 pnpm lean 准备：真实小型 pnpm fixture（内联 workspace + 少量依赖）验证安装成功、`pnpm list` 通过、worktree 内 workspace 链接指向 worktree 源码（fake runner 或真 pnpm，明确标注耗时）。
- [x] 5.5 pnpm promote：lean → mutable 后依赖真实可解析；npm promote 回归。
- [x] 5.6 失败场景：pnpm 安装失败时 diagnostics 记录错误且首条消息不发送（handoff/HTTP 层）；`UNSUPPORTED_PROJECT` 经 HTTP 返回 400 与明确 message。
- [x] 5.7 CLI/status/UI 输出 packageManager 断言（含 bin-entrypoint 回归）。

## 6. Deployment & docs

- [x] 6.1 `skills/ws/SKILL.md`：pnpm 从 backlog 表述改为已支持；保留 yarn/bun/rush 为 backlog 声明；同步 `~/.dsh` 后校验。
- [x] 6.2 全量验证：`npm test`、package typecheck、`node scripts/sync.mjs` 连跑两次无变化。
- [x] 6.3 `dsh-cockpit` 端到端：新空白会话在 pnpm workspace 仓库 start → lean 准备成功 → status/promote 验证；确认该仓库此前残留已被清理（见 6.4）。
- [x] 6.4 operator 清理 `dsh-cockpit` 残留：`git worktree remove .worktrees/commit-prgrmr-prgrmr`、`git branch -d ws/commit-prgrmr-prgrmr`，保留 `.git/ws/operations/759f5b7b-4a24-455a-aeaf-a3ecc2af1d99.json` 作为失败审计记录；说明后续行为（不作为当前绑定）。
