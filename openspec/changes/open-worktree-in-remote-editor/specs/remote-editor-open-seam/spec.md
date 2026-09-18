## ADDED Requirements

### Requirement: 远程编辑器打开能力是可选的、经探测消费的浏览器侧接缝
系统 SHALL 以**可选服务**形式提供「把一个绝对路径交给用户所在机器的编辑器打开」的能力。消费方 MUST 通过运行时探测（`ctx.get()` 语义）获取该能力，MUST NOT 将其声明为加载期必需依赖（`inject`）。

该约束是硬性的：把可选服务写入 `inject` 会使缺该服务的 Host **整个插件静默不加载**，表现为功能无声消失而非降级。

#### Scenario: 能力存在时被探测到
- **WHEN** 页面中存在该能力的提供方且已完成初始化
- **THEN** 消费方 SHALL 探测到该能力并可发起打开请求

#### Scenario: 能力缺失时消费方仍正常工作
- **WHEN** 页面中不存在该能力的提供方（例如未安装提供方插件、或未经 cockpit 访问）
- **THEN** 消费方 SHALL 正常加载并保持其本机默认打开行为，MUST NOT 因探测失败而崩溃、阻塞或跳过渲染

#### Scenario: 能力不得成为加载期依赖
- **WHEN** 消费方插件声明依赖
- **THEN** 该能力 MUST NOT 出现在 `inject` 列表中；消费方在提供方缺失时 MUST 仍然完成加载

### Requirement: 远程 authority 由宿主机侧持有并经受控通道下发
提供方 SHALL 从宿主机侧的设备登记信息中获得远程 authority 材料（SSH alias），并经**已存在的、经 origin 严格校验的** postMessage 通道下发给页面内的提供方插件。系统 MUST NOT 为此新增任何未经 origin 校验的跨文档通道。

下发的 alias MUST 满足 SSH config alias 的字符约束（仅 `[A-Za-z0-9]` 开头，后续限 `[A-Za-z0-9._-]`，长度上限 128）。不满足约束的 alias MUST 被拒绝，且 MUST NOT 参与 URI 拼装。

#### Scenario: 合法 alias 随握手下发
- **WHEN** 宿主机侧父页面向页面内提供方发起配置握手，且当前设备登记了合法 sshAlias
- **THEN** 该 alias SHALL 随握手消息一并下发，并使远程打开能力可用

#### Scenario: 设备无 alias（本机设备）
- **WHEN** 当前设备是本机设备、未登记 sshAlias
- **THEN** 握手 MUST NOT 声明远程打开能力可用；消费方按能力缺失处理，回落本机默认行为

#### Scenario: alias 不满足字符约束
- **WHEN** 下发或读取到的 alias 含 `@`、`:`、空白或其它约束外字符
- **THEN** 系统 SHALL 拒绝该 alias，MUST NOT 拼装 URI，并按能力缺失降级

#### Scenario: 非法来源的消息被丢弃
- **WHEN** 页面收到声称携带 alias 的 postMessage，但其 origin 与期望的宿主机 origin 不匹配
- **THEN** 系统 SHALL 丢弃该消息，MUST NOT 据此启用或更新远程打开能力

### Requirement: URI 在宿主机侧产出，路径经白名单校验
远程打开的 URI SHALL 由**宿主机侧父页面**产出并交给系统 handler，MUST NOT 由内嵌文档自行发起该导航。

在产出 URI 前，系统 SHALL 校验路径：MUST 为绝对路径，MUST NOT 含 `..` 路径段。校验失败 MUST 拒绝打开且不产出 URI。

URI 形态 SHALL 为 `vscode://vscode-remote/ssh-remote+<alias><absolute-path>?windowId=_blank`，其中 `windowId=_blank` 用于强制新窗口而非复用当前窗口。

#### Scenario: 合法路径产出远程深链
- **WHEN** 提供方收到一个绝对路径的打开请求，且当前 alias 合法
- **THEN** 宿主机侧父页面 SHALL 产出 `vscode://vscode-remote/ssh-remote+<alias><path>?windowId=_blank` 并交给系统 handler

#### Scenario: 相对路径被拒绝
- **WHEN** 打开请求携带的路径不是绝对路径
- **THEN** 系统 SHALL 拒绝该请求，MUST NOT 产出任何 URI

#### Scenario: 路径含上跳段被拒绝
- **WHEN** 打开请求携带的路径含 `..` 段
- **THEN** 系统 SHALL 拒绝该请求，MUST NOT 产出任何 URI

#### Scenario: 内嵌文档不自行导航
- **WHEN** 远程打开能力可用且用户触发打开
- **THEN** 内嵌文档 SHALL 把请求交给父页面处理，MUST NOT 自行调用 `window.open` 触发 `vscode-remote` 深链

### Requirement: 全部失败路径安全降级且不伪造成功
系统 MUST NOT 在任何失败路径上伪造打开成功。当远程打开不可用或被拒绝时，消费方 SHALL 回落到其本机默认打开行为；当本机行为同样无法完成时，其结果由操作系统/浏览器对未注册 scheme 的标准处理决定。

远程打开能力的任何异常 MUST NOT 影响宿主 DSH 页面的其余功能。

#### Scenario: 提供方在请求过程中异常
- **WHEN** 消费方已探测到能力，但发起请求时提供方抛错或无响应
- **THEN** 消费方 SHALL 安全降级到本机默认打开行为，且不向用户报告成功

#### Scenario: 编辑器未注册 scheme
- **WHEN** URI 已交给系统 handler，但用户机器上没有注册处理该 scheme 的编辑器
- **THEN** 系统 SHALL 不伪造成功；其行为由操作系统/浏览器的标准处理决定

#### Scenario: 能力异常不扩散
- **WHEN** 远程打开链路任一环节发生异常
- **THEN** 宿主 DSH 页面的其余功能 SHALL 不受影响

### Requirement: 接缝只传输最小标识，不扩展执行面
经该接缝传输的信息 SHALL 限于：一个 SSH alias 与一个绝对路径。系统 MUST NOT 经该接缝传输凭据、token、会话内容或用户配置。

该接缝 MUST NOT 新增任何远端命令执行面。宿主机侧已有的 SSH 连接用途 SHALL 保持不变（仅端口转发），MUST NOT 因本能力而获得执行任意命令的通道。

#### Scenario: 传输内容受限
- **WHEN** 接缝传递一次打开请求
- **THEN** 其载荷 SHALL 仅含路径与协议元数据，MUST NOT 含凭据、token 或会话内容

#### Scenario: 不新增远端执行面
- **WHEN** 远程打开能力被使用
- **THEN** 系统 SHALL 仅产出 URI 交给本地系统 handler，MUST NOT 经 SSH 或任何其它通道在远端执行命令
