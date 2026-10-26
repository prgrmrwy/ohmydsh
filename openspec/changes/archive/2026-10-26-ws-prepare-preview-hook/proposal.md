## Why

Worktree Session 创建的隔离环境默认只有源码、依赖，以及一个空的隔离 `DSH_HOME`。不同仓库要在 worktree 里跑起来验收，需要带入的东西各不相同：ohmydsh 要模型配置和凭据，dsh-cockpit 要自己的开发服务配置。现在 ws 没有提供任何扩展点，每个仓库只能绕开 ws 自己处理，或者干脆先合入主干再验收。

ws 应该只提供一个通用机制：在需要验收时，让接入仓库提前做一些准备工作。具体做什么由接入仓库自己决定，ws 不需要了解。

## What Changes

- **新增按需执行的 `ws prepare-preview` 动作。** 隔离 home 被手工删除时，会先在原路径重建，不会因为找不到目录而失败。
  - ws start 不变，不执行任何仓库脚本。只有在需要验收时，才由用户或 Agent 显式调用。
  - 对当前绑定的 worktree，执行接入仓库声明的 prepare-preview hook（受 Git 跟踪的可执行文件），cwd 为 worktree。
  - 通过一组固定的 `WS_*` 环境变量传入上下文：源仓库根、worktree、git common dir、operationId、隔离 home，以及运行 ws 的 Host 自身的 home。hook 进程的 `DSH_HOME` 被强制设为隔离 home，避免误写真实环境。
  - 仓库没有这个文件时报告 skipped，不视为错误。可以重复调用。
  - 每次结果（ok/failed/skipped、退出码、时间、截断后的输出）写入 operation 元数据，`ws status` 可以看到。失败不影响 worktree。
- **hook 完全可选。** 路径固定为 `.ws/prepare-preview` 和 `.ws/teardown-preview`。不声明任何 hook 的仓库，行为完全不变。
- **不阻塞其它 worktree。** hook 运行时不持有仓库级 ws 锁，同一 worktree 用自己的独占锁防止重复执行；teardown 在清理流程内运行，只给 30 秒。
- **ws clean 先收尾、再删除。** 安全门通过后，先执行可选的 `teardown-preview`，让接入方停掉自己的预览进程。按用户决定，失败只告警、照常清理，并提示进程可能仍在运行。
- **ws clean 删除隔离 home。** 安全清理时，在路径证明通过的前提下，一并删除 operation 记录的隔离 home。现在从不删除，`.git/ws/dsh-home/` 下已经积累了 33 个目录；接入方往里放了凭据副本之后，更不能这样保留。
- **对接入方公开 hook 契约**，写进 worktree-session 的 README：执行条件、环境变量、超时、失败语义、幂等要求。

本 change 不包含任何仓库的具体脚本。ohmydsh 的接入见 change `ohmydsh-worktree-preview`；dsh-cockpit 等其它仓库按同一契约在各自仓库接入。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `source-workspace-worktree-session`：新增可选的预览 hook（prepare/teardown）及执行契约、结果记录；明确 ws start 不执行 hook；清理时先执行 teardown，再删除隔离 home。

## Impact

- `packages/worktree-session/src/host/`：新增 prepare-preview.ts；改动 maintenance.ts（clean 删除 home）、tool.ts 与 CLI（新增动作）、wire.ts（状态字段）；补充对应测试。
- `packages/worktree-session/README*.md`：hook 契约。
- `skills/ws/`：新增动作的用法。
- 安全面：ws 会以用户权限执行仓库内的代码。信任边界与 `npm install` 的 lifecycle 脚本相同，但只在显式调用时执行，且只执行 Git 已跟踪、非符号链接的版本。
