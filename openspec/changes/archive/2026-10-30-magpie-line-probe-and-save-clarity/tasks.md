# Tasks

说明：重基后 delta 共 44 个 scenario，其中 16 个是既有行为（沿用既有测试，无任务），28 个是本 change 新增、按 anvil 强制格式各占「红-绿-重构」三项；另有一组无独立 scenario 的实现收尾（D9 保存隔离来自 design 验收句）；「未配置」标记的 DOM 断言已由「线路展示与展开」的新场景承载（`test_line_active_ui_03`）。原 39/12/27 的口径是重基前的中间版本。每组末尾给出该组的相关检查命令；不要照表跑 90 次全量测试，最后统一跑一次全套。

## 1. 宿主：线路检查端点骨架与传输边界

- [x] 1.1 Write failing test: `test_line_check_transport_01`（检查只触达被检查线路的 `/v1/models`；生效线路 origin 0 请求；无目录同步、无换线）(assert fails for right reason)
- [x] 1.2 Implement: 注册 `/api/dsh-magpie-connector/line-check`；`runtime` 增加只读检查方法（拼临时 identity、经 `transport.request` 发 `GET /models`，不进入 `beginOperation`/`syncCatalog`/`emit`）to pass 1.1
- [x] 1.3 Refactor; full suite stays green
- [x] 1.4 Write failing test: `test_line_check_transport_02`（直连草稿不携带 `CF-Access-*`，只带自己的 bearer，即使另一线路配了 Access）
- [x] 1.5 Implement: 检查 identity 的 `accessMode`/Access 头只取草稿自身；direct 不带 Access to pass 1.4
- [x] 1.6 Refactor; full suite stays green
- [x] 1.7 本组检查：`npx vitest run test/line-check-transport.test.ts test/line-transport.test.ts`

## 2. 宿主：检查结果分类

- [x] 2.1 Write failing test: `test_line_check_01`（草稿检查返回 `ok` 与模型摘要；`current` 代际、`selectedLineId`、store 字节、`knownOwners`、publish 均不变）
- [x] 2.2 Implement: 结果投影为 `{modelCount, models:[{id}]}`（与 envelope 同一形状；网关输入里的 `owned_by` 只作脱敏夹具，不进入输出），不写 `gen.catalog`、不 `commitOwners`、不 `emit` to pass 2.1
- [x] 2.3 Refactor; full suite stays green
- [x] 2.4 Write failing test: `test_line_check_02`（未监听端口与 TLS 握手失败都是 `unreachable`、无 `gatewayStatus`、无 5xx）
- [x] 2.5 Implement: 连接/发送/TLS 阶段异常归一为 `unreachable`，reason 带真实原因 to pass 2.4
- [x] 2.6 Refactor; full suite stays green
- [x] 2.7 Write failing test: `test_line_check_03`（401/403/503 → `unauthorized`/`forbidden`/`http`，各自带 `gatewayStatus`）
- [x] 2.8 Implement: 已取得响应状态时按 status 映射 kind to pass 2.7
- [x] 2.9 Refactor; full suite stays green
- [x] 2.10 Write failing test: `test_line_check_04`（307 的两个 `Location` 变体：跨 origin 与同 origin `/api/*` 目标各 0 请求；304/300 无 `Location` 作为 Response 归 `redirect`，源网关各只 1 个 `/v1/models`、无后续请求）
- [x] 2.11 Implement: `transport.ts:54` 的重定向分支加 `redirect: true` 标记（行为不变）；检查层对「抛错带标记」与「Response 3xx」两条路都归 `redirect`，不新增传输 to pass 2.10
- [x] 2.12 Refactor; full suite stays green
- [x] 2.13 Write failing test: `test_line_check_05`（200 后 body 中断 → `unreachable` 且无重放；200 后 body 不结束 → `timeout`、`latencyMs ≤ 6000`、连接中止、随后可再检查）
- [x] 2.14 Implement: 2xx 阶段 body 读取失败归 `unreachable`；5 秒总预算（AbortController + 计时器）覆盖连接、响应头、body 与解析，`finally` 释放闸门 to pass 2.13
- [x] 2.15 Refactor; full suite stays green
- [x] 2.16 Write failing test: `test_line_check_06`（HTML 与 `{data:{}}` → `invalid-catalog` 且无 `modelCount`；`{data:[]}` → `ok`、`modelCount: 0`、`models: []`）
- [x] 2.17 Implement: 2xx 才解码 body：非 JSON 或 `data` 非数组 → `invalid-catalog`；空数组视为 `ok` to pass 2.16
- [x] 2.18 Refactor; full suite stays green
- [x] 2.19 Write failing test: `test_line_check_07`（403 且错误 body 不结束直到预算耗尽 → 仍为 `forbidden`/403，reason 标注 body 未完整读取）
- [x] 2.20 Implement: 状态优先于 body——已定分类不因错误 body 超时/失败改变 to pass 2.19
- [x] 2.21 Refactor; full suite stays green
- [x] 2.22 Write failing test: `test_line_check_08`（假 key 横跨截断边界：reason 恰为 290 个 `x` + 完整 `[redacted]`、长度 300、不含完整 key 与 `secret-ABC`）
- [x] 2.23 Implement: reason 先 `redact()` 再截断到 300 字符 to pass 2.22
- [x] 2.24 Refactor; full suite stays green
- [x] 2.25 本组检查：`npx vitest run test/line-check.test.ts`

## 3. 宿主：检查请求字段契约

- [x] 3.1 Write failing test: `test_line_check_contract_01`（14 个非法输入全部 400，零请求零解析；空 id 不得因缺地址而通过）
- [x] 3.2 Implement: 请求体形状校验（非对象/未知键/`id` 空串或非字符串/缺或非字符串 `baseUrl`/`accessMode` 空串或非字符串/凭据 `null` 或非字符串）→ 400 to pass 3.1
- [x] 3.3 Refactor; full suite stays green
- [x] 3.4 Write failing test: `test_line_check_contract_02`（八种非法值：ftp、无版本段、userinfo、direct 带 Access、key 含空白、accessClientId 含空白、accessClientSecret 含空白、key 超长 → 全部 `invalid`、零请求）
- [x] 3.5 Implement: 地址用 `normalizeBaseUrl`、凭据形状复用保存侧规则、direct 携带 Access 拒绝，统一 `invalid` to pass 3.4
- [x] 3.6 Refactor; full suite stays green
- [x] 3.7 Write failing test: `test_line_check_contract_03`（六行固定输入：前五项无 id、`C` 为合法 https `/v1`、`key` 有效，分别是非 https、缺 secret、缺 clientId、clientId 空串、secret 空串；第六项已保存 id + 空地址 → 全部 `incomplete`、零请求、零解析）
- [x] 3.8 Implement: 空地址先判 `incomplete`（不回退）；cloudflare 必须 https 且成对；无 id 时只用显式字段 to pass 3.7
- [x] 3.9 Refactor; full suite stays green
- [x] 3.10 Write failing test: `test_line_check_contract_04`（有 id 时省略或空串 key／两项 Access → 用该线路保存值，请求头逐项正确，响应无明文）
- [x] 3.11 Implement: 有 id 时省略/空串凭据回退到该线路已保存值（只回退凭据，不回退地址）to pass 3.10
- [x] 3.12 Refactor; full suite stays green
- [x] 3.13 Write failing test: `test_line_check_contract_05`（无 id 且有地址无 key → `incomplete`、零解析、零请求）
- [x] 3.14 Implement: 无 id 时不解析任何派生凭据引用 to pass 3.13
- [x] 3.15 Refactor; full suite stays green
- [x] 3.16 Write failing test: `test_line_check_contract_06`（形状合法但不在当前配置的 id → `invalid` 且零解析；形状非法 → 400）
- [x] 3.17 Implement: id 形状校验 + 已验证配置成员校验（失败即 `invalid`，不解析凭据）to pass 3.16
- [x] 3.18 Refactor; full suite stays green
- [x] 3.19 本组检查：`npx vitest run test/line-check-contract.test.ts`

## 4. 宿主：准入、读取一致性与单飞

- [x] 4.1 Write failing test: `test_line_check_admission_01`（解析被暂停期间分别完成「整组凭据保存成功」「保存失败」「删除线路」→ 三次都 `pending`、零请求、闸门与引用释放；恢复验证分支化：成功分支直接新值 ok、失败分支先完成整组重试再 ok、删除分支先原 id invalid 再用无 id 草稿 ok）
- [x] 4.2 Implement: 连接写入版本号（`updateLines` 入口递增、失败不回退）＋解析后只复核版本号与 `disposed` to pass 4.1
- [x] 4.3 Refactor; full suite stays green
- [x] 4.4 Write failing test: `test_line_check_admission_02`（分支 (a) 调用时正在保存 → 零解析零请求即 `pending`；分支 (b) 已开始解析后保存才发生 → 允许已有解析，但仍 `pending`、零网关请求、闸门与引用释放）
- [x] 4.5 Implement: 入口准入（`disposed`/`saving`/`failedFields`）+ 解析后版本复核 to pass 4.4
- [x] 4.6 Refactor; full suite stays green
- [x] 4.7 Write failing test: `test_line_check_admission_03`（`credentials.resolve` 抛错 → `invalid`、脱敏、零请求）
- [x] 4.8 Implement: 凭据解析异常归一为 `invalid` 并脱敏 to pass 4.7
- [x] 4.9 Refactor; full suite stays green
- [x] 4.10 Write failing test: `test_line_check_admission_04`（两个设置页并发检查同一草稿 → 一个 `busy`、网关只收到 1 个请求）
- [x] 4.11 Implement: host 全局单飞闸门（首行同步占闸、`finally` 释放、不复用他人结果）to pass 4.10
- [x] 4.12 Refactor; full suite stays green
- [x] 4.13 Write failing test: `test_line_check_admission_05`（临时 key/Access 在成功模型字段、401 body、JSON 键名与转义、body 读取错误中均 `[redacted]`）
- [x] 4.14 Implement: 用 `retainIdentity`/`retainKey` 引用计数纳入 `redact()`；handler 内部收敛异常、构造响应后再释放引用 to pass 4.13
- [x] 4.15 Refactor; full suite stays green
- [x] 4.16 本组检查：`npx vitest run test/line-check-admission.test.ts`

## 5. 客户端：保存结果、未配置标记与身份隔离

- [x] 5.1 Write failing test: 扩展 `test_line_list_04`（既有「未完整线路不参与自动选择」的 THEN 增加「卡片头显示未配置、且不带 `data-active-line`；完整线路不显示」）
- [x] 5.2 Implement: `LineDraft` 带 host 返回的 `complete`，卡片头按保存态渲染「未配置」标记，与「（未保存）」草稿标记区分 to pass 5.1
- [x] 5.3 Refactor; full suite stays green
- [x] 5.4 Write failing test: `test_line_silent_ui_03`（两种提交的结果文本恰为 `已保存 · 当前线路 2` / `已保存 · 当前无生效线路`；元素不带 `role=alert|status|aria-live`；无 alert/confirm；文本不含「切换」）
- [x] 5.5 Implement: 保存结果文案改为状态陈述，移除结果元素的 `role="status"` to pass 5.4
- [x] 5.6 Refactor; full suite stays green
- [x] 5.7 Write failing test: 保存待响应期间旧卡片已不可见；生效 key 已写而后续字段写入失败时旧卡片不恢复；纯备用线路提交保留卡片与读取时间且不额外 `GET cards`（design D9 三条验收句，无独立 scenario）
- [x] 5.8 Implement: `touchesActiveIdentity` 短谓词（删除生效线路 / 地址或接入方式变化 / 为该线路提供凭据）→ 提交前 `clearUsage()` + 推进 epoch；失败路径重读 settings 与 cards 且不恢复旧卡片；未命中时保留卡片 to pass 5.7
- [x] 5.9 Refactor; full suite stays green
- [x] 5.10 本组检查：`npx vitest run test/line-silent-ui.test.tsx test/line-list.test.ts test/cards-render.test.tsx test/settings-write-isolation.test.ts`

## 6. 客户端：检查快照展示与失效

- [x] 6.1 Write failing test: `test_line_check_ui_01`（缓存 `{a,b,c}` + `lastSyncAt` T；检查同组 → 「与缓存目录一致」+ T 且不显示多/少；检查 `{a,b,x}` → 「多 1 · 少 1」、多 `{x}`、少 `{c}` 且不展示共同集合；两次都无设置写入；被测线路是生效线路时同样渲染）
- [x] 6.2 Implement: 快照渲染（kind、耗时、数量、与缓存 id 集合的多/少、缓存时间）；不因 active 隐藏 to pass 6.1
- [x] 6.3 Refactor; full suite stays green
- [x] 6.4 Write failing test: `test_line_check_ui_02`（快照区域无 checkbox / effort / 刷新，模型 id 为纯文本节点）
- [x] 6.5 Implement: 只读快照 DOM（无交互控件）to pass 6.4
- [x] 6.6 Refactor; full suite stays green
- [x] 6.7 Write failing test: `test_line_check_ui_03`（active 已切换、目录仍是继承目录与 T1 → 显示「与缓存目录一致」+ T1，不出现「当前线路」/「同一个网关」）
- [x] 6.8 Implement: 文案基准固定为缓存，不引用生效线路身份 to pass 6.7
- [x] 6.9 Refactor; full suite stays green
- [x] 6.10 Write failing test: `test_line_check_ui_04`（本卡四类事件（改地址/key/Access/接入方式）、保存成功、生效线路改变、显式清除、重开页面都丢弃快照；迟到的检查结果被丢弃；仅编辑其它线路或重排线路**不**丢弃）
- [x] 6.11 Implement: 快照签名（含三项凭据输入）+ `checkEpoch`；失效事件按 design D8 的五类，不因别卡草稿变化失效 to pass 6.10
- [x] 6.12 Refactor; full suite stays green
- [x] 6.13 Write failing test: `test_line_check_ui_05`（无缓存 / 有缓存无 `lastSyncAt` / 空缓存有 `lastSyncAt` 三种情形都不给一致结论）
- [x] 6.14 Implement: 两个缺失条件任一成立即只显示 kind/数量/耗时 to pass 6.13
- [x] 6.15 Refactor; full suite stays green
- [x] 6.16 本组检查：`npx vitest run test/line-check-ui.test.tsx`

## 7. 收尾

- [x] 7.1 版本与文档：`packages/dsh-magpie-connector/package.json` 与 `dsh.yaml` 相关版本字段按发版惯例升版；`README.md` / `README.zh.md` 补充「检查线路」能力、只读快照语义与「生效线路同样可检查」
- [x] 7.2 全套检查：`npm test`、`packages/dsh-magpie-connector` 内测试全绿（12 个沿用场景仍在），`npm run check:artifacts`
- [x] 7.3 制品校验：`openspec validate magpie-line-probe-and-save-clarity --strict`
