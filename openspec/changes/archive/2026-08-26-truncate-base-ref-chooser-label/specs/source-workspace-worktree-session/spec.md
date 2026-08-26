## ADDED Requirements

### Requirement: Input-area base ref chooser shows refs in one line with a hover full name
输入区在空白会话创建态展示 base ref 选择器时，选择器按钮标签与下拉候选项的 ref 名 SHALL 以单行渲染，超出可用宽度时以省略号截断且不发生换行；当用户 hover 按钮或候选项时，SHALL 能看到该 ref 的完整名称。该展示行为 MUST NOT 改变 base ref 选择语义（选择仍不产生任何 Git 副作用），也不得改变绑定模型、生命周期状态或任何持久数据。

#### Scenario: Long selected base ref keeps the input row on one line
- **WHEN** 空白会话已选中的 base ref 名在选择器按钮可用宽度内无法完整容纳
- **THEN** 按钮 SHALL 保持单行布局，超宽部分以省略号显示，且不因换行而增加输入区控件行高

#### Scenario: Hover the chooser reveals the full selected ref name
- **WHEN** 用户将指针悬停在 base ref 选择器按钮上
- **THEN** 系统 SHALL 展示当前选中 ref 的完整名称，并同时保留“选择 base ref 不产生 Git 副作用”的说明语义

#### Scenario: Long candidate ref in the dropdown stays on one line
- **WHEN** 下拉候选列表中某个本地或远端 ref 名超出候选面板可用宽度
- **THEN** 该候选项 SHALL 单行省略显示，且 hover 时展示该候选 ref 的完整名称

#### Scenario: Short ref names are unaffected
- **WHEN** 选中的 ref 名或候选 ref 名在可用宽度内可完整容纳
- **THEN** 系统 SHALL 完整显示该名称且不添加省略号或截断

#### Scenario: Selection still has no Git side effects
- **WHEN** 用户在下拉列表中点选任意候选 ref
- **THEN** 系统 SHALL 仅更新该会话的暂存 base ref 选择，且 MUST NOT 执行任何 Git 操作或产生持久绑定
