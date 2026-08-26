## Purpose

让本机 DSH 通过受信 OpenSSH 通道登记、探测和持续连接多个普通远端 DSH Host，同时保持节点独立故障、凭据不出节点和可诊断的安全生命周期。

## ADDED Requirements

### Requirement: GUI 仅登记已验证的非交互 SSH 节点
系统 SHALL 允许用户在中央 GUI 以显示名、SSH alias 和远端 DSH 端口添加节点。节点只有在系统 OpenSSH 能以非交互模式解析 alias、通过既有 `known_hosts` 校验并完成公钥或 SSH Agent 认证后才可持久保存；系统 MUST NOT 关闭主机密钥校验，也 MUST NOT 在节点 registry 中保存密码、私钥内容、passphrase 或 provider secret。

#### Scenario: 已预验证 alias 可添加
- **WHEN** 用户添加一个已在终端完成主机密钥确认且 `BatchMode` 登录成功的 SSH alias
- **THEN** 系统生成不可变 node id 并持久保存节点显示名、alias、端口、顺序与启用状态

#### Scenario: 交互认证节点被拒绝
- **WHEN** SSH 连接要求密码、MFA、首次指纹确认或无法使用 SSH Agent
- **THEN** 系统拒绝保存该节点并提示用户先在终端完成验证，不得降级为不安全连接

### Requirement: 节点实例使用私有且保守的持久化 registry
系统 SHALL 将 GUI 管理的节点实例原子写入 `$DSH_HOME/plugins/dsh-federation/nodes.json`，父目录和文件权限 SHALL 为 owner-only，并对目标执行 regular-file/no-follow 或等价检查。更新 SHALL 串行化并采用 generation/CAS、0600 temp、fsync、rename 和目录持久化；`dsh.yaml` SHALL 只控制联邦 package 和全局策略，不记录节点实例。registry 无法解析、是 symlink、版本未知或身份状态无法证明时系统 MUST fail closed，且 MUST NOT 用空配置覆盖原文件。

#### Scenario: 节点变更原子落盘
- **WHEN** 用户成功添加、重命名、重排、启用、禁用或删除节点
- **THEN** 系统通过临时文件加 rename 提交完整 registry，并保持 node id 在显示名或 alias 变化后不变

#### Scenario: registry 损坏
- **WHEN** 启动时 registry 内容损坏或版本未知
- **THEN** 联邦节点不激活、原文件保持不变，GUI 展示可操作诊断且本机官方 DSH 仍可用

### Requirement: 中央使用系统 OpenSSH 管理回环隧道
系统 SHALL 通过系统 OpenSSH 和保存的 alias 建立只监听中央 `127.0.0.1` 的本地转发，复用用户的 `~/.ssh/config`、`known_hosts`、SSH Agent 与 `ProxyJump`。隧道 SHALL 以严格 argv 构造和 option boundary 防止 alias 注入，启用 `BatchMode`、`ExitOnForwardFailure` 和有界 keepalive；stderr SHALL 有界并脱敏。由于 stock OpenSSH 无可移植的 listener-FD 接管接口，本地端口分配 SHALL 使用 OS 分配的候选回环端口，关闭临时 reservation 后启动受跟踪 SSH；若 OpenSSH 绑定竞争失败则分配新候选并有界重试。系统 MUST NOT 在自有 SSH 子进程存活且 DSH 协议 readiness probe 成功之前向 carrier 发布 endpoint，因此端口竞争或无关服务不得形成 false-ready。系统 SHALL 跟踪每个隧道进程，并在节点禁用、删除、正常进程 disposal 或可捕获终止信号时幂等清理自有进程、socket 与 timer；不得盲目终止无法证明归属的其他 SSH 进程。不可捕获的 `SIGKILL`、内核崩溃或断电不宣称同步 disposer 保证，重启后也不得仅按端口或命令行相似性杀进程。

#### Scenario: 隧道成功建立
- **WHEN** SSH 身份有效且远端端口可转发
- **THEN** 系统为该节点分配独立回环端口，并仅将此本地地址交给上层 DSH carrier

#### Scenario: 本地转发 listener 绑定失败
- **WHEN** OpenSSH 无法绑定候选本地端口
- **THEN** `ExitOnForwardFailure` 使该 SSH 子进程失败，系统不发布 endpoint，并以新 OS 分配候选端口有界重试或显示隧道诊断

#### Scenario: SSH 已建立但远端 DSH 目标或协议不可用
- **WHEN** SSH 本地 listener 已建立，但后续 `direct-tcpip` channel、远端目标端口或 DSH 协议 probe 失败
- **THEN** 系统不依赖 `ExitOnForwardFailure` 判定远端 readiness，不发布 endpoint，并将故障分类为 tunnel/channel、`DSH_UNAVAILABLE`、非 DSH 服务或协议不兼容；不得把仅能监听的本地端口或其他服务误认为远端 DSH

### Requirement: 保存验证与 DSH Readiness 分离
系统 SHALL 只以非交互 SSH 身份验证作为保存节点或修改 alias 的提交条件；保存后再独立探测 tunnel 和 DSH readiness。readiness 失败 MUST NOT 撤销已经验证并保存的节点。系统 SHALL 至少区分 disabled、SSH 不可达、隧道失败、DSH unavailable、非 DSH 服务、DSH 不兼容、degraded 和 ready；MUST NOT 仅根据非交互 PATH 或 `command -v` 声称 DSH 未安装。中央不得自动安装、启动或停止远端 DSH。

#### Scenario: SSH 可达但 DSH 不可用
- **WHEN** 节点 SSH 验证成功但指定端口拒绝连接、端口错误或没有有效 DSH 协议
- **THEN** 节点仍保存在 registry 并显示 `DSH_UNAVAILABLE` 或更精确的协议诊断及人工修复指引，不得自动执行远端命令或拉起进程

#### Scenario: 修改 alias 验证超时或取消
- **WHEN** 已保存节点的新 alias 在非交互身份验证期间超时、失败或被用户取消
- **THEN** 系统保留原 alias 和连接配置，不提交部分变更

#### Scenario: 重复 alias 和端口
- **WHEN** 用户保存与已有节点相同的 alias 和远端端口
- **THEN** 系统给出重复警告但允许用独立 node id 保存，两个逻辑节点的身份和本地隧道仍相互隔离

#### Scenario: 可选能力缺失
- **WHEN** 核心 workspace/session 与事件能力可用，但一个可选扩展能力缺失
- **THEN** 节点进入 degraded 或 ready-with-warning，核心会话可用且缺失操作从 UI 隐藏

### Requirement: 节点独立重连且不误判远端任务
系统 SHALL 将每个节点视为独立故障域。SSH 或 carrier 断开时，系统 SHALL 标记观测中断、冻结该节点写操作并自动退避重连；系统 MUST NOT 把远端 turn 标记为失败、自动取消任务或重发写请求。重连 SHALL 建立新 generation，重新获取权威 baseline，并丢弃旧 generation 的迟到事件。

#### Scenario: 运行中断线后恢复
- **WHEN** 一个远端 session 正在运行时其隧道断开并随后恢复
- **THEN** 其他节点继续工作，该节点先显示 stale/offline，重连后按远端 workspace/session/history 和事件基线恢复真实状态

#### Scenario: 节点删除
- **WHEN** 用户从中央删除一个没有未知写操作的节点
- **THEN** 系统关闭中央连接并删除本地登记和可重建缓存，但不停止远端 DSH、不删除远端 workspace/session，也不修改远端文件或凭据

#### Scenario: 未知写操作存在时删除节点
- **WHEN** 节点仍有 `OUTCOME_UNKNOWN` 操作而用户请求删除
- **THEN** 系统要求明确确认，并在删除可重建投影后保留最小脱敏交付诊断直到用户明确清除，避免把删除节点误当作操作未执行的证据
