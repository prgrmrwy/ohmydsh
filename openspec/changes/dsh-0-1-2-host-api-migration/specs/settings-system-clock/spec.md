## MODIFIED Requirements

### Requirement: 时间真相源为主机进程
系统 SHALL 通过 host 半区注册的 Connection RPC channel `/dsh-system-clock` 向浏览器提供一次时间采样：主机 epoch 毫秒、主机 IANA 时区、主机当前 UTC 偏移（分钟）与主机 hostname。客户端 SHALL 以该采样为基准（与 `Date.now()` 求 skew）驱动本地每秒 tick；**不得**以浏览器本地时间冒充主机时间。

该 channel SHALL 只对本机回环来源可用。该限制在 DSH `0.1.1-rc.2` 上由注册时显式传入的 `authority: loopback` 表达；`0.1.2` 线移除了该注册参数，因此**表达方式随运行体而变，约束本身不变**：在目标运行体上，系统 SHALL 采用该运行体提供的等价机制维持同一边界，并以实际验证确认非回环来源不可达。当目标运行体确实不提供等价机制时，系统 SHALL 停止并将该缺口作为显式决策交由人处理，MUST NOT 以"注册参数已不存在"为由默认放弃该限制。

#### Scenario: 主机时间与浏览器时区不同
- **WHEN** DSH 主机时区为 Asia/Shanghai，而浏览器所在设备时区为 America/Los_Angeles
- **THEN** 时钟显示主机墙钟时间与主机时区标签（如 `Asia/Shanghai (UTC+08:00)`），而不是浏览器本地时区的时间

#### Scenario: channel 未注册/不可达
- **WHEN** host 无 `connection` 服务（如 headless 组合）或 channel 未注册
- **THEN** 页面显示明确的「主机时钟不可用」降级态并周期重试，**不**静默显示浏览器本地时间

#### Scenario: 运行体移除了 authority 注册参数
- **WHEN** 运行体升级后 RPC 注册接口不再接受 `authority` 参数
- **THEN** 系统 SHALL 以该运行体的等价机制维持"仅本机回环可用"这一边界，MUST NOT 因参数消失而静默放弃该限制

### Requirement: 只读与安全
系统 SHALL 仅通过官方 `settings.section` 槽与通用 connection RPC 通道工作：不发起第三方网络请求、不读取会话/凭据/文件、不修改官方 DOM 结构与 class；业务返回仅含时间/时区/hostname 这类无害主机事实。

该 channel SHALL 仅对本机回环来源可用（表达方式见「时间真相源为主机进程」：`0.1.1-rc.2` 为注册时的 `authority: loopback`，`0.1.2` 线改用该运行体的等价机制）。无论采用哪种表达，"通道不对非回环来源开放"这一约束 SHALL 始终成立并经实际验证。

#### Scenario: 无外部网络外呼
- **WHEN** 时钟正常走时
- **THEN** 不产生任何对 DSH 主机之外的网络请求

#### Scenario: 官方 UI 不被改写
- **WHEN** 时钟章节渲染
- **THEN** 除本插件注入的样式与章节内容外，官方设置面板结构与其它章节不受影响

#### Scenario: 非回环来源访问 channel
- **WHEN** 非本机回环来源尝试访问 `/dsh-system-clock`
- **THEN** 该请求 SHALL 不被受理，且该行为 SHALL 在运行体迁移后经实际验证确认仍然成立
