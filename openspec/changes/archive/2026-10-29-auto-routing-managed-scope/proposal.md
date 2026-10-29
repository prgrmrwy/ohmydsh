## Why

AUTO 现在会拦截它本不该管的子会话，导致真实流程失败。

- **Pet locus 第一轮被拒**：2026-10-28 16:43，Pet 用 `subagents.createIdleContinuable` 创建的 locus 子会话在第 1 轮直接报 `unsupported：创建没有官方工具身份绑定`（`policy-host.ts:111`），飞书投递静默挂起。
- **traex/GPT 主会话无法派子会话**：主会话按模型名判定支持（`traex/GPT-5.6-Sol` 算作 GPT 系列，AUTO 正常判档），子会话却要求 provider 必须登记在注册表的 `transports` 里（`policy-host.ts:56`）。traex 没有登记，所以子会话还没创建就被拒；即使显式给了 model 和 effort 也一样。
- **fork、MANUAL 时创建的子会话、路由不可用、子任务 Jev 失败**：一律报错并要求暂停委派。

这些行为违背原设计 `auto-routing-policy-and-enforcement/design.md:39` 写的“用户选择继承后保持原生行为并标明未路由”。也违背用户 2026-10-28 确认的原则：**AUTO 只管自己能管的部分，不该管的直接放行**。每出现一个新 provider 都要登记一次，这种做法也不可持续。

## What Changes

- **收敛受管范围。** AUTO 只路由在官方 fresh 创建工具（`subagent`、fresh `spawn_teammate`）的 ALS 上下文内，以 `source = "startup"` 创建、`parentSession` 等于工具执行会话、且创建时根为 AUTO、直接父 provider 可读并成功绑定的子会话。该规则不能证明工具独占来源：同一窗口内插件以同父直接创建的子会话也可能一并受管，这是用户 2026-10-28 接受的限制，不使用 catalog 消歧。其余子会话原样放行，不判断、不改写、不报错，`childRouting` 显示未路由；包括窗口外插件直建（如 Pet locus）、MANUAL 时创建的子会话和 fork。孙会话照常按同一规则判定，每一层以直接父会话为锚。
- **BREAKING：fork 由报错改为原样放行。** fork 按 DSH 原生行为与父会话保持一致，AUTO 不判断、不改写。`route_subagent` 对 fork 返回非错误的 `routed: false`。
- **BREAKING：去掉 provider 登记。** 注册表删除 `transports`。子会话沿用直接父会话的实际 provider（显式指定时用指定值），不做枚举校验。家族只按模型名判定，与主会话使用同一规则。能力槽模型在该 provider 的实时目录里按去掉前缀后的模型名查找。`route_subagent` 的 `provider` 参数改为任意字符串。
- **派发前不再强制预览。** 环境级指令改为直接用官方 fresh 工具、只传用户或 lead 指定的值；`route_subagent` 变为可选预览，推荐结果不再作为显式参数传入。
- **BREAKING：路由不可用时退化，不再拦截。** 退化链为：
  1. 能力槽模型可用，就用它；
  2. 否则保持父会话的模型，只按 depth 调 effort；
  3. depth 对应的 effort 不可用时，用父会话的 effort；
  4. 仍不可用，或选出的模型不在 DSH 子会话允许列表内时，不改写，交给 DSH 默认行为，并发出可见告警。
  子任务的 Jev 失败或取消也按第 4 步退化，不停用主会话。
- **子会话不再显示 AUTO 芯片。** 状态接口对子会话返回非错误的“不适用”，client 不渲染芯片，也不再轮询。
- 已绑定子会话的 fail-closed 保持不变：绑定标记存在但记录缺失或损坏、父子身份不匹配。
- 同步更新包内 skill `subagent-model-routing` 中关于 fork 与失败处理的条目。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `auto-model-routing`：受管范围、fork、provider 锚定与无枚举、家族按模型名判定、退化链、子任务 Jev 失败的处理、预览工具输出、子会话芯片与状态端点、skill 规则。注册表与内置策略两条 requirement 整体重写，去掉 `transports`。

## Impact

- 代码（`packages/auto-model-routing/`）：
  - `src/policy-host.ts`：受管判定、fork、退化链，以及无记录时放行；
  - `src/routing.ts`：按模型名找家族与能力槽、退化链；
  - `src/strategies/`：删除 `transports`；
  - `src/settings-host.ts`：目录按 provider 读取，不再按注册表过滤；
  - `src/policy-store.ts`：provider 不再做枚举校验；
  - `src/subagent-tool.ts`：provider 改为字符串、退化结果不再报错；
  - `src/endpoints.ts`、`src/index.ts`（state 公共后处理前短路）、`src/client/index.ts`：子会话不显示芯片；
  - `skills/subagent-model-routing/SKILL.md`；
  - 对应测试。
- 环境级指令 `instructions/dsh-home.md` 的“子会话派发”一节与 `tests/agent-instructions-dispatch.test.mjs`：派发前不再强制调用 `route_subagent`，也不再把预览推荐当显式参数传入；路由只在创建时判断一次。
- 依赖：不新增依赖，不改宿主包，不改 `dsh.yaml` 的 pin。发布版本号由发布流程决定。
- 用户可见行为：
  - traex 等未登记 provider 下的 GPT/Claude 子会话可以派发；
  - Pet locus 在 AUTO 主会话下可以运行；
  - fork 不再报错；
  - 路由不可用时子会话照常运行，并在根会话的提示和面板中出现告警。
- 不在范围内：Pet 在子会话报错时不结算 delivery、locus 一直标记为 busy 的问题，另开 change；跨 provider 选模。
