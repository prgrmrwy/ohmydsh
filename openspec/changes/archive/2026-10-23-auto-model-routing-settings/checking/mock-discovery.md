# 阶段 2：原生 Mock 探测（暂停等待用户决定）

## 接续边界

沿用用户已确认阶段 1：24 个 spec 来源检查点、独立性低、lint 87.5%，CP21/22/23 为 partial；不重复请求阶段 1 确认。本轮开始时 active change 下无 checking 目录及原始 checkpoint/plan/trail 文件，因此不猜测其余检查点编号、不重建已确认 oracle。规范依据为 change 的 spec.md、tasks.md、verify.md；尚无 trail 计划授权或付费请求额度授权。

本轮仅阅读源码/文档，及使用现有 agent-browser 的 amr-accept profile 对既有 http://127.0.0.1:3080 发出一次只读性质的 `POST /api/auto-model-routing.settings {}`。未执行 trail、UT/e2e、模型/Jev 请求；未写真实配置、API key、共享允许列表；未创建会话、启动/重启服务器。

## 探测证据

- 根 package.json:31–42：没有 mock/dev:mock/seed script 或 mock 框架依赖。
- packages/auto-model-routing/package.json:35–69：只有 build/typecheck/test，未提供浏览器 mock 启动入口。
- packages/auto-model-routing/cordis.patch.yml:1–3：生产组合仅插入插件，没有 mock 参数。
- packages/auto-model-routing/src/index.ts:25–32：home/jevBase/jevTimeoutMs 明确标注 Test seams only；不能据此认定既有3080可运行时启用。
- packages/auto-model-routing/src/jev.ts:28–63：生产默认向 OpenRouter 发出 Host 端 fetch；浏览器 fetch 拦截不等于拦截此 Host 请求。
- packages/auto-model-routing/test/fake-jev.ts:4–20：fakeJev 是 test-only 回环服务，无当前 GUI 接线。
- packages/auto-model-routing/test/host.integration.test.ts:24–68：测试自行创建 Cordis Context、fake adapter/allowlist，并用 jevBase 注入；不是3080运行配置。
- packages/auto-model-routing/test/gui-fixture.ts:5–36 与 vitest.config.ts:4–6：测试 UI primitives stub/静态 catalog，不是现网原生 fixture 开关。
- packages/auto-model-routing/src/settings-host.ts:16–35,50–55：目录和列表来自官方服务，保存时重读；未发现 mock 替换接口。
- README.md:88–98：只记录测试中的 fake LLM/Jev，明确离线检查不替代既有 GUI 验收。
- eval/run.mjs 的 --base 为评估脚本入口，不改变正在运行的 Host。未执行此脚本。
- 文件探测：package 内 `*mock*` 只有 node_modules/scheduler；`*fixture*` 只有 test/gui-fixture.ts；未找到 msw/mockjs/vite-plugin-mock、dev:mock、MOCK_/ENABLE_MOCK/USE_MOCK 接线。

## 真实目录只读观测

agent-browser 0.39.1；既有 amr-accept profile origin=http://127.0.0.1:3080，path=/。认证读取设置 HTTP 200，configStatus=ok。

7 个模型：GPT Sol/Astra/Luna，以及 Claude Haiku/Sonnet/Opus/Fable，全部返回 reasoningEfforts=[low,medium,high,xhigh,max]。官方 childAllowlist.status=enabled，包含这全部 7 条路由。key 仅检查 describe 状态：configured=true,source=env,writable=false,available=true，未读取其值。

特别注意：test/gui-fixture.ts:30 把 Astra 设为仅 low/medium；真实目录并非如此，不能靠选择 Astra 构造 CP23。

## Surface × 数据态矩阵

下表是场景发现，不是 trail 计划或执行结果。`not_needed` 仅指不需要 mock，不代表已授权实际执行。

| Surface / 数据来源 | 所需数据态 | 关联检查点/范围 | Mock 状态 | 约束与结论 |
|---|---|---|---|---|
| 设置页凭据区 / describe | 启动环境只读 | 只读 key | not_needed | 当前只读态真实存在；不测试迁移/修改 key |
| Claude/GPT 页签、主编辑 picker / 官方主目录 | 多模型、跨页草稿、实际会话保持不变 | 草稿、criteria、候选、无 max | not_needed | 当前目录可读；尚未执行交互 |
| 主 effort 表 / 配置+实际请求 header | 精确覆盖、另一模型缺省、保存下请求生效、cap 与恢复默认 | 主映射相关 | not_needed | 可通过未来获批的临时配置构造；付费请求尚未获批 |
| 子推荐 picker / 目录∩允许列表 | 精确组合、候选与effort过滤、cap冲突 | 子推荐/上限相关 | not_needed | 当前正常列表存在；配置写入仍需 trail 授权 |
| 子工具及实际派发 / 官方目录与会话快照 | 显式组合、主子独立、MANUAL routed:false | 工具/真实派发相关 | not_needed | 正常态无需 mock；不在本轮调用工具或派发 |
| 新普通会话/既有验收会话 / defaultMode 与状态 | 新 AUTO、已有 MANUAL | 默认模式相关 | not_needed | 应使用独立验收会话；不触碰历史业务会话 |
| Composer 提示/状态 / 成功 Jev 决策 | toast关/开、实际header、无max | 提示与请求相关 | not_needed | 需要后续获批真实请求；面板自报不替代header证据 |
| 保存端点 / config store | 非法字段、cap冲突不落盘 | 非法提交/冲突相关 | not_needed | 实际调用需后续授权，比较配置字节；本轮未调用 |
| Host Jev 客户端→停用状态/后续请求 | 固定2000ms响应，1500失败/2500成功 | CP21 | missing | 只有测试回环假Jev；未找到既有3080可启用的原生入口。自然网络波动不能替代固定延迟 |
| 子 picker→Host保存→重读→route_subagent | 页面加载后允许列表收缩、旧值不可选、保存拒绝与工具拒绝 | CP22 | missing | 生产是真实共享服务；当前禁止改共享白名单；无隔离fixture/动态列表mock入口。单拦截浏览器响应不能证明Host或工具复核 |
| 子 picker 模型菜单→effort菜单→保存 | A/xhigh→B仅low/medium，要求重新选择，重选后可保存 | CP23 | missing | 所有真实模型能力相同；静态UT Astra fixture不同于真实目录，未找到现网目录fixture入口 |

## 强制暂停

CP21、CP22、CP23 的 `data_scenario_required=true`，其余正常态无需 mock，但仍未获执行授权。上述 missing 的含义限定为“在本轮已检查的原生插件/文档/现有3080接线内未发现可用方式”，不声称整个宿主不存在任何潜在能力。

用户需要对三个场景选择：提供已存在原生mock入口；转人工（仍需满足前置条件，不能当已通过）；本次跳过并记录缺口；或暂停验收，另行补齐mock后再继续。未决定前不进入相关 trail 规划/执行。禁止新增框架、改业务代码注入、改共享白名单或重启来绕过此门禁。

尚无 plan.yaml / trails，不伪造 draft 来使门禁通过。后续保存原始 oracle 时需保留既有24 CP编号；不得从本矩阵反推新的 expected。

## 后续用户决策与阶段3交接

以上是阶段2当时的暂停记录，不改写为已经验证。接续用户明确“跳过这三项，继续”：CP21固定延迟1500/2500、CP22允许列表收缩竞态、CP23换不兼容effort，本次均skip，未覆盖且不计通过。用户逐项给出其余24CP列表后，Collector仅按该列表及spec保存checkpoints.yaml、plan.yaml与trails/T1–T8.yaml，不从本矩阵新造oracle。T8完整保留三项skip与missing证据。具体trail计划、真实付费请求/临时全局设置和执行策略仍待用户确认；独立B Reviewer仍待主会话安排。此补记不构成执行授权。
