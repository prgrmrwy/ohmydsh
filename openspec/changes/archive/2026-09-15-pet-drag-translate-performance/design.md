## Context

动机见 proposal.md — Why。需求见本 change 的 `specs/dsh-pet/spec.md` 与
`specs/pet-top-layer/spec.md`。

塑造实现方式的现状约束：

- 位置真相有两处：React state `position`（`overlay.tsx:95`，初值来自
  `readPosition`）和 `localStorage`（`position.ts` 的 `POSITION_KEY`）。
  渲染时写成内联 `left`/`top`（`overlay.tsx:453`）。
- 拖动状态在 ref 里（`dragging`，`overlay.tsx:140`），存 `pointerId` 与上一次
  的指针坐标，采用**增量**模型：每个 move 用 `event.clientX - state.dx` 求
  delta，再累加到当前位置上（`overlay.tsx:320-326`）。
- `clampPosition` 依赖 `viewport` 与 `size` 两个 React 值（`position.ts:36`），
  而 `size` 来自 Host config，可随 Settings 变化。既有注释明确警告过 stale
  closure 会把越界位置持久化（`overlay.tsx:328-331`）。
- 另有一个 effect 在 viewport 或 size 变化时重新钳制位置且**故意不持久化**
  （`overlay.tsx:181-185`）。这条路径与拖动并存，两者都会改 `position`。
- `.dshpet-root` 已经是 `position:fixed; z-index:999`（`styles.ts:57`）。
  `z-index:999` 是 fix-pet-below-settings-layer 精心选定的值，有两条测试锁定
  （`client.test.ts:831` 锁精确值，`client.test.ts:846` 锁 100 < v < 1000 区间）。
- `hovered` 是单个 `string | undefined`（`overlay.tsx:126`），存能力 id；只由
  扇区 `mouseleave`（`overlay.tsx:584`）与 a11y 按钮 `blur`（`overlay.tsx:637`）
  清除。`mode` 的收起路径有四条：距离判定（`overlay.tsx:282`）、Escape
  （`overlay.tsx:495`）、blur（`overlay.tsx:492`）、面板外点击（`overlay.tsx:293`），
  没有一条会清 `hovered`。

## Goals / Non-Goals

**Goals:**

- 拖动路径上零 layout、零轮盘重渲染，且每帧至多一次 DOM 写入。
- hover 高亮成为 `mode` 的函数，不再是需要靠对称事件维护的独立状态。
- 既有定位不变量（视口坐标系、钳制、持久化格式、z-index、后代锚定）逐条保持。

**Non-Goals:**

- 不改持久化格式，不做迁移。`{x, y}` CSS 像素语义不变，`transform` 只是同一
  坐标的另一种落地方式。
- 不改钳制规则本身，也不改 viewport/size 变化时"重新钳制但不持久化"的行为。
- 不改 `z-index` 值。本设计的结论是它无需改动（见决策 4），而不是重新选值。
- 不引入动画、惯性或吸附边缘；本次只解决卡顿与错误可见状态。
- 不改 Task 面板、轮盘几何、能力模型或任何 Host 侧逻辑。

## Decisions

### 决策 1：位移通道改为 `translate3d(x, y, 0)`，`left`/`top` 归零

`.dshpet-root` 的 CSS 改为携带 `left:0;top:0`，位置全部由 `transform` 承载。

为什么必须显式写 `left:0;top:0`：`position:fixed` 元素在 `left`/`top` 为
`auto` 时使用静态位置（static position）作为起点。Pet 的宿主节点在
`document.body` 下，其静态位置取决于 body 的内容流，并非可靠的 `(0,0)`。
把两者钉成 `0` 后，`translate3d` 的参数就等于视口坐标，与 `localStorage` 里
存的 `{x, y}` 数值完全同构——这也是不需要迁移的原因。

用 `translate3d` 而非 `translate`：第三个轴向参数是让图层进入合成器的惯用提示。
不使用 `will-change:transform`——它常驻时会无条件保留一个合成层，Pet 是常驻
浮层，代价要一直付；而 `translate3d` 已足够，且只在实际发生变换时生效。

**备选方案：** 保留 `left`/`top` 只做 React 优化。已否决：`left`/`top` 每次
写入都使 Pet 的几何失效，触发 layout 与 paint，这是卡顿的主因之一，仅减少
重渲染次数并不能消除它。

### 决策 2：拖动期直接写 DOM，只在结束时提交回 React

这是本次改动的核心，也是唯一真正有风险的部分——它引入了"拖动中 DOM 与 React
state 不一致"的窗口。设计据此把不一致约束成可证明安全的形态。

- `pointerdown`：记录起始指针坐标与**当次拖动开始时的 Pet 位置**，两者都进
  `dragging` ref。
- `pointermove`：算出候选位置，钳制，存进 ref（作为待提交值），然后用
  `requestAnimationFrame` 调度一次写入；已有在途的 rAF 则不再调度。写入直接
  设 `rootRef.current.style.transform`。**不调用 `setPosition`**，所以拖动全程
  没有一次 React 重渲染。
- `pointerup` / `pointercancel`：取消在途 rAF，`setPosition(最终值)` 并
  `writePosition` 持久化。React 此时接管，渲染出的 `transform` 与 DOM 上已有
  的值一致，不会有跳动。

**从增量模型改为绝对模型。** 现有代码每个 move 都把 delta 累加到 `position`
上（`overlay.tsx:320-326`）。绕过 React 后这条路径不再可用：`position` 在拖动
期间不更新，累加会一直加在同一个起点上。改为在 `pointerdown` 时快照起始位置，
每次 move 用 `origin + (当前指针 - 起始指针)` 直接算绝对位置。

这同时修掉一个既有的隐性缺陷：增量模型在钳制后会丢步。指针推到视口边缘外时
位置被钳住，但每次 move 都把 `dx` 更新成最新指针坐标，于是指针从边缘往回走时
Pet 立即跟随——而不是等指针回到"当初离开边缘的那个点"才动。绝对模型下钳制是
纯函数，不累积误差。

**为什么把待提交值放在 ref 而不是只读 DOM：** 提交时若从 `style.transform`
反解字符串，就把字符串格式变成了隐式契约。ref 里始终是结构化的 `{x, y}`。

**stale closure 的处理。** 既有注释两处警告过 `size`/`viewport` 的 stale
closure 会持久化越界位置（`overlay.tsx:328-331`、`overlay.tsx:345-348`）。
绕过 React 后 handler 存活时间更长（整个拖动手势），风险更高。做法：把
`viewport` 与 `size` 也各自放进 ref，由一个 effect 同步，钳制时读 ref 而非
闭包捕获值。这样即使 Settings 在拖动中途改了 mascot 尺寸，钳制也用新值。

**与"重新钳制"effect 的竞争。** `overlay.tsx:181-185` 的 effect 会在 viewport
或 size 变化时 `setPosition`。若它在拖动中触发，React 渲染出的 `transform`
会覆盖我们直写的值。处理：该 effect 在拖动进行中（`dragging.current !== undefined`）
时跳过——拖动本身已经在用最新的 viewport/size 钳制，重复钳制没有意义；拖动
结束时的提交会落在已钳制的值上。

**备选方案 A：`setPosition` + `useMemo` 隔离轮盘子树。** 已否决：轮盘的
`slots`/`rings` 依赖 `size`、`shortcuts`、`accent`、`ringStyle`、`hovered` 等
多个值，要把它们全部记忆化并拆出稳定组件，改动面远大于本方案，且每帧仍要过
一遍 React 的 reconciliation。

**备选方案 B：`useDeferredValue` / transition 降级位置更新。** 已否决：会让
Pet 在指针后面"拖尾"，把性能问题换成延迟问题。

### 决策 3：hover 高亮由状态改为 `mode` 的函数

不再给四条收起路径分别补 `setHovered(undefined)`——那是要求四处保持同步，正是
当前 bug 的成因（漏了其中每一条都会复现）。

改为：**读取时用 `mode` 收敛。** 轮盘只在 `mode === 'menu'` 时渲染
（`overlay.tsx:547`），所以让有效 hover 值等于"`mode` 为 `menu` 时才采信
`hovered`"。任何收起路径——包括未来新增的——都自动清除高亮，无需记得补一行。

**实施修正（实测后）：只收敛读取是不够的。** 最初按"读取时用 `mode` 判断"
实现，回归测试立刻失败：`hovered` 仍留在 state 里，重新展开轮盘把 `mode` 置回
`menu` 时，陈旧高亮被原样交还——读取门只是在收起期间把它藏起来了。因此实际做法
是一个 `mode !== 'menu'` 时 `setHovered(undefined)` 的 effect：仍是单点收敛
（任何收起路径，含日后新增的，都自动清除），但真正清除了状态而非遮蔽它。

再加一条：

- **`pointerdown` 时清 `hovered`**：拖动开始即清，满足 spec 中拖动清除高亮
  一条。这一处必须显式写，因为拖动不改 `mode`（Pet 可在轮盘展开时被拖动），
  上面那个 effect 覆盖不到。

**"按存在性过滤"经验证为死代码，已移除。** 设计初稿要求有效 hover 额外命中
当前 `shortcuts` 中某个 id，用来满足 spec 中"被高亮的能力不再渲染时高亮不转移"
一条。反向验证（tasks 5.7）显示：移除该检查后对应回归测试**依然通过**。原因是
高亮本就按 id 比较，而几何位置按索引决定——消失的 id 匹配不到任何已渲染扇区，
高亮自然消失，不可能被接替该位置的能力继承。该不变量由"按 id 比较"这一事实
本身保证，不需要额外代码。保留一个看似承重实则无效的检查会误导后来者，故删除，
并在代码注释中记录该结论与发现方式。`activeHover` 作为具名读取点保留，使两处
调用点不会各自漂移。

**备选方案：在每条收起路径补 `setHovered(undefined)`。** 已否决：四处对称
维护，新增第五条收起路径时会静默回归——与当前 bug 同构。

### 决策 4：`z-index` 保持 999，不因 `transform` 调整

`transform` 会创建 stacking context，需要确认它不破坏 fix-pet-below-settings-layer
的结论。结论是不破坏，理由要写清以免日后有人"顺手修一下"：

`.dshpet-root` 已经是 `position:fixed` 且 `z-index:999`（非 `auto`），**按规范
本来就已经是一个 stacking context**。`transform` 不会新增一层，它只是让同一个
元素满足了另一条成为 stacking context 的条件。Pet 与 Settings 仍在根 stacking
context 里按 999 对 1000 直接比较，关系不变。

后代锚定同理：`.dshpet-wheel`、`.dshpet-panel`、`.dshpet-badge` 等
`position:absolute` 元素本就以 `.dshpet-root` 为 containing block（它已是
`position:fixed`）。`transform` 让它额外成为 containing block，对已经以它为
参照的后代是重言式，不产生位移。

## Risks / Trade-offs

- **拖动中 DOM 与 React state 不一致** → 窗口严格限于一次拖动手势内，且只涉及
  `transform` 一个属性。提交时 React 渲染出的值与 DOM 上的值相同，不会跳动。
  在途 rAF 在提交前取消，避免提交后再被旧帧覆盖。
- **rAF 回调在卸载后触发** → 组件卸载时取消在途 rAF；回调里同时对
  `rootRef.current` 判空。
- **拖动中途 mascot 尺寸变化导致钳制用旧值** → viewport/size 经 ref 读取
  （决策 2），不依赖闭包捕获。
- **"重新钳制"effect 与直写竞争** → 该 effect 在拖动进行中跳过（决策 2）。
- **`transform` 上的亚像素值可能使 emoji 字形轻微模糊** → 钳制结果来自整数
  指针坐标的差值，为整数；`readPosition` 也只接受有限数值。必要时提交前取整。
- **测试锁定了 `left`/`top` 形状** → `client.test.ts:222-223` 断言
  `/left:\d+px/` 与 `/top:\d+px/`，`client.test.ts:819`、`831` 断言
  `.dshpet-root{position:fixed;z-index:999;width:72px` 的精确前缀形状。这些是
  预期内的失败，需改写为 translate 形态，但必须继续守护它们原本的不变量
  （PET_SIZE 与 CSS 宽度一致、z-index 精确为 999、fixed 而非 absolute），
  MUST NOT 借改测试之机放宽断言。
- **jsdom 无 `requestAnimationFrame` 保证** → 现有 `interaction.test.ts` 在
  jsdom 下驱动真实 React 挂载。jsdom 提供 rAF，但断言需在 rAF 之后读取；
  沿用该文件已有的 `settle()` 等待模式。
- **jsdom 无 `PointerEvent`** → 既有测试已用带 `pointerId` 的 `MouseEvent`
  绕过（`interaction.test.ts:106`），沿用。

## Migration Plan

无数据迁移。`localStorage` 的 `{x, y}` 语义不变，存量位置直接可用（spec 中
「升级后沿用已保存位置」一条即为此的验收）。回滚即还原代码，无遗留状态。
