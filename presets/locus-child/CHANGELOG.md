# locus-child

## 0.1.0

- 新增：Locus 子会话专用 preset，等于 `locus-base` 去掉 `write`/`edit`（`tool-fs` 只读配置）。
- 原因：DSH 0.2.1 删除并静默忽略子代理启动请求的 `toolFilter`，旧 `LOCUS_BASE_TOOL_FILTER`
  对 `write`/`edit` 的收窄只能改由 preset 表达；Pet 以 `agentPreset` 独立选择它，
  该选择随子会话持久化（`agent-preset/selected`），冷恢复重新挂载同一 preset。
- 与 `locus-base` 一样不含任何委派、workflow、agent 控制、job 控制、plan mode、goal 与 `skill-filesystem`。
