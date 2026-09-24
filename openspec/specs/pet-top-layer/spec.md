# Pet Top Layer Specification

## Purpose
Pet 作为不为任何应用布局让位的顶层浮层：独立挂载点与独立 React root、视口坐标系定位，以及交互与拖拽状态在挂载方式变更后仍完好。

## Requirements

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

### Requirement: 独立挂载不得破坏 React 交互与既有状态

为脱离应用布局，Pet SHALL 挂载在 `document.body` 下自有的宿主节点中，并为该节点
建立**独立的 React root**。系统 MUST NOT 通过把已挂载节点移出宿主 React root 的
容器（re-parent 或向 body portal）来实现脱离：React 在其挂载容器上做事件委托，
移出容器会使 hover、拖拽、点击等合成事件静默失效，而元素看起来仍正常渲染。

独立 root SHALL 由插件自身管理生命周期，并在插件卸载时 unmount 该 root 并移除
宿主节点，不得泄漏节点或监听器。

承载 Pet 的组件 SHALL 保持稳定的组件标识（在模块作用域声明，而非每次渲染新建的
内联组件），使外壳的页面切换不会重新挂载 Pet 而丢失拖拽位置与面板状态。

#### Scenario: 挂载方式变更后交互完好
- **WHEN** Pet 改为独立 root 挂载后，用户 hover Pet、拖拽 Pet、点击轮盘扇区
- **THEN** 三者均正常响应，与变更前行为一致

#### Scenario: 页面状态切换不丢状态
- **WHEN** 用户在会话、无会话 Hero 与 Settings 之间切换
- **THEN** Pet 保持挂载，位置与已打开的面板状态不丢失

#### Scenario: 插件卸载清理干净
- **WHEN** Pet 客户端插件被卸载
- **THEN** 独立 React root 被 unmount、宿主节点被移除，无残留节点或事件监听器

#### Scenario: 未绘制区域不拦截页面操作
- **WHEN** 指针位于 Pet 宿主平面内但不在 Pet 本体或已展开轮盘之上
- **THEN** 该处的点击落到下层页面元素，Pet 的宿主节点不吞掉指针事件

### Requirement: 位移通道 MUST NOT 削弱顶层浮层的既有保证

系统 SHALL 保证 Pet 采用 `transform` 一类由合成器直接搬运图层的位移通道时，该
通道的两项副作用都不削弱顶层浮层的既有保证：根节点同时成为 stacking context，
以及成为后代绝对定位元素的 containing block。

**层叠顺序不受影响。** Pet 的根节点已经是 `position:fixed` 且带有非 `auto`
的 `z-index`，本身已经是一个 stacking context——引入 `transform` 不新增任何
一层。Pet 仍 SHALL 以其既定 `z-index` 值直接参与根 stacking context 的比较，
即"高于普通应用内容、严格低于官方 Settings 弹层"这一既有关系 MUST NOT 改变。
系统 MUST NOT 因为改用 `transform` 而调整该 `z-index` 值。

**定位参照系不受影响。** Pet 的后代元素（轮盘、Task 面板、角标等）本就以 Pet
的根节点为参照，而非以视口或应用 frame 为参照。改用 `transform` 后该参照关系
SHALL 保持一致，MUST NOT 使任何后代元素改为参照其他祖先，也 MUST NOT 使其
相对 Pet 本体的位置发生偏移。

**不为布局让位不受影响。** Pet 的定位包含块 SHALL 仍是视口，MUST NOT 因位移
通道的变化而回落到 `#root` 或应用 frame 之内；layout-push 形态的插件压缩
`#root` 时，Pet 的屏幕位置 SHALL 仍然不受任何影响。

#### Scenario: 改用合成器位移后 Settings 仍在 Pet 之上
- **WHEN** Pet 以 `transform` 定位，用户打开官方 Settings 面板，此时 Pet 处于
      任意状态（收起、轮盘展开或 Task 面板打开）
- **THEN** Settings 弹层（含其遮罩）仍完整覆盖在 Pet 之上，Pet 的本体、轮盘与
      面板均不可见于 Settings 内容之上

#### Scenario: 改用合成器位移后仍不被侧栏顶走
- **WHEN** Pet 以 `transform` 定位，用户展开 layout-push 形态的侧栏使 `#root`
      被压窄
- **THEN** Pet 的屏幕位置保持不变，不被推移也不被裁剪

#### Scenario: 后代元素仍锚定在 Pet 本体上
- **WHEN** Pet 以 `transform` 定位并被拖到视口的任意位置，随后展开轮盘与 Task 面板
- **THEN** 轮盘仍以 Pet 本体为圆心，Task 面板与角标仍保持相对 Pet 本体的既有
      位置，不出现偏移
