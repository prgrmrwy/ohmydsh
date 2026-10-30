## Context

`dsh-magpie-connector` 0.3.1 的设置页线路区由 `src/client/SettingsPage.ts` 的 `Connection` / `LineCard` 渲染：展开状态初值为 `activeLineId ?? 第一条`（`SettingsPage.ts:217`），设置刷新时重置到 active（`:219`），新增线路自动展开（`:231`）；行内是四个文字按钮 `上移 / 下移 / 删除 / 展开`（`:291-295`），头部本身没有点击行为。用量条由 `styles.ts:38-39` 的 `.dmg-track`（圆角 + overflow 裁切）与无圆角的 `.dmg-fill` 组成，部分进度时填充末端是直角。线路可达性只有布尔探测：`selection.ts` 的 `probePort` 返回 `Promise<boolean>`，单条 600ms、正/负缓存 10s/15s，只服务自动选择。

现行 spec 与本 change 直接相关的约束：`magpie-line-selection` 要求「默认只展开当前生效线路」（`:67`）、禁止后台轮询（`:119`）、线路区不得新增 `role=alert/status` 或 `aria-live`（`:83`）；`dsh-magpie-connector` 的探测例外只允许连接「参与自动选择的完整线路」（`:470`）。`docs/internal-api.md` 与 `routes.ts:62` 把 host 面固定为 `settings / cards / speed` 三个资源；`api.ts:6` 的 `Resource` 联合类型与之对应。

Web 壳提供 DSH 产品图标：`@deepseek-ai/dsh-client-ui-primitives` 导出 `Icon*OutlineRegular`（1px stroke）/ `Medium`（1.3px）与 `Tooltip`、`DisclosureRow` 等组件，`IconProps = { size?, className? }`、颜色走 `currentColor`，图标默认 14px、建议放在 16px 视觉盒内。同仓 `auto-model-routing` 已在 client 运行时导入该类图标与 `Tooltip`，并用 vitest alias 把 primitives 指向测试 stub；其 `tsdown.config.ts` 的 `external: [/^@deepseek-ai\//]` 与 `dsh-magpie-connector` 完全一致，因此可以沿用同一模式。

## Goals / Non-Goals

**Goals:**
- 用量条填充段两端圆角，部分进度时视觉连续。
- 已配置时默认收起所有线路；首次添加与新增线路仍自动展开；保存刷新不打断正在编辑的行，包括「新建线路首次保存后 id 变化」这条路径。
- 覆盖序号 / active 方块 / 主机名 / 延迟的切换控件成为点击与键盘目标；上移 / 下移 / 删除改为常驻 DSH 图标按钮，带可访问名称与 tooltip。
- 打开设置页时对每条已保存、地址可解析的线路做一次 TCP 建连计时，先显示「测速中…」再显示 4 格信号条 + 毫秒数；只做展示，不参与选择。
- 新增只读 host 资源 `GET /api/dsh-magpie-connector/latency`，不持久化、不轮询、不带凭据、不写 settings。

**Non-Goals:**
- 手动选择 / 强制指定线路（仍是既有 Non-goal）。
- 延迟定时刷新、历史曲线或质量告警；HTTP/TLS 级真实延迟。
- 删除二次确认、拖拽排序、线路 schema / 凭据变更；自动选择行为不变（仅把「SHALL NOT 探测」收窄为「为选择目的」，消除与线路测速的字面冲突）。
- 在模型选择器或会话界面展示延迟。
- 手动「重新测速」按钮（重新打开面板即可重测；见 Open Questions）。

## Decisions

### D1 用量条圆角：给填充段自身加半径

`.dmg-fill` 增加 `border-radius:3px`，与 `.dmg-track` 的 `3px` 一致；轨道已有 `overflow:hidden`，因此 100% 时两者完全重合，部分进度时末端也呈现圆角。
- 备选：把填充包进额外的圆角容器 → 多余一层 DOM 且仍要裁切，弃用。
- 备选：只加右侧半径 → 低百分比时左端会被轨道裁成圆角、右端单独半径仍成立，但与 100% 状态不一致，弃用。
- 验收：`settingsCss` 是导出的字符串，测试解析 `.dmg-track` 与 `.dmg-fill` 的 `border-radius` 断言两者相同且非零；「46% 时右端是圆弧」属于像素结果，放在 worktree 预览验收，不进 spec 断言。

### D2 收起语义与新建线路 id 变更的展开键协调

规则：
1. 初始 `expanded = null`（全部收起）。
2. `add()` 继续把新草稿设为展开，并记录 `pendingDraftId`（该草稿的合成 `draftId`）；用户删除该草稿时清空 `pendingDraftId`。
3. `save()` 在发请求之前，把待保存草稿**当时的数组位置**记录为 `pendingIndex = drafts.findIndex(d => d.draftId === pendingDraftId && !d.id)`（只在存在未保存草稿时记录）。位置在 `save()` 时取而不是在 `add()` 时取，因此「新增后先上移/下移再保存」也正确：POST 顺序就是保存时的顺序，响应里的新线路会出现在同一位置。
4. `settings` 变化时计算 `next = lineDrafts(settings)`：
   - 当前 `expanded` 仍存在于 `next` → 保留；
   - 否则若 `pendingIndex != null` 且 `next[pendingIndex]` 存在 → 把 `expanded` 重写为 `next[pendingIndex].draftId`（即 host 刚分配的 8-hex id），随后清空 `pendingIndex`；
   - 否则 `expanded = null`。
5. 保存失败时 `settings` 不变化，组件不重建草稿，`expanded` 与输入内容自然保留，也不触发 latency 重测；`pendingIndex` 保留到下一次成功响应。

第 4 条是必需的：未保存草稿的 `draftId` 是 `new-<n>-<ts>`（`SettingsPage.ts:206`、`:229-231`），首次保存成功后响应里的线路带真实 id，若只按 `draftId` 保留展开，刚填好的行会立刻收起——这正是用户约束 1 明确排除的行为。
- 备选：保存后重新按地址匹配 → 多个空地址草稿会导致歧义，弃用。
- 备选：在 `add()` 时记录位置 → `move()`（`SettingsPage.ts:224-227`）会改变位置，弃用。
- 备选：用数组下标作为唯一展开键 → 排序/删除时会错位，弃用。
- 备选：每次设置刷新回到 `null` → 保存后收起正在编辑的行，弃用。

### D3 行结构：切换控件与操作按钮是兄弟节点

```
.dmg-line-head (div，不加 click)
├── button.dmg-line-toggle (flex:1, aria-expanded, 展开时 aria-controls)
│     ├── 三角图标（IconTriangleRightFillRegular，展开时旋转 90°）
│     ├── span.dmg-line-index "线路 N"
│     ├── span.dmg-active（仅生效线路，4×4 方块）
│     ├── span.dmg-line-title 主机名
│     └── span.dmg-latency（data-latency-state / level / ms）
└── div.dmg-line-actions
      ├── button 上移  IconChevronUpOutlineRegular
      ├── button 下移  IconChevronDownOutlineRegular
      └── button 删除  IconTrashOutlineRegular
```
- 不用 `role="button"` 的整行包裹操作按钮：会形成嵌套交互元素，读屏语义不合法，且需要 `stopPropagation` 补丁；拆成兄弟节点后点击操作天然不切换。
- 点击目标是切换控件（覆盖序号、方块、主机名、延迟），head 的 gap/内边距不是点击区；spec 与实现用同一句话描述。
- 折叠时编辑内容不渲染，`aria-controls` 只在展开时出现（避免指向不存在的 id）。
- 切换控件是原生 `<button type="button">`，浏览器天然支持 Enter/Space；jsdom 不做键盘默认激活，因此测试只断言 `tagName === 'BUTTON'`、`type`、`aria-expanded` 随点击翻转，Enter/Space 放到预览验收。
- 操作按钮常驻（非 hover-only），禁用态 `aria-label` 带原因（如「上移线路 1（已是第一条）」）；DSH `Tooltip` 只包在可用按钮上（disabled 按钮不派发鼠标事件，tooltip 无法显示，用 aria-label 说明）。
- 连接区 info 图标：`INFO_TEXT`（`SettingsPage.ts:193`）扩为五项（增加「延迟是 TCP 建连耗时（含 DNS 解析），不是网关健康检查」）；hover 用 `title` 显示该文本，图标变成 `tabIndex=0` 并把同一文本放进 `aria-label`，键盘聚焦也能获得说明。既有 `line-silent-ui.test.tsx` 的 `title` 断言会因新增第 5 项而需要同步，另补一条 `aria-label` 断言。
- 保留 `data-line-id` / `data-expanded` 与行根元素位置，既有 UI 测试与 spec 断言不受影响。

### D4 图标：直接使用 DSH 产品图标（Regular）而不是自绘

- 引入 peer/dev 依赖 `@deepseek-ai/dsh-client-ui-primitives@^0.2.0-rc.2`（与 `dsh.yaml` 的 DSH pin 同版）。
- 上移 / 下移 / 删除：`IconChevronUpOutlineRegular` / `IconChevronDownOutlineRegular` / `IconTrashOutlineRegular`；展开：`IconTriangleRightFillRegular`（填充三角形，与 chevron 形状区分，避免「展开箭头」和「下移箭头」混淆）。
- 几何沿用 DSH `DisclosureRow` 的度量：16px 视觉盒、14px 图标、6px 间距、标题 13px；行内颜色 `--dsw-alias-label-tertiary`，hover 提到 `--dsw-alias-label-secondary`，禁用 `--dsw-alias-label-dimmed`。
- 图标按钮 24×24、透明背景、`--dsw-radius-sm`、hover `--dsw-alias-interactive-bg-hover`、`focus-visible` 用 `--dsw-focus-ring-color`；每个按钮带中文 `aria-label`，可用按钮用 DSH `Tooltip` 显示同名动作。
- 备选：把图标 path 复制成内联 SVG → 与 DSH 图标更新脱钩，而且要处理第三方美术归属，弃用（仓库原则是不 vendor 远端源码）。
- 备选：继续用文字按钮 + 图标前缀 → 用户明确要求图标化，弃用。
- 测试：`vitest.config.ts` 增加与 `auto-model-routing` 相同的 alias，把 primitives 指向 `test/client-support/primitives-stub.ts`（stub 提供可断言的 `svg` 占位与 `Tooltip` 透传），避免在 jsdom 里加载真实壳 bundle 的 CSS。

### D5 延迟：新 GET-only 资源 + host 侧 TCP 建连计时

数据流：

```
浏览器 SettingsPage                 Host routes               配置
  GET /latency ───────────────▶ LatencyController ──▶ runtime.config()（已保存线路）
                                   │ Promise.all(measurePort)  │ 每条 ≤600ms，并行
                                   │  无 HTTP / 无凭据          │
  {lines:[{id,ms}]} ◀──────────┘                          endpointOf(baseUrl)
```

- 新文件 `src/host/latency.ts`：`LatencyController` 依赖 `runtime.config()`、可注入 `measure`（测试 seam）与 `now`；`read()` 单飞（并发 GET 共享同一次测量，用连接次数断言共享），`dispose()` abort 悬挂探测。只返回**有可解析地址**的已保存线路，空地址线路不出现在 `lines` 里。
- `selection.ts` 抽出内部 `probeSocket(host, port, timeoutMs, signal): Promise<{reachable, ms}>`，`probePort` 变成它的薄包装以保持 `Probe` 类型与既有测试不变；RTT 用单调时钟（`performance.now()`）差值、四舍五入并 `Math.max(0, …)` 钳制；DNS 解析时间计入，因此文案统一写「TCP 建连耗时（含 DNS 解析）」而不是「TCP 往返」。
- 资源 `GET /api/dsh-magpie-connector/latency`：`register({methods:['GET']})`。非 GET 不由本处理器处理，由连接层统一返回 404（不发起连接）；spec 因此写「不进入 latency 处理、返回 404」而不是 400/405。响应 `{lines: [{id, ms: number|null}]}`，`null` = 600ms 内未完成建连；不该被 UI 或测试消费的时间戳不放进响应；不写 settings、不碰自动选择探测缓存、不改 `activeLineId`。`routes.ts` 的资源数组与 `api.ts` 的 `Resource` 联合类型加 `latency`；`registerRoutes` 的返回对象增加 `latency` 控制器与 dispose。`LatencyController.read()` 在 disposed 后直接返回空结果：不建连、不缓存（测试在控制器层断言）。「POST 被拒绝」由连接层产生 404，插件侧测试断言注册的 `methods` 恰为 `['GET']`、POST 不进处理器且不产生连接，不伪造一个插件内的 404。
- 客户端：`readLatency()` 在挂载 effect 中与 settings/cards 并行发出，线路写入成功（`identityWrite`）后重置为 `measuring` 并重发；用独立 epoch 丢弃过期响应。状态机 `measuring | done(entries) | failed | idle`；任何非 2xx（含 404）或网络错误都落到 `failed`，静默不报警。
- 备选：把 `lines[].latency` 塞进 `GET settings` → 每次保存与每次读取设置都会测速，且只测到「第一个可达」为止，还会改变既有探测次数断言，弃用。
- 备选：客户端直接 fetch 网关地址测延迟 → 浏览器无 TCP 能力、受 CORS 限制且会暴露凭据，弃用。
- 备选：用 `GET /models` 的真实耗时 → 要带 key、会打网关、且只有生效线路有数据，弃用（可作未来补充）。

### D6 档位、DOM 契约与配色

- 每行延迟位：`[data-latency]` 元素带 `data-latency-state`（`measuring | done | failed | idle`）；`done` 时带 `data-latency-level`（`0..4`）与 `data-latency-ms`（整数或空字符串）。
- 档位：4 格 ≤100ms、3 格 ≤250ms、2 格 ≤450ms、1 格 ≤600ms、`ms` 为 null → 0 格 + 「超时」。理由：600ms 与自动选择的单条探测截止一致；毫秒数是主要信息，格数只是快速感知。
- 「超时」保留为用户熟悉的 FPS 失败读数，tooltip 说明「600ms 内未完成建连（可能很慢或不可达）」，不把可达但 >600ms 的线路说成故障。
- 颜色：level 4/3 `--dsw-alias-state-success-primary`；level 2/1 `--dsw-alias-state-warn-primary`；level 0 与 `failed` 文本 `--dsw-alias-label-dimmed`（唯一取值，不再二选一）。
- 状态只按「是否本应有读数」划分：地址可解析的已保存线路在请求中为 `measuring`、成功后 `done`、失败后 `failed`；空地址 / 未保存草稿在任何阶段都是 `idle`，既不显示「测速中…」也不显示「—」或格数；响应里不存在的行（请求期间被删除或地址不可解析）落到 `idle`。`failed` 显示「—」且不显示格数。
- 信号条 `aria-hidden`，毫秒文本是唯一可读内容并带「TCP 建连耗时（含 DNS 解析）」提示；`font-variant-numeric: tabular-nums` 防跳动。
- 备选：只用单一颜色、仅用格数区分 → FPS 观感不足，弃用；备选：按 LAN/公网分档 → 增加配置面，弃用。

### D7 失败与并发处理

- 测速请求失败（任何非 2xx 含 404 / 网络错误）：`failed`、显示「—」，不阻塞设置与用量加载，不重试。
- 保存失败（409/400）：不重测，保留现有读数与展开状态。
- 关闭面板时组件卸载即忽略响应（epoch guard）；host 侧单飞保证多标签页只测一次。
- `registerRoutes(...).dispose` 关闭 `LatencyController`，abort 所有测量，不留悬挂 socket（与 `LineSelector.dispose` 同款语义）。

### D8 文档、版本与发布资产

- `docs/internal-api.md` 增加第四个资源的形状、测量语义与「GET-only、不持久化、不轮询、不写 settings」约束。
- 版本 0.3.1 → 0.4.0；`package.json` 与 `dsh.yaml` 中该 local package 的 `version` 同步，CHANGELOG 记一条；包内 README 中「设置页」段落补一句延迟与默认收起。
- `docs/settings.png` 按 `docs/SCREENSHOTS.md` 复拍，并更新该截图台账行（source/date/reviewer/verdict/note）。
- `api.ts` 与 `client/index.ts` 顶部「三个 D10 资源」的过时注释改为四个。

### D9 既有 UI 用例的连带修改

默认收起会卸载线路编辑体，既有直接查询编辑控件、然后点「保存」的用例会先失败在「找不到节点」。实现时需要：
- 在 `test/client-support/fake-api.ts` 加一个 `expandLine(host, lineId)` 辅助函数（点击 `[data-line-id]` 内的切换控件）；
- `test/access-ui.test.tsx` 的三条用例、以及 `owner-settings-ui` / `cards-render` / `line-silent-ui` 中任何渲染线路编辑体的用例，先展开目标行再操作；
- 所有渲染设置页的 fixture 增加 `'GET latency'` 处理器（返回 `{lines: []}`），或显式断言未映射时的 404 → `failed` 降级；`fakeApi` 默认对未映射资源返回 404（`test/client-support/fake-api.ts:13`），不补 handler 的用例会渲染「—」而不是崩溃，但不能默认依赖这个巧合。
- `test/line-silent-ui.test.tsx` 的 info 图标改用稳定锚点 `.dmg-info`（或 `[title^="线路按序号"]`），因为可访问名称会变成完整 `INFO_TEXT`、不能再按旧 `aria-label` 精确匹配；断言 `title` 与 `aria-label` 都含五项。
- 未保存草稿行没有 `data-line-id`，用 `data-draft` 属性（新增）或 `.dmg-line:last-child` 定位，供「首次安装/新增线路」用例使用。

## Risks / Trade-offs

- [TCP 建连耗时只到 Cloudflare 边缘，源站故障时读数仍可能很好] → info 文案与 spec 明确「不是网关健康检查」，且延迟只做展示、不参与选择。
- [打开面板会额外建立 ≤5 条 TCP 连接] → 并行、单条 600ms、单飞、无轮询、无持久化；仅在设置页打开与线路保存后触发。
- [新增 peer 依赖在旧 shell 不可用会导致设置区加载失败] → primitives 由 Web 壳随 DSH 版本提供，插件与 DSH 同版 pin（`dsh.yaml`），且 `auto-model-routing` 已有同款运行时依赖；测试用 stub 隔离。
- [图标无文字可能产生歧义] → DSH `Tooltip` + `aria-label`；禁用态把原因写进 `aria-label`。
- [jsdom 无法计算真实 CSS 几何或键盘默认激活] → 圆角、档位、状态都以导出常量/`data-*` 属性断言；像素与 Enter/Space 行为放预览验收。
- [依赖变更需要可写依赖] → 实现前先 `ws promote`，再更新 `package.json` / lockfile；否则 lockfile 与工作区不一致。
- [默认收起后用户找不到编辑入口] → 折叠行仍显示主机名、active 方块与延迟；切换控件带 `aria-expanded`、三角图标与 pointer。
- [旧 host 没有 latency 资源（404）] → 客户端把任何非 2xx 归为 `failed`，显示「—」，其余功能不受影响（版本偏斜期的唯一支持路径）。

## Migration Plan

1. `ws promote`（依赖模式切到可写）→ 给 `packages/dsh-magpie-connector` 加 peer/dev 依赖并更新 lockfile。
2. host：`latency.ts` + `selection.ts` 计时探测 + `routes.ts` 第四资源（GET-only）+ dispose 接线；补 host 测试（响应形状、GET-only、单飞、dispose 中止、不写设置）。
3. client：样式（圆角、行布局、信号条）+ `SettingsPage`（收起语义与 pending 展开键协调、切换控件、图标、测速状态）+ `api.ts`；补 UI 测试与 primitives stub；按 D9 加 `expandLine` 帮助函数、修既有 settings-render 用例、给 fixture 补 latency 处理器。
4. 文档 / 版本（`package.json` + `dsh.yaml`）/ 截图台账；`npm test`、包内 `typecheck`、`npm run check:artifacts`、`node scripts/sync.mjs` 幂等检查；worktree 预览验收（含 Enter/Space 与 46% 圆角目视）。
5. 回滚：纯前端 + 只读资源，无持久化数据迁移；回滚到 0.3.1 包即可，旧客户端不会请求 `latency`。

## Open Questions

- 是否在「连接」区加一个手动「重新测速」图标按钮？当前设计是重新打开面板即重测；成本很低，等实际使用后再定（若要加，先改 spec）。
