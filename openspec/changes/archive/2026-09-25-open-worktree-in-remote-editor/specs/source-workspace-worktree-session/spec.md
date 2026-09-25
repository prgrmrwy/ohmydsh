## MODIFIED Requirements

### Requirement: Editor open behavior is configurable
系统 SHALL 允许配置编辑器打开方式；默认 SHALL 使用 `vscode://file/<绝对路径>` deep link 交给本机处理。配置变更 MUST NOT 改变绑定模型、持久格式、wire 或 schema。

系统 SHALL 额外提供运行时注册点，允许同页面其它插件替换打开行为（见 `worktree-open-handler-registry`）。存在已注册实现时 SHALL 优先使用；无注册方、注册方拒绝或异常时 SHALL 回落到上述默认 deep link 行为。该注册能力 MUST NOT 声明为加载期必需依赖，且其定义 MUST NOT 引用任何具体注册方。

#### Scenario: Default deep link
- **WHEN** 用户未自定义打开方式且点击分支名
- **THEN** 系统 SHALL 以 `vscode://file/<worktreePath>` 交给本机打开

#### Scenario: Missing local editor
- **WHEN** 本机没有注册处理 deep link 的编辑器
- **THEN** 系统 SHALL 不静默失败；其行为由操作系统/浏览器对未注册 scheme 的标准处理决定，且不得伪造成功

#### Scenario: Registered open handler present
- **WHEN** 某插件已注册打开行为，且用户点击已绑定会话的分支名
- **THEN** 系统 SHALL 把 `worktreePath` 交给已注册的实现，MUST NOT 同时产出 `vscode://file/` deep link

#### Scenario: No registered open handler
- **WHEN** 没有任何插件注册打开行为
- **THEN** 系统 SHALL 保持既有 `vscode://file/<worktreePath>` 行为不变，且插件 SHALL 正常加载

#### Scenario: Registered open handler fails
- **WHEN** 已注册的实现在执行中抛错或被拒绝
- **THEN** 系统 SHALL 回落到 `vscode://file/<worktreePath>`，且不向用户报告成功
