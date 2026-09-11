# 历史阻塞：已解除

该变更曾因官方 `@deepseek-ai/dsh-subagent@0.1.2-rc.1` 缺少
`settlementNotice` 而阻塞。当前已验证的解决方案见 `RUNTIME-OVERRIDE.md`：

- 固定源码补丁；
- 隔离 root launcher；
- npm `overrides` 仅替换 DSH 的传递依赖 `dsh-subagent`；
- 仓库现有 `DSH_BIN` 逃生门选择该 launcher；
- 实际运行时实例发布能力 marker，Pet 结构化探测后才放行。

这不是 profile `compatDependencies`，也不是修改 npm cache。生成目录全部
忽略，删除 Worktree Session `.env.local` 的 `DSH_BIN` 行即可回到官方包。

该文件只保留历史索引；不要再把它当成当前阻塞。当前剩余工作以 `tasks.md`
为准。
