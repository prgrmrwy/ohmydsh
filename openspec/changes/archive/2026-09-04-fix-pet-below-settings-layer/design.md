## Context

`packages/dsh-pet/src/client/styles.ts` 目前把 `.dshpet-root` 的
`z-index` 定为 `2147483000`（接近 int32 上限）。这个数值来自
`2026-09-03-pet-send-cr-and-workspace-env` 的 D6 决策：当时的问题是
`dsh-better-sidebar` 以 "layout push" 形态压缩 `#root`（`margin-right` +
`width:calc(...)`），Pet 原本挂在 `shell.overlay` 槽内会被一起压窄/裁剪；
修复把 Pet 移到 `document.body` 下的独立宿主 + 独立 React root，
`position:fixed` 按视口定位，`z-index` 顺带"提到很高"。D6 的验收范围只有
"侧栏挤压/裁剪不再影响 Pet"，从未评估过 Pet 与官方 Settings 弹层的相对
层级。

复核已部署的 DSH 与第三方插件客户端 bundle（源码位于
`/Users/prgrmrwy/.npm/_npx/de4831d60afe10da/node_modules/@deepseek-ai/*/lib/client.js`
与 `~/.dsh/profiles/web/node_modules/dsh-better-sidebar/src/client/*`）后
确认的层叠事实：

- Pet 的挂载路径 `document.body > [data-dsh-pet-host] > .dshpet-root` 中
  没有任何祖先建立新的层叠上下文（无 `transform`/`filter`/`isolation`/
  `contain`）。
- 官方 Settings 弹层（`@deepseek-ai/dsh-client-ui-settings-general` 的
  `SettingsRoot.module.css` → `.VOzbGW_overlay`）是
  `position:fixed;inset:0;z-index:1000`，其祖先链（`#root` →
  `AppFrame.pI_x6G_frame`，见 `@deepseek-ai/dsh-client-ui-layout` 的
  `AppFrame.module.css`）同样不建立新层叠上下文。
- 因此 Pet 与 Settings 弹层同处**根层叠上下文**，直接按 `z-index` 数值
  比较——`2147483000` 远大于 `1000`，Pet（含展开的轮盘菜单）会盖在
  Settings 弹层（及其 mask）之上，包括 Pet 自己的设置分区。这与用户报告
  的现象一致。
- 全仓库已部署客户端 bundle 中出现的 `z-index` 数值可分两档：
  - "普通内容"档：多数官方/第三方浮层控件（下拉、气泡、工具条等）用
    个位数到 `100`（如 `dsh-client-ui-commands`/`ui-jobs`/
    `ui-input-trigger`/`ui-subagent` 的 `100`，`dsh-better-sidebar` 自身
    面板内部的 `2`–`60`，其中 `40`/`45`/`46`/`50`/`60` 是该插件自建的
    局部层叠上下文内的值，不直接与根上下文数值比较）。
  - "顶层模态"档：固定在 `1000` 起，用于必须盖过几乎一切的场景——官方
    Settings 弹层（`1000`）、`dsh-client-ui-attachment` 的
    lightbox/拖放遮罩（均为 `1000`）、`dsh-better-sidebar` 自己的 mermaid
    预览模态（`1000`，注释明确写"Fixed overlay above the DSH overlay
    stack (1000+)"）与拖放提示（`1001`/`1002`，注释明确"above DSH's own
    whole-page drop mask (z-1000)"）、`dsh-client-ui-message-feedback` 的
    批注面板（`1100`）。
  - 没有任何已部署包在 `100` 与 `1000` 之间取值，也没有共享的 z-index
    design token（对 `--dsw-*` 前缀做过全量 grep，零命中）——层级完全靠
    约定数值，不靠令牌或 API。

## Goals / Non-Goals

**Goals:**
- Pet 的层叠顺序继续高于"普通内容"档的一切（现有四个 Scenario：侧栏
  展开、拖拽调宽、右边缘停靠、窗口尺寸变化，行为不变）。
- Pet 的层叠顺序低于官方 Settings 弹层（`1000`），使 Settings 打开时
  始终完整可见、不被 Pet（含轮盘、Task 面板）遮挡。
- 用一个有据可查、留有安全余量的具体数值替换"接近 int32 上限"的旧值，
  并在样式注释中写清依据，避免未来又是一次随手选数。

**Non-Goals:**
- 不引入跨插件共享的 z-index 注册表或 design token——这是比本次修复大得多
  的工程（需要官方或社区约定新 API），且当前只有一个已知冲突（Settings），
  不足以承担引入新机制的成本。
- 不逐一处理"顶层模态"档内部的相对顺序（例如 Pet 是否也应该低于
  `dsh-better-sidebar` 的 mermaid 预览模态或
  `dsh-client-ui-message-feedback` 的批注面板）。用户明确报告的问题只有
  "被 Settings 盖住"；下面"风险"一节说明为什么把 Pet 压到 `1000` 以下会
  作为副作用同时低于这一整档，以及为什么这个副作用可接受，但不为它们
  单独设计验收场景。
- 不改变 D6 已解决的定位包含块问题（`position:fixed` 独立 root 的结论
  不变），本次只动 `z-index` 数值本身。

## Decisions

### D1：数值选 `999`，而不是更小的"安全值"（如 500）或继续贴近上限

选择：`.dshpet-root` 的 `z-index` 改为 `999`——已知"顶层模态"档最低值
（`1000`，Settings/attachment/mermaid 模态)减一。

理由：
- 必须 **严格小于** `1000`，不能等于。两者同处根层叠上下文且都是
  `position:fixed`，若数值相等，胜负由 DOM 顺序决定（后插入的节点覆盖
  先插入的）；Pet 的宿主节点在 `apply()` 时机才追加到 `document.body`，
  相对 Settings 弹层的挂载时机不构成任何契约，等值会重新引入一种"有时
  盖住有时被盖住"的不确定性——这正是 `pet-top-layer` 现有 Requirement
  已经否定的思路（"层叠顺序本身 MUST NOT 被当作解决挤压的手段"背后的
  同一原则：不能依赖不受控的隐式顺序）。
- 选择"仅比已知阈值小 1"而不是"退一大截"（如 500），是为了在"高于普通
  内容"这一硬约束上留最大安全边际：已观测的普通内容最高值是 `100`，
  `999` 相对它有充分余量；同时这个数值本身即文档——"就是 Settings 弹层
  之下一步"，不依赖记忆一个任意居中的数字。
- 考虑过引入一个具名 JS 常量（如
  `PET_ROOT_Z_INDEX = SETTINGS_OVERLAY_Z_INDEX - 1`）而不是 CSS 字符串里
  的字面量。放弃：`PET_CSS` 现有其它所有数值（尺寸、圆角、间距）都是
  模板字符串里的字面量，`z-index` 单独抽常量会打破现有风格且收益有限
  （官方 Settings 的 `1000` 本身也不是一个可 import 的公开常量，跨包引用
  不可行，抽出来的常量只能又是一份手抄值）。改为在字面量旁写清注释来源。

### D2：接受"低于 `999` 也会低于 `1000+` 档内部更高的值"这一副作用，不做分层规避

选择：不试图让 Pet 同时"高于 mermaid 模态（`1000`)"又"低于 Settings
（`1000`)"——两者数值相同，单一 `z-index` 标量做不到,也不必做到。

理由：用户报告的具体问题只是 Settings 被盖住；`999` 会让 Pet 同时退到
`dsh-better-sidebar` 的 mermaid 预览模态、拖放提示,以及
`dsh-client-ui-message-feedback` 批注面板等其它"顶层模态"档之下。这些
同样是"需要临时独占视觉焦点"的全屏/大面积覆盖层,Pet 让位给它们与让位
给 Settings 是同一类判断,不是意外回归。反过来"分别处理每一个第三方顶层
模态"需要枚举并跟踪所有此类插件的数值,维护成本和收益不成比例,且不是
用户要求的范围。

### D3：不动 `pet-top-layer` 现有四个 Scenario,只追加一条

选择：现有 Requirement"Pet 是不为任何布局让位的顶层浮层"中"层叠顺序
SHALL 高于普通应用内容"这句改写为同时声明"但 MUST 低于官方 Settings
弹层",四个既有 Scenario（侧栏展开/拖拽调宽/右边缘停靠/窗口尺寸变化)
原文保留,新增一个 Settings 场景。

理由：定位包含块问题（D6 已解决的核心矛盾)与层叠顺序问题相互独立,前者
的验收条件与本次改动无关,不应该在同一次改动里被重写或稀释。

## Risks / Trade-offs

- **[风险] 未来某个插件把自己的浮层放在 `100`–`999` 区间** → 会重新盖过
  Pet,且不会有任何自动检测手段提示。缓解：写清楚注释与本 design 记录
  当前已知的两档惯例（普通内容 ≤100,顶层模态 ≥1000),供后续排查时对照；
  真正的根治需要 DSH 官方提供层级 API/token,超出本次范围。
- **[风险] `999` 与 `1000` 只差 1,官方未来把 Settings 弹层数值下调** →
  例如若 Settings 改成 `500`,Pet 的 `999` 会反过来又盖住 Settings。
  缓解：这是任何"读取当前已知值再减一"的做法的固有脆弱性,而非本次改动
  独有；数值来自实际读码而非猜测,一旦官方数值变化需要重新核实,已在
  design 中留档方便下次对照,不做更复杂的运行时探测（探测官方私有 CSS
  class 名称本身就是脆弱耦合,比硬编码数值更差)。
- **[副作用，非缺陷] Pet 同时会低于 `dsh-better-sidebar` 的 mermaid 模态/
  拖放提示与 `message-feedback` 批注面板** → 见 D2,判定为可接受的一致
  行为而非需要规避的回归。
- **[无风险] 不影响 D6 的挤压/裁剪修复** → 本次只改 `z-index` 数值,不碰
  `position:fixed`、独立 root 挂载、视口钳制等既有实现。
