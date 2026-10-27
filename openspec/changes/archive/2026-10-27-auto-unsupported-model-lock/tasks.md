## 1. 测试先行

- [x] 1.1 `test/policy-v2.test.ts`：新增 `autoSupportedModel` 用例矩阵——`claude-opus-5-5`、`claude/claude-opus-5-5`、`codex/gpt-6.1-sol`、`gpt-6-astra`、`GPT-5.6-Sol`、`CLAUDE-fable-5-1`（大小写与 transport 前缀）为支持；`deepseek-v4.1-flash`、`glm-5.3`、`grok-4.7`、`gemini-3`、`kimi-k3`、`qwen3.8-flash`、`opencode-go/deepseek-v4.1-flash`、空值为不支持。
- [x] 1.2 `test/policy-host.integration.test.ts`：新增「AUTO 会话主模型为不支持模型」用例——通过官方 selection 把主模型指向 `opencode-go/deepseek-v4.1-flash`（注册对应 fake adapter），发出用户回合后断言：`turn/end` 无 error、`calls` 的 provider/model/effort 与官方合成一致、Jev 请求次数为 0、持久化模式为 `MANUAL`。
- [x] 1.3 同文件新增「支持范围内映射不可得」用例：主模型为 `claude-opus-5-5` 但 fake adapter 只返回 `efforts=['max']`（或 `defaultEffort='max'`）时，请求原样发出、`reason=no-effort-support`、回合不失败、不写 Jev disabled。
- [x] 1.4 `test/policy-host.integration.test.ts`（harness 增加 connection 路由）新增状态接口用例：不支持模型时 `state` 返回 `autoSupport={supported:false,provider,model}` 且模式为 `MANUAL`；`setMode AUTO` 不生效；切回 `claude-opus-5-5` 后 `autoSupport.supported=true` 且仍为 `MANUAL`。
- [x] 1.5 `test/client.test.ts` + `test/lock.dom.test.ts`：锁定态静态渲染断言（`aria-disabled`、`data-locked`、描边 info 图标、面板含「仅支持 Claude / GPT」与仓库链接、不含切换箭头、点击不发 setMode）；普通态渲染不变。
- [x] 1.6 修改实现前运行新增用例确认按预期失败（红）：`Cannot find module '../src/support.js'`、锁定态渲染缺 `aria-disabled`/`data-locked`、状态接口缺 `autoSupport`、不支持模型仍调 Jev 等。

## 2. 实现

- [x] 2.1 新增纯函数（建议放 `src/policy-v2.ts` 或独立 `src/support.ts`）：`autoSupportedModel(model)`（去 transport 前缀后 `claude-`/`gpt-` 前缀，大小写不敏感）与 `currentMainSelection(ctx, agent)`（`sessionProjections` pending → `requestHeader` → `agent.options` → 未知）。
- [x] 2.2 `src/policy-host.ts`：`agent/pre-step` 主会话在调 Jev 前判支持范围，不支持则写 MANUAL 并跳过；`agent/request` 主会话用 `next()` 后实际配置再判一次，不支持则写 MANUAL 并原样返回 config；effort 映射包 `try/catch`，失败记录 `no-effort-support` 并原样返回。
- [x] 2.3 `src/index.ts`：`agent/created` 仅在支持范围（或选择未知）时应用 `defaultMode: AUTO`；policy-v2 的 `state`/`setMode` 响应附加 `autoSupport`，不支持时强制/保持 MANUAL 并 `policy.invalidate`；`setMode('AUTO')` 在不支持时不生效。
- [x] 2.4 `src/client/index.ts`：`View` 增加 `autoSupport`；锁定态用 `aria-disabled`（不用原生 disabled，保证 hover 可用）、`IconInfoOutlineRegular` 描边图标替代切换箭头、面板说明支持范围与 issue/PR 链接；通过惰性 `ctx.inject(['modelDirectories'])` 订阅会话选择变化触发即时刷新（服务缺失时静默退回 3s 轮询）；补 `.amr-*` 样式（弱化色、链接、锁定态 hover 不显示交互底色）。
- [x] 2.5 确认子任务路由 fail-closed、legacy 回滚与既有测试断言不变。

## 3. 文档

- [x] 3.1 `packages/auto-model-routing/README.md` / `README.zh.md`：主会话说明补「AUTO 仅支持 Claude/GPT 系列；切到其他模型自动落 MANUAL 并锁定，芯片 info 图标悬停给 issue/PR 链接；切回后可手动启用」。
- [x] 3.2 检查 `docs/policy-v2-development.md` 等开发文档，仅在现有描述会误导时补边界说明。

## 4. 验证与收尾

- [x] 4.1 在 `packages/auto-model-routing` 运行 `npm test`、`npm run typecheck`、`npm run build`，记录实际通过的测试文件数与失败项（如有）。
- [x] 4.2 运行 `openspec validate auto-unsupported-model-lock --strict`；确认 current spec 已反映最终行为后归档 change。
- [x] 4.3 报告未验证边界：不部署、不重启 3080 GUI，不做真实订阅模型付费调用；真实 GUI 悬停/链接点击验收另由用户决定。
