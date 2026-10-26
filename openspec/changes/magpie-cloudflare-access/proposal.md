## Why

公网 Magpie API 已由 Cloudflare Access 服务令牌和专用 gateway key 双重保护，但自研插件只支持后者，不能直接使用公网入口。独立增加可选 Access 凭据，避免混入尚未归档的 Magpie/AUTO 主线。

## What Changes

- 使用官方 credentials 保存可选 Access client id/secret，设置页只返回配置状态。
- 全部既有网关接口附加 Access 请求头，保持 Magpie bearer key。
- 凭据变更遵循既有 generation/operation 生命周期，覆盖错误脱敏和失效。
- LAN 未配置 Access 时保持原行为；不自动切换现有连接或重启日常Host。

## Capabilities

### New Capabilities
- `magpie-access-auth`: 自研 Magpie 插件的可选 Cloudflare Access 服务鉴权、安全配置与生命周期。

### Modified Capabilities
无。基础 dsh-magpie 规范仍位于未归档主线，本 change 不复制或覆盖其内容。

## Impact

涉及 dsh-magpie host runtime/settings/transport/routes、client SettingsPage/api、入口凭据变更订阅及定向测试；不改 AUTO、Pet compat、manifest、lock 或现有主线账本。公网基础设施由 private home-substore 管理。无新增网络依赖，不在本仓库存储凭据。
