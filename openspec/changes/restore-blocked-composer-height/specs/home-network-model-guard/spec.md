## MODIFIED Requirements

### Requirement: 门禁是 Host 强制边界并由客户端提前提示

系统 SHALL 在 Host 的模型流开始前拒绝阻断或未知出口的 Claude 调用，不得仅依赖浏览器输入框状态。Web 客户端 SHALL 使用 composer block 提前提示用户，但客户端状态不是授权边界。

该门禁 MUST 覆盖用户输入、CLI、subagent 和其他经过 Host LLM 流的 Claude 调用；已在门禁建立前开始的调用是否完成由 Host 当前请求生命周期决定，不得声称可以撤回已经发出的请求。

当客户端 composer block 生效时，输入区 SHALL 保持可见且保有至少一行文本的高度，其阻断原因文案 SHALL 可被用户读到。系统 MUST NOT 让被阻断的输入区塌陷到无法辨识原因的程度——阻断的可感知性是该 affordance 的组成部分，仅把原因写入 DOM 而用户看不见不满足本要求。

该可见性 SHALL NOT 依赖运行体版本的内部渲染细节（如输入框由何种编辑器实现、是否产出空段落、私有构建期类名）。当运行体升级导致被阻断输入区失去高度时，系统 SHALL 以不修改运行体自身产物的方式恢复该可见性，并在配置清单中记录该补偿的存在与移除条件。

#### Scenario: 绕过输入框调用 Claude

- **WHEN** 阻断或未知出口下通过 CLI、subagent 或其他非 Web 输入路径发起 Claude 模型流
- **THEN** Host 在向模型提供方发出请求前拒绝该调用

#### Scenario: 非 Claude Host 调用

- **WHEN** 阻断或未知出口下发起非 Claude 模型调用
- **THEN** Host 不因本门禁拒绝该调用

#### Scenario: 被阻断的输入区保持可读

- **WHEN** 出口被判定为阻断或未知，客户端对当前会话写入 composer block
- **THEN** 输入区仍占据至少一行文本的高度，阻断原因文案可被用户读到，而非塌陷为不可辨识的细条

#### Scenario: 运行体渲染变化不得使阻断提示失效

- **WHEN** 运行体升级改变了输入框的内部实现，使被阻断状态下输入区不再自带高度
- **THEN** 系统仍保证输入区可见与原因可读，且该保证不通过修改运行体自身产物实现
