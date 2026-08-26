## Purpose

保证联邦 API 接管、客户端桥接和自定义 UI 只能完整、可证明地激活；任一冲突或故障均安全回退官方单机 DSH，并给出准确诊断而不扩大权限。

## ADDED Requirements

### Requirement: Host 联邦 API 路由必须进程级事务接管
系统 SHALL 根据已验证并提交的 client call graph/inventory，将全部必要 workspace/session/respond exact routes 和唯一 `/api` outer middleware ownership 作为一个进程级激活事务注册。任一路由或 middleware 冲突、源码兼容 patch 不匹配或 Host 依赖失败时，系统 MUST 回滚本次已注册的所有联邦 ownership，并进入明确的 disabled-conflict 或 activation-failed 状态。outer middleware SHALL 位于原 Connection Host/Origin trust fence 之后、有效 composed handler 之前；其 native `next` MUST 保留 `Typert interceptor → privileged fence → ApiProxy fallback`，不得调用裸 `ctx.apiProxy`。每个接受 workspace/session id 的入口以及任何含未分类 `fed1:` 身份的 `/api` 请求 MUST 在 `next` 前路由或显式拒绝；MUST NOT 让联合 ID 落入本机官方 handler。Host READY 后 SHALL 同时安全支持官方浏览器的本机裸 ID 和联邦浏览器的联合 ID。

#### Scenario: 中途发生 route 冲突
- **WHEN** 联邦注册若干 routes 后发现另一插件已占用必要 exact route
- **THEN** 系统撤销此前所有联邦注册，报告冲突路径，官方本机 API 继续完整工作

#### Scenario: Host 依赖就绪
- **WHEN** Stable Core、registry、本机 Node adapter 和全部 inventory routes 均成功初始化
- **THEN** 系统一次性提交进程级 Host READY；Client 是否显示联邦 UI 由各浏览器实例独立决定

### Requirement: 每个 Client 独立提交或回退联邦 UI
每个浏览器实例 SHALL 只有在 federation contract、event bridge、Node Shell、Workspace Embed 和 Picker 均可渲染时才使联邦 slot entry 生效；失败时 SHALL 卸载该实例的联邦 UI贡献，使官方 Workspace/Session 浏览器重新成为 winner。一个 Client 的失败、刷新或关闭 MUST NOT 撤销 Host READY 或打断其他已就绪 Client。缓存远端数据 MUST NOT 在失去权威连接后伪装为可写在线状态。

#### Scenario: Client bridge 初始化失败
- **WHEN** Host 已 READY 但一个浏览器实例的事件桥或联邦侧栏加载失败
- **THEN** 该实例回退官方单机 UI 和联邦诊断，Host routes 与其他已就绪浏览器保持工作

#### Scenario: 多浏览器实例独立
- **WHEN** Client A 已进入联邦 UI，而随后打开的 Client B 初始化失败或崩溃
- **THEN** Client A 不被刷新或降级，Client B 单独显示官方 UI

#### Scenario: 构建期 Workspace Embed 不兼容
- **WHEN** 新 DSH 版本或源码 blob 与受控 patch/hash contract 不匹配
- **THEN** build/sync 在卸载或替换当前可用部署之前失败，不产出含陈旧生成模块的新 artifact；fresh 环境保持官方 UI，已有环境保留最后可用部署并报告升级阻断

#### Scenario: 禁用联邦 package
- **WHEN** 用户在 manifest 中禁用并重新物化联邦 package
- **THEN** DSH 恢复原生单 Host 行为，远端节点和凭据不受修改，私有 registry 可保留供以后重新启用

### Requirement: 错误必须按故障域分类并给出安全诊断
系统 SHALL 区分 registry、SSH identity、tunnel、transport、protocol、compatibility、capability、routing、remote business、outcome unknown 与 activation conflict 错误。GUI SHALL 展示用户可执行且不泄漏 secret 的诊断；MUST NOT 将所有故障折叠成模糊的连接失败，也 MUST NOT 在日志中输出私钥、passphrase、provider token 或完整敏感会话内容。

#### Scenario: DSH 协议不兼容
- **WHEN** 远端端口可达但核心 schema、RPC 或事件流探测失败
- **THEN** 节点显示 incompatible、中央和远端版本及失败能力，写操作保持禁用

#### Scenario: 远端业务拒绝
- **WHEN** 远端 Host 对 rename、archive 或 prompt 返回业务错误
- **THEN** UI 保持当前权威投影、显示远端错误，不把它误报为 SSH 断线或尝试本地执行

### Requirement: 兼容声明以已验证矩阵和能力探测为准
系统 SHALL 维护已验证的 DSH 版本/能力矩阵。V1 可以只有一个 rc.2 wire adapter，但只有矩阵中的组合可无警告提供完整写能力；允许范围内未验证版本必须先通过只读核心探测并显示 experimental 警告，写能力需要专项证明。未知协议不得靠 SemVer 猜测为兼容。

#### Scenario: 已验证版本连接
- **WHEN** 远端版本和能力组合存在于已验证矩阵且探测通过
- **THEN** 节点进入 ready 并开放对应读写能力

#### Scenario: 范围内未验证版本
- **WHEN** 远端版本在允许范围但未被矩阵验证
- **THEN** 系统显示 experimental，按探测结果保守开放能力；核心写路径未证明时保持禁用

### Requirement: 中央信任面不得借联邦扩大
系统 MUST 保持远端 DSH 回环绑定和 SSH 加密通道，不得要求 `web.lan` 或 `DSH_LAN`。中央 SHALL 只暴露明确建模的联邦操作，不得提供通用 SSH 命令执行、远端凭据管理或任意路径本地打开接口。浏览器到中央的请求仍 SHALL 经过 DSH Host/Origin 围栏，且该围栏不得被误当作节点认证。

#### Scenario: 请求试图访问未登记节点
- **WHEN** 浏览器构造一个合法形状但指向未知 node id 的联合命令
- **THEN** 系统在路由前拒绝，不建立临时任意目标连接，也不回退为本机操作

#### Scenario: 用户尝试局域网明文连接
- **WHEN** 远端节点只有非回环明文 HTTP 地址而没有受信 SSH 通道
- **THEN** V1 拒绝登记或连接，不建议开启 LAN 暴露作为替代
