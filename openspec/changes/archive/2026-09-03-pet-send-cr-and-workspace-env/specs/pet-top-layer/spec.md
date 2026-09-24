## ADDED Requirements

### Requirement: Pet 是不为任何布局让位的顶层浮层

Pet SHALL 渲染在一个不受 DSH 应用外壳布局影响的顶层平面上：其位置 SHALL 以视口
为坐标系，MUST NOT 因任何面板、侧栏或工作台的展开、收起、拖拽调宽而被移动、压缩
或裁剪。

具体地，系统 MUST NOT 把 Pet 的定位包含块建立在 `#root` 或应用 frame 之内。已知
的挤压来源是采用 "layout push" 形态的插件（例如 `dsh-better-sidebar` 对 `#root`
施加 `margin-right` 与 `width: calc(100% - …)`）：此类布局变化 SHALL 对 Pet 的
屏幕位置无任何影响。

Pet 的层叠顺序 SHALL 高于普通应用内容。层叠顺序本身 MUST NOT 被当作解决挤压的
手段——挤压属于定位包含块问题，提高 z-index 不能修复它。

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