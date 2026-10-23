# dsh-magpie-display-name-shim

[English](README.md) · 简体中文

<!-- problem -->
使用 [dsh-magpie-connect](https://github.com/bitxeno/dsh-magpie-connect) 0.4.1 时，DSH 模型选择器里 Magpie 网关的模型显示的是 route id（`claude/claude-haiku-5-5`、`codex/gpt-6-luna`），而不是网关本来就提供的显示名（`Claude Haiku 5.5`、`GPT-6-Luna`）。这个插件让选择器显示显示名。

上游修复是 [bitxeno/dsh-magpie-connect#1](https://github.com/bitxeno/dsh-magpie-connect/pull/1)。本 shim 只是过渡，等包含该修复的版本 pin 进来后就停用或删除。

## 工作方式

- 在 `llm/adapters-updated` 时包装 Magpie route（默认 `dsh-magpie-connect`）对应的 adapter：把 `listModels` 和 `resolveModel` 返回的 `name` 换成网关显示名。
- 显示名来自 dsh-magpie-connect 自己的目录缓存（`~/.dsh-magpie-connect/magpie-models.json`），只在文件变化时重读；shim 不发任何网络请求。
- 不改 `id`，所以路由、已保存的选择和会话历史仍是 route id。没有显示名的模型照旧显示 id。
- 读缓存失败时保持原名，不会因 shim 把选择器弄坏。

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `providerId` | `dsh-magpie-connect` | dsh-magpie-connect 注册的 route id（它的 `providerId`）。 |
| `dataDir` | `~/.dsh-magpie-connect` | dsh-magpie-connect 的数据目录（它的 `dataDir`）。 |

## 移除

<!-- section: removal -->
`test/real-adapter.test.mjs` 断言已 pin 的 dsh-magpie-connect 仍返回 `name: id`。升级后这条断言失败，就说明上游修复已发布：在 `dsh.yaml` 设 `enabled: false`，`dsh build` 后重启。

## 开发

```bash
npm test
```
