## 1. hook 执行

- [ ] 1.1 新建 `packages/worktree-session/src/host/prepare-preview.ts`（同时服务两个 hook，传 `WS_HOOK`）：判定 hook（Git 已跟踪、普通文件、非链接、可执行）；按 D2 构造 `WS_*` 环境变量并覆盖 `DSH_HOME`；`shell:false`；prepare 5 分钟、teardown 30 秒超时，超时后终止进程组；截断输出尾部；返回 `{status, exitCode, outputTail, at}`
- [ ] 1.2 未绑定、已 cleaned 或 phase 非 prepared 时拒绝，且不写元数据
- [ ] 1.3 隔离 home 缺失时，校验路径后以 0700 重建，再执行 prepare-preview

## 2. 动作与状态

- [ ] 2.1 `wire.ts` 与 operation 元数据新增可选的 `preview` 字段
- [ ] 2.1b 加锁三步：短暂持仓库锁校验 → 不持锁执行（同 worktree 用 `preview-<operationId>.lock` 独占，残留锁按 pid 存活判定）→ 短暂持仓库锁复核绑定未被 clean 后只写 `preview` 字段
- [ ] 2.2 tool schema、`dsh-ws` CLI 新增 `prepare-preview` 动作：目标解析同 promote，显式 path 走一次性授权；tool 描述写明按需调用
- [ ] 2.3 `ws status` 输出 preview 结果，缺失时显示"未准备"

## 3. clean 删除隔离 home

- [ ] 3.0 `maintenance.ts`：安全门全部通过后、`git worktree remove` 之前执行 teardown-preview；失败或超时写入结果 `warnings` 并照常继续；dry-run 只列入 actions
- [ ] 3.1 `maintenance.ts`：worktree 删除成功后，校验 dshHome（realpath 在 `<common>/ws/dsh-home/` 下、basename 等于 operationId、非链接）通过再删除，报告 removed 或 skipped；目录已不存在视为已删除

## 4. 测试

- [ ] 4.1 fixture 仓库：ws start 不执行 hook；hook 收到的 `WS_*` 与 operation 一致，`DSH_HOME` 等于隔离 home；无 hook 时报告 skipped；未跟踪、链接或不可执行时不执行并报告 failed；非零退出与超时时绑定和 phase 不变、status 可见；输出被截断；重复调用只更新 preview 字段；未绑定或已 cleaned 时被拒
- [ ] 4.2 clean：teardown 在删除前执行、失败时告警且清理完成、dry-run 不执行、安全门拒绝时不执行；home 正常删除、已不存在不报错、越界或 basename 不符跳过、安全门拒绝时保留；清理后 Session 释放不依赖 home 存在
- [ ] 4.4 无 `.ws/` 时全部行为不变；home 缺失时被重建
- [ ] 4.5 锁：hook 运行期间（用阻塞的 fixture hook）另一 worktree 的 start/promote/clean 正常完成；同一 worktree 第二次调用立即被拒；hook 运行期间该 worktree 被 clean 后结果不写回；残留的独占锁在 pid 已死时可被接管
- [ ] 4.6 teardown：卡住的 teardown 在 30 秒内被终止并告警，清理照常完成
- [ ] 4.3 包内 typecheck、test、build；仓库 `npm test`、`npm run check:artifacts`

## 5. 文档

- [ ] 5.1 `packages/worktree-session/README*.md`：hook 契约（可选性、固定位置、执行条件、环境变量含 `WS_HOOK`、prepare 5 分钟与 teardown 30 秒超时、prepare 与 teardown 的失败语义、接入方需保证幂等和路径校验），附一个最小示例
- [ ] 5.2 `skills/ws/`：新增 `prepare-preview` 的用法与调用时机

## 6. 收尾

- [ ] 6.1 `openspec validate ws-prepare-preview-hook --strict`
