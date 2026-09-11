## ADDED Requirements

### Requirement: 位移通道 MUST NOT 削弱顶层浮层的既有保证

Pet 的位移可以采用 `transform` 一类由合成器直接搬运图层的通道。此类通道会使
Pet 的根节点同时成为 stacking context 与后代绝对定位元素的 containing block，
因此系统 SHALL 保证这两项副作用都是无害的。

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
