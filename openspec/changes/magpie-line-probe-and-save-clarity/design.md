## Context

`dsh-magpie-connector` 的线路模型是「列表 = 优先级，生效线路由自动选择决定」。目录同步只发生在「生效线路身份变化」时（`runtime.ts:457-463` 的 `reconcileActiveLine` 只在 `changed` 时 `syncCatalog()`），因此一条新加的、没被选中过的线路从来没有被真正请求过；它的健康度在界面上不可知。

设置页的线路卡片目前只有地址/key/接入方式输入与上移/下移/删除/展开（`SettingsPage.ts:282-320`）。保存是整个列表的原子提交：写凭据、写设置、重新选线（对每条完整线路做 TCP 探测）、必要时重同步目录，然后客户端清空并重读用量卡片（`SettingsPage.ts:71-92`）。其中两个行为与既有规范不符：任何 `lines` 提交都清空用量卡片（`dsh-magpie-connector` 要求非生效变化「SHALL NOT 清空目录或卡片」）；已保存但不完整的线路没有「未配置」标记（`magpie-line-selection` 要求「SHALL 标记为未配置」）。

架构约束：`gen.catalog` 是全局的（模型选择器、按 owner 注册的路由、设置页 provider 分组），`visibleModels`/`defaultEfforts` 以 model id 为键也是全局的，用量卡片的状态挂在 `Generation` 上。任何「看另一条线路的目录」的实现都不能写这三处。另外主 spec「只读与传输边界」把每个网络 hop 限定在当前生效线路的 origin，因此检查必须同时修改该 requirement，否则实现必然违反两条规范中的一条。

## Goals / Non-Goals

**Goals:**

- 保存前就能知道某条线路「通不通、key 对不对、和我们缓存的目录差在哪」，且不需要先保存。
- 检查在结构上无法影响生效线路、路由注册与偏好配置。
- 保存后的状态可读：结果只陈述当时的生效线路；未完整线路有「未配置」标记。
- 恢复「非生效线路变化不清空用量卡片」的既有要求，同时不退化既有身份隔离。

**Non-Goals:**

- 按线路读取账号/用量（`GET /magpie/quotas/cards` 旁路），留待后续 change。
- 手动指定/切换线路。
- 检查结果的持久化、缓存复用、后台轮询。
- 任何视觉样式调整（进度条圆角已从本期范围移除）。

## Decisions

**D1：检查走 `transport`，绕过 `beginOperation()` / `syncCatalog()`，并同步修改传输边界规范。**
`beginOperation()` 会解析凭据、做选择（可能 rotate generation）并把结果提交进 `current`（`runtime.ts:197-222`）；`syncGeneration` 还会 `commitOwners` + `emit()` 注册路由（`runtime.ts:355-380`）。检查只用 `normalizeBaseUrl` 校验草稿地址、按需解析未填写的凭据、拼临时 identity，然后 `transport.request(identity, 'GET', '/models')`，响应经纯函数 `mapCatalog()`（`catalog.ts:31`）投影成 `{modelCount, models:[{id}]}`（与 D5 的 envelope 同一形状，不输出 owner）后丢弃 `CatalogModel[]`。`transport` 的白名单已允许 `GET /models`（`transport.ts:26`），跨 origin 由传入 identity 决定，因此传输实现不需要放宽；但主 spec「只读与传输边界」把 hop 限定在生效线路 origin，所以本 change 必须给该 requirement 一份完整 MODIFIED delta，把「线路检查」写成第二个、且仅限单次 `GET /models` 的例外（`specs/dsh-magpie-connector/spec.md`）。除这条例外，其它 hop 的 origin / 白名单 / 重定向 / Access 规则一字不改。

**D2：检查的 identity 不带 `lineId`，因此不会失效探测缓存。**
`transport` 只在连接阶段失败且 identity 带 `lineId` 时回调 `onConnectionFailure`（`transport.ts:56-60`）。检查要求零副作用，草稿一律不带 `lineId`：缓存失效留给下一次真实操作。

**D3：临时凭据复用现有引用计数做脱敏，不新建瞬时 Set。**
请求体可能带一把从未保存过的 key。它不在 `currentSecrets` 里，`redact()` 看不见它。直接复用 `retainIdentity()` / `retainKey()`（`runtime.ts:219-232`）——`redact()` 已经把 `activeKeys` 并入候选并按长度倒序替换（`runtime.ts:235-248`），引用计数天然支持并发与共享值，不会出现「A 的 finally 删掉 B 还在用的值」。释放时机：检查 handler **内部收敛所有异常**（任何失败都转成结构化结果，绝不向外抛），响应 JSON 的脱敏在构造时完成，`finally` 里释放引用。这样外层 route 的 catch 永远不会成为「首次处理含临时凭据的异常」的路径。覆盖成功 body（模型 id；网关输入里的 `owned_by` 只作脱敏夹具，不进入输出）、错误 body（`reason` 与网关回显）、JSON 键名与转义序列、以及 body 读取阶段抛错。

**D4：准入靠「连接写入版本号」，不靠两个时点都看到 `saving=false`。**
凭据解析是 `await`（`resolveLine` 异步解析三个引用），一次保存可以在解析窗口内完整开始并结束：两个时点都读到 `saving=false`、`failedFields=[]`，却已经把凭据换成了另一个版本——按旧值解析出的一半加新值的一半拼出的组合从未被任何一次完整提交过。所以准入用一个 host 内存的 **连接写入版本号**：

- 递增时机：`updateLines` 开始时（与 `saving=true` 同一同步段，**即使这次保存最终失败也不回退**）、凭据引用的外部更新事件（`invalidateCredential` 覆盖的 `credentials/reference-updated`）。
- 检查流程：入口同步记录 `v0 = writeVersion`，同时做一次准入检查（`disposed` / `saving` / `failedFields` 非空 → `kind: "pending"`，零请求零解析）；解析凭据；解析后、发请求前复核 `writeVersion === v0 && !disposed`，不满足 → `kind: "pending"`，零网关请求。
- 解析后**不再**重新加载配置做成员复核、也不再重复比对 `saving`：删除线路、保存失败、以及「解析结束时仍在保存」都发生在某次 `updateLines` 之内，版本号必然已经变过——重复检查只增加分支，不增加保证。
- 版本号只是「这两次读取之间没有连接写入」的凭据，不换代、不选线、不同步、不写盘；不能用 `current` generation 代替它（非生效线路的变化按主 spec 不换代，generation 不会动）。

字段契约（请求体是草稿的子集，不是设置的写入格式；非对象、未知键一律 400）：

| 字段 | 省略 | 空串 | 非字符串 / `null` | 非法值 |
| --- | --- | --- | --- | --- |
| `id` | 新草稿，只用显式字段 | 400 | 400 | 非 8 位小写 hex → 400；形状合法但不在当前已验证配置 → `invalid`（零请求零解析） |
| `baseUrl` | 400（必填） | 200 + `incomplete`，**不回退**，零请求零解析 | 400 | 非 http(s)、无版本段、含 userinfo/query/fragment → `invalid`（零请求） |
| `accessMode` | 视为 `direct` | 400 | 400 | 其它取值 → 400 |
| `key` / `accessClientId` / `accessClientSecret` | 有 `id` 沿用该线路保存值；无 `id` 视为缺失 → `incomplete` | 同「省略」 | 400 | 非空但 >512 字符或含空白 / 非 ASCII 可见字符 → `invalid`（零请求） |

另外：`accessMode === "direct"` 时携带非空 Access 值 → `invalid`（零请求）；`cloudflare` 且地址非 https 或缺一项 Access → `incomplete`；凭据解析抛错 → `invalid`（零请求）。前端字段 `apiKey` 只是 UI 名，只有非空时才以 `key` 出现在 wire 上；「留空则保持不变」由「省略」表达，空串在凭据字段上等价于省略、在 `id` / `baseUrl` / `accessMode` 上是明确的 400 或 `incomplete`，不把空串当写入值。

**D5：结果 envelope、分类与优先级。**
请求体形状非法（非对象、未知键、`baseUrl` 非字符串、`accessMode` 取值非法）→ 400；其余一律 200 + `{kind, gatewayStatus?, reason?, latencyMs, modelCount?, models?, testedAt}`，handler 内部收敛所有异常，**任何异常都不得逃出成 5xx**。kind 取值与分类顺序以 `magpie-line-selection`「线路检查端点与结果分类」为准；这里只记两条容易做反的实现规则：

- **状态优先于 body**：一旦拿到响应状态，3xx / 401 / 403 / 其它非 2xx 的分类不再受错误 body 读取失败或超时影响，只在 `reason` 标注「错误 body 未完整读取」。
- **重定向有两条路**：`transport` 用 `redirect: 'error'`（`transport.ts:50`）。带 `Location` 的 3xx 在 undici 里直接抛错，经 `transport.ts:54` 变成普通 `Error`（没有 status）；而 300/304 这类没有可跟随目标的 3xx 会作为 `Response` 正常返回（已用本机 307/304/300 实测确认）。所以检查层：拿到 `Response` 时按 `status` 归 `redirect`，抛出时按「被传输层阻断的重定向」归 `redirect`。为了不靠中文字符串匹配，给 `transport.ts:54` 那个分支加一个 `redirect: true` 标记（+1 行、行为不变），检查层读标记。不得为了诊断再开第二条传输路径。

`reason` 是脱敏后的短文本：**先脱敏、再截断到 300 字符**（顺序不可颠倒，否则秘密可能只剩未匹配上的前缀）；截断边界的精确夹具写在 `test-plan.md` 的 Coverage Notes。`latencyMs` 覆盖到结果产生为止。`models` 只回模型 id（不投影 `owner`，本期不做归属展示）。

**D6：全局单飞在 host，不在页面。**
「同一时刻只允许一个检查」是 host 级要求：两个设置页各自有 `checking` 状态，页面锁拦不住并发。检查 handler 首行同步取得闸门（一个布尔 + 一个在飞标记），拿不到即返回 `kind: "busy"`，绝不复用另一份草稿的结果；`finally` 释放。客户端仍保留自己的单飞与禁用态，那只是减少无谓请求，不是正确性依据。

**D7：快照的比较基准是「宿主目录缓存」，比较键是完整 model id。**
客户端用 `settings.groups` 的 model id 并集 + `lastSyncAt` 作为基准，这是**缓存**而不是生效线路的实时目录——设置读取只更新 active、不换代不同步（`magpie-line-selection`「生效线路定义」），切线后目录还是继承来的旧目录。因此文案固定为 `与缓存目录一致（缓存于 T）`，无 `lastSyncAt` 或缓存为空时**不作**一致性结论，只显示 `kind` / 数量 / 耗时；任何文案 SHALL NOT 出现「与当前线路一致」或「同一个网关」。比较只按完整去重的 model id 集合，只展示多出 / 缺少（不展示共同集合、不投影归属）。

**D8：快照的签名、失效事件与迟到丢弃。**
每张线路卡片持有 `{signature, result}`，`signature = [id ?? null, baseUrl.trim(), accessMode, apiKey, accessClientId, accessClientSecret]`（比现有 `lineSignature` 多三项凭据输入，改 key 或任一项 Access 也要失效）。失效事件是一份固定清单：本卡签名变化、保存成功、`activeLineId` 改变、显式清除、设置页重新打开（`useEffect` 重读 settings）。增删或重排线路**不**单独触发失效——它们在保存成功之前只是本地草稿，不影响比较基准。实现用 `checkEpoch`：每次失效或发起检查递增；请求发出时记录 `{draftId, signature, epoch}`，结果落地前校验三者都未变，否则丢弃。**快照对生效线路同样渲染**：单线路安装时用户改的往往就是生效线路，隐藏它等于吞掉唯一有用的结果，而下方模型与用量区代表的是已保存状态、不是草稿结果。

**D9：保存的身份隔离按「提交是否触及生效身份」判断，并且隔离发生在请求发出之前。**
`mutateSettings` 不再按字段名判断 `identityWrite`，改为在发出 POST 前（同步）计算 `touchesActiveIdentity(submittedLines)`，任一成立即隔离：

1. 生效线路被删除；
2. 生效线路的 `baseUrl` 或 `accessMode` 改变（含 cloudflare → direct 的隐式 Access 清除）；
3. 提交里为生效线路提供了任一凭据（`key` / `accessClientId` / `accessClientSecret` 出现且非空）。

「隔离」= `clearUsage()`（隐藏卡片、推进 `cardsEpoch`、清 `refreshing`/`notice`），**在等待响应的整段时间里保持隐藏**——host 侧 `updateLines` 先写凭据再 `await reconcileActiveLine()`，后者可能等最长 15 秒的目录同步，这期间 host 已经用新 key 工作，界面不能还显示旧 key 的卡片。未命中三条时（纯备用线路编辑/增删/重排）保留卡片与读取时间，且不额外 `GET cards`。

响应后：若 `view.activeLineId` 与提交前不同（保存引起的自动切线）→ 按既有切换规则清空并重读；若已隔离但 `activeLineId` 未变（例如只换了生效线路的 key）→ 保持隐藏，用已推进的 epoch 重读卡片。

失败路径：已隔离的提交收到非 2xx / 500 部分写入 / 网络错误时，**不恢复**旧卡片；改为重新 `GET settings`（拿到脱敏设置与 pending）再 `GET cards`（新 epoch），让界面反映宿主真实状态，同时展示错误。未隔离的纯备用线路提交失败 → 保留原卡片，只显示错误。迟到的旧 `GET cards` / 刷新响应由 `cardsEpoch` 丢弃（`SettingsPage.ts:43-56` 已有该机制）。

验收三句：保存仍在等待目录同步时旧卡已不可见；生效 key 已写但其它字段写入失败时旧卡不可见；纯备用提交保留内容与读取时间且不额外 `GET cards`。

**D10：保存结果只陈述状态，且不带 live region。**
结果元素改为纯文本 `<p className="dmg-ok">`，移除现有的 `role="status"`（`SettingsPage.ts:278`），文案为 `已保存 · 当前线路 N` / `已保存 · 当前无生效线路`。`magpie-line-selection` 的静默规则禁止为线路变化新增 `role="alert"` / `role="status"` / `aria-live`，保存结果属于线路变化的结果呈现，因此不引入任何 live 语义，也不叙述「已切换」。

**D11：未配置标记复用 host 已有的 `complete`。**
`settingsView()` 已按线路返回 `complete`（`runtime.ts:493`），`view-model.ts:19` 也有该字段，只是客户端没渲染。给 `LineDraft` 补 `complete`，卡片头在 `draft.id && !draft.complete` 时显示「未配置」，与「（未保存）」草稿标记语义区分。标记反映的是宿主保存态，不反映输入框里尚未保存的内容。

**备选方案与否决理由**

- 复用 `settings` 提交（`testLine` 字段）：把只读操作塞进唯一写路径，与 `updating` 串行锁、凭据 quarantine 语义纠缠。否决。
- 按线路单独保存：放大 `failedFields`/`retained` 状态机，收益只是按钮距离。否决。
- 页面顶部「切换查看的线路」：与「不提供手动选择或强制指定线路的入口」冲突，且让「看到的目录」与「生效的目录」永久错位。否决。
- 检查时顺带读用量（`GET /magpie/quotas/cards` 旁路）：`CardsController` 状态挂 `Generation`，需开一条无提交旁路；配置阶段信息价值低。推迟。
- 用页面锁实现「同一时刻只允许一个检查」：两个设置页各自持锁，host 仍并行。否决（D6）。
- 用「与当前生效线路一致」作为文案：缓存可能是继承目录，会给出虚假结论。否决（D7）。
- 新建一个瞬时 `Set` 管脱敏：并发/共享值时释放时机互相踩。改用现有引用计数（D3）。

## Lean 取舍（ponytail 视角）

用「只找成本、不找覆盖」的视角过了一遍，结论记在这里，避免以后重复讨论「这段能不能删」：

**已删 / 已收**

- 删掉「被测线路是生效线路时不显示快照」：单线路安装下用户改的往往就是生效线路，隐藏它等于吞掉唯一有用的结果，而下方目录代表已保存状态、不是草稿结果。
- 重定向不再要求「统一按状态识别」：实测 307+Location 抛错、304/300 返回 `Response`，改成「`Response` 按 `status`、阻断错误按标记」两条路，不新增传输（`transport.ts:54` 加 1 行标记）。
- 合并同行为变体（网关 401/403/503、2xx 断流与超时、2xx 解码三态、Cloudflare 不完整六变体、准入三类写入交错、保存结果有/无 active、快照一致与差异），断言一条不少，scenario 由 53 降到 39。
- 删掉 connector delta 里与 selection 重复的「线路检查不跟随重定向」，以及重复的「未配置标记」场景（并入既有「未完整线路不参与自动选择」的 THEN）。
- 解析后不再重新加载配置做成员复核：删除线路、保存失败、解析结束时仍在保存，都发生在某次 `updateLines` 内，版本号必然已变。
- 快照不再投影 `owner`、不展示共同集合：比较键只有完整 model id，少一个字段也少一处误解。
- design 不再逐条复述 spec 的分类枚举与脱敏夹具（字段矩阵保留在 D4，它是实现的输入契约），只留实现顺序理由与代码落点；Risks 从 9 条收敛到 5 条。

**协商后明确不做（成本已核对，删了更贵或会丢需求）**

- 自动目录比较保留：用户要的「具体信息」就是在保存前看出地址是否指错环境；只报数量答不了这个问题。代价是比最小 MVP 多约 40 行实现，接受。
- 连接写入版本号保留：替代方案是检查与保存共用一把锁，代价是保存要等最长 15 秒的目录同步、或检查被保存挡住；版本号只是 1 个整数 + 2 次比较。只允许显式凭据的「更便宜」方案并不等价：会丢掉「凭据留空沿用保存值」，而环境只读凭据的输入框本来就是禁用的，用户将无法检查这些已保存凭据。
- 提交前三条件隔离保留：三条分别对应主 spec 已有的隔离场景（删除生效线路、改地址/接入方式、换 key）；收成「一律清卡片」正是当前 bug 本身。
- tasks 保持「每个 scenario 红-绿-重构」的三相：这是 anvil schema 的强制格式，无法按工作包压成 15–20 项；已改为在每个工作包末尾标注相关检查命令，避免照表跑 90 次全量测试。
- 12 个沿用场景保持绿：它们是既有行为，不因本 change 重新发明测试。

## Risks / Trade-offs

- [检查与保存交错，拼出从未被完整提交过的「旧 key + 新 secret」] → D4 的连接写入版本号（保存开始即递增、失败不回退；解析后只比版本号）。两个时点都看到 `saving=false` 不算安全依据。
- [临时凭据泄漏到响应/日志] → D3 的引用计数 + 构造响应时完成脱敏。
- [隔离后保存失败，卡片一直空着] → 已隔离的失败不恢复旧卡片，改为重读设置与卡片（D9）；未隔离的失败保留原卡片。
- [快照与继承目录混淆] → 文案固定「缓存于 T」，禁止「当前线路/同一个网关」；无基准不下结论（D7）。
- [网关 `/models` 很慢] → 5 秒总预算 + 全局单飞；超时归 `kind: "timeout"` 并释放闸门。

## Migration Plan

纯增量：新端点 + 客户端渲染与判断收窄，无 schema 变化、无凭据引用变化、无数据迁移。旧 Host + 新客户端时端点 404：客户端把检查入口视为不可用（禁用并提示），其余功能不受影响；新 Host + 旧客户端表现为多一个没人调用的端点。回滚只需回退插件版本，设置文件保持可读。

## Open Questions

- 检查入口的文案与位置（线路卡展开区底部，还是卡片头）留到实现时按实际密度定；不影响 spec。
