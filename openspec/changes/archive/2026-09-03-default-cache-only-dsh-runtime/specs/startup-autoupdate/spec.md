## MODIFIED Requirements

### Requirement: stop/restart 按端口安全管理 server 与 UI 生命周期

`dsh stop` 与 `dsh restart` 必须(SHALL)从目标端口的监听进程定位 server,并在信号终止前验证其 argv 属于 DSH web;不得仅依赖某一 npm/npx 版本的固定进程字符串,也不得终止无法证明属于 DSH 的端口占用者。`stop` 必须(SHALL NOT)执行 registry 查询、CLI provision 或包依赖计算。UI 清理必须独立于 server 匹配结果执行:关闭已安装 PWA,并清理 Chrome 普通窗口中指向同一 loopback 端口的遗留标签。`restart` 必须完整执行「停止 server → 关闭全部 UI 表面 → 确认端口释放 → 按 `dsh-runtime-provisioning` 的同一精确 pin 策略解析一次运行体 → 启动 server → 启动后按 UI 打开开关只打开 PWA(若存在)」。UI 清理(stop/restart)不受 `web.open` 影响:开关只约束"自动打开",不改变"停止时关闭"。

#### Scenario: npm/npx 升级改变 server argv

- **WHEN** 目标端口由 `node …/node_modules/.bin/dsh web --port <port>` 或受支持的 `lib/bin.js web --port <port>` 监听
- **THEN** stop/restart 仍能定位并停止该 server,不得因旧进程正则不匹配而提前返回

#### Scenario: 端口被非 DSH 服务占用

- **WHEN** 目标端口监听进程的 argv 无法证明属于 DSH web
- **THEN** stop/restart 拒绝发送信号并以错误退出

#### Scenario: stop 不触发运行体解析

- **WHEN** 操作者运行 `dsh stop`，无论目标 server 是否存在
- **THEN** 启动器只执行本地进程与 UI 清理，不调用 npm、npx、pnpm 或 registry

#### Scenario: restart 清理重复 UI

- **WHEN** PWA 与 Chrome 普通窗口中的同端口标签同时存在，且精确 pin 的运行体缓存已就绪
- **THEN** restart 关闭二者、无需依赖计算即重启 server，并按 `web.open` 只打开已配置或自动探测到的 PWA(开关关闭则不开)
