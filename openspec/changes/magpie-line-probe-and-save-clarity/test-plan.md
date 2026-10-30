## Test Plan

依据 `openspec/changes/magpie-line-probe-and-save-clarity/` 的 proposal/design 与两份 delta spec（`dsh-magpie-connector` 8 scenarios、`magpie-line-selection` 31 scenarios，共 39）。其中 12 个是沿用的既有行为（标 🟢 green，指向现有测试），**27 个是本次新增**（标 🔴 red）。数量口径不要读成「39 项新功能」。review.md 为 `VERDICT: APPROVE_WITH_CHANGES` + `CHANGES_APPLIED: yes`；本轮按 ponytail 视角合并了同行为变体（53 → 39）并删掉「生效线路不显示快照」特例，断言未减少。

约定：每个新增 scenario 至少一个**新建的具名测试**；沿用场景标 🟢 green 并指向已有测试（`test_line_list_04` 需按新 THEN 扩展「未配置」标记断言，不改其它断言）。新增测试初始 🔴 red，apply 阶段逐个翻绿，verify 不允许残留 red。函数名沿用本包 `test_<area>_NN spec Scenario "..."`。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 完整流程只触达白名单 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 重定向不被跟随 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_02 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 存在全局代理时仍直连 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_03 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 多线路时只触达生效线路 origin | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_04 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 明文 http 线路不携带 Access 头 | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_05 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 探测只建 TCP 连接不发 HTTP | packages/dsh-magpie-connector/test/line-transport.test.ts | test_line_transport_06 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 线路检查只触达被检查线路的 /v1/models | packages/dsh-magpie-connector/test/line-check-transport.test.ts | test_line_check_transport_01 | 🟢 green |
| specs/dsh-magpie-connector/spec.md → 只读与传输边界 | 检查直连草稿不携带 Access 头 | packages/dsh-magpie-connector/test/line-check-transport.test.ts | test_line_check_transport_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 首次安装为 0 条并提供添加入口 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_01 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 添加备用线路并调整优先级 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_02 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 删除线路且至少保留一条 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_03 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 未完整线路不参与自动选择 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_04 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 折叠线路可展开编辑 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_05 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 线路数量上限 | packages/dsh-magpie-connector/test/line-list.test.ts | test_line_list_06 | 🟢 green |
| specs/magpie-line-selection/spec.md → 线路列表与优先级 | 保存结果只陈述状态 | packages/dsh-magpie-connector/test/line-silent-ui.test.tsx | test_line_silent_ui_03 | 🟢 green |
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

- **复用夹具、不新建框架**：host 侧用 `test/support/host.ts`（真实 Cordis / LlmRuntime / ownRoutes / 事件监听）、`test/support/credentials.ts`（可包装单次 `resolve` 制造暂停）、`test/support/gateway.ts`（`deferred`、请求记录、`unreachableBaseUrl`）、`test/support/line.ts`（lines 夹具、`newId` seam）。客户端用 `test/client-support/fake-api.ts` 的延迟响应与调用计数 + jsdom 渲染。
- **暂停解析**（admission_01、admission_02）：包装 `credentials.resolve` 让第一项解析挂起；暂停期间分别完成「整组凭据保存成功」「保存失败」「删除线路」三种写入，再逐个释放。三条都断言 `pending`、网关 0 请求、闸门与 `retainIdentity` 引用释放；随后的恢复验证按分支不同——成功分支直接用新值检查为 `ok`；失败分支先按既有 pending 规则完成一次成功的整组重试再检查为 `ok`；删除分支先断言原 id 为 `invalid`，再用无 id 的完整显式草稿检查为 `ok`。`admission_02` 要分两支断言：入口被拒时零解析零请求；解析期间才发生保存时允许已有的解析，但结果仍 `pending` 且零网关请求、闸门与引用已释放。
- **重定向的两条路**（check_04）：undici 的 `redirect:'error'` 只对 301/302/303/307/308 抛错（307 即使没有 `Location` 也抛），300/304 会作为 `Response` 返回。夹具因此分四次：307 的 `Location` 分别指向另一 origin 的 mock 与同 origin 的 `/api/usage`（两者各 0 请求），以及无 `Location` 的 304、300（源网关各只收到 1 个 `/v1/models`、无后续请求）。实现侧只允许给 `transport.ts:54` 加 `redirect: true` 标记，不加第二条传输。
- **body 读取失败与超时**（check_05、check_07）：直接控制 `ServerResponse`/socket 写出响应头后中断或永不结束；超时用 Vitest 假时钟推进 5 秒预算，断言 `latencyMs ≤ 6000`、连接中止、闸门释放；`check_07` 用 403 + 不结束 body 断言「状态优先」。
- **`contract_03` 的六个输入必须按行固定**：前五项都不带 id（`C` 为合法 https `/v1` 地址、`key` 有效，分别制造非 https、缺 secret、缺 clientId、clientId 空串、secret 空串）；第六项用已保存 id `a1b2c3d4` + 空地址。逐次断言 incomplete、零解析、零网关请求——否则「缺 key」会让完全漏检 Access 的实现也能通过。
- **脱敏夹具**（check_08、admission_05）：假 key `secret-ABCDEFGHIJK0123456789`，原因原文 = 290 个 `x` + key + 30 个 `y`；正确输出恰为 290 个 `x` + 完整 `[redacted]`（300 字符），必须断言不出现完整 key、也不出现先截断后脱敏才会留下的前缀 `secret-ABC`；另一条用 JSON 键名与转义回显覆盖 `redactJson`。
- **状态不变观察器**（check_01）：不依赖 `GET settings` 作唯一观察器，直接比较 `runtime.current` 对象与外层记录（代际 id、`selectedLineId`、store 字节、`knownOwners`、publish 调用与事件）。
- **UI 场景**（ui_01..05、silent_ui_03）：fakeApi 分阶段响应验证差异集合、只读区域与失效；`ui_01` 断言一致/差异两种变体且不展示共同集合、`POST settings` 为 0；`ui_04` 断言仅编辑其它线路或重排时**不**丢弃本卡快照，四种本卡事件才丢弃；`silent_ui_03` 断言两种结果文本、元素不带 `role=alert|status|aria-live`，并在保存→切线→重读全过程不给新增节点加 live 语义。
- **快照对生效线路同样渲染**：`ui_01..04` 的公共前提必须包含「被测线路就是 `activeLineId`」的情形，防止实现照抄旧的「active 时隐藏」特例。
- **实施后补充**：`test/line-check-ui.test.tsx` 的 ui_01 同时覆盖「一致」与「多/少」两种变体；`test/line-silent-ui.test.tsx` 的 `test_line_silent_ui_03` 一次覆盖有/无 active 两种结果；`test/line-active-ui.test.tsx` 的 `test_line_active_ui_03` 承担「未配置」标记的 DOM 断言（host 侧的 `complete: false` 断言仍在 `test_line_list_04`）。另有 3 个无独立 scenario 的实现级测试 `test/line-save-isolation.test.tsx`（design D9 三条验收句）与 `test/dispose.test.ts` 中的路由注册断言（新端点已被注册/释放）。
- **非可执行项**：无。39 个 scenario 都有代码测试入口（12 个由既有测试覆盖）。
