## Context

AUTO（policy-v2）的主会话链路在 `packages/auto-model-routing/src/policy-host.ts`：

1. `agent/pre-step`：用户回合 step 1 调 Jev 判 `depth=lower/baseline/higher`，只记状态，不改请求。
2. `agent/request`：`await next()` 拿到官方合成配置后，用 `ctx.llm.resolveModelInfo(provider, model)` 取该模型真实 `reasoning.efforts` 与 `reasoning.defaultEffort`，交给 `src/policy-v2.ts` 的 `policyEffort()` 算目标 effort，返回改写后的 config。

问题：链路末尾没有任何「该模型是否归 AUTO 管」的前置判断。`policyEffort()` 把推荐起点当作必须命中 `AUTO_EFFORTS = low|medium|high|xhigh` 的枚举，于是：

- `opencode-go/deepseek-v4.1-flash`（pi-ai 目录只映射 `low/high/max`，profile `reasoning: max`）→ `defaultEffort=max` → `AUTO_EFFORTS.indexOf('max') = -1` → 抛 `模型推荐 effort 起点不可验证，请先配置受支持模型`；
- 抛错发生在 `agent/request` 钩子，DSH 把整轮判为失败（2026-10-27 本工作区会话 turn 1 的 `turn/end`，code `UNKNOWN`），用户在 GUI 看到「本轮运行失败」；
- 同一分支还会因 `!supported.includes(start)`、候选集为空、上限排除全部候选等边界抛错，把「可选能力做不了映射」升级成「请求不可发」。

用户已明确产品定位：AUTO 只服务 Claude / GPT 系列；不支持其它模型是可以接受的，但从 AUTO 切到不支持模型时必须优雅退出——落 MANUAL、锁定不可切回、给出可见说明与反馈入口，而不是报错。因此本 change 放弃「让所有模型都能做 effort 检测」的方向，改为显式支持范围 + 不可用锁定，并顺带把主请求的映射失败降级为不改写。

客户端可用的官方信号：官方模型选择服务 `ctx.modelDirectories`（`@deepseek-ai/dsh-client-ui-model-selection`）持有每个会话的 `ModelDirectory.store`，快照含 `current`（durable 选择）与 `pending`（已提交未生效的手选）。同仓库的 `home-network-model-guard`、`sidebar-session-provider-icon` 已用该服务做同类「当前模型」判定，是既有集成先例。

## Goals / Non-Goals

**Goals:**

- AUTO 主模型范围可预期：Claude/GPT 系列正常；其它模型锁定 MANUAL，不再出现本轮失败。
- 三处一致：状态接口（芯片/面板）、pre-step（不浪费 Jev、不起刷写）、request（权威不改写）。
- 锁定态 UI 满足用户描述：MANUAL + 描边 info 图标、整个按钮 hover 提示、issue/PR 链接、点击无效。
- 支持范围内 effort 映射不可得不阻断请求，降级 `no-effort-support`。
- 改动自包含：不新增依赖、不改 manifest/宿主包、legacy 回滚与子路由行为不变。

**Non-Goals:**

- 不把 DeepSeek/GLM/Grok 等模型纳入 AUTO 的 effort 映射（用户已明确不需要）。
- 不改子任务自动能力家族（仍 Claude/GPT，Magpie 保留 transport）。
- 不自动恢复 AUTO：切回 Claude/GPT 后保持 MANUAL，由用户重新点击。
- 不改 legacy 四档策略行为、不改 `dsh.yaml`/版本 pin/发布流程。

## Decisions

**D1：支持范围按「模型家族名」而不是 provider 判定。**

- 规则：`model` 去掉最后一个 `/` 之前的前缀（覆盖 Magpie 的 `claude/...`、`codex/...`）后，以 `claude-` 或 `gpt-` 开头（大小写不敏感）即支持。
- 理由：AUTO 的能力槽与 effort 起点表本质是「Claude/GPT 家族」概念；模型可能经不同 transport（官方 claude/codex、Magpie，甚至未来自定义网关）提供，按 provider 白名单会把同家族模型误锁。用户原话也是「倾向于 gpt 和 claude」。
- 备选（拒绝）：只认 provider `claude`/`codex` + Magpie 家族。会让 `traex/GPT-5.6-*`、`test/claude-*` 这类同家族路由被误判不支持，也让现有测试夹具（provider `test` + `claude-opus-5-5`）全部失效。

**D2：锁定状态是「模式持久化为 MANUAL + 状态接口返回 autoSupport」，不是新增持久化字段。**

- 判定每次从「当前主模型」实时推导：`autoSupport.supported = autoSupportedModel(模型名)`；不支持且当前模式为 AUTO 时写 MANUAL（持久化，重启后仍是 MANUAL）。
- 不持久化「因不支持而锁定」的标记：切回 Claude/GPT 后 `autoSupport.supported=true`，芯片自然恢复可点击，而模式仍为 MANUAL（符合 D4）。避免状态文件 schema 迁移与过期标记。
- 理由：模型能力判定应跟随当前选择而不是历史；状态文件保持向后兼容。

**D3：三处薄弱点统一复用同一对纯函数。**

- `autoSupportedModel(model): boolean`（家族名前缀）与 `currentMainSelection(ctx, agent)`（当前选择读取）。
- 当前选择读取优先级：官方 `sessionProjections.stateOf(session,'modelSelection').pending` → `session.requestHeader()?.config`（上次实际请求）→ `agent.options`（创建时的默认选择）→ 未知（按支持处理，不误锁）。
- 门禁点：
  - 状态接口 `state`/`setMode`：返回 `autoSupport`；AUTO + 不支持时写 MANUAL 并 `policy.invalidate`（撤销进行中的 Jev 结果）；不支持时 `setMode('AUTO')` 不生效。
  - `agent/pre-step`（主会话用户回合）：不支持则写 MANUAL、跳过 Jev。
  - `agent/request`（主会话）：用 `next()` 后的**实际** provider/model 再判一次（权威），不支持则写 MANUAL 并原样返回 config。
  - `agent/created`：`defaultMode: AUTO` 只对支持范围（或未知选择）的新会话生效。
- 理由：任一单点都可能因时序（pending 选择、恢复会话、默认模式）漏判；request 处是权威兜底，其余保证可见性与不浪费 Jev。

**D4：切回支持模型后保持 MANUAL，不自动恢复 AUTO。**

- 理由：用户明确「默认改成 manual」；AUTO 是显式选择，模型来回切换不应反复产生自动判档与 `selectModel` 副作用。

**D5：映射不可得时主请求降级不改写，而不是抛错。**

- `agent/request` 内把 `resolveModelInfo` 之后的 effort 计算包在 `try/catch`：失败时记录 `reason=no-effort-support` 状态（复用现有分支），原样返回官方 config，不写 Jev disabled。
- 子任务路径不变：`choosePolicyRoute()` 对不可用映射继续抛可见设置错误，保持「暂停委派」契约。
- 理由：主请求的失败代价（整轮报废）与能力降级代价不对等；「未知不猜」已由不改写表达。

**D6：芯片锁定态用 `aria-disabled` 而不是原生 `disabled`。**

- 原生 `disabled` 按钮在浏览器中不派发鼠标事件，会让「hover 整个按钮显示说明」失效（这是本需求的显式要求）。因此锁定态保留按钮可聚焦/可 hover，只把点击置为空操作并加 `aria-disabled="true"` 与弱化配色。
- 提示内容放在现有 `amr-panel` 卡片里（自绘、支持链接与自动换行）；官方 `Tooltip` 的 `label` 仅接受字符串，无法放链接，拒绝。
- info 图标用官方 UI primitives 的描边图标 `IconInfoOutlineRegular`（1px stroke，与现有 `SwapIcon` 的描边风格一致）；锁定态用它替代切换箭头，避免暗示可切换。
- 链接：`https://github.com/prgrmrwy/dsh-auto-model-routing`（`target=_blank`、`rel=noopener noreferrer`），文案「其他模型策略欢迎提交 issue 或 PR」。

**D7：客户端即时刷新用官方 `modelDirectories`，保留轮询兜底，不新增包依赖。**

- `apply()` 内用 `ctx.inject(['modelDirectories'], ...)` 拿到会话选择 store 的订阅；store 变化时立即触发一次状态 RPC，替代最长 3s 的轮询延迟。
- 不写进 `dsh.client.inject` / package.json：按本地最小接口做类型断言，服务缺失时静默退回 3s 轮询，避免为了可选增强改动发布依赖面。
- store 生命周期注意：目录/ store 可能随会话作用域重建（`home-network-model-guard/bindings.ts` 记录的坑）；芯片只把订阅当加速信号，失败/失效由 3s 轮询自愈。

## Risks / Trade-offs

- [模型名启发式可能误判：例如自定义别名 `my-gateway/opus-5` 不以 `claude-` 开头会被锁] → 状态接口返回实际 provider/model，面板说明支持范围；用户可改用标准模型名或提交 issue，属于可接受的产品边界。
- [状态接口轮询本身带写副作用（AUTO 会话转 MANUAL）] → 只在「当前模式 AUTO 且当前模型不支持」时写一次，幂等；其它情况只读。
- [选择读取可能滞后一步（pending 尚未进入 projection、恢复会话无 header）] → `agent/request` 用 `next()` 后的实际配置作最终权威；最坏情况是某一回合多调一次 Jev 或早锁一拍，不会改错模型或失败请求。
- [前后端对「支持范围」理解漂移] → 规则只在 Host 实现一次，客户端只消费 `autoSupport`，不在 client 复制判定。
- [锁定态弱化配色可能被误认为 Jev 停用（红色警示）] → 锁定态用中性弱化色 + info 图标，不套用 `data-disabled` 的红色错误样式；面板文案明确「不支持当前模型」而非失败。
- [客户端订阅的是官方内部服务 `modelDirectories`] → 只做可选加速并保留轮询兜底；即使服务改名/缺失也不影响正确性。

## Migration Plan

- 无数据迁移：不新增/修改配置文件或状态 schema；已处于 AUTO 的不支持模型会话在下一次状态读取时自动落 MANUAL。
- 回滚：revert 本 change 的代码与规范提交即可；用户手动切回 AUTO 不受残留状态影响。
- 部署：Host 侧变化，需 `dsh build` 后重启 DSH 才生效；重启与发布由用户决定，本 change 不含部署动作。

## Open Questions

- 无阻塞项。info 图标仅在锁定态出现（正常态沿用切换箭头）；若希望平时也常驻说明入口，可在实现后按 UI 反馈微调，不影响行为契约。
