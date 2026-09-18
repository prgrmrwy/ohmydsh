## MODIFIED Requirements

### Requirement: Editor open behavior is configurable
系统 SHALL 允许配置编辑器打开方式；默认 SHALL 使用 `vscode://file/<绝对路径>` deep link 交给本机处理。配置变更 MUST NOT 改变绑定模型、持久格式、wire 或 schema。

当页面中存在可选的远程编辑器打开能力（见 `remote-editor-open-seam`）时，系统 SHALL 优先委派给该能力；该能力缺失、拒绝或异常时 SHALL 回落到上述默认 deep link 行为。探测 MUST 为运行时探测，MUST NOT 声明为加载期必需依赖。

#### Scenario: Default deep link
- **WHEN** 用户未自定义打开方式且点击分支名
- **THEN** 系统 SHALL 以 `vscode://file/<worktreePath>` 交给本机打开

#### Scenario: Missing local editor
- **WHEN** 本机没有注册处理 deep link 的编辑器
- **THEN** 系统 SHALL 不静默失败；其行为由操作系统/浏览器对未注册 scheme 的标准处理决定，且不得伪造成功

#### Scenario: Remote open capability present
- **WHEN** 页面中存在可用的远程编辑器打开能力，且用户点击已绑定会话的分支名
- **THEN** 系统 SHALL 把 `worktreePath` 委派给该能力，MUST NOT 自行产出 `vscode://file/` deep link

#### Scenario: Remote open capability absent
- **WHEN** 页面中不存在远程编辑器打开能力（未安装提供方，或未经 cockpit 访问）
- **THEN** 系统 SHALL 保持既有 `vscode://file/<worktreePath>` 行为不变，且插件 SHALL 正常加载

#### Scenario: Remote open capability fails
- **WHEN** 已探测到远程能力但委派过程中抛错或被拒绝
- **THEN** 系统 SHALL 回落到 `vscode://file/<worktreePath>`，且不向用户报告成功
