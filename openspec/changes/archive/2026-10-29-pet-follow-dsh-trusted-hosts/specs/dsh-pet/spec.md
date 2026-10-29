# Spec Delta

## REMOVED Requirements

### Requirement: Pet 管理接口只受理回环或显式声明的同源来源
**Reason**: `DSH_PET_TRUSTED_HOSTS` 与官方 `--trusted-host` 是同值的两份配置，且挡不住经同一域名可达的更大能力（会话、shell）。
**Migration**: 删除 `.env.local` 中的 `DSH_PET_TRUSTED_HOSTS`；只保留 `DSH_TRUSTED_HOSTS`（即 `--trusted-host`）。新边界见下方 ADDED 要求。

## ADDED Requirements

### Requirement: Pet 管理接口只受理回环或 DSH 已信任的同源来源

Pet 管理接口 SHALL 在官方 Connection fence 与浏览器会话认证之后，再做一道独立的来源检查：`Host` 必须是回环地址，或本次请求已被官方 fence 放行（Host 在部署的 `--trusted-host` 内且认证通过）；`Origin` 存在时，回环 Host 下其 host 须为回环名，非回环 Host 下其 host（含端口）须与 `Host` 完全一致。Pet MUST NOT 维护独立的 host 列表或读取专用环境变量。未经官方 fence 放行的请求，Pet SHALL 只认回环。

#### Scenario: DSH 信任的域名同源受理
- **GIVEN** `dsh web` 以 `--trusted-host a.example.com` 启动
- **WHEN** 已认证的浏览器以 `Host: a.example.com`、`Origin: https://a.example.com` 调用 Pet 管理接口
- **THEN** Pet 正常处理该请求

#### Scenario: DSH 信任的域名跨源仍拒绝
- **GIVEN** 官方 fence 已放行 `Host: a.example.com` 的请求
- **WHEN** 该请求的 `Origin` 为 `https://evil.example` 或 `https://a.example.com:8443`
- **THEN** Pet 拒绝该请求，状态为 403

#### Scenario: DSH 未信任的域名到不了 Pet
- **GIVEN** `dsh web` 未配置 `--trusted-host`
- **WHEN** 浏览器以 `Host: a.example.com` 调用 Pet 管理接口
- **THEN** 官方 fence 返回 403，Pet 处理函数不被执行

#### Scenario: 未经 fence 的路由只认回环
- **WHEN** 一条未经官方 fence 包装的 Pet 路由收到 `Host: a.example.com`、`Origin: https://a.example.com` 的请求
- **THEN** Pet 拒绝该请求，状态为 403

## MODIFIED Requirements

### Requirement: Pet 来源检查的拒绝使用标准错误信封

Pet 来源检查拒绝请求时 SHALL 返回 403 和标准错误信封（`ok: false`、非空 `error`、非空 `message`），`message` SHALL 说明只受理回环或 DSH `--trusted-host` 所信任的同源来源。拒绝 MUST NOT 暴露所请求的路由是否存在。

#### Scenario: 客户端显示真实拒绝原因
- **WHEN** Pet 来源检查拒绝一次管理调用
- **THEN** 客户端显示的错误包含该 `message`，而不是"缺少 ok 标记"
