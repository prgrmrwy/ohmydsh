# ws-prepare-preview-hook 实施复核

日期：2026-10-26。计划基线：9cb7e9c8；复核范围：该基线后的本 change 全部实现、测试与文档。当前会话 GPT 系本地评审，无子智能体、无 Agent Teams。只实施通用 ws 能力，ohmydsh 接入仍为待办。

## 结论

当前未发现阻断本 change 的实现问题。以下测试限制须保留，合入/发布不在本次授权范围。

## 已复核路径

- ws tool → 同一次显式 path 授权 → 当前绑定解析 → wsPreparePreview；CLI 与包根导出均已接入。
- 仅 prepared/bound 可执行；start 不调用 hook；缺 hook 返回 skipped。
- Git 跟踪、普通文件、可执行位、最终文件及 .ws 父目录的符号链接拒绝。
- 可信 WS_* 上下文；DSH_HOME 强制覆盖；home 写入/删除前按 operationId 与 canonical common dir 做严格证明。
- 同 worktree 独占文件锁；hook 执行不持 repo.lock；写回时重读 operation，clean 后不复活；未知/活跃锁 owner fail closed。
- stdout/stderr 有界尾部；5 分钟 prepare、不到 30 秒 teardown；POSIX 超时 TERM 后 KILL 进程组。Windows 使用 taskkill /T /F 路径，但未在 Windows 实机验证。
- clean 既有安全门先于 teardown；dry-run 不执行；teardown 失败只告警；危险 home 跳过；missing home 不报错；结果 warnings 经仓库级 cleaned 条目完整返回。
- CLI hook 失败返回非零，skipped 返回零，避免脚本流水线把准备失败当成功。

## 修复的复核问题

- CLI 起初对 failed hook 返回零，已修复并加入口回归测试。
- 只检查 hook 最终文件不足以防 .ws 目录链接，现同时拒绝该父目录链接并有测试。
- 并发测试起初以 1.5 秒 timeout 推断执行顺序，重负载下不可靠；改为显式 release-hook 文件同步。最终聚焦测试通过。
- Vitest 的 --no-cache 不关闭转换缓存；lean node_modules 不可写，改用额外 --no-fsModuleCache，无需 promote 或改共享依赖。

## 验证

- `npm run typecheck --workspace=dsh-worktree-session`：通过。
- `npm run build --workspace=dsh-worktree-session`：通过。
- `npm test --workspace=dsh-worktree-session -- --no-cache --no-fsModuleCache`：34 文件、229 测试通过。
- 新增聚焦 prepare-preview / preview-entrypoints：10/10 通过。
- 根 `npm test`：622 测试，603 通过、17 失败、2 跳过。同依赖的计划基线 archive 对照中，这 17 项全部重现；archive 本身无独立 Git index，额外失败 6 项。因此只证明未观察到新增根测试失败，不宣称根测试全绿。
- `npm run check:artifacts`、`git diff --check`、严格 OpenSpec 校验：通过。

## 限制及接受的风险

- hook 是仓库可信代码，不是文件/网络安全沙箱；截断输出不能自动识别秘密，接入脚本不得输出凭据。
- 用户选择 teardown 失败只告警后继续清理，可能残留预览进程及其对已删目录的写入。
- 按批准设计，prepare 运行时允许该 worktree clean；hook 结束后写回被拒，但脚本仍可能在清理后创建文件。接入方仍须幂等并正确收尾。
- 活跃 owner PID 被系统复用会导致保守拒绝，需要 operator 核实后处理残留 lock；不会盲目删活锁。
- Windows executable/shebang 启动与 taskkill 子树终止未做真机验收；本轮验证为 macOS。实际 GUI 新工具注册需以后部署/重启后验收，当前会话 schema 不会自动变化。
