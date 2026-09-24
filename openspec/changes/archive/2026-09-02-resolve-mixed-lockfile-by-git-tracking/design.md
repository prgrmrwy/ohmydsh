## Context

见 `proposal.md` — Why。此处只列约束住方案的现状事实：

- `detectPackageManager(repoPath)`（`src/host/project.ts:15`）当前是**纯 fs 判定**：两次 `pathExists`，无进程调用、无注入点，返回 `Promise<PackageManager>`。
- 唯一调用点是 `performStart`（`src/host/operation.ts:126`），位于 `withMkdirLock(repo.lock)` 内、`resolveCommit` / `allocateTask` **之前**，且只在 `operation === undefined`（首次启动）时调用；replay 走 `operation.packageManager ?? 'npm'`，不重新探测。这是 fail-closed 的结构性保证，方案不得移动这个位置。
- `performStart` 已持有可复用的依赖：`git`（`GitClient`）、`runner`（`ProcessRunner`）、`repo.repoRoot`。`GitClient.maybe()`（`src/host/git.ts:26`）在退出码非 0 时返回 `undefined` 而不抛错，天然适配"信号不可用"语义。
- `OperationRecord.diagnostics?: readonly string[]`（`src/wire.ts:97`）已存在并已持久化，`performStart` 在失败路径上用 `diagnostics.slice(-20)` 维护它。可见性需求可复用该字段，无需新增 wire 字段或 schema 版本升级。
- 探测发生在 operation 记录**创建之前**，所以裁决信息无法在探测时刻写入记录 —— 必须由探测函数返回给调用方，再随记录一起落盘。

## Goals / Non-Goals

**Goals:**

- 把"仓库意图"从不可证明变为在多数真实场景下可证明，且判定过程零猜测、可复现。
- 保持 fail-closed 结构：裁决与拒绝都在任何 Git 资源、operation 文件、绑定创建之前完成。
- 让采信结果可复核，避免"静默只用了一套锁"。
- 保持单 lockfile 路径的行为与开销不变（不为常见场景引入额外进程调用）。

**Non-Goals:**

- 不引入任何"默认包管理器"兜底 —— 无信号即拒绝，这是本设计的核心取舍（见 Decisions D1）。
- 不做 lockfile 内容层面的推断（如比较 mtime、解析 lockfile 判断哪个更"新"或更"完整"）。
- 不改 `dependencyFingerprint`、lean/promote、`ready.json` schema 或 wire 结构版本。

## Decisions

### D1：无信号时拒绝，而不是回退默认

采信信号缺失时继续拒绝，不设 `pnpm 优先` 之类的兜底。

理由：兜底会把**可诊断的配置错误**转成**静默的错误安装**。以本次真实仓库为例，若默认选 npm，就会用那份陈旧 lock 跑 `npm ci`，装出一套丢掉 `packages/web` workspace、丢掉 `figlet`/`snappy` overrides（正是 `08578e6` 要修的问题）的 `node_modules`，然后安静跑起来 —— 用户在半小时后遇到一个莫名的 figlet 路径错误，而不是当场一眼能修的提示。反向默认（选 pnpm）对以 npm 为准的仓库是对称的事故。这也与 `openspec/specs/source-workspace-worktree-session/spec.md` 的既有不变量（身份/状态无法证明时前置拒绝）以及仓库 `AGENTS.md`「身份或状态无法证明时应拒绝破坏性操作」一致。

替代方案：① 固定默认 —— 已否决，理由如上；② 交互式询问用户选哪个 —— 探测发生在 host 侧、首条消息提交路径内，没有可用的交互通道，且会把一个应由仓库配置回答的问题推给每次启动。

### D2：信号优先级为 `packageManager` 字段 > git 跟踪状态

`package.json` 的 `packageManager` 是 Corepack 标准的**显式声明**，语义强于"哪个文件被提交了"这一间接证据；显式声明存在时它就是仓库意图本身。跟踪状态是次优的客观证据，用于绝大多数未声明 `packageManager` 的仓库（本次命中的 `dev-infra-server` 即无该字段）。

`packageManager` 值形如 `pnpm@10.23.0`，取 `@` 前的名字；只有解析出 `npm` 或 `pnpm` 才采信，`yarn`/`bun` 等视为**无信号**（继续走跟踪状态，仍无则拒绝），而不是当作"不支持"直接抛错 —— 后者会让一个恰好声明了 yarn 但实际两套锁并存的仓库得到误导性诊断。字段缺失、非字符串、无法解析同样视为无信号。

### D3：跟踪状态用 `git ls-files --error-unmatch <path>` 逐个查询，经 `GitClient.maybe`

在 `src/host/git.ts` 新增 `isTracked(repoRoot, relativePath, git): Promise<boolean | undefined>`，通过 `git.runner` 执行 `git ls-files --error-unmatch -- <relativePath>` 并直接读取退出码。

关键点：`GitClient.maybe` 无法区分"未跟踪"（退出码 1）与"根本不是 Git 工作树 / git 不可用"（其他非 0）。而 spec 要求这两者行为不同：一个 tracked 一个 untracked 要采信，查询失败要拒绝。因此 `isTracked` 需要区分三态 —— `ProcessResult.code` 为 `0` → `true`，为 `1` → `false`，其他值、超时或 runner 抛错 → `undefined`（不可查询）。两个 lockfile 中任一查询返回 `undefined` 时，整个跟踪信号视为不可用。

替代方案：一次 `git ls-files -- package-lock.json pnpm-lock.yaml` 解析输出行 —— 输出为空时同样无法区分"两个都没跟踪"与"查询失败"，仍需看退出码，没有简化收益。

### D4：探测函数返回结构体而非裸枚举，裁决信息由调用方落盘

`detectPackageManager` 的返回从 `PackageManager` 改为 `{ packageManager, adoption? }`，其中 `adoption` 仅在混合场景采信时存在，携带采信的管理器、依据信号（`'packageManager-field' | 'git-tracking'`）与被忽略的 lockfile 名。`performStart` 在构造 operation 记录时把 `adoption` 渲染成一条中文诊断字符串放进 `diagnostics` 初始值。

理由：探测在记录创建前发生，函数不能自己落盘；返回值携带是唯一不破坏"探测无副作用"性质的方式。复用 `diagnostics` 而非新增字段，避免 `schemaVersion` 变更与旧记录兼容处理。

签名同时需要新增可选的 git 依赖参数（`git = createGitClient()`），保持既有测试可以只传 `repoPath`。

替代方案：让探测函数自己写文件 —— 否决，会破坏"拒绝时不创建任何文件"的不变量。

### D5：单 lockfile 路径短路，不做任何额外查询

`npm !== pnpm` 时直接返回，`packageManager` 字段与 git 查询都不执行。既满足"单 lockfile 项目不产生噪声"的 spec 场景，也保证常见路径零额外进程开销。

## Risks / Trade-offs

- **采信了跟踪状态，但用户本地那份未跟踪的 lock 才是他当前想用的** → 这种情形下用户的真实意图与仓库配置冲突，属于仓库层面要先解决的问题；`adoption` 诊断会明确写出"忽略了哪个 lockfile"，用户能立刻看到并按需调整仓库配置（提交或删除），而不是拿到一套不明来源的依赖。
- **`git ls-files` 在超大仓库上的开销** → 只在混合场景执行，且带 `--error-unmatch -- <单个路径>`，是 O(1) 级索引查询；单 lockfile 路径完全不触发（D5）。
- **退出码 1 的语义假设**（未跟踪）依赖 git 行为稳定 → git 的 `ls-files --error-unmatch` 在路径未跟踪时返回 1 是长期稳定契约；即便某天返回其他码，落点是 `undefined` → 拒绝，即退化为**当前已有的保守行为**，不会误装依赖。
- **诊断复用 `diagnostics` 数组，与失败诊断混在同一列表** → `diagnostics` 已是"人读的诊断流"而非结构化错误，语义相容；采信信息作为首条写入，`slice(-20)` 的裁剪窗口下不会挤掉后续失败信息（成功启动路径本就不再追加）。
- **行为放宽降低了 fail-closed 严格度** → 放宽仅发生在意图**可证明**时；不可证明的分支一字未动。真混合（两个都 tracked）仍然拒绝，这正是需要人工决断的场景。

## Migration Plan

无数据迁移、无持久格式变更、无 wire 结构版本变更：`diagnostics` 是既有可选字段，旧 operation 记录无需处理。replay 路径读 `operation.packageManager`，不重新探测，因此变更前创建的记录行为不变。

回滚即还原 `project.ts` / `operation.ts` / `git.ts` 三处改动与文档；无残留状态需要清理。
