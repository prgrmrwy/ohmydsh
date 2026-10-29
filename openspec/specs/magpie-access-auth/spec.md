# Magpie Access Authentication Specification

## Purpose

Allow the self-authored Magpie client to call an Access-protected gateway without a VPN client, while preserving existing LAN usage, credential confidentiality, and operation identity across configuration changes.

## Requirements

### Requirement: Optional Access service authentication

插件 SHALL 支持按线路可选的 Cloudflare Access Client ID / Secret 对，与该线路的 gateway key 并存。启用 Cloudflare Access 的线路地址 MUST 为 https。启用线路上的所有网关请求 MUST 同时携带该线路的两项 Access 头并保留 bearer 认证；未启用 Access 的线路 SHALL NOT 携带任何 Access 头，保持局域网行为。插件 SHALL NOT 把一条线路的 Access 值发往另一条线路，也 SHALL NOT 把任何 Access 值发往明文 http 地址。

#### Scenario: Protected gateway

- **WHEN** 某条 https 线路配置了完整 Access pair 且为生效线路
- **THEN** 该线路的目录、Chat Completions、Responses、配额卡片与刷新请求都包含该线路的 Access pair 与 gateway key

#### Scenario: LAN connection

- **WHEN** 生效线路未启用 Access（直连或 http），即使另一条线路配置了 Access
- **THEN** 该线路请求不包含任何 Access 头，既有 gateway 请求行为不变

#### Scenario: Invalid pair

- **WHEN** 只配置一项 Access 字段、凭据含非法 header 字符，或线路地址不是 https
- **THEN** 客户端在发出任何网关请求之前拒绝该配置，且不写入任何凭据

### Requirement: Credentials remain confidential

插件 MUST 通过官方 credentials 服务按线路保存 Access 值，绝不写入普通设置。读取 SHALL 只暴露 configured / writable 状态。错误、网关返回数据与日志 MUST NOT 泄露任何线路当前或仍在进行中的 Access 值；脱敏集合 SHALL 覆盖所有已配置线路。环境拥有的 Access 凭据 MUST NOT 被设置操作覆盖或清除。

#### Scenario: Settings read and failed request

- **WHEN** 读取设置，或某条线路的网关在错误文本中反射 Access 凭据
- **THEN** 设置响应与错误输出中都不出现任何线路的原始 Access 值

#### Scenario: Read-only credential source

- **WHEN** 更新目标是来自启动环境的 Access 凭据
- **THEN** 更新被拒绝，且该线路的其它连接字段不被修改

### Requirement: Captured connection lifecycle

线路或凭据变化 MUST 使过期的后台结果失效，并与既有 gateway-key 行为保持一致。已进入的操作 SHALL 保持一份连贯的捕获凭据；任何请求 MUST NOT 混用两条线路或新旧两套凭据。既有重定向拒绝与端点限制 MUST 保持有效。线路自动切换造成的凭据变化 SHALL 按连接身份与代际规则处理，并用目录缓存避免模型列表闪断。

#### Scenario: Access rotation during discovery

- **WHEN** 生效线路的 Access 凭据在目录同步运行期间变化
- **THEN** 旧的同步结果不能作为新连接的目录发布

#### Scenario: Prepared operation

- **WHEN** 连接凭据在准备之后变化
- **THEN** 该操作按既有已准备调用生命周期使用单一连贯身份执行，且所有保留的秘密仍被脱敏
