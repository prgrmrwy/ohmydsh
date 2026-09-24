## Why

Pet 的浮层根节点 `.dshpet-root` 使用 `z-index:2147483000`——这是
`2026-09-03-pet-send-cr-and-workspace-env`（D6）为让 Pet 脱离
`dsh-better-sidebar` 的 "layout push" 挤压而选定的"高于应用内容"数值,当时的
验收范围只覆盖侧栏挤压/裁剪场景。但该数值同时高于官方
`@deepseek-ai/dsh-client-ui-settings-general` 的 Settings 弹层容器
`.VOzbGW_overlay`（`z-index:1000; position:fixed; inset:0`）。两者的祖先链
（`#root` → `AppFrame.frame` → 各自容器)均未建立新的层叠上下文（无
transform/filter/isolation/contain）,因此 Pet 与 Settings 弹层同处根层叠
上下文,直接按 z-index 数值比较——数值差距达六个数量级,结果是 Pet 的桌宠本体
与展开的轮盘菜单会盖在 Settings 弹层（含其 mask）之上,包括 Pet 自己的
Settings 设置区（`dsh-pet` section,通过同一个官方 Settings 面板呈现）。用户
打开 Settings 时会看到 Pet 悬浮在弹层上方、遮挡内容,这既不符合官方 Settings
作为模态操作面的预期,也不是 D6 的原意（D6 要解决的是"不被布局挤压/裁剪",
从未主张"盖过 Settings")。

## What Changes

- 修正 `.dshpet-root` 的 `z-index`：保持"高于普通应用内容"（侧栏、面板、
  对话区等既有场景不变),但改为**低于官方 Settings 弹层**（当前已知数值
  1000),使 Settings 打开时始终盖住 Pet,而非相反。
- 具体取值落在“高于普通应用层级、低于 1000”的区间,并在样式注释中记录依据
  （官方 Settings overlay 的 1000,而非 D6 时代随手选的“接近 int32 上限”的
  数值)。
- 不改变 Pet 相对普通应用内容（对话区、侧栏、`dsh-better-sidebar` 面板等）的
  层叠关系——`pet-top-layer` 规范中"不被布局挤压/裁剪"的既有场景与验收条件
  保持有效,只补一条新的例外（低于 Settings)。
- 同步更新/新增覆盖该层级关系的测试（当前测试只断言
  `z-index:\d+`（正则占位),未锁定具体数值范围,也未断言与 Settings 的相对
  关系,需要补上。

## Capabilities

### New Capabilities

（无)

### Modified Capabilities

- `pet-top-layer`：现有 Requirement "Pet 是不为任何布局让位的顶层浮层" 中
  "Pet 的层叠顺序 SHALL 高于普通应用内容" 这一句需要补充一条例外——Pet 的
  层叠顺序 MUST 低于官方 Settings 弹层,使 Settings 面板始终可见于 Pet 之上。
  不改变该 Requirement 中"挤压属于定位包含块问题,提高 z-index 不能修复它"
  的既有结论,也不改变四个既有 Scenario（侧栏展开/拖拽调宽/右边缘停靠/窗口
  尺寸变化)。

## Impact

- 代码：`packages/dsh-pet/src/client/styles.ts`（`.dshpet-root` 的
  `z-index` 数值与其解释注释)。
- 测试：`packages/dsh-pet/test/client.test.ts`（现有的
  "positions against the viewport" 与 "keeps the mascot and the clamp size
  in agreement" 用例只做正则占位匹配,需要补充/调整为断言具体数值区间,并新增
  "低于 Settings 弹层已知值" 的回归用例)。
- 规范：`openspec/specs/pet-top-layer/spec.md`（通过本 change 的 delta spec
  合入一条 MODIFIED Requirement)。
- 不涉及 Host 端改动、不涉及 wire 协议、不涉及依赖变更,风险面很窄。
