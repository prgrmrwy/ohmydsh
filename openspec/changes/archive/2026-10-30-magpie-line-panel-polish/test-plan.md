## Test Plan

Every `#### Scenario:` in the two delta specs is mapped to one named test. New tests are 🟢 green until implemented; scenarios whose behavior is unchanged (or only extended) by this change map to existing green tests and say so.

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/magpie-line-selection/spec.md → 静默规则与 info 说明 | 切换线路静默无提示 | packages/dsh-magpie-connector/test/line-silent-ui.test.tsx | test_line_silent_ui_01 | 🟢 green（既有测试；断言改为默认收起下的绿方块） |
| specs/magpie-line-selection/spec.md → 静默规则与 info 说明 | info 图标说明优先级 | packages/dsh-magpie-connector/test/line-silent-ui.test.tsx | test_line_silent_ui_02 | 🟢 green（`title` 增加第 5 项延迟语义 + 新增 `aria-label` 断言） |
| specs/magpie-line-selection/spec.md → 静默规则与 info 说明 | 延迟变化与测速失败不产生提示 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_silence | 🟢 green |
| specs/magpie-line-selection/spec.md → 自动选择规则 | 单线路直接使用且不探测 | packages/dsh-magpie-connector/test/line-selection.test.ts | test_line_selection_01 | 🟢 green（行为未变） |
| specs/magpie-line-selection/spec.md → 自动选择规则 | 序号 1 可达时使用序号 1 | packages/dsh-magpie-connector/test/line-selection.test.ts | test_line_selection_02 | 🟢 green（行为未变） |
| specs/magpie-line-selection/spec.md → 自动选择规则 | 序号 1 不可达时自动使用序号 2 | packages/dsh-magpie-connector/test/line-selection.test.ts | test_line_selection_03 | 🟢 green（行为未变） |
| specs/magpie-line-selection/spec.md → 自动选择规则 | 全部不可达时用序号 1 并上抛真实错误 | packages/dsh-magpie-connector/test/line-selection.test.ts | test_line_selection_04 | 🟢 green（行为未变） |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 默认收起已配置的线路 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_active_ui_01 | 🟢 green（默认展开改为默认收起） |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 无 active 时不显示方块 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_active_ui_02 | 🟢 green（既有断言；补 collapsed 断言） |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 首次安装空态与添加第一条线路后展开 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_install | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 新建线路首次保存后保持展开并换成新 id | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_first_save | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 新增线路并上移后首次保存仍保持展开 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_save_after_move | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 新增备用线路只展开新行 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_add | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 点击切换控件切换展开且图标操作不触发展开 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_toggle | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 保存失败时保持展开且不清空输入 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_save_failure | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 保存后不收起正在编辑的行 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_save_keep | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路延迟展示 | 打开面板后展示四条线路的延迟档位 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_levels | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路延迟展示 | 测速中占位与无地址行留空 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_measuring_idle | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路延迟展示 | 超时显示 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_timeout | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路延迟展示 | 测速请求失败静默降级为破折号 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_failed | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路延迟展示 | 旧 host 没有 latency 资源时静默降级 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_404 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路测速范围与独立性 | 打开面板对每条已保存且地址可解析的线路测一次 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_scope_ui（UI 侧只断言一次 `GET latency` 与未配置 key 线路的读数；连接次数由 `test_line_transport_06` / `test_latency_*` 断言） | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路测速范围与独立性 | 刷新模型列表不重新测速 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_no_remeasure_on_resync | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路测速范围与独立性 | 保存线路后重新测速 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_remeasure_on_save | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路测速范围与独立性 | 不轮询且不改变线路选择 | packages/dsh-magpie-connector/test/line-latency-ui.test.tsx | test_line_latency_no_polling | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 用量入口与颜色（AMD4） | 用量条三档颜色（AMD4） | packages/dsh-magpie-connector/test/cards-render.test.tsx | 用量条颜色 it.each | 🟢 green（行为未变） |
| specs/dsh-magpie-connector/spec.md → 用量入口与颜色（AMD4） | 有卡片时没有整体刷新（AMD4） | packages/dsh-magpie-connector/test/cards-render.test.tsx | 有卡片时没有整体刷新栏目，只有每张卡片自己的刷新 | 🟢 green（行为未变） |
| specs/dsh-magpie-connector/spec.md → 用量入口与颜色（AMD4） | 目录同步失败时不发全量刷新 | packages/dsh-magpie-connector/test/cards-render.test.tsx | 目录同步失败时不发全量刷新并给出原因 | 🟢 green（行为未变） |
| specs/dsh-magpie-connector/spec.md → 用量入口与颜色（AMD4） | 用量条填充两端圆角 | packages/dsh-magpie-connector/test/cards-render.test.tsx | test_usage_bar_round_cap | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 完整流程只触达白名单 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_01 | 🟢 green（行为未变） |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 重定向不被跟随 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_02 | 🟢 green（行为未变） |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 存在全局代理时仍直连 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_03 | 🟢 green（行为未变） |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 多线路时只触达生效线路 origin | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_04 | 🟢 green（行为未变） |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 明文 http 线路不携带 Access 头 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_05 | 🟢 green（行为未变） |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 探测只建 TCP 连接不发 HTTP | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_06 | 🟢 green（扩展：测速也只建 TCP 且覆盖未配置 key 的线路） |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 空地址线路不被测速 | packages/dsh-magpie-connector/test/latency.test.ts | test_latency_empty_address_skipped | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 线路测速资源接口 | 响应形状与 GET-only | packages/dsh-magpie-connector/test/latency.test.ts | test_latency_response_and_get_only | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 线路测速资源接口 | 空地址线路不出现在响应中 | packages/dsh-magpie-connector/test/latency.test.ts | test_latency_response_omits_empty | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 线路测速生命周期 | 并发 GET 共享一次测量 | packages/dsh-magpie-connector/test/latency.test.ts | test_latency_single_flight | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 线路测速生命周期 | dispose 中止悬挂测量 | packages/dsh-magpie-connector/test/latency.test.ts | test_latency_dispose | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 线路测速生命周期 | 测速不写设置也不改变线路选择 | packages/dsh-magpie-connector/test/latency.test.ts | test_latency_no_side_effects | 🟢 green |

## Coverage Notes

- **测试文件**：新增 `test/latency.test.ts`（host `LatencyController` + 路由注册 + 测量 seam）与 `test/line-latency-ui.test.tsx`（客户端延迟展示、测速时机、失败/404、无轮询）；`test/line-active-ui.test.tsx` 就地扩写默认收起、首次/新增展开、首次保存换 id、上移后保存、保存失败与点击切换，不再新开一个同构文件。都沿用包内现有的 `// @vitest-environment jsdom` + `react-dom` `act` + 裸 DOM 事件模式，不引入 testing-library。
- **共享夹具**：`test/client-support/fake-api.ts` 增加 `expandLine(host, lineId)`（点击行内切换控件）；所有渲染设置页的用例补 `'GET latency'` 处理器（或显式测试 404 降级），避免依赖 fakeApi 默认 404 的巧合；`fakeApi` 的调用记录用于断言「打开只测一次 / 保存后重测 / 不轮询 / 不因读数发 POST」。
- **primitives stub**：`test/client-support/primitives-stub.ts` 提供 `Icon*` 占位 `svg`（带 `data-icon` 名称便于断言）与 `Tooltip` 透传；`vitest.config.ts` 增加 alias，与 `auto-model-routing` 一致。
- **host seam**：`LatencyController` 注入 `measure(host, port, timeoutMs, signal)` 与单调时钟 `now`；测试用假时钟与可控 `measure` 断言并行、600ms 截止、单飞、dispose 中止与 `read()` after dispose 不建连。
- **green 行说明**：标 🟢 的行是既有测试，本 change 不改其行为断言（个别行只加断言），因此不经历 red→green；其余行按 TDD 先红后绿。实现顺序与 tasks.md 的批次对应。
- **非代码验收**：46% 进度下填充末端为圆弧、Enter/Space 键盘激活切换控件，jsdom 无法断言，放入 worktree 预览验收（`verify.md` 引用），不作为 test-plan 行。
- **测试前置**：新增 `@deepseek-ai/dsh-client-ui-primitives` 依赖前需先 `ws promote`（worktree 依赖为只读缓存），否则 `package.json` / lockfile 无法更新，`npm test` 可能解析到主仓安装版本而非本 worktree 声明。
