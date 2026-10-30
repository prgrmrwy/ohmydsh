## 1. 依赖与测试底座

- [x] 1.1 `ws promote`（worktree 依赖模式切到可写），确认 `git status` 只出现预期的 `package.json` / `package-lock.json` 变化
- [x] 1.2 给 `packages/dsh-magpie-connector` 增加 peer/dev 依赖 `@deepseek-ai/dsh-client-ui-primitives@^0.2.0-rc.2`，跑一次安装更新 lockfile；确认 `tsdown.config.ts` 的 `external: [/^@deepseek-ai\//]` 已覆盖运行时外部化
- [x] 1.3 写失败测试：新建 `test/client-support/primitives-stub.ts`（`Icon*` 占位 `svg` 带 `data-icon`、`Tooltip` 透传）并把 `vitest.config.ts` 指向 stub；写 `test/latency.test.ts` 的首个骨架用例（期望 `LatencyController` 存在、`read()` 返回 `{lines}`），断言失败原因为「模块/控制器不存在」
- [x] 1.4 实现：创建 `src/host/latency.ts` 的空骨架（导出常量、类与类型），让 1.3 的骨架用例以「行为未实现」方式失败而不是模块缺失
- [x] 1.5 Refactor；`npm test --workspace=packages/dsh-magpie-connector` 保持可运行（骨架用例仍红）

## 2. 用量条圆角

- [x] 2.1 Write failing test: `test/cards-render.test.tsx → test_usage_bar_round_cap`（test-plan: specs/dsh-magpie-connector → 用量入口与颜色 → 用量条填充两端圆角；断言 `settingsCss` 中 `.dmg-track` 与 `.dmg-fill` 的 `border-radius` 相同且非零），确认因 `.dmg-fill` 没有 radius 而失败
- [x] 2.2 Implement: 在 `src/client/styles.ts` 的 `.dmg-fill` 上补 `border-radius:3px`（与 `.dmg-track` 一致）使 2.1 通过
- [x] 2.3 Refactor: 抽出/复用圆角常量注释，确认既有用量条颜色用例仍绿

## 3. 线路展示与展开（默认收起、切换控件、操作图标）

- [x] 3.1 Write failing test: `test/line-active-ui.test.tsx → test_line_active_ui_01`（默认收起已配置的线路），断言两张卡片 `data-expanded="false"`、active 方块仍在生效行、无展开体；同时把 `test_line_active_ui_02` 补上 `data-expanded="false"` 断言
- [x] 3.2 Implement: `SettingsPage` 初始 `expanded = null`；`settings` 刷新保留既有展开项（尚不处理 pending 草稿，留到 3.10）；样式给折叠行加上主机名/延迟/切换控件布局
- [x] 3.3 Refactor: 抽出 `LineCard` 的折叠行布局，保持 `data-line-id` / `data-expanded` 契约
- [x] 3.4 Write failing test: `test/line-active-ui.test.tsx → test_line_expand_install` 与 `test_line_expand_add`（首次安装添加第一条线路、新增备用线路只展开新行）
- [x] 3.5 Implement: `add()` 保持展开新草稿；空态添加第一条线路后展示编辑体
- [x] 3.6 Refactor: 统一 `add()` 路径，仓库内已有 `expandLine(host, lineId)` 辅助（`test/client-support/fake-api.ts`）供其它用例复用
- [x] 3.7 Write failing test: `test/line-active-ui.test.tsx → test_line_expand_toggle`（两条已保存线路，点击线路 2 的切换控件展开；点击已启用的「上移」图标不改变展开状态；断言切换控件是原生 `button`、`type="button"`、`aria-expanded` 翻转）
- [x] 3.8 Implement: 行头部拆成 `button.dmg-line-toggle` + `.dmg-line-actions` 兄弟节点；用 DSH 图标（`IconTriangleRightFillRegular` 旋转、`IconChevronUp/DownOutlineRegular`、`IconTrashOutlineRegular`）+ `Tooltip`；保留 `aria-controls` 仅展开时出现；操作按钮常驻、禁用态 `aria-label` 带原因
- [x] 3.9 Refactor: 图标/按钮样式走 DSH 度量（16px 视觉盒、14px 图标、24px 按钮、`--dsw-*` token），移除四个文字按钮及其死样式
- [x] 3.10 Write failing test: `test/line-active-ui.test.tsx → test_line_expand_first_save`、`test_line_expand_save_after_move`、`test_line_expand_save_keep`、`test_line_expand_save_failure`（首次保存换新 id 仍展开；上移后首次保存仍展开；保存成功不收起；保存失败保持展开且保留输入）
- [x] 3.11 Implement: 按 design D2 在 `save()` 时记录 `pendingIndex`、在 `remove` 时清空 `pendingDraftId`、在设置刷新时把消失的 pending 草稿重写到同位置的响应行；保存失败不重置 drafts
- [x] 3.12 Refactor: 用 `lineSignature` 之外的最小状态承载 pending 逻辑，确认既有 `line-list` / `access-ui` 等用例按 D9 的 `expandLine` 适配后仍绿

## 4. 线路测速 host 侧

- [x] 4.1 Write failing test: `test/latency.test.ts → test_latency_empty_address_skipped`、`test_latency_response_and_get_only`、`test_latency_response_omits_empty`（空地址不连接且不出现在响应；GET 返回 `{lines:[{id,ms}]}`；注册的方法恰为 `['GET']`、POST 不进入处理器且不建连）
- [x] 4.2 Implement: `selection.ts` 抽出内部 `probeSocket(host,port,timeoutMs,signal)` 返回 `{reachable, ms}`（`probePort` 变薄包装，`Probe` 类型不变）；`latency.ts` 的 `LatencyController` 用 `runtime.config()` + `endpointOf` 并行测量、单调时钟、`Math.max(0, round(ms))`
- [x] 4.3 Refactor: 保持 `probePort` 既有测试全绿（`line-probe.test.ts` 不改语义）
- [x] 4.4 Write failing test: `test/latency.test.ts → test_latency_single_flight`（两个并发 `read()` 只产生一组测量：连接尝试次数不增加，两次 `lines` 相同）
- [x] 4.5 Implement: 控制器内单飞（进行中的 promise 复用），`ms` 为 null 表示 600ms 内未完成
- [x] 4.6 Refactor: 提取测量结果类型，避免控制器与路由层共享可变状态
- [x] 4.7 Write failing test: `test/latency.test.ts → test_latency_dispose`（悬挂测量被 abort、socket 释放、dispose 后 `read()` 直接返回空且不建连）
- [x] 4.8 Implement: `LatencyController.dispose()` abort 所有在途测量并在 disposed 后短路 `read()`
- [x] 4.9 Write failing test: `test/latency.test.ts → test_latency_no_side_effects`（测量前后 settings.json 字节不变、`activeLineId` 不变、随后选择仍按自动选择规则探测）
- [x] 4.10 Implement: 保证 `read()` 只读 `runtime.config()`、不写 store、不碰 `LineSelector` 缓存
- [x] 4.11 Write failing test: `test/line-transport.test.ts → test_line_transport_06` 扩展断言（测速也只建 TCP、覆盖未配置 key 但地址可解析的线路）
- [x] 4.12 Implement: 接线 `routes.ts` 注册 `latency`（`methods:['GET']`）+ `registerRoutes` 返回控制器与 dispose；`src/index.ts` 的 effect disposer 关闭控制器
- [x] 4.13 Refactor: 更新 `test/dispose.test.ts:9` 的资源路径数组与 `release` 次数（3 → 4），`test/feature-wiring.test.ts:12` 标题文案

## 5. 线路测速客户端展示

- [x] 5.1 Write failing test: `test/line-latency-ui.test.tsx → test_line_latency_levels`、`test_line_latency_timeout`、`test_line_latency_measuring_idle`（四档 `data-latency-level` 4/3/2/1 与 `data-latency-ms`；null → level 0 + 「超时」；pending → `measuring` + 「测速中…」；空地址/未保存 → `idle` 无占位）
- [x] 5.2 Implement: `api.ts` 的 `Resource` 加 `latency`；`SettingsPage` 增加 latency 状态机与 DOM 契约（`data-latency-*`）、4 格信号条 + 等宽毫秒 + `title` 提示；`styles.ts` 增加信号条/状态样式与 token 配色
- [x] 5.3 Refactor: 提取 `latencyLevel(ms)` 纯函数与阈值常量，供测试与 UI 共用
- [x] 5.4 Write failing test: `test/line-latency-ui.test.tsx → test_line_latency_failed`、`test_line_latency_404`（500/网络错误与 404 → `failed` + 「—」；空地址行保持 `idle`；两张 `[data-line-id]` 卡片与 `[aria-label="用量"]` 仍在、`data-usage-state` 不变；无新增 alert/status/aria-live）
- [x] 5.5 Implement: 任何非 2xx 或异常归为 `failed`；渲染「—」；空地址/未保存保持 `idle`；响应中不存在的行落 `idle`
- [x] 5.6 Write failing test: `test/line-latency-ui.test.tsx → test_line_latency_scope_ui`、`test_line_latency_remeasure_on_save`、`test_line_latency_no_remeasure_on_resync`、`test_line_latency_no_polling`、`test_line_latency_silence`（打开只测一次且覆盖未配置 key 的可解析线路；保存成功重测；resync 不重测；不轮询不发 POST；失败只影响延迟位且不新增提示）
- [x] 5.7 Implement: 挂载时与 `identityWrite` 成功后发起 `readLatency()`，用独立 epoch 丢弃过期响应；不监听 settings 对象变化重复测速；失败不重试
- [x] 5.8 Refactor: 与 cards 的 epoch/失败处理对齐命名，确认 `test/line-latency-ui.test.tsx` 全绿且无 `act` 警告

## 6. info 说明与既有用例适配

- [x] 6.1 Write failing test: `test/line-silent-ui.test.tsx → test_line_silent_ui_02` 扩展（`title` 含 TCP 建连耗时第 5 项；图标 `tabIndex=0` 且 `aria-label` 含同一说明）；`test_line_silent_ui_01` 适配默认收起
- [x] 6.2 Implement: `INFO_TEXT` 扩为五项；info 图标加 `tabIndex=0` 与完整 `aria-label`
- [x] 6.3 Write failing test: 给 `test/access-ui.test.tsx` 三条用例补 `expandLine` 前置与 `GET latency` fixture，断言先红（当前找不到编辑控件）
- [x] 6.4 Implement: 新增 `test/client-support/fake-api.ts` 的 `expandLine` 辅助与 `latency` fixture；按 D9 适配 `access-ui` 及其它 settings-render 用例
- [x] 6.5 Refactor: 全包 `vitest run` 绿；确认没有用例依赖 fakeApi 默认 404 的巧合

## 7. 文档、版本与验收

- [x] 7.1 更新 `packages/dsh-magpie-connector/docs/internal-api.md`：第 4 个资源形状、GET-only/404、测量语义、不持久化/不轮询/不写 settings
- [x] 7.2 版本 0.3.1 → 0.4.0：`package.json`、`dsh.yaml` 的 local package `version`、`CHANGELOG.md`；`src/client/api.ts` 与 `src/client/index.ts` 的「三个 D10 资源」注释改四个
- [x] 7.3 按 `docs/SCREENSHOTS.md` 复拍 `docs/settings.png` 并更新台账行（source/date/reviewer/verdict/note）——已用隔离预览 + agent-browser（headless Chrome 156 + 本地 Noto Sans SC）在 1600×1600 复拍，mock 网关演示数据；台账行已更新（2026-10-30）
- [x] 7.4 验证：`npm test --workspace=packages/dsh-magpie-connector`、包内 `typecheck`、根 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs` 连续两次幂等
- [x] 7.5 worktree 预览验收（`dsh build` → `ws prepare-preview` → `dsh`）：默认收起、点击头部展开/收起、图标与 tooltip、Enter/Space 激活、46% 用量条圆角、测速中→四档/超时/「—」的观感与暗色主题——已在隔离预览（port 3202、isolated home）用 agent-browser 完成：两行默认收起；点击/Enter/Space 切换成功；换行后顺序与展开保持；图标 aria-label 与 DSH Tooltip 可见；信号条 4 格 + 「5 ms」、备用线路「超时」；46%/28% 用量条右端为圆弧
- [x] 7.6 把 test-plan.md 所有 🔴 行按实际结果翻绿，填写 `verify.md`（含预览验收记录与未覆盖项），再判断是否可归档
