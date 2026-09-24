# dsh-pet 规范增量：轮盘改版

本增量以 `add-dsh-pet` change 中的 `specs/dsh-pet/spec.md` 为基准。该能力的规范尚未归档到 `openspec/specs/`，因此下列 MODIFIED 需求的原文取自该 change。

## MODIFIED Requirements

### Requirement: Web 中提供常驻、可拖动且可访问的 Pet 入口

系统 SHALL 在 DSH 页面提供不替换原生工作台的 frame-wide 浮动 Pet。Pet SHALL 在普通会话、无会话 Hero 和 Settings 等页面状态间保持可用，允许用户拖动位置，并在页面重载后恢复已保存的位置。Pet MUST NOT 默认遮挡底层页面交互；其可交互表面 SHALL 明确接管指针和键盘操作，而未绘制区域 MUST NOT 拦截指针事件。

快捷能力 SHALL 呈现为以 Pet 本体为圆心的同心圆环轮盘。轮盘 SHALL 由内向外填充，每圈填满后才启用下一圈，最多三圈，容量依次为 6、8、10，合计上限 24 个能力；超出上限的能力 MUST NOT 渲染，且 MUST NOT 因此报错或阻断其余能力。

hover Pet 本体或等价键盘操作 SHALL 展开轮盘；指向 Pet 本体之外的区域 MUST NOT 唤起轮盘。展开后，从圆心到最外侧已渲染圆环之间的整个圆盘 SHALL 视为轮盘的可保持区域，其中包含圆环之间的间隙与扇区接缝；指针离开该区域 SHALL 立即收起轮盘。可保持区域的半径 SHALL 按实际渲染的圈数计算，MUST NOT 按最大圈数计算。

轮盘 SHALL 逐圈渐入：第一圈在展开时立即可见，其后每圈依次延迟出现，使层次可被感知而不显著推迟可操作时间。

扇区标签 SHALL 沿弧线切向排布并随扇区角度旋转；当该角度会使文字上下颠倒时，系统 SHALL 将其翻转 180°，使任意位置的标签均保持可正向阅读。标签超出扇区弧长可容纳的宽度时 SHALL 截断并以省略号标示。

点击 Pet 本体 SHALL 打开 Task 面板或提供等价入口。所有能力、任务状态和上下文选择 MUST 可通过键盘操作，且深色与浅色主题下均保持可辨认。

#### Scenario: 在会话之间切换
- **WHEN** 用户从一个 DSH session 切换到另一个 session
- **THEN** Pet 保持挂载且位置不变，后续操作使用新的当前页面上下文而不是先前页面上下文

#### Scenario: 拖动并重载页面
- **WHEN** 用户拖动 Pet 到新的可见位置后重载 DSH 页面
- **THEN** Pet 在视口边界内恢复到已保存位置

#### Scenario: 指针掠过 Pet 周围空白
- **WHEN** 指针经过 Pet 本体之外、轮盘尚未展开的区域
- **THEN** 轮盘保持收起，且该区域不拦截底层页面的指针操作

#### Scenario: 从 Pet 本体移向外圈能力
- **WHEN** 用户 hover Pet 展开轮盘后，将指针移向某个外圈扇区
- **THEN** 轮盘在移动全程保持展开，经过圆环间隙与扇区接缝时不收起

#### Scenario: 能力不足以填满三圈
- **WHEN** 已启用能力只够渲染一圈，用户将指针移到第二圈本应所在的空白位置
- **THEN** 轮盘收起，因为该位置不属于已渲染的圆盘

#### Scenario: 能力数量超过轮盘上限
- **WHEN** 已启用能力多于 24 个
- **THEN** 轮盘渲染前 24 个能力，其余不渲染，且轮盘与其余功能均可正常使用

#### Scenario: 标签位于轮盘下方
- **WHEN** 某个能力的扇区位于轮盘正下方
- **THEN** 该扇区标签正向朝上显示，不出现上下颠倒

#### Scenario: 键盘使用能力轮盘
- **WHEN** 键盘用户聚焦 Pet 并打开快捷能力
- **THEN** 用户可以遍历、选择或关闭能力轮盘，焦点状态和能力禁用原因均可感知

### Requirement: Pet 面板按来源聚合并管理 Task 和 Invocation

Pet 面板 SHALL 显示当前来源 scope 的活跃 Pet Task、其 executor session 状态和按时间排列的 Invocations，并允许切换查看其它来源和已归档 Task。每个 Invocation SHALL 显示能力、运行/排队/等待/结果/失败状态及必要结果链接；复杂执行过程 SHALL 通过打开原生 executor session 查看，Pet 面板不要求复制完整 DSH transcript。

面板中每个 Task SHALL 呈现为单一可点击条目，点击 SHALL 打开该 Task 的 executor session。面板 MUST NOT 提供归档 Task 的入口；归档 SHALL 在 executor session 自身完成，Pet SHALL 观察归档变化并同步——终态 Task 自动归档，非终态 Task 保持活跃并给出可诊断说明，MUST NOT 把外部归档当作工作已被取消的证据。

用户 SHALL 能从面板回答当前等待问题。重试瞬态执行尝试不得创建新 snapshot；用户主动重新执行能力 SHALL 创建新 Invocation 和新 snapshot。

#### Scenario: 当前 session 有多次 Pet 调用
- **WHEN** 当前 source session 的 Pet Task 已执行 Create MR 并正在执行 Send CR
- **THEN** 面板在一个 Task 下显示两条 Invocation、各自状态和同一个 executor session 跳转入口

#### Scenario: 查看其它来源任务
- **WHEN** 用户从当前来源切换到“全部任务”
- **THEN** 面板可按 source session/workspace/独立来源聚合展示活跃和已归档 Task，且不会把 executor session 当作 source

#### Scenario: 从面板进入执行会话
- **WHEN** 用户点击面板中的某个 Task 条目
- **THEN** 系统打开该 Task 的 executor session，且该条目不提供归档或取消操作

#### Scenario: 在会话中归档终态 Task
- **WHEN** 用户在某个终态 Pet Task 的 executor session 中归档该会话
- **THEN** Pet 同步将该 Task 标记为已归档，无需用户在 Pet 面板中另行操作

#### Scenario: 在会话中归档仍在进行的 Task
- **WHEN** 用户归档了一个仍处于非终态的 Pet Task 的 executor session
- **THEN** 该 Task 保持活跃并显示可诊断说明，Pet 不将其视为已取消

### Requirement: Pet Skill 通过显式安装和启用清单管理

Pet SHALL 将“已安装”“已启用”“显示为快捷能力”建模为显式 Pet 配置，而 MUST NOT 把 DSH 全局 Skill 发现结果自动加入 Pet。Pet Agent 的 model-facing catalog、`skill` loader 和用户显式 `/<skill-name>` 注入 SHALL 只允许当前配置代际中已启用且由当前 Invocation 固定版本的 Pet Skill；未启用、仅全局可见、已卸载或名称碰撞的 Skill SHALL fail-closed。

设置界面 SHALL 在已启用 Skill 达到轮盘容量上限（24 个）时阻止继续启用，并说明原因。该上限属于呈现约束，MUST NOT 影响授权边界：超出上限不改变任何 Skill 的启用状态或可执行性，只影响其是否出现在轮盘上。

一期 SHALL 支持两种安装来源：Pet 插件 manifest 显式声明的受信内置 Skill，以及用户从运行当前 `dsh web` 的 Host 机器绝对路径显式导入的单层 Skill bundle。Web UI SHALL 先提交该路径执行只读检查并展示名称、摘要、文件范围、来源和风险预览，只有用户再次确认后才注册安装；它 MUST NOT 把路径解释为浏览器客户端路径。

#### Scenario: 启用数量达到上限
- **WHEN** 用户已启用 24 个 Skill，并尝试启用第 25 个
- **THEN** 系统拒绝该次启用并说明已达轮盘容量上限，已启用的 Skill 不受影响

#### Scenario: 存量启用数超过上限
- **WHEN** 由于历史数据，已启用 Skill 数量超过 24 个
- **THEN** 轮盘只渲染前 24 个，其余 Skill 仍可被调用与管理，系统不报错
