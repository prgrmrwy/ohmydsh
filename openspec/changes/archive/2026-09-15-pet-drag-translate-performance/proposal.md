## Why

拖动 Pet 时明显卡顿。当前实现把位置写成 `.dshpet-root` 的内联 `left`/`top`
（`packages/dsh-pet/src/client/overlay.tsx:453`），于是每个 `pointermove` 都
落在浏览器最贵的那条路径上——改 `left`/`top` 触发 layout 与 paint，而
`setPosition` 又让整棵 `PetOverlay` 重渲染。拖动通常发生在轮盘已展开之后
（hover Pet 本体即把 mode 置为 `menu`），所以每个 move 事件重建的是一整棵
含 24 个扇区的 SVG 树，而那棵树与 Pet 的位置毫无关系。

同时，圆环扇区的 hover 高亮会残留：`hovered` 只由扇区自己的 `mouseleave`
与 a11y 按钮的 `blur` 清除（`overlay.tsx:583`、`overlay.tsx:637`），一旦轮盘
在指针尚在某扇区上时因别的原因收起（距离判定收起、Escape、拖动开始、能力
列表刷新使该扇区不再渲染），那次 `mouseleave` 永远不会到达，`hovered` 便留
着上一个能力的 id。下次展开轮盘时该扇区带着高亮出现，指向的是用户此刻并未
悬停的能力——对一个"点一下就执行"的入口来说，这是会诱发误点的错误可见状态。

## What Changes

- Pet 位移改用 GPU 友好的 `transform: translate3d()`，不再写 `left`/`top`：
  合成器可直接搬运图层，拖动不再每帧 layout/paint。
- 拖动进行中绕过 React：`pointermove` 用 `requestAnimationFrame` 批处理并直接
  写 `rootRef.current.style.transform`，只在 `pointerup`/`pointercancel` 时把
  最终位置提交回 React state 与 `localStorage`。拖动途中不再重渲染轮盘 SVG。
- 每帧最多一次 DOM 写入：同一帧内的多个 `pointermove` 合并，指针事件频率高于
  屏幕刷新率时不再产生多余写入。
- 修复圆环 hover 残留：轮盘收起时 SHALL 清除 hover 高亮，且高亮 SHALL 只在
  仍被渲染的扇区上存在。拖动开始也清除，因为拖动期间指针不再表示"悬停某能力"。
- 既有不变量全部保留：视口坐标系、钳制、`position:fixed`、`z-index:999`
  低于官方 Settings、宿主节点不吞指针事件、独立 React root。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `dsh-pet`: 「Web 中提供常驻、可拖动且可访问的 Pet 入口」新增两条要求——
  拖动 SHALL 走合成器友好的位移通道并在拖动途中避免与位置无关的重渲染；
  轮盘 hover 高亮 SHALL 在轮盘收起与扇区不再渲染时清除，MUST NOT 残留到
  下一次展开。
- `pet-top-layer`: 「Pet 是不为任何布局让位的顶层浮层」补充：以 `transform`
  实现位移使 `.dshpet-root` 成为 stacking context 与 containing block，
  规范需明确这 MUST NOT 削弱"低于 Settings、不为布局让位"两条既有保证，
  且后代 `position:absolute` 元素的参照系变化必须是无害的。

## Impact

- `packages/dsh-pet/src/client/styles.ts`：`.dshpet-root` 规则；确认
  `.dshpet-wheel`、`.dshpet-panel`、`.dshpet-badge` 等后代绝对定位元素本就
  以 `.dshpet-root` 为参照（它已是 `position:fixed`），故参照系不变。
- `packages/dsh-pet/src/client/overlay.tsx`：`onPointerDown/Move/Up` 三个
  handler、根节点 `style`、`hovered` 的清除时机。
- `packages/dsh-pet/test/client.test.ts`：现有断言 `expect(markup).toMatch(/left:\d+px/)`
  与 `/top:\d+px/`（第 222–223 行）以及 `.dshpet-root{position:fixed;z-index:999;width:72px`
  形状断言（第 819、831 行）会随本次改动失效，需改写为 translate 形态并保留
  它们原本守护的不变量（PET_SIZE 与 CSS 宽度一致、z-index 精确为 999）。
- `packages/dsh-pet/test/interaction.test.ts`：拖拽用例走真实 React 挂载，
  可在此新增 hover 残留回归用例。
- 不涉及 Host、持久化 schema、路由或 `dsh.yaml`；`localStorage` 的位置格式
  （`{x, y}` CSS 像素）保持不变，故存量位置无需迁移。
