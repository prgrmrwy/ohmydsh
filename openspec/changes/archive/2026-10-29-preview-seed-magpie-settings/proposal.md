## Why

dsh-magpie-connector 从 `$DSH_HOME/plugins/dsh-magpie-connector/settings.json` 读取连接线路（地址、可见模型、`knownOwners`）。gateway key 已随 `.credentials.yaml` 复制，但 prepare-preview 不复制这个文件，所以预览 Host 里 connector 没有任何线路，不注册 route，默认模型为 Magpie 时新会话第一轮就报 `NO_ADAPTER`。2026-10-29 做 session-safe-dsh-restart 的预览验收时遇到，当时只能手动复制。

## What Changes

- prepare-preview 的复制白名单（`scripts/lib/ws-preview-seed.mjs` 的 `SEED_FILES`）加入 `plugins/dsh-magpie-connector/settings.json`。按 connector README，该文件不含 key 和 Access 值。
- 真实 home 没有该文件时照旧跳过并列出，不生成默认值。

## Capabilities

### Modified Capabilities

- `ohmydsh-worktree-preview`：白名单新增一项。

## Impact

- 代码：`scripts/lib/ws-preview-seed.mjs`；测试：`tests/ws-preview-seed.test.mjs`。
- 不影响真实 home；预览中 connector 写回的 `knownOwners` 只落在隔离 home。
