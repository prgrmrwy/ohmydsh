## MODIFIED Requirements

### Requirement: Pet 是不为任何布局让位的顶层浮层

Pet SHALL 渲染在一个不受 DSH 应用外壳布局影响的顶层平面上：其位置 SHALL 以视口
为坐标系，MUST NOT 因任何面板、侧栏或工作台的展开、收起、拖拽调宽而被移动、压缩
或裁剪。

具体地，系统 MUST NOT 把 Pet 的定位包含块建立在 `#root` 或应用 frame 之内。已知
的挤压来源是采用 "layout push" 形态的插件（例如 `dsh-better-sidebar` 对 `#root`
施加 `margin-right` 与 `width: calc(100% - …)`）：此类布局变化 SHALL 对 Pet 的
屏幕位置无任何影响。

Pet 的层叠顺序 SHALL 高于普通应用内容（对话区、侧栏、工作台面板等），但 MUST
低于官方 Settings 弹层：Settings 打开时 SHALL 完整可见并可操作，不被 Pet 的
桌宠本体、展开的轮盘菜单或 Task 面板遮挡。层叠顺序本身 MUST NOT 被当作解决
挤压的手段——挤压属于定位包含块问题，提高 z-index 不能修复它；"高于普通内容、
低于 Settings" 只解决层叠顺序本身的问题，与挤压/裁剪问题相互独立。

#### Scenario: 右侧工作台展开
- **WHEN** 用户展开 better-sidebar 的右侧工作台，使 `#root` 被压窄
- **THEN** Pet 的屏幕位置保持不变，不被推向左侧，也不被裁剪

#### Scenario: 拖拽调整侧栏宽度
- **WHEN** 用户拖拽侧栏分隔条连续改变宽度
- **THEN** Pet 全程保持在原屏幕位置，不随拖拽移动

#### Scenario: 停靠在右边缘时展开侧栏
- **WHEN** Pet 被拖到视口右边缘，随后侧栏展开
- **THEN** Pet 仍完整可见于原位置，可能被侧栏覆盖或覆盖侧栏，但不被移动或裁掉

#### Scenario: 窗口尺寸变化仍然生效
- **WHEN** 浏览器窗口尺寸改变
- **THEN** Pet 仍被约束在视口内（既有钳制行为不变），且该钳制依据视口尺寸而非
      被压缩后的应用宽度

#### Scenario: 打开 Settings 面板时 Pet 让位
- **WHEN** 用户打开 DSH 官方 Settings 面板（包括 Pet 自己的设置分区），此时
      Pet 处于任意状态（收起、轮盘展开或 Task 面板打开）
- **THEN** Settings 弹层（含其遮罩）完整覆盖在 Pet 之上，Pet 的桌宠本体、
      轮盘或面板均不可见于 Settings 内容之上；关闭 Settings 后 Pet 恢复
      原有的显示与交互
