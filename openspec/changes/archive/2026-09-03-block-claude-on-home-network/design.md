## Context

动机见 `proposal.md` — Why。行为契约见 `specs/home-network-model-guard/spec.md`。

约束来自 DSH 0.1.1-rc.2 的实际扩展面（已通过读取 `node_modules/@deepseek-ai/*` 的 `.d.ts` 与发布物核对）：

- **官方提供了输入禁用接口**：`@deepseek-ai/dsh-client-ui-conversation` 的 `ComposerBlocks`（`ctx.conversation.blocks`），`set(sessionId, { reason })` / `storeFor` / `forget`。其文档注释明确定位："This is an affordance, not enforcement: the Host refuses a prompt it cannot route regardless of what any client disables." 这直接决定了本能力的性质上限。
- **per-session 模型选择可订阅**：`ctx.modelDirectories.directoryFor(sessionId).store`，快照含 `current: ModelSelection | null` 与 `routable`。本仓 `packages/sidebar-session-provider-icon` 已在生产使用该面，`src/client/selection-binding.ts` 是可复用的绑定生命周期形状（resolve 可能 throw，成功后才记录 id 以保持可重试）。
- **Host RPC 接线有现成模板**：`packages/system-clock` 的 `src/index.ts` 演示了 `ctx.inject(['connection'], ...)` 惰性注册 + `authority: 'loopback'` + handler 永不 throw（一律返回 `RpcResult`）+ headless 组合下不阻断加载。
- **浏览器拿不到主机出口 IP**：`dsh.yaml` 的 `web.lan: false` 决策使跨机访问统一走 SSH 隧道（`docs/notes/lan-access-ssh-tunnel.md`），浏览器所在设备与 DSH 主机常常不是同一台。网络位置只能由 Host 判定。

一个已核实的既有占用：官方 `dsh-client-ui-model-selection` **自己就是 `blocks` 的写入方**。其发布物中在 `directoryFor` 里订阅 `directory.store`，每次变化都执行
`conversation.blocks.set(sessionId, snapshot.routable === false ? { reason } : undefined)`，
并在 scope 销毁时 `set(sessionId, undefined)`。`ComposerBlocks` 是**每会话单槽位、后写覆盖**的注册表——这构成本设计必须处理的核心冲突（见 Decisions 第 4 条）。

## Goals / Non-Goals

**Goals:**

- 把"网络位置 × 模型系列"的合取判定收敛成一个纯函数，使其可在无浏览器、无网络的条件下单测。
- 外部 IP 外呼次数可控且可预测：TTL 缓存 + 并发合并（single-flight）。
- 与官方 `blocks` 写入方共存，且共存策略的失效是**可观测的**，而不是静默失去拦截。

**Non-Goals:**

- 不劫持 `SessionInput.submit`（见 Decisions 第 1 条的备选分析）。
- 不挂 `llm/stream` waterfall 做 Host 强制（用户已选择仅客户端形态）。
- 不做配置面（`dsh.yaml` 条目/设置 UI/规则热更新），规则为包内常量。
- 不做 IP 地理定位、不做 ASN 判定、不记录 IP 访问历史。

## Decisions

### 1. 用官方 `ctx.conversation.blocks`，不劫持 `submit`

**选择**：通过 `ComposerBlocks.set` 把输入框置为 inert，禁用原因即提示文案。

**备选（已否决）**：像 `packages/worktree-session/src/client/handoff.ts:126` 那样 `Object.defineProperty` 覆盖 per-session facade 的 `submit`。该文件是本仓已验证可行的先例，且 `submit` 在官方契约里是 "THE complexity sink"，覆盖它能同时拿下点击与 Enter 两条路径。

**否决理由**：worktree-session 需要劫持是因为它要**在官方发送前插入一段异步 Host 编排、再决定是否转发**（claim/bind/admit 三段式），语义上是"改写发送流程"。本能力只需要"禁止发送"，这正是 `blocks` 的设计用途；而劫持 `submit` 需要自带描述符可写性防御（`handoff.ts:132-136`）、还原逻辑与 in-flight 去重，且用户点击后才报错的体验劣于按钮直接不可用。用官方接口换来的是升级面更窄。

**代价**：`blocks` 只给一个 `reason` 占位文案，没有独立的 toast/通知通道。若后续需要更强提示，可叠加同一 facade 上的 `input.notify('error', text)`（`handoff.ts:122` 的用法），但本期不做。

### 2. 网络判定放 Host，经 loopback RPC 下发，只回结论不回 IP

**选择**：Host 半区注册一个 Connection RPC channel（`authority: 'loopback'`），响应体只含分类结论 + 状态 + 新鲜度，**不含 IP 原文**。

**理由**：浏览器无法观测主机出口 IP（SSH 隧道场景下更是另一台机器）。只回结论满足 spec 的"不泄漏 IP 原文"要求，也让浏览器侧不可能被诱导上报 IP。

**备选（已否决）**：本机网卡 IP / 网关 MAC / SSID。用户明确选择公网出口 IP 口径。

### 3. 缓存键含本机网络指纹，而不是纯 TTL

**选择**：Host 侧内存缓存为 `{ verdict, fetchedAtMs, fingerprint }` + 一个 in-flight promise。命中缓存要求 **TTL 未过期且 fingerprint 未变**；并发请求共享同一个 in-flight promise。外呼带超时与 abort。

`fingerprint` 取本机非 internal IPv4 地址集合（`os.networkInterfaces()`，排序后拼接）。这是纯本地、零成本、同步可得的信号。

**理由**：用户的实际使用形态是"断网重连"，要求经历一次断网就重新判定。纯 TTL 无法表达这一点——TTL 调短会导致常态持续外呼，调长则重连后仍沿用旧结论。把网络指纹纳入缓存键后，重连必然改变（或至少可能改变）地址集合从而强制失效，TTL 退化为"指纹未变时的兜底上限"，可以取得较长（分钟级）。

**已核实**：本机 `en0` 地址为 `100.82.201.181`（CGNAT 段），断网重连后 DHCP 续租/改址会体现在该集合上。存在同址重连的情况（指纹不变），因此 TTL 兜底仍然必要，两者是合取而非替代。

**备选（已否决）**：监听系统网络变化事件。跨平台脆弱、需要额外依赖；每次判定请求时同步读一次 `networkInterfaces()` 已足够，且无需常驻监听。

### 3b. 出口 IP 不稳定是已核实事实，判定必须是白名单

**实测**（公司网络，同一时刻）：三个查询服务返回三个不同 IP（`203.208.167.151` / `101.71.133.201` / `203.208.167.148`），随后重复查询同一服务四次又稳定返回另一个值（`63.216.146.178`）。即出口 IP 既**跨服务不一致**，也**跨时间漂移**——这是大型 NAT/CDN 出口池的正常表现。

**结论与设计影响**：

- 判定必须是**白名单**语义（"命中家庭特征才拦截"），而非黑名单或"未知即拦截"。这已固化为 spec 中新增的需求。误判方向因此永远偏向"不拦截"，与 fail open 一致。
- **只使用单一固定查询端点**。混用多个端点会引入本就不一致的答案；备用端点只在主端点失败时启用，且失败即 fail open，不做多端点投票。
- 家庭出口 IP 是否稳定**必须在家庭网络实测后才能确定**。若家里同样漂移，则精确 IP 匹配不可用，需退到 CIDR 网段；若连网段都不稳定，则公网 IP 口径整体不适用，需回到用户此前否决的本地指纹口径（网关 MAC / SSID——本机已验证均可读：网关 `100.82.192.1`、SSID 可经 `ipconfig getsummary` 取得）。这是实现阶段的第一个决策点，不是可以先猜的细节。

**待实现时确定的量**：TTL 具体时长、外呼超时、查询端点的选择。

### 4. 与官方 `blocks` 写入方的共存：重新断言 + 顺序不敏感

这是本设计的主要技术风险点，单列。

官方 model-selection 在**每次** `directory.store` 变化时写 `blocks`：`routable === false` 写它的 reason，否则写 `undefined`。而本能力的触发条件之一**正是模型选择变化**，两个订阅者监听同一个 store。

**选择**：本能力也订阅同一个 `directory.store`，在每次变化后（以及每次 Host 判定结果变化后）**重新断言**自己的结论：命中则 `set(sessionId, ourBlock)`，不命中则**不写 `undefined`**，而是仅在"上一拍是我们写的 block"时才清除。

两条不变式：

- **不覆盖官方的 `routable === false` 拦截**。官方那条 block 表示"没有 adapter 能路由该模型"，比我们的策略性拦截更根本。判定顺序为：`routable === false` → 让位官方，本能力不写；否则按本能力结论决定。
- **不把官方的清除误当成"应该恢复"**。我们只根据自己的合成结论写入，不读回 `storeFor` 的当前值作为决策输入（避免与官方形成写-读回环）。

**顺序敏感性**：若官方的 publish 在我们之后执行，它会把我们的 block 清成 `undefined`，拦截静默失效。官方在 `directoryFor` 创建时即订阅，我们只能在其后订阅，因此**正常情况下我们后执行、我们赢**。但这依赖 store 的订阅者按注册顺序通知，属于未文档化的实现细节。

**缓解**：实现时用 `storeFor(sessionId)` 订阅**结果**做一次自检——当我们的结论是"应拦截"而 block 槽位实际为空时，重新断言（一次，带防抖，避免与官方形成无限互写）。该自检失败可观测，不静默降级。这一条同时是 DSH 升级后的首要回归点。

**备选（已否决）**：改用 `submit` 劫持绕开槽位竞争。见第 1 条；且劫持同样要与 worktree-session 的既有劫持共存（两者都改写同一个 `submit`），风险并未降低。

### 5. 判定逻辑为纯函数，规则为包内常量

**选择**：`shouldBlock({ network, selection })` 纯函数 + `HOME_NETWORKS` / Claude 系列识别两组常量，独立于 cordis 与 DOM。

**理由**：spec 的场景表（家里×Claude 四象限、fail open、routable 让位）几乎逐条对应单测用例。Claude 系列识别需要覆盖订阅制 provider——`dsh.yaml` 的 `llm-subscriptions` 条目说明 `claude` 是一个独立路由 id，因此识别需同时看 `provider` 与 `model`，参考 `packages/sidebar-session-provider-icon/src/client/logos.ts:41` 的 `brandKeyOf(provider, model)` 双字段做法，不能只匹配 model 名。

## Risks / Trade-offs

- **`blocks` 槽位被官方覆盖导致拦截静默失效** → 见 Decisions 第 4 条：重新断言 + 基于 `storeFor` 的自检；列为 DSH 升级首要回归点。这是本设计最可能出问题的地方。
- **首例外呼引入新信任面** → 本仓现有自研 package 均无外部网络请求。缓解：只请求单一 IP 查询端点、只取 IP 字段、不发送任何本地信息、超时+abort、结果不落盘；须在 `dsh.yaml` note 中显式记录该信任面变化（`proposal.md` — Impact 已声明）。
- **拦截可被绕过（devtools / 换客户端 / CLI）** → 本能力按 spec 定位为 affordance 而非安全边界，spec 最后一条需求即固化该边界。若日后需要真正强制，`dsh-llm` 的 `'llm/stream'(options, next)` waterfall 是唯一强制点（可见 `options.provider`，不调 `next()` 即拒绝），届时作为独立 change。
- **出口 IP 漂移使精确匹配可能整体不可用**（已实测，见 Decisions 3b）→ 白名单语义保证误判偏向不拦截；但**家庭出口 IP 的稳定性未知**，是实现阶段的首个决策点。若家里也漂移，本方案的口径需要改变（CIDR 或退回本地指纹），届时需回到用户确认。
- **同址重连时网络指纹不变** → 指纹失效不能覆盖全部重连场景，因此保留 TTL 作为兜底上限（两者合取）。
- **VPN / 热点共享改变出口而不改变本机地址** → 指纹不变 + TTL 未过期时会沿用旧结论，最长滞后一个 TTL。可接受，且方向仍偏向不拦截。

## Migration Plan

新增 local package，无数据迁移、无破坏性变更。

- 落地：`packages/home-network-model-guard/` → `dsh.yaml` 新增 local 条目 → `node scripts/sync.mjs`（或 `dsh build`）物化 → 重启 DSH 生效。
- 验证顺序：先跑包内 `typecheck` / `test`（纯函数判定与缓存语义可完全离线覆盖），再跑仓库级 `npm test`、`npm run check:artifacts`，最后连续两次 sync 验证幂等。
- 回滚：`dsh.yaml` 该条目改 `enabled: false` + 重新 build 即完全移除拦截，源码保留在仓库（符合仓库"禁用≠删除"约定）。

## Open Questions

~~**阻塞项（必须在家庭网络实测后由用户确认，见任务组 5）**~~ **已解决（2026-09-03 家庭实测，任务 5.1/5.2）**：家用线公网出口 IP 稳定为 `115.197.18.69`（8/8 连续查询 ≈1s 间隔一致 + ipinfo.io 交叉一致），ISP 以类似静态方式寻址该线路。采用**精确 IP 白名单**（`HOME_NETWORKS = ['115.197.18.69']`），不需要 CIDR；若运营商日后重编号，白名单不命中 → `not-home`（不拦截），重新测量更新即可。实测同时确认 `api.ipify.org` 在家亦不可达（空响应），`ifconfig.me` 稳定可达 —— 端点选择不再有疑问。

以下不影响 spec、方案选择或任务拆分，实现时确定即可：

- ~~外部 IP 查询端点的选择与其失败/限流语义；是否配备用端点~~ **已确定：单一固定端点 `ifconfig.me/ip`；不配备用端点（多端点答案不一致不可投票），失败 fail open 后可重试；另实现一次同端点立即重试以抵御首次连接抖动（2026-09-03 家庭实测，node fetch 偶发首连 ETIMEDOUT 而重试成功）。**
- TTL 与外呼超时的具体取值（TTL 5min、超时 5s，已落实现并随 fingerprint 失效兜底）。
