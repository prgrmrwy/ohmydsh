## Test Plan

依据 `openspec/changes/archive/2026-10-30-magpie-line-probe-and-save-clarity/` 的 proposal/design 与两份 delta spec（`dsh-magpie-connector` 9 scenarios、`magpie-line-selection` 35 scenarios，共 **44**）。delta 已按 0.4.0 合入后的当前主 spec 重基：`线路展示与展开` 与 `只读与传输边界` 的既有 scenario 逐字保留（其中「默认收起 / 图标操作 / 每线路测速」来自已归档的 `2026-10-30-magpie-line-panel-polish`），本 change 只追加检查相关条款与场景。

其中 16 个 scenario 由既有测试覆盖（标 🟢 green，含 polish 已落地的 9 个展开/收起场景与 7 个传输边界场景），**28 个是本 change 新增**并已实现。数量口径不要读成 44 项新功能。

约定：每个新增 scenario 至少一个具名测试；沿用场景指向已有测试（不改断言）。全部 44 行均已翻绿（实施见 `verify.md`）。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 完整流程只触达白名单 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 重定向不被跟随 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 存在全局代理时仍直连 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 多线路时只触达生效线路 origin | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 明文 http 线路不携带 Access 头 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 探测只建 TCP 连接不发 HTTP | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 空地址线路不被测速 | packages/dsh-magpie-connector/test/latency.test.ts | test_latency_empty_address_skipped | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 线路检查只触达被检查线路的 /v1/models | packages/dsh-magpie-connector/test/line-check-transport.test.ts | test_line_check_transport_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 检查直连草稿不携带 Access 头 | packages/dsh-magpie-connector/test/line-check-transport.test.ts | test_line_check_transport_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 默认收起已配置的线路 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_active_ui_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 无 active 时不显示方块 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_active_ui_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 首次安装空态与添加第一条线路后展开 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_install | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 新建线路首次保存后保持展开并换成新 id | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_first_save | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 新增线路并上移后首次保存仍保持展开 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_save_after_move | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 新增备用线路只展开新行 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_add | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 点击切换控件切换展开且图标操作不触发展开 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_toggle | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 保存失败时保持展开且不清空输入 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_save_failure | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 保存后不收起正在编辑的行 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_expand_save_keep | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路展示与展开 | 已保存但未完整的线路标记为未配置 | packages/dsh-magpie-connector/test/line-active-ui.test.tsx | test_line_active_ui_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 保存结果陈述 | 保存结果只陈述状态 | packages/dsh-magpie-connector/test/line-silent-ui.test.tsx | test_line_silent_ui_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查端点与结果分类 | 检查未生效的草稿线路返回快照且不改变任何状态 | packages/dsh-magpie-connector/test/line-check.test.ts | test_line_check_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查端点与结果分类 | 连接阶段失败归入 unreachable | packages/dsh-magpie-connector/test/line-check.test.ts | test_line_check_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查端点与结果分类 | 网关非 2xx 按状态分类 | packages/dsh-magpie-connector/test/line-check.test.ts | test_line_check_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查端点与结果分类 | 3xx 不跟随并按状态归 redirect | packages/dsh-magpie-connector/test/line-check.test.ts | test_line_check_04 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查端点与结果分类 | 2xx 的 body 读取失败与预算耗尽 | packages/dsh-magpie-connector/test/line-check.test.ts | test_line_check_05 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查端点与结果分类 | 2xx body 的解码结果分类 | packages/dsh-magpie-connector/test/line-check.test.ts | test_line_check_06 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查端点与结果分类 | 状态优先于错误 body 超时 | packages/dsh-magpie-connector/test/line-check.test.ts | test_line_check_07 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查端点与结果分类 | reason 先脱敏再截断 | packages/dsh-magpie-connector/test/line-check.test.ts | test_line_check_08 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查请求字段契约 | 请求形状非法返回 400 | packages/dsh-magpie-connector/test/line-check-contract.test.ts | test_line_check_contract_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查请求字段契约 | 值非法归入 invalid | packages/dsh-magpie-connector/test/line-check-contract.test.ts | test_line_check_contract_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查请求字段契约 | 草稿不完整一律 incomplete | packages/dsh-magpie-connector/test/line-check-contract.test.ts | test_line_check_contract_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查请求字段契约 | 凭据留空沿用保存值 | packages/dsh-magpie-connector/test/line-check-contract.test.ts | test_line_check_contract_04 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查请求字段契约 | 无 id 的草稿只用显式字段 | packages/dsh-magpie-connector/test/line-check-contract.test.ts | test_line_check_contract_05 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查请求字段契约 | 未知或未提交的线路 id | packages/dsh-magpie-connector/test/line-check-contract.test.ts | test_line_check_contract_06 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查的准入、读取一致性与单飞 | 解析期间发生连接写入 | packages/dsh-magpie-connector/test/line-check-admission.test.ts | test_line_check_admission_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查的准入、读取一致性与单飞 | 入口或解析后处于保存中 | packages/dsh-magpie-connector/test/line-check-admission.test.ts | test_line_check_admission_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查的准入、读取一致性与单飞 | 凭据读取异常不发请求 | packages/dsh-magpie-connector/test/line-check-admission.test.ts | test_line_check_admission_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查的准入、读取一致性与单飞 | 同一时刻只允许一个检查 | packages/dsh-magpie-connector/test/line-check-admission.test.ts | test_line_check_admission_04 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查的准入、读取一致性与单飞 | 临时凭据的脱敏覆盖成功与失败两条路径 | packages/dsh-magpie-connector/test/line-check-admission.test.ts | test_line_check_admission_05 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查快照的展示与失效 | 与缓存对比：一致或多出 / 缺少 | packages/dsh-magpie-connector/test/line-check-ui.test.tsx | test_line_check_ui_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查快照的展示与失效 | 快照只读 | packages/dsh-magpie-connector/test/line-check-ui.test.tsx | test_line_check_ui_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查快照的展示与失效 | 缓存基准诚实，不断言当前线路 | packages/dsh-magpie-connector/test/line-check-ui.test.tsx | test_line_check_ui_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查快照的展示与失效 | 失效事件与迟到结果 | packages/dsh-magpie-connector/test/line-check-ui.test.tsx | test_line_check_ui_04 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路检查快照的展示与失效 | 没有缓存基准时不下结论 | packages/dsh-magpie-connector/test/line-check-ui.test.tsx | test_line_check_ui_05 | 🟢 green |

## Coverage Notes

- **复用夹具、不新建框架**：host 侧用 `test/support/host.ts`（真实 Cordis / LlmRuntime / ownRoutes / 事件监听）、`test/support/credentials.ts`（可包装单次 `resolve` 制造暂停、可挂起 `set` 以停留在保存窗口）、`test/support/gateway.ts`（`deferred`、请求记录、`unreachableBaseUrl`）、`test/support/line.ts`。客户端用 `test/client-support/fake-api.ts` 的延迟响应与调用计数 + jsdom 渲染。
- **暂停解析**（admission_01/02）：包装 `credentials.resolve` 让第一项解析挂起；暂停期间分别完成「整组凭据保存成功」「保存失败」「删除线路」，再逐个释放。三条都断言 `pending`、网关 0 请求、闸门与 `retainIdentity` 引用释放；随后的恢复验证按分支不同——成功分支直接用新值检查为 `ok`；失败分支先按既有 pending 规则完成一次成功的整组重试再检查为 `ok`；删除分支先断言原 id 为 `invalid`，再用无 id 的完整显式草稿检查为 `ok`。`admission_02` 分两支断言：入口被拒时零解析零请求；解析期间才发生保存时允许已有的解析，但结果仍 `pending` 且零网关请求、闸门与引用已释放。
- **重定向的两条路**（check_04）：undici 的 `redirect:'error'` 只对 301/302/303/307/308 抛错（307 即使没有 `Location` 也抛），300/304 会作为 `Response` 返回。夹具因此分四次：307 的 `Location` 分别指向另一 origin 的 mock 与同 origin 的 `/api/usage`（两者各 0 请求），以及无 `Location` 的 304、300（源网关各只收到 1 个 `/v1/models`、无后续请求）。
- **body 读取失败与超时**（check_05、check_07）：直接控制 `ServerResponse`/socket 在写出响应头后中断或永不结束；超时用注入的 `checkTimeoutMs`（默认 `CHECK_TIMEOUT_MS = 5000` 由 check_01 断言）推进，断言连接中止、闸门释放；`check_07` 用 403 + 不结束 body 断言「状态优先」。
- **`contract_03` 的六个输入必须按行固定**：前五项都不带 id（`C` 为合法 https `/v1` 地址、`key` 有效，分别制造非 https、缺 secret、缺 clientId、clientId 空串、secret 空串）；第六项用已保存 id `a1b2c3d4` + 空地址。逐次断言 incomplete、零解析、零网关请求。
- **脱敏夹具**（check_08、admission_05）：假 key `secret-ABCDEFGHIJK0123456789` 横跨 300 字符截断边界；断言精确输出「290 个 x + 完整 `[redacted]`」、不出现完整 key 与 `secret-ABC`；另用 JSON 键名与转义回显覆盖 `redactJson`。
- **状态不变观察器**（check_01）：不依赖 `GET settings` 作唯一观察器，直接比较 `runtime.current` 对象与外层记录（代际 id、`selectedLineId`、store 字节、`knownOwners`、publish 调用与事件）。
- **UI 场景**（ui_01..05、silent_ui_03、active_ui_03）：fakeApi 分阶段响应验证差异集合、只读区域与失效；`ui_04` 断言仅编辑其它线路或重排时**不**丢弃本卡快照，本卡四类事件才丢弃；`silent_ui_03` 断言两种结果文本、元素不带 `role=alert|status|aria-live`；`active_ui_03` 断言「未配置」标记与 `data-active-line` 互斥，且未保存草稿显示「（未保存）」。
- **快照对生效线路同样渲染**：`ui_01..04` 的公共前提必须包含「被测线路就是 `activeLineId`」的情形，防止实现复活旧的「active 时隐藏」特例。
- **无独立 scenario 的实现级测试**：`test/line-save-isolation.test.tsx`（design D9 三条验收句）、`test/dispose.test.ts` 中的路由注册断言（新端点注册与释放）。
- **非可执行项**：无。
