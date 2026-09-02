## 1. Git 跟踪状态查询能力

- [x] 1.1 在 `packages/worktree-session/src/host/git.ts` 新增 `isTracked(repoRoot, relativePath, git = createGitClient()): Promise<boolean | undefined>`，用 `git.runner('git', ['ls-files', '--error-unmatch', '--', relativePath], { cwd: repoRoot })` 取退出码三态映射：`0` → `true`（已跟踪）、`1` → `false`（未跟踪）、其他 → `undefined`（不可查询），并加注释说明为何不用 `GitClient.maybe`（无法区分未跟踪与查询失败，见 design D3）
- [x] 1.2 为 `isTracked` 补测试：已跟踪文件返回 `true`、未跟踪文件返回 `false`、非 Git 目录返回 `undefined`

## 2. 探测函数裁决逻辑

- [x] 2.1 在 `src/host/project.ts` 定义裁决结果类型：`MixedLockfileAdoption { packageManager: PackageManager; signal: 'packageManager-field' | 'git-tracking'; ignoredLockfile: string }` 与 `ProjectResolution { packageManager: PackageManager; adoption?: MixedLockfileAdoption }`，并在 `src/wire.ts` 按需导出（若类型需跨模块使用）
- [x] 2.2 实现 `packageManager` 字段读取辅助：解析仓库根 `package.json` 的 `packageManager`，取 `@` 前名字，仅当为 `npm` 或 `pnpm` 时返回该值；文件缺失、JSON 解析失败、字段缺失/非字符串/解析为 yarn 等其他管理器时返回 `undefined`（视为无信号，不抛错，见 design D2）
- [x] 2.3 改写 `detectPackageManager(repoPath, git = createGitClient()): Promise<ProjectResolution>`：单 lockfile 时短路直接返回（不读 `package.json`、不查 git，见 design D5）；均不存在时维持现有 `UNSUPPORTED_PROJECT` 诊断
- [x] 2.4 实现混合场景裁决：先按 2.2 采信 `packageManager` 字段；否则用 1.1 查两个 lockfile 跟踪状态，任一为 `undefined` 则整个信号不可用，恰好一个 `true` 时采信该 lockfile；两者裁决成功时填充 `adoption`（含被忽略的 lockfile 名）
- [x] 2.5 混合场景无可区分信号时抛 `WsError('UNSUPPORTED_PROJECT', ...)`，诊断文案需说明"存在混合 lockfile 且无法判定仓库意图"，并提示可通过提交/删除冗余 lockfile 或声明 `packageManager` 字段解决；确保 MUST NOT 回退任何默认包管理器（design D1）

## 3. 启动路径接入与可见性

- [x] 3.1 更新 `src/host/operation.ts:126` 唯一调用点：按新签名传入 `git`，从返回值取 `packageManager`，保持调用位置仍在 `resolveCommit` / `allocateTask` 之前（fail-closed 结构不得移动）
- [x] 3.2 采信发生时（`adoption` 存在），把裁决渲染成一条中文诊断字符串（采信的包管理器、依据信号、被忽略的 lockfile）作为新建 operation 记录的 `diagnostics` 初始项落盘；replay 路径（`operation !== undefined`）不重新探测、不重复追加
- [x] 3.3 确认单 lockfile 项目不产生任何裁决诊断（`diagnostics` 保持为空/不含混合相关文本）

## 4. 测试

- [x] 4.1 更新 `packages/worktree-session/test/project.test.ts` 中因返回类型变化而失效的既有断言（`toBe('npm')` → 取 `.packageManager`），保持单 lockfile 与无 lockfile 两个既有用例的语义不变
- [x] 4.2 新增混合场景用例：git fixture 中 `pnpm-lock.yaml` 已提交、`package-lock.json` 未跟踪 → 采信 `pnpm` 且 `adoption.signal === 'git-tracking'`；反向朝向（npm 已提交、pnpm 未跟踪）→ 采信 `npm`
- [x] 4.3 新增用例：两个 lockfile 都已提交 → 拒绝；两个都未跟踪 → 拒绝；非 Git 目录且两个 lockfile 都存在 → 拒绝（均为 `UNSUPPORTED_PROJECT`）
- [x] 4.4 新增用例：`package.json` 声明 `packageManager: 'pnpm@10.23.0'` 且跟踪状态指向 npm → 采信 `pnpm` 且 `signal === 'packageManager-field'`；声明 `yarn@4.0.0` 时该信号被忽略并退回跟踪状态判定
- [x] 4.5 更新 `test/project.test.ts` 的 `rejects mixed lockfiles without touching Git state` 集成用例：现有 fixture 把两个 lockfile 都 `git add` 提交，属于"都 tracked"分支，应仍然拒绝且不触碰 Git 状态 —— 确认断言依然成立
- [x] 4.6 新增集成用例：混合但可裁决的 fixture 走通 `startOperation`，验证 operation 记录的 `diagnostics` 含裁决信息、且依赖指纹按采信的 lockfile 计算
- [x] 4.7 检查并修复其他因 `detectPackageManager` 返回类型变化受影响的测试文件（`test/` 下引用该函数处）

## 5. 文档与校验

- [x] 5.1 更新 `skills/ws/SKILL.md:135` 附近的"Deferred, not commands"段落：混合 lockfile 不再一律拒绝，改述为"可裁决时采信 tracked/声明的那个并记录诊断，无信号时拒绝"
- [x] 5.2 检查 `packages/worktree-session/README.md` 是否需要同步混合 lockfile 行为说明
- [x] 5.3 运行 package 内 build / typecheck / test，以及仓库级 `npm test`、`npm run check:artifacts`
- [x] 5.4 运行 `openspec validate resolve-mixed-lockfile-by-git-tracking --strict`
- [x] 5.5 在 `~/mydir/dev/dev-infra-server` 上实证：恢复备份的 `package-lock.json`（`~/.cache/dsh-backup/dev-infra-server.package-lock.json.20260902`）造出真实混合状态，确认新逻辑采信 pnpm 并给出裁决诊断；验证后按用户意愿决定是否再次移除该文件
