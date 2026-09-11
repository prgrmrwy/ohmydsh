## 1. 位移通道改为 transform

- [x] 1.1 `src/client/styles.ts`：`.dshpet-root` 规则加上 `left:0;top:0`，并
      更新其上方注释，说明为何必须显式钉成 0（fixed 元素在 `left/top:auto`
      时用静态位置，body 下的静态位置不是可靠的 (0,0)），以及 translate 参数
      因此与持久化的 `{x, y}` 同构。
- [x] 1.2 同一注释块补充 `transform` 与 `z-index:999` 的关系（design.md 决策 4）：
      该节点因 `position:fixed` + 非 auto `z-index` **本来就已是** stacking
      context，`transform` 不新增层级，故 999 无需改动——写清以阻止日后"顺手
      调高"。
- [x] 1.3 `src/client/overlay.tsx`：根节点 `style` 用
      `transform: translate3d(${x}px, ${y}px, 0)` 取代 `left`/`top`。保留既有
      的 `--dshpet-mascot-size` 与 `--dshpet-wheel-radius` 两个自定义属性。

## 2. 拖动期绕过 React

- [x] 2.1 `dragging` ref 结构改为绝对模型：存 `pointerId`、起始指针坐标
      （`startX/startY`）、`origin`（pointerdown 当时的 Pet 位置）、`moved`，
      以及 `pending`（待提交的已钳制位置）。移除按 delta 累加的 `dx`/`dy` 语义。
- [x] 2.2 新增 `viewportRef` 与 `sizeRef`，由 effect 与对应 state 同步；拖动
      路径的钳制一律读 ref，不捕获闭包值（design.md 决策 2 的 stale closure
      处理）。
- [x] 2.3 `onPointerDown`：快照起始指针坐标与当前 `position` 到 ref。
- [x] 2.4 `onPointerMove`：按 `origin + (当前指针 - 起始指针)` 算绝对位置，
      用 ref 里的 viewport/size 钳制，写入 `pending`，然后经 rAF 调度一次
      `rootRef.current.style.transform` 写入；已有在途 rAF 时不重复调度。
      **不调用 `setPosition`**。保留既有 2px 移动阈值以区分点击与拖动。
- [x] 2.5 `onPointerUp` / `onPointerCancel`：取消在途 rAF，用 `pending`
      调 `setPosition` 与 `writePosition` 持久化；维持 `draggedRef` 的
      点击抑制语义不变。
- [x] 2.6 组件卸载时取消在途 rAF；rAF 回调内对 `rootRef.current` 判空。
- [x] 2.7 `overlay.tsx:181-185` 的重新钳制 effect：拖动进行中跳过
      （design.md 决策 2 的竞争处理）。保留其"不持久化"的既有行为与注释理由。
- [x] 2.8 在这几个 handler 上写注释说明"拖动中 DOM 与 React state 故意不一致"
      的边界：窗口限于一次手势、只涉及 `transform`、提交值与 DOM 一致故无跳动。

## 3. 修复轮盘 hover 残留

- [x] 3.1 `overlay.tsx`：派生有效 hover 值——`mode === 'menu'` 时才采信
      `hovered`，且该 id 必须命中当前 `shortcuts`。扇区 `data-hovered` 与
      扇区 `fill` 两处都改读这个派生值（`overlay.tsx:575`、`overlay.tsx:601`）。
- [x] 3.2 `onPointerDown` 中清除 `hovered`（拖动不改 `mode`，故此处需显式清）。
- [x] 3.3 写注释说明为何用"读取时按 `mode` 收敛"而不是在四条收起路径各补一次
      清除（design.md 决策 3）：后者要求四处对称维护，新增第五条收起路径就会
      静默回归，与本次修的 bug 同构。

## 4. 更新既有测试

- [x] 4.1 `test/client.test.ts:222-223`：`/left:\d+px/`、`/top:\d+px/` 改为断言
      `transform:translate3d(...)` 形态。
- [x] 4.2 `test/client.test.ts:819`：PET_SIZE 与 CSS 宽度一致性断言的正则随
      新规则形状调整，继续锁 `width:${declared}px`。
- [x] 4.3 `test/client.test.ts:831`、`846`：z-index 的精确值断言与
      100 < v < 1000 区间断言随新规则形状调整；**必须继续锁精确值 999**，
      不得借机放宽为 `\d+`。
- [x] 4.4 `test/client.test.ts:215`：`position:fixed` / 非 `absolute` 的断言
      随形状调整，继续守护"视口定位而非应用 frame 定位"。

## 5. 新增回归测试

- [x] 5.1 `test/client.test.ts`：断言 `.dshpet-root` 规则含 `left:0` 与 `top:0`
      （编码任务 1.1 的不变量——缺了它 translate 的原点就不可靠）。
- [x] 5.2 `test/interaction.test.ts`：拖动后断言根节点 `style.transform` 已更新
      且 `left`/`top` 未被写入；覆盖 spec「轮盘展开时拖动 Pet」。
- [x] 5.3 `test/interaction.test.ts`：`pointercancel` 结束的拖动持久化取消时
      位置，不回弹到起点；覆盖 spec「拖动被取消」。
- [x] 5.4 `test/interaction.test.ts`：hover 某扇区后按 Escape 收起，再次展开，
      断言无扇区带 `data-hovered="true"`；覆盖 spec「指针停在扇区上时轮盘收起」。
- [x] 5.5 `test/interaction.test.ts`：hover 某扇区后开始拖动，断言高亮立即清除；
      覆盖 spec「拖动开始时清除高亮」。
- [x] 5.6 `test/interaction.test.ts`：hover 某能力后刷新能力清单使其不再渲染，
      断言高亮不转移到占据同一位置的其他能力；覆盖 spec「被高亮的能力不再渲染」。
- [x] 5.7 反向验证：临时还原决策 3 的清除逻辑（改回直接读 `hovered` 且去掉
      拖动清除），确认相应用例会失败，证明它们真的在守护该不变量，然后恢复。
      实测结果：5.4 与 5.5 如期失败；**5.6 仍然通过**——由此发现"按存在性
      过滤"是死代码（高亮按 id 比较，消失的 id 匹配不到任何已渲染扇区），
      该不变量由比较方式本身保证，无需额外代码。已删除该检查并在代码注释与
      design.md 中记录结论。反向验证的价值正在于此：它同时证伪了一条我以为
      必要的实现。
- [x] 5.8 反向验证位移改动：临时把根节点 `transform` 改回 `left`/`top`，确认
      5.2 与 4.1 失败；临时移除 CSS 的 `left:0;top:0`，确认 5.1 失败。

## 6. 验证

- [x] 6.1 `cd packages/dsh-pet && npm run typecheck`（host 与 client 两个 tsconfig）。
- [x] 6.2 `cd packages/dsh-pet && npm test`（vitest 全量）。
- [x] 6.3 `npm test` 与 `npm run check:artifacts`（仓库级）。
- [x] 6.4 `node scripts/sync.mjs` 物化，并连续运行第二次确认幂等无变化。
- [x] 6.5 浏览器实测：拖动 Pet 确认流畅。
      用户于 `dsh build` + 重启后实测确认「手感没问题」。DevTools Performance
      录制未单独执行——拖动流畅本身即本次要解决的可观察问题，已达成。
- [x] 6.6 浏览器实测既有不变量：展开 layout-push 侧栏压缩 `#root` 后 Pet 屏幕
      位置不变；打开官方 Settings 确认其完整覆盖 Pet
      （覆盖 `pet-top-layer` 两条关键 scenario）。用户实测确认。
      这两条是 `transform` 引入 stacking context 与 containing block 后风险
      最集中的位置，实测结果与 design.md 决策 4 的分析一致。
- [x] 6.7 浏览器实测位置持久化：拖动后重载，Pet 回到释放位置。用户实测确认，
      印证「translate 参数即视口坐标、存量位置无需迁移」这一同构假设成立。
- [ ] 6.9 浏览器实测轮盘 hover 残留修复：hover 某扇区后按 Escape（或移开指针）
      收起轮盘，再次展开，确认没有扇区带着上一次的高亮出现。
      **待用户执行**（用户表示「第一个晚点看」）。自动化侧已由 5.4/5.5 覆盖并
      反向验证，但那是 jsdom 断言 `data-hovered`，不等于真实渲染下的视觉确认。
      本条是本 change 未归档的唯一原因。
- [x] 6.8 `openspec validate pet-drag-translate-performance --strict`。
