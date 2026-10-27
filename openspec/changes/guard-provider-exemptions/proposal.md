# Proposal

## Why

Magpie 的模型按 UI displayGroup 分组，但请求 provider 始终是 `dsh-magpie`。本机 Geo 不能代表网关的模型出口，目前模型 ID 的 Claude 前缀使这些请求被本机 guard 拒绝。

## What Changes

- 增加按实际 provider route ID 精确匹配的 `exemptProviders`；Host 与 Web 采用相同策略，不依赖 UI 分组或模型名称决定豁免。
- 通用默认列表为空；仓库部署配置明确加入 `dsh-magpie`。提供设置页编辑、持久化与无需重启的生效方式。
- 豁免请求不等待 Geo；其他 Claude 请求维持 blocked/unknown fail-closed。
- 从 manifest 删除已停用的 `dsh-magpie-connect` 条目，保留现有数据和历史资料。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `home-network-model-guard`: 增加 provider 豁免作为现有 Claude 门禁的明确例外，并贯通配置及两端判定。

## Impact

影响 guard 的配置、规则、Host RPC/流入口、Web 输入框与设置页、对应测试和文档，以及 manifest 和本地部署配置 patch。无新依赖，不改 Magpie 分组、模型路由或凭据，不自动迁移旧会话，也不重启日常 Host。
