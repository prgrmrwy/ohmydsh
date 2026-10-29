# Spec Delta

## ADDED Requirements

### Requirement: Pet 管理接口只受理回环或显式声明的同源来源

Pet 管理接口 SHALL 在官方 Connection fence 与浏览器会话认证之后，再做一道独立的来源检查：`Host` 必须是回环地址，或命中 Pet Host 启动时从 `DSH_PET_TRUSTED_HOSTS` 读取的 authority；`Origin` 存在时，其 host 必须与 `Host` 一致（回环名之间互认）。官方 `DSH_TRUSTED_HOSTS` 或 `trustedHosts` MUST NOT 自动放宽这道检查。变量未设置、为空或含任一非法项时，Pet SHALL 只认回环。

#### Scenario: 未声明时只认回环
- **GIVEN** Host 进程环境中没有 `DSH_PET_TRUSTED_HOSTS`，但官方 fence 已信任 `a.example.com`
- **WHEN** 已认证的浏览器以 `Host: a.example.com` 调用 Pet 管理接口
- **THEN** Pet 拒绝该请求，状态为 403

#### Scenario: 声明后同源受理
- **GIVEN** `DSH_PET_TRUSTED_HOSTS=a.example.com`，官方 fence 也信任该域名
- **WHEN** 已认证的浏览器以 `Host: a.example.com`、`Origin: https://a.example.com` 调用 Pet 管理接口
- **THEN** Pet 正常处理该请求

#### Scenario: 声明后跨源仍拒绝
- **GIVEN** `DSH_PET_TRUSTED_HOSTS=a.example.com`
- **WHEN** 请求的 `Host` 为 `a.example.com`，`Origin` 为 `https://evil.example`
- **THEN** Pet 拒绝该请求，状态为 403

#### Scenario: 带端口的声明只匹配该端口
- **GIVEN** `DSH_PET_TRUSTED_HOSTS=a.example.com:8443`
- **WHEN** 请求的 `Host` 为 `a.example.com:9443`
- **THEN** Pet 拒绝该请求；`Host` 为 `a.example.com:8443` 时受理

#### Scenario: 非法声明整体失效
- **GIVEN** `DSH_PET_TRUSTED_HOSTS` 含 `https://a.example.com` 这类不是 bare `host[:port]` 的项
- **WHEN** Pet Host 启动
- **THEN** Pet 在 Host 日志中记录该变量无效，并只认回环，不因此进入 degraded

### Requirement: Pet 来源检查的拒绝使用标准错误信封

Pet 来源检查拒绝请求时 SHALL 返回 403 和标准错误信封（`ok: false`、非空 `error`、非空 `message`），`message` SHALL 说明只受理回环或 `DSH_PET_TRUSTED_HOSTS` 中声明的同源来源。拒绝 MUST NOT 暴露所请求的路由是否存在。

#### Scenario: 客户端显示真实拒绝原因
- **WHEN** Pet 来源检查拒绝一次管理调用
- **THEN** 客户端显示的错误包含该 `message`，而不是"缺少 ok 标记"
