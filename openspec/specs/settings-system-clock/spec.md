# settings-system-clock Specification

## Purpose
在 Web 设置面板导航最底部新增一章「系统时钟」，实时显示 **DSH 主机系统** 的 24 小时制时间与主机时区，供跨时区多设备用户一眼确认当前 DSH 主机的墙钟时间与机器身份。时间真相源是 host 进程采样，而非浏览器本地时间。

## Requirements

### Requirement: 设置面板底部存在主机系统时钟章节
系统 SHALL 在设置面板导航列表的**最末尾**（order 高于通用/模型/插件/订阅等既有章节）注册并渲染 `settings.section`（id `system-clock`），导航标签按当前语言显示（中文「系统时钟」/ English "System Clock"），内容为实时主机时钟页。

#### Scenario: 章节出现在导航底部
- **WHEN** 用户打开设置面板
- **THEN** 导航列表底部出现「系统时钟」条目，点击后内容列渲染主机时钟页

#### Scenario: 语言切换后标签跟随
- **WHEN** 用户切换界面语言（中/英）
- **THEN** 导航标签随之切换，不残留旧语言

### Requirement: 时间真相源为主机进程
系统 SHALL 通过 host 半区注册的 Connection RPC channel `/dsh-system-clock`（`authority: loopback`）向浏览器提供一次时间采样：主机 epoch 毫秒、主机 IANA 时区、主机当前 UTC 偏移（分钟）与主机 hostname。客户端 SHALL 以该采样为基准（与 `Date.now()` 求 skew）驱动本地每秒 tick；**不得**以浏览器本地时间冒充主机时间。

#### Scenario: 主机时间与浏览器时区不同
- **WHEN** DSH 主机时区为 Asia/Shanghai，而浏览器所在设备时区为 America/Los_Angeles
- **THEN** 时钟显示主机墙钟时间与主机时区标签（如 `Asia/Shanghai (UTC+08:00)`），而不是浏览器本地时区的时间

#### Scenario: channel 未注册/不可达
- **WHEN** host 无 `connection` 服务（如 headless 组合）或 channel 未注册
- **THEN** 页面显示明确的「主机时钟不可用」降级态并周期重试，**不**静默显示浏览器本地时间

### Requirement: 24 小时制走秒时钟
系统 SHALL 以 24 小时制（无 AM/PM）、零填充渲染时分秒（`HH:MM:SS`），每秒更新一次；渲染 SHALL 通过 `Intl.DateTimeFormat` 使用主机 IANA 时区，使 DST 切换与历史偏移正确，而不要求客户端理解时区规则。

#### Scenario: 秒级刷新
- **WHEN** 时钟章节处于可见状态
- **THEN** 秒位每秒推进，时分相应更新

#### Scenario: 下午时刻不显示 AM/PM
- **WHEN** 主机墙钟为 14:05:09
- **THEN** 显示 `14:05:09`，不出现 PM

### Requirement: 展示日期与时区信息
系统 SHALL 在时刻下方展示主机时区日期（年-月-日 + 星期）与时区行：IANA 名（如 `Asia/Shanghai`）与当前 UTC 偏移（如 `(UTC+08:00)`）；主机无法提供 IANA 名时，时区行仅展示 `UTC±HH:MM`。SHALL 额外展示主机 hostname（小字，用于多设备区分）。

#### Scenario: 完整信息展示
- **WHEN** 主机采样返回 `timeZone: "Asia/Shanghai"`、`utcOffsetMinutes: -480`、`hostname: "devbox"`
- **THEN** 页面显示 `Asia/Shanghai (UTC+08:00)` 与 `DSH 主机 · devbox`，日期行显示上海当地日期与星期

#### Scenario: IANA 名缺失回退
- **WHEN** 主机采样 `timeZone` 为空且 `utcOffsetMinutes: 120`
- **THEN** 时区行显示 `UTC-02:00`

### Requirement: 周期与可见性重同步
系统 SHALL 以不超过 60s 的周期，并在页面从隐藏回到可见（`visibilitychange`）时重新调用 host 采样并重算 skew，以校准时钟漂移与主机时区 DST 切换；重同步失败 SHALL 保留现有 skew 继续走时，不得中断显示。

#### Scenario: 周期重同步
- **WHEN** 时钟运行超过 60s
- **THEN** 系统重新采样并以新采样重算 skew，显示无跳变地继续走秒

#### Scenario: 主机 DST 切换后被校正
- **WHEN** 主机时区发生 DST 切换，且随后发生一次重同步
- **THEN** 时钟显示切换后的主机墙钟时间

### Requirement: 只读与安全
系统 SHALL 仅通过官方 `settings.section` 槽与通用 connection RPC 通道工作：不发起第三方网络请求、不读取会话/凭据/文件、不修改官方 DOM 结构与 class；channel 以 `authority: loopback` 注册，业务返回仅含时间/时区/hostname 这类无害主机事实。

#### Scenario: 无外部网络外呼
- **WHEN** 时钟正常走时
- **THEN** 不产生任何对 DSH 主机之外的网络请求

#### Scenario: 官方 UI 不被改写
- **WHEN** 时钟章节渲染
- **THEN** 除本插件注入的样式与章节内容外，官方设置面板结构与其它章节不受影响
