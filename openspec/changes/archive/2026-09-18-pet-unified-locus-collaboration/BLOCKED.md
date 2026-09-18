# 历史阻塞：已解除

该变更曾因官方 `@deepseek-ai/dsh-subagent@0.1.2-rc.1` 缺少
`settlementNotice` 而阻塞。当前已验证的解决方案见 `RUNTIME-OVERRIDE.md`：

- 固定源码补丁；
- 隔离 root launcher；
- npm `overrides` 替换 DSH 的 reviewed Subagent/Storage 能力包；
- `dsh-pet.hostRuntimeCompatibility` 仅为长期 Host 声明选择该 launcher；
- 实际运行时实例发布能力 marker，Pet 结构化探测后才放行。

这不是修改 npm cache，也不再依赖每台机器 `.env.local` 的 Pet `DSH_BIN`。
一次性官方 CLI 与 Host runtime 的当前分流、版本 fence 和迁移规则以
`RUNTIME-OVERRIDE.md` 为准。

该文件只保留历史索引；不要再把它当成当前阻塞。当前剩余工作以 `tasks.md`
为准。
