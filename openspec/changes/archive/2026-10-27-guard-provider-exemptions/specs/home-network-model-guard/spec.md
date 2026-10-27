# Spec Delta

## ADDED Requirements

### Requirement: 按实际 provider 精确豁免本机出口门禁

系统 SHALL 支持 `exemptProviders`，按请求或当前模型选择的实际 provider route ID 精确匹配；MUST NOT 按 UI 分组、显示名、模型名称或 provider 前缀推导豁免。本规范其余 Claude 出口门禁要求 SHALL 仅适用于未豁免 provider。已豁免 provider SHALL 在 allowed、blocked、unknown 下均跳过本机出口门禁，Host 不查询或等待 Geo；模型家族识别不因豁免而改变，其他组件的发送限制仍有效。

#### Scenario: Magpie 的多个 UI 分组共用同一豁免

- **WHEN** `exemptProviders` 包含 `dsh-magpie-connector`，用户选择 Magpie (Claude) 或 Magpie (GPT) 分组中的模型，实际 provider 为 `dsh-magpie-connector`
- **THEN** Web 与 Host 均跳过本机出口门禁，即使 Geo 为 blocked 或 unknown

#### Scenario: 相似名称与直连不产生隐式豁免

- **WHEN** 列表仅含 `dsh-magpie-connector`，Claude 调用的 provider 是 `claude`、`anthropic`、`dsh-magpie-connect` 或 `dsh-magpie-connector-other`
- **THEN** 它仍受原有 blocked/unknown fail-closed 门禁约束；UI 分组和模型名称不改变该结论

#### Scenario: 豁免请求不等待 Geo

- **WHEN** 已配置豁免的 provider 发起模型流，Geo 服务挂起或不可用
- **THEN** Host 直接进入后续调用，Web 在取得有效豁免策略后即可解除本守卫的阻断，无需等待 Geo

### Requirement: 豁免配置校验持久化与两端同步

通用豁免默认 SHALL 为空列表；部署 MAY 显式设置默认值，本仓库 SHALL 配置 `dsh-magpie-connector`。配置 SHALL 校验有限长度的非空 route ID 字符串列表、去除重复项、拒绝通配符与非法值，并允许空列表撤销全部豁免。有效本机配置优先于部署默认；非法配置 MUST NOT 产生豁免。设置页 SHALL 编辑并完整保存当前有效配置；保存后无需重启即更新 Host 与 Web，其他已打开客户端 SHALL 在后续刷新中更新。Web 未取得有效策略或刷新失败时 MUST NOT 自行推测豁免。

#### Scenario: 保存与清空豁免

- **WHEN** 用户在出口守卫设置页保存 `dsh-magpie-connector` 或清空该列表
- **THEN** 配置持久化，Host 下一次调用采用新列表，当前客户端重新判定现有会话；空列表撤销部署默认豁免

#### Scenario: 保存其他字段不丢失配置

- **WHEN** 用户修改阻断国家或 Geo 端点并保存
- **THEN** 当前豁免列表与已配置的超时、缓存参数保持不变

#### Scenario: 非法配置与策略读取失败

- **WHEN** 配置包含非法豁免值，或 Web 无法取得有效策略
- **THEN** 系统不新增任何豁免，未豁免 Claude 保持 fail-closed

#### Scenario: 模型切换与其他阻断共存

- **WHEN** 在 blocked/unknown 出口下从直连 Claude 切换到已豁免 Magpie，或撤销 Magpie 豁免
- **THEN** 输入框无需刷新页面即可解除或建立本守卫阻断，且不清除其他组件的原因文案
