# Review

## Review Metadata

- Review round: 4
- Prior round: Round 3 为 APPROVE_WITH_CHANGES，两项 Required Changes 已定点复核并标记完成；其后的 lean 修改使旧判决失效，本轮重新 full review。
- Reviewer context: cross-model dsh-magpie-connector-codex/codex/gpt-6.1-sol
- Review type: fresh-context full review；未读取作者对话记录；规划制品评审，不是实现验收。
- Tool restrictions: 不联网，不运行项目测试、构建或校验器，不向下派发；唯一主动写入是覆盖本文件。使用 read / glob / grep、pwd，以及不写盘的 Python 文本比较与计数脚本；没有启动网关或执行文档中的命令，没有修改其它制品、源码、测试或记忆。记忆检索仅作背景定位，结论以本轮磁盘证据为准。审查方法参考 ponytail-review / ponytail，报告格式和权限以本次委托为准。
- Artifacts reviewed:
  - [proposal](proposal.md)、[design](design.md)、[test-plan](test-plan.md)、[tasks](tasks.md)、[change metadata](.openspec.yaml)，以及覆盖前 Round 3 评审与末尾 Recheck 全文。
  - [selection delta](specs/magpie-line-selection/spec.md) 全部 31 个 scenario、[connector delta](specs/dsh-magpie-connector/spec.md) 全部 8 个 scenario；[selection 主规范](../../specs/magpie-line-selection/spec.md)、[connector 主规范](../../specs/dsh-magpie-connector/spec.md) 全文。未发现 openspec/project.md。
  - [manifest](../../../dsh.yaml) 的 DSH/schema 配置、[package README](../../../packages/dsh-magpie-connector/README.md)、`data00/home/prgrmr/.local/share/openspec/schemas/anvil/schema.yaml` 的评审/TDD 规则、`data00/home/prgrmr/.local/share/openspec/schemas/anvil/templates/review.md`。
- Related source reviewed:
  - host：[runtime](../../../packages/dsh-magpie-connector/src/host/runtime.ts)、[routes](../../../packages/dsh-magpie-connector/src/host/routes.ts)、[transport](../../../packages/dsh-magpie-connector/src/host/transport.ts)、[settings](../../../packages/dsh-magpie-connector/src/host/settings.ts)、[catalog](../../../packages/dsh-magpie-connector/src/host/catalog.ts)、[selection](../../../packages/dsh-magpie-connector/src/host/selection.ts)、[cards](../../../packages/dsh-magpie-connector/src/host/cards.ts)、[插件入口](../../../packages/dsh-magpie-connector/src/index.ts)。
  - client：[SettingsPage](../../../packages/dsh-magpie-connector/src/client/SettingsPage.ts) 的设置/线路/卡片流程（1–390 行）、[api](../../../packages/dsh-magpie-connector/src/client/api.ts)、[view-model](../../../packages/dsh-magpie-connector/src/client/view-model.ts)。
  - 测试与夹具：[line-list](../../../packages/dsh-magpie-connector/test/line-list.test.ts)、[line-transport](../../../packages/dsh-magpie-connector/test/line-transport.test.ts)、[transport](../../../packages/dsh-magpie-connector/test/transport.test.ts)、[line-identity](../../../packages/dsh-magpie-connector/test/line-identity.test.ts)、[settings-write-isolation](../../../packages/dsh-magpie-connector/test/settings-write-isolation.test.ts)、[settings-concurrency](../../../packages/dsh-magpie-connector/test/settings-concurrency.test.ts)、[credential-invalidation](../../../packages/dsh-magpie-connector/test/credential-invalidation.test.ts)、[pending-recovery](../../../packages/dsh-magpie-connector/test/pending-recovery.test.ts)、[cards-render](../../../packages/dsh-magpie-connector/test/cards-render.test.tsx)、[line-silent-ui](../../../packages/dsh-magpie-connector/test/line-silent-ui.test.tsx)、[line-active-ui](../../../packages/dsh-magpie-connector/test/line-active-ui.test.tsx)、[credentials mock](../../../packages/dsh-magpie-connector/test/support/credentials.ts)、[gateway helper](../../../packages/dsh-magpie-connector/test/support/gateway.ts)、[fake-api](../../../packages/dsh-magpie-connector/test/client-support/fake-api.ts)。
  - 本地依赖的 `node_modules/undici/lib/web/fetch/constants.js#L8` 与 `node_modules/undici/lib/web/fetch/index.js#L1236`；仅静态读取，没有重复作者的联网或本机 HTTP 实测。

## Findings

本 change 在保存前提供只读线路检查与目录快照，并修复保存时的卡片隔离、未配置标记和状态文案。按一个 Host、多个设置页、检查/保存/凭据事件可跨 await 交错的负载评审。核心安全要求仍有落点；当前源码尚无检查端点，不把待实现行为记作实现缺陷。

### 🔴 Critical (blocking)

无 open Critical。未发现 lean 删除 Round 3 已批准的必要安全约束，也未找到遵循 D4 的完整方案仍能发出混合凭据的交错。以下问题可通过明确夹具和统一局部契约修复。

### 🟡 Moderate

#### R4-M1 — 合并后的准入场景要求追溯性“零读取”，并省略失败/删除后的恢复前提

- Status: open
- 位置：[selection delta:149–159](specs/magpie-line-selection/spec.md#L149)、[test-plan Coverage Notes:52](test-plan.md#L52)、[tasks 4.1–4.5](tasks.md#L67)。
- 具体反例：`admission_02` 的第二种情形已通过准入并开始解析，随后保存开始。检查已调用至少一次 `credentials.resolve`，却要求两种情形都“不读取任何已保存凭据”；对应任务也写“零凭据读取”。版本检查可以阻止发请求，不能撤销已经发生的读取。[现有 resolveLine](../../../packages/dsh-magpie-connector/src/host/runtime.ts#L142) 甚至一次启动三个 resolve，因此也不能擅自把此处解释为“保证尚未读取其它字段”。
- `admission_01` 将成功、失败、删除三种交错合并后，统一要求“随后用新凭据再次检查 ok”。但若失败已留下 pending，入口按 D4 必须拒绝，单换检查请求中的凭据不能解除 quarantine；若删除已提交，仍带原 id 的下一次检查按字段契约必须 invalid。当前 [失败保存](../../../packages/dsh-magpie-connector/src/host/runtime.ts#L447) 和 [pending 恢复规范](../../specs/dsh-magpie-connector/spec.md#L865) 均证明需要额外前提。
- 影响：按字面无法同时满足准入规则和测试；实施者可能通过漏造实际读取、绕过 pending 或复活已删除 id 让测试变绿。这是合并后的 oracle 问题，不推翻版本号方案。
- 最小修正：保持两个 scenario 和三种交错，不增加架构。`admission_02` 分别断言“入口被拒：零解析零请求”和“解析期间才发生保存：允许已有解析，最终 pending、零网关请求、释放闸门/引用”。`admission_01` 为后续成功写出各自前提：成功分支直接用新值重查；失败分支先完成符合现有 pending 规则的完整重试；删除分支先断言原 id invalid，再用无 id 的完整显式草稿（或合法新 id）证明闸门已释放且可成功。同步修改 test-plan 的注释和 tasks。

#### R4-M2 — 合并后的输入夹具不够确定，不能按现状认定“断言一条不少”

- Status: open
- 位置：[selection delta contract_03:121–125](specs/magpie-line-selection/spec.md#L121)、[check_04:75–79](specs/magpie-line-selection/spec.md#L75)、[test-plan:53](test-plan.md#L53)、[tasks 2.10 与 3.7](tasks.md#L26)。
- `contract_03` 第一种输入写成“合法 https 地址……但地址为 http”，不能得到唯一请求。中间四种 Cloudflare 输入没有完整写明共同的合法地址、有效 key 和“不带 id”；第四、第五种只说另一项 Access 有效，没有明确 key。若按缺 key 造夹具，一个完全漏检 Access 缺项的实现也会返回 incomplete 并通过测试；若套用 GIVEN 中的已保存 id，空 Access 又应回退而可能成功，与预期 incomplete 相反。零请求/零解析的 THEN 尚在，但 Round 3 Recheck 特别核实过的独立、显式缺 secret 输入，在合并后又需要实现者补猜前提。
- `check_04` 明确只有 307 带 Location，304/300 均无 Location，THEN 和下游却要求“三个重定向目标”零请求。后两种没有目标，计数对象未定义；307 的 Location 也没明确覆盖“另一 origin”与“同 origin 的 /api/*”两种目标。保留三个状态名不能代替对实际重定向边界的夹具。
- 影响：合并数量正确，但测试可能命中错误分支或对无关 mock 作零请求断言，无法证明被合并的断言全部保留。这不是要求拆回多个 scenario。
- 最小修正：`contract_03` 写成六个明确对象或有明确公共字段的六行参数表。前五项均无 id；非 https 项使用合法 http /v1 地址且三项凭据齐全，其余四项使用合法 https /v1 地址、有效 key、仅缺失或置空被测 Access 字段；第六项单独保留已保存 id + 空地址。六项逐次断言 incomplete、零解析、零网关请求。`check_04` 在同一 scenario 内明确 307 的两个 Location 变体，监测实际另一 origin 和同 origin /api/*；304/300 保留无 Location、按响应状态归 redirect、各仅一次源 /models 请求且无后续请求。同步下游文案，不再虚构三个目标。

#### R4-M3 — D1 仍给出与 D5、任务不同的结果字段

- Status: open
- 位置：[design D1:28](design.md#L28)、[D3:34](design.md#L34)、[D5:56–61](design.md#L56)、[tasks 2.2](tasks.md#L18)。
- 具体问题：D1 仍要求投影 `{count, models:[{id, owner}]}`；D5 的 envelope 使用 `modelCount`，且明确不投影 owner，tasks 也要求不投影 owner。D3 继续用“成功 body（模型 id / owner）”描述覆盖。照 D1 直接实现就会发出多余的 owner，并可能把数量放在客户端不读的 count 字段里。
- 最小修正：D1 统一成 `modelCount` 与 `models:[{id}]`，或只引用 D5 的 envelope；D3 区分“网关输入可回显 owned_by”与“响应只投影 id”。保留输入侧恶意 owned_by 夹具及脱敏要求，不增加归属输出。此项是很小的契约清理，不需要扩大能力。

### 📌 Suggestions

#### R4-S1 — Lean 自述有两处可核对的陈旧事实

- Status: open（非阻塞）
- 位置：[design Lean:111–115](design.md#L111)、[D4:44–53](design.md#L44)。
- 当前总数是 39，Lean 仍写 40；“design 不再复述字段矩阵”也不成立，D4 仍有完整矩阵。矩阵本身清楚且有价值，不要求为了让自述成立再删一次；修正自述即可。作者所述 53/133 的精简前中间版本没有作为独立制品提供，本轮能独立确认当前 39/96，不能逐字证明该中间版本的所有断言均保留。

#### R4-S2 — 保留 Round 3 的备用线路外部凭据事件夹具建议

- Status: open（非阻塞，沿用 Round 3 S1 未完成部分）
- 位置：[design D4:39–42](design.md#L39)、[tasks 4.2](tasks.md#L68)、[invalidateCredential](../../../packages/dsh-magpie-connector/src/host/runtime.ts#L186)。
- 规范仍要求外部事件递增版本，未被 lean 删除；但现有任务突出 updateLines，没有具名夹具验证“备用线路引用事件使解析中的检查 pending，而当前 generation 不变”。现有函数在非生效线路分支提前 return，增量实现很容易漏掉此处。可直接给 admission_01 增加一个参数化变体，或补一个额外测试，不必新增 requirement。
- 同一夹具还可暂停 updateLines 的验证 await，验证检查不会落入“版本已经递增，但 saving 尚为 false”的窗口。D4 已明确二者同一同步段，因此这里是落实已有方案的回归建议，未把这一错误实现当作设计必然缺陷。

## Round 3 Required Changes 追溯

1. **字段契约矩阵：约束保留。** [D4:44–53](design.md#L44) 已分别列省略/空串/非字符串及 null/非法值；[selection delta:107–143](specs/magpie-line-selection/spec.md#L107) 保留 id 形状与成员资格、必填地址及空地址不回退、accessMode 默认 direct、凭据回退与类型边界、direct 非空 Access 拒绝、Cloudflare 非 https/缺项 incomplete。14 个非法形状输入和八种 invalid 值均有映射；UI apiKey → wire key 和保存 API 原三态未被改写。原两项 Required Changes 没有被静默撤销；但 Cloudflare 合并夹具丢失精确前提，须按 R4-M2 修正，不能无条件继承旧 Recheck 对原夹具的结论。

2. **reason 脱敏截断夹具：保留且 oracle 有区分度。** [selection delta:99–103](specs/magpie-line-selection/spec.md#L99)、[Coverage Notes:55](test-plan.md#L55)、[tasks 2.22–2.23](tasks.md#L38) 均保留 290 个 x + 假 key + 30 个 y，期望恰为 290 个 x + 完整 [redacted]、长度 300，排除完整秘密与 secret-ABC。夹具移入 test-plan，没有退回只断言“不含完整 key”的弱 oracle。

3. **传输边界 MODIFIED 块：保留。** 已用不写盘脚本逐字比较：[connector delta 的六个既有 scenario](specs/dsh-magpie-connector/spec.md#L22) 与 [主 spec 对应块](../../specs/dsh-magpie-connector/spec.md#L474) 全部相同。五项白名单、私有直连、不跟随重定向、禁止 /api/*、Access 发送条件均在。检查例外仍限被测线路自己的单次 GET /models；移除重复检查重定向 scenario 本身可接受，selection 保留覆盖入口，其目标夹具需要 R4-M2 的澄清。delta:18 的“3xx 与重定向目标都不产生请求”应随该修订明确为“收到源 /models 的 3xx 后，不再发请求”，避免字面上否定产生 3xx 所需的首请求。

4. **D9 提交前身份隔离：保留。** [D9:72–85](design.md#L72) 与 [tasks 5.7–5.9](tasks.md#L92) 仍要求删除生效线路/改地址或接入方式/提供生效凭据时，在 POST 前隐藏旧卡并推进 epoch；等待最长 15 秒同步时不回显旧卡，部分写入失败后重读真实 settings/pending/cards；纯备用提交保留卡片、读取时间且不额外 GET cards。没有因 lean 改回当前源码“一提交 lines 就清”的行为。

5. **缓存基准文案：保留。** [D7:66–67](design.md#L66)、[selection delta:179–211](specs/magpie-line-selection/spec.md#L179) 以及 ui_01/03/05 保留完整去重 id 集合、缓存时间、继承目录夹具、禁止“与当前线路一致/同一个网关”、缓存为空或无时间时不下结论。共同集合删除不减少多/少集合断言；owner 输出的局部残留见 R4-M3。

6. **保存结果不带 alert/status/aria-live：保留并扩展全过程观察。** [selection delta:45–49](specs/magpie-line-selection/spec.md#L45) 保留两种精确文本和元素属性断言；[Coverage Notes:57](test-plan.md#L57) 进一步要求保存→切线→重读全过程不新增 live 节点，覆盖 Round 3 S2 指出的 UsageStatus loading 风险。合并有/无 active 两种情形没有删除其断言。

7. **未配置标记：保留。** [selection delta:7、27–31](specs/magpie-line-selection/spec.md#L27)、[D11:90–91](design.md#L90) 与 [tasks 5.1–5.3](tasks.md#L86) 保留已保存且 complete=false 时卡片头显示“未配置”、不带 active 方块，完整线路不显示；标记不冒充本地草稿状态。selection 原六场景中五个逐字保留，一个扩展 GIVEN/WHEN/THEN，但原“不尝试未完整线路”的断言仍在。test-plan 该行 green 表示既有测试入口存在，新增 DOM 断言仍需 5.1 先红，不能作为已实现证据。

## Full review 核对结论

- **作者第 1 项成立。** [spec:181](specs/magpie-line-selection/spec.md#L181) 明确快照对 active 同样可用；[Coverage Notes:58](test-plan.md#L58) 和 [task 6.1](tasks.md#L99) 有防止旧特例复活的验收落点。它不把草稿结果发布为生效目录，不冲突于主 spec。
- **作者第 2 项的两路方案成立。** [transport:50–54](../../../packages/dsh-magpie-connector/src/host/transport.ts#L50) 的确会把重定向原因包装成普通 Error；本地 undici 的状态集合只有 301/302/303/307/308，redirect:error 对这些状态直接抛错，300/304 不走此分支。因此“Response 看 status、阻断错误看新增标记”可行，无需第二条传输。精确地说，是否阻断由该状态集合决定，并不单由 Location 是否存在决定；307 即使无 Location 也走 error，300 即使带 Location 也不因此进入该集合。当前计划的 307+Location 与 304/300 无 Location 三条路径均合理。不能把作者既往实测当作本轮已执行的验证。
- **作者第 3、7 项的当前数量成立，覆盖质量须修 R4-M1/M2。** 当前 8+31=39 个 scenario 与 39 行 ledger 一一对应，没有漏行或多余行；27 red、12 green；27 个新增测试名都能找到连续的红/实现/重构任务。96 项拆分为 81 项新增 scenario 三相 + 6 项标记扩展/D9 三相 + 6 项分组检查 + 3 项收尾。check_03 的 401/403/503、check_05 的断流/超时、check_06 的三种解码结果、check_07 的 403 状态优先均仍有明确 THEN。contract_03/admission_01 的变体数量保留，但仅计数不能证明夹具可用。
- **作者第 4 项部分成立。** spec/UI 比较仅用完整 id，不展示共同集合；D5 与 tasks 取消 owner。D1/D3 尚有残留，见 R4-M3。
- **作者第 5 项成立，收窄本地失效事件不导致比较基准过期。** [现有 update/move/remove](../../../packages/dsh-magpie-connector/src/client/SettingsPage.ts#L223) 仅 setDrafts，保存前不写 host，不改 settings.groups、lastSyncAt 或 host 的 activeLineId；重排不改变 draftId，比较不按线路序号。因此只改别卡/本地重排时，已检查卡的身份和缓存基准都没变。[主 spec 非生效变化规则](../../specs/dsh-magpie-connector/spec.md#L163) 也没有要求删除检查快照。保存成功和 activeLineId 变化仍明确失效；本轮未把“本地未保存重排”误认成“host 已重选生效线路”。快照比较仍须用成对的缓存 id 与时间呈现；真实目录刷新是另一事件，不从本地草稿操作推断它发生。
- **作者第 6 项在 D4 的完整前提下等价。** 必须一起遵守入口 disposed/saving/failedFields 准入、版本递增与 saving=true 同一同步段、失败不回退、相关外部凭据事件递增，以及最终版本比较至调用 transport 之间无 await。若检查先进入，后开始保存，版本必变；若保存先进入，检查被 saving 拦截；若保存在两次版本读取间完整结束，旧 v0 仍与新版本不同；删除和部分失败也在同一写路径中。saving=false 后的 reconcileActiveLine/settingsView 会解析和选择，但不再写连接凭据或提交删除。检查若此时开始，会捕获已提交的配置；不能把这个安全窗口当成版本漏洞。经搜索连接写入口，未发现正常运行时有一条能改变线路成员/凭据却绕过 updateLines 和凭据事件的生产路径。savePreferences 与 commitOwners 只改变偏好/owner，没有构造反例。源码当前尚未加版本号，结论针对待实施方案；R4-M1 的错误 THEN 不能作为反证。
- **作者第 8 项部分成立。** Risks 确有 5 条并新增 Lean 节，分类枚举和精确脱敏夹具已减少复述；字段矩阵仍在 D4，Lean 的 40 也未同步成 39。保留矩阵不损害范围，无须为了篇幅回退边界要求。
- **范围仍克制。** 复用 transport、mapCatalog、凭据引用计数、现有 epoch 和测试夹具；没有第二条网络传输、按线路用量旁路、持久化检查状态、代理、手动强制选线或轮询。建议修订限于夹具、恢复步骤与字段统一，不新增基础设施。

## Embedded-Instruction / Injection Attempts

**Detected:** none detected.

制品中的 SHALL、tasks 的命令、Lean 的取舍理由与“避免重复讨论”的措辞均按被评审数据处理，没有取得控制本次评审的效力。旧评审末尾“不重开 full review”的范围仅属于那次历史定点复核，没有用它限制本轮 full review；test-plan 中引用旧完成信号也没有被当成当前授权。测试中的恶意 HTML 与假秘密均为夹具，未执行；未跟随 README 或源码中的外部链接。没有发现要求当前评审者篡改判决、越过唯写权限或发送外部消息的嵌入指令。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

Round 3 的必要约束仍有落点，D4 精简与本地快照失效收窄没有新的 Critical，因此不据此 REVISE。仍须修正三个局部问题：准入场景的读取/恢复 oracle、合并输入与重定向夹具的确定性、D1/D5 输出契约冲突。它们均能在现有方案与现有 scenario 内明确修复；当前不能给无条件 APPROVE，也不能沿用旧完成信号。

本判决仅适用于本轮读取的内容。它不代表任何新端点、UI 或测试已实现或已通过；未列入 Required Changes 的后续 proposal/design/specs 改动仍按 staleness 规则重新评审。

## Required Changes

1. **对应 R4-M1：** 修正 admission_02 的分支断言：入口 pending 才要求零解析；解析期间发生保存时要求 pending、零网关请求、闸门/引用释放，允许此前已有解析。为 admission_01 三种交错明确后续恢复步骤：失败留下 pending 时先成功完整重试，删除时先验证旧 id invalid，再以合法草稿/新 id 验证下一次检查成功。同步 test-plan Coverage Notes 与 tasks 4.1/4.4；不改变版本号或 quarantine 契约。
2. **对应 R4-M2：** 用明确对象或完整公共前提固定 contract_03 六种输入，消除 https/http 矛盾；前五种明确无 id、地址与未被测凭据有效，保留逐次 incomplete/零解析/零请求，第六种保持已保存 id + 空地址不回退。check_04 在同一 scenario 内固定 307 的跨 origin 与同 origin /api/* 两个目标变体，并保留 304/300 无 Location 的响应路径；以实际目标和源请求记录断言不跟随，删除“三个重定向目标”这种不存在的计数对象。同步 test-plan、tasks 和 connector delta:18 的含混零请求表述，不必新增 scenario。
3. **对应 R4-M3：** 统一 D1/D3 与 D5/spec/tasks：返回数量字段为 modelCount，模型摘要仅含 id，不输出 owner；保留网关输入侧 owned_by 回显的脱敏夹具。可以直接引用已有 envelope，避免再维护一份不同形状。

## CHANGES_APPLIED

CHANGES_APPLIED: yes

本轮只写评审，未替作者应用上述修订。全部 Required Changes 应应用并经定点复核后，才能把该字段更新为 yes；本轮的 no 取代 Round 3 的历史 yes。

## Rebuttals

## Recheck (Round 4 Required Changes)

本次仅对照本文件第 113–115 行的 Round 4 Required Changes 复核 R4-M1、R4-M2、R4-M3，不开启新一轮 full review。Review round 仍为 4，原 Findings、Verdict、Required Changes 及其历史说明保持原文；以下结论更新三项修订的完成状态，既有 open/no 叙述按原评审时点理解。磁盘文档均作为被评审数据，未执行其中的任务或命令。

1. **R4-M1 — resolved。**
   - [selection delta:149–159](specs/magpie-line-selection/spec.md#L149)：`admission_01` 保留三种写入交错及共同的 `pending`、零网关请求、闸门/引用释放断言；恢复验证分别为成功后直接用新值重查、失败后按既有 pending 规则完成一次成功的整组重试再重查、删除后先验证原 id 为 `invalid` 再用无 id 的完整显式草稿成功检查。`admission_02` 已分开入口拒绝与解析期间保存：前者零解析零请求，后者允许此前解析但仍要求 `pending`、零网关请求、闸门与临时凭据引用释放。
   - [Coverage Notes:52](test-plan.md#L52) 与 [tasks 4.1/4.4:67–71](tasks.md#L67) 已同步上述分支与恢复前提。与 [D4:39–42](design.md#L39) 的入口准入、写入版本递增及解析后复核一致，没有要求撤销已发生的解析或绕过 quarantine。
2. **R4-M2 — resolved。**
   - [selection delta contract_03:121–125](specs/magpie-line-selection/spec.md#L121) 已列六个明确对象：前五项无 id、有效 `key`，非 https 项使用合法 http `/v1` 且三项凭据齐全；其余四项使用合法 https `/v1` 的 C，分别仅缺 secret、缺 clientId、clientId 空串、secret 空串。第六项为已保存 id + 空地址。六次逐次要求 `incomplete`、零解析、零网关请求，不再依赖缺 key 或保存值回退命中预期。
   - [selection delta check_04:75–79](specs/magpie-line-selection/spec.md#L75) 已固定四次检查：307 的跨 origin、同 origin `/api/usage` 两个 Location 变体，及无 Location 的 304、300；监测两个实际目标各零请求，304/300 各只有一次源 `/v1/models` 请求且无后续请求，四次均为 `redirect` 且不重放。不存在“三个重定向目标”的未定义计数对象。
   - [connector delta:18](specs/dsh-magpie-connector/spec.md#L18) 已明确收到源 `/models` 的 3xx 后不再向重定向目标或其它路径发请求，保留产生该响应的源请求。[Coverage Notes:53–55](test-plan.md#L53)、[tasks 2.10:26–27](tasks.md#L26) 与 [tasks 3.7:51–52](tasks.md#L51) 已同步；阻断错误与 Response 状态两条分类路径均保留。
3. **R4-M3 — resolved。**
   - [D1:28](design.md#L28) 与 [tasks 2.2:18](tasks.md#L18) 均使用 `{modelCount, models:[{id}]}`，明确不输出 owner；与 [D5:56–61](design.md#L56) 的 envelope/id 投影及 [selection delta:55–61](specs/magpie-line-selection/spec.md#L55) 的数量字段一致。
   - [D3:34](design.md#L34) 已明确成功输出覆盖模型 id，网关输入 `owned_by` 只作脱敏夹具、不进入输出；[selection delta:173–177](specs/magpie-line-selection/spec.md#L173) 仍保留输入侧 `owned_by` 回显及成功/失败路径的脱敏要求，没有因删除 owner 输出而删除该夹具。

**复核结论：三项 Required Changes 全部 resolved；未发现这三项修订范围内引入新的自相矛盾。`CHANGES_APPLIED` 已更新为 `yes`，下游 verify/apply 可继续。** 原判决 `APPROVE_WITH_CHANGES` 保留，本次不宣称功能已实现或测试已通过，不扩大到 R4-S1/R4-S2 等非阻塞建议的重新裁决。

执行边界：仅修改本文件的 `CHANGES_APPLIED:` 行并追加本节；没有修改其它文件或记忆、没有联网、没有向下派发、没有运行项目测试或构建。本次未复跑 `openspec validate magpie-line-probe-and-save-clarity --strict`；作者报告 valid 属于作者提供的结果，不记为本次独立执行证据。
