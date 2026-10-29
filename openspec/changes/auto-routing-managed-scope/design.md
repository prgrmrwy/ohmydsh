## Context

AUTO 子任务路由全部在 `packages/auto-model-routing/src/policy-host.ts`，挂在四个宿主钩子上：

- `tools/execute`（:48-63）：拦截 `subagent`、`subagent_fork`、`spawn_teammate`。fork 在这里直接抛错（:54）；provider 不在注册表 `transports` 中也抛错（:56）。其余情况用 `AsyncLocalStorage` 开启一个绑定上下文。
- `agent/created`（:64-74）：在绑定上下文内创建、且 `parentSession` 与执行者一致的子会话，写入记录与 `.bound` 标记。
- `agent/pre-step`（:107-148）：子会话第 1 步。无记录且根为 AUTO 时抛 `unsupported：创建没有官方工具身份绑定`（:111），Pet locus 就是在这里失败的；Jev 失败、路由不可用、模式中途变化也会抛错。
- `agent/request`（:182-190）：把已绑定的 route 应用到请求上。

注册表（`src/strategies/`）的 `transports` 同时承担三项职责：provider 白名单、子模型 id 前缀、目录与允许列表的 provider 过滤（`settings-host.ts:19,34`、`policy-store.ts:8`、`subagent-tool.ts:41`）。主会话的支持判定只看模型名（`support.ts:14`），因此 `traex/GPT-5.6-Sol` 的主会话可以 AUTO，子会话却被拒。

原设计 `auto-routing-policy-and-enforcement/design.md:39` 要求不支持的路径“如实告知、标明未路由、保持原生行为”。用户 2026-10-28 确认的原则是：AUTO 只管自己能管的，其余放行；策略跟模型走；不按 provider 登记。

## Goals / Non-Goals

**Goals:**
- 非受管子会话（官方工具 ALS 上下文外的插件直建、MANUAL 时创建、fork）原样放行，零抛错；同窗口同父 startup 插件旁支可能一并受管，按 D1 如实记录该已接受限制。
- 去掉 provider 登记：任何 provider 下的 Claude/GPT 子会话都能受管，provider 锚定直接父会话。
- 路由不可用或子任务 Jev 失败时退化，不阻断子请求，且结果可见。
- 子会话不显示芯片。

**Non-Goals:**
- 跨 provider 选模（例如 traex 父会话落到 codex 能力槽）。
- Pet 子会话报错后不结算 delivery 的问题（另开 change）。
- 改变主会话的判断、effort 同步或锁定行为。
- 改变已绑定子会话的 fail-closed 规则。

## Decisions

**D1：受管 = 官方工具 ALS 窗口内、同父、startup 创建；如实接受同窗口旁支限制。** 沿用现有 `AsyncLocalStorage` + `parentSession` 校验，判定在 `agent/created(startup)` 一次完成：复核根 AUTO、采样父配置、先写记录再写 `.bound`；resume 或已有 `.bound` 不重写。无记录无标记的 pre-step 原样返回；fork 不开启上下文。

曾评估以 `subagent/catalog` 精确 childId 作为来源证明，但探针（`scripts/probe-managed-identity.mjs`，见 implementation-progress.md）证明窗口内插件经官方服务直建的旁支同样发布 catalog、满足全部条件，catalog 只能证明父子关系、不能证明工具来源，因此不采用（徒增时序依赖而无收益）。官方当前无更精确接缝；用户 2026-10-28 决定接受该窄窗口误判并如实记录，而非放弃子路由。Pet locus 按飞书消息在窗口外创建，不受影响。
- 备选（拒绝）：在 auto 里按 `dsh-pet-executor` preset 加白名单。这会让 auto 耦合 Pet 的内部细节，而且只修了 Pet 一个调用方。
- 备选（拒绝）：要求 Pet 改走官方工具。locus 由 Host 代码创建，不是 Agent 的工具调用，生命周期不一样。
- 备选（拒绝）：fork 只调 effort。fork 的语义就是复制父会话，官方 `subagent_fork` 也不接受模型参数；用户确认保持一致即可。

**D2：provider 只沿用，不枚举。** `tools/execute` 只保存真正显式传入的 provider，不提前固化继承 provider。D1 的 `agent/created` 绑定边界统一读取直接父会话的实际 requestHeader 配置（缺失字段回落 options），形成 `parentSelection`；P 取显式 provider，否则取该快照的 provider，并据此形成记录的 `explicit.provider`。父 provider 无法读取、P 不是字符串或 P 为空时不进入绑定，按非受管路径放行；不新增 provider 枚举错误。`policy-store` 的 `explicit.provider`、`route.provider` 改为 `z.string().min(1).max(128)`；`family` 仍按注册表 id 枚举，记录中的家族已不在注册表时 fail closed。
- 备选（拒绝）：provider 白名单（现状）。每个新 provider 都要登记，traex 一类的场景会被直接拒绝。
- 备选（拒绝）：同家族跨 provider 选模。这会切换账号与额度，有多个候选 provider 时还需要新的选择规则，并且违背 10-14“provider 为锚”与 D4a“不跨 transport 回退”的决定。

**D3：家族按模型名，能力槽按目录解析。** 子模型家族与主会话使用同一个函数（`bare(model)` 匹配 `modelPrefixes`）。能力槽不再拼前缀，而是在父 provider 的目录中按 `bare(entry.model)` 忽略大小写匹配槽位名；所有候选都先要求最后一个 `/` 之前的完整前缀与父模型精确相同（无 `/` 为空串），随后检查恰好唯一，否则未找到。Magpie 的 `codex/` 前缀因此可以自然解析到，`transports` 整个删除。
- 风险：同一 provider 下出现两个前缀不同但 bare 名相同的条目，例如 `codex/gpt-6-luna` 与 `opencode-go/gpt-6-luna`。父模型前缀可以消歧；消歧不了时退化，不会选错。

**D4：目录按 provider 惰性读取。** `catalog(provider)` 只列出该 provider 的模型；允许列表不再按注册表过滤，改为按精确的 provider/model 比对。原来枚举所有已登记 provider 的做法，在去掉登记后会变成枚举宿主全部 provider，开销与失败面都会变大。

**D5：退化链（见 spec）。** 实现上，`choosePolicyRoute` 改为返回 `{route} | {fallback: reason}`，不再抛错。`pre-step` 中凡是走到第 4 步的情况（含 Jev 失败、取消、needs-context、模式中途变化、恢复时发现 pending 丢失），都写入 `status: unsupported` 与 reason 并 `return decision`。`agent/request` 遇到 `unsupported` 且无 route 时原样返回 config。完整性错误仍拒绝：标记存在但记录缺失或损坏、parentId 不符、实际请求头与已绑定 route 不符。另外，已有 route 每次请求（含恢复）继续复核目录、当前允许列表、captured allowlist 与 cap；撤销、cap 降低或服务不可用时拒绝该次请求，不改记录、不重判、不换路由。这是安全门禁失败，不属于初始候选退化。
- **子判断 epoch**：初始判断捕获根 epoch；每个 Jev/目录 await 之后与保存 route 前都校验 epoch 和模式。AUTO→MANUAL→AUTO 同样使旧结果失效，终态 unsupported/mode-changed；不得采用旧成功或失败，不写根 disabled。其 notice 是退化说明，不是新 decision。
- **允许列表无豁免（第 1 轮 C1 后修订）**：每个候选（包括父模型）都必须在允许列表与 captured allowlist 内。这与用户原话“可用子（DSH 配置里手动指定的）也没有的，退化到 DSH 默认”一致，也避免了恢复时需要额外证明“这是原生继承”。代价：允许列表里没有 traex 模型时，traex 子会话只能走第 4 步。
- **显式维度不替换（C2）**：第 3 步只在 effort 由 AUTO 计算时生效；显式模型或 effort 不可用直接第 4 步（`explicit-unavailable`）。第 1 步在只显式 effort 时也要求槽位支持该 effort。
- **记录状态组合（M5）**：写入用 zod 判别联合约束 status 与 route/actual 的组合，`unsupported` 的 reason 用闭集；读取对旧 `needs-context`、无 route 的 `failed` 放宽 reason，按无 route 放行。矛盾组合沿用“无法恢复”fail closed。冷恢复遇到 `recommended` 无 route 改写为 `unsupported/interrupted`。
- **子 Jev 失败不停用根会话**：主会话 Jev 失败会停用 AUTO，因为主会话的判断没有替代。子任务失败只影响这一个子会话，退化后依然可用；如果因此停用根会话，会把一次子任务失败放大成整个会话树失去 AUTO。根会话下一回合自己调用 Jev 时，若服务确实故障，会照常停用。

**D6：告警 = logger warn + 根会话 `childNotice`。** 只保存在内存中，并且只保留最近一条，与 `latest` decision 同一生命周期。它不写入 `decision`，以保持「决策提示」中“失败不记录新决策”的语义；toast 复用现有通道，按 notice id 去重。
- 备选（拒绝）：只写 logger。用户看不到，等同于静默退化。

**D7：子会话 `state` 返回 200 `{applicable:false}`。** `src/index.ts:107-118` 对成功的 state/setMode 有公共后处理（读选择、锁定、补字段），所以短路必须放在这段之前，并对原始 HTTP 与 RPC envelope 都生效（M4）。client 收到后渲染 null，并清除轮询与订阅；`sessionId` 变化时 effect 重新运行，普通会话照常开始轮询。`setMode`、`label`、`observe` 对子会话仍返回 4xx。

**D8：路由只在创建时判断一次，预览改为可选（C3、M2，用户 2026-10-28 确认）。** 环境级指令改为“直接用官方 fresh 工具，只传用户或 lead 指定的值，不需要先预览”，删除“返回档位就全部显式传给子会话工具”。这样就不存在“预览失败后创建再判一次”的强制路径，也不会因为把推荐当显式参数而让创建跳过判断。预览仍保留：与创建共享退化链；去掉 `family` 参数；第 4 步与 Jev 失败返回非错误 `fallback`，`insufficient_context` 返回 `needs-context`，取消返回错误（“已取消”），内部异常报错。若 Agent 主动预览后再创建，会多一次 Jev 调用，这是可选行为的代价，不再由指令强制。
- 备选（拒绝）：预览把“原生继承意图”传给创建。需要宿主可验证、单次绑定本次创建的通道，现有官方能力没有。

## Risks / Trade-offs

- [退化让“未按预期路由”变得不阻断，用户可能没有注意到] → `childNotice` 会出现在 toast 与面板中，`childRouting` 记录 reason，Host 日志也有一条 warn。
- [允许列表没有父模型时，该 provider 下的子会话无法调 effort] → 走第 4 步并告警，用户可在 DSH 设置里把该模型加入允许列表。
- [正式工具可能在 `agent/created` 之前就按 DSH 自身规则拒绝显式参数（M3）] → 这属于 DSH 原生校验，AUTO 不绕过；相关场景前提写为“DSH 原生校验已允许创建”，测试只断言 AUTO 自身不抛路由错误、不改写。
- [环境级指令变化会影响所有会话的派发习惯] → 只删除强制预览与“显式传推荐”两条，其余派发规则不变；由 `tests/agent-instructions-dispatch.test.mjs` 守护。
- [能力槽按 bare 名解析，可能匹配到同名但实际不是同一模型的条目] → 只在父 provider 的目录内匹配，再按前缀消歧，不唯一则退化。用户 3.1 的原则是：同家族跨 provider 的能力一致性由官方保证。
- [去掉 `route_subagent.family` 与 provider 枚举属于工具 schema 的破坏性变更] → 包内 skill 与环境级指令都没有使用 `family`；provider 由枚举放宽为字符串，原有调用仍然合法。
- [`catalog(provider)` 每次都现查] → 只查一个 provider，单个模型解析失败时跳过，与现有 try/catch 语义一致。设置页读取（无 provider 参数）继续返回目录，范围为允许列表中出现的 provider（允许列表不可用时为空），不枚举宿主全部 provider，也不在代码里写死 provider 名（S2）。

## Migration Plan

- 新写初始记录必须含 `parentSelection: {provider, model?, reasoningEffort?}`，不增加版本字段、不批量迁移。旧合法 completed/已有 route 记录缺此字段仍按原 route 恢复并校验实时门禁；旧 recommended 无 route 转 interrupted，绝不从现在的父配置补造快照。新建 API 拒绝缺 parentSelection 的初始写入，读取允许旧形状；实际读取到无快照无 route 时只走 interrupted。其它未知键或坏形状继续拒绝。
- 已经因 :111 卡住的 Pet locus：部署后下一轮即可放行。已挂起的 delivery 需要等 Pet 自己超时，不在本次范围内。
- 部署：在主 checkout 执行 `dsh build`，并重启 Host，由用户决定。回滚方式是 revert 本次提交，或在 `dsh.yaml` 中固定为上一版插件。

## Open Questions

- 无阻塞项。同窗口旁支误判为已接受限制；若官方未来提供 tool-call→child 身份接缝，再收紧。
