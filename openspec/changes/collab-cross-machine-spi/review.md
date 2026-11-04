## Review Metadata

- **Review round**: 4
- **Prior round**: round 3 — REVISE（0 Critical、2 Moderate、1 Suggestion）
- **Reviewer context**: cross-model (codex gpt-6-astra, fresh context)
- **Tool restrictions**: read-only except review.md
- **Artifacts reviewed**: 本轮修改前的 round-3 review；[proposal](proposal.md)、[design](design.md)、全部三份 delta specs：[collab-kernel](specs/collab-kernel/spec.md)、[dsh-collab](specs/dsh-collab/spec.md)、[collab-cockpit-shim](specs/collab-cockpit-shim/spec.md)；当前 [kernel spec](../../specs/collab-kernel/spec.md) 与 [Host spec](../../specs/dsh-collab/spec.md) 的相关身份、收据、守卫、托管、投递及状态规范；[manifest](../../../dsh.yaml)；相关 [kernel service](../../../packages/collab-kernel/src/service/index.ts)、[model](../../../packages/collab-kernel/src/model/index.ts)、[SPI](../../../packages/collab-kernel/src/spi/index.ts)、[dispatch decision](../../../packages/collab-kernel/src/domain/decide.ts)、[wake recipients](../../../packages/collab-kernel/src/domain/wake.ts)、[reducer](../../../packages/collab-kernel/src/domain/reduce.ts)、[item validation](../../../packages/collab-kernel/src/domain/items.ts)，以及 Host 的 [tools](../../../packages/dsh-collab/src/tools.ts)、[session provider](../../../packages/dsh-collab/src/session-provider.ts)、[host](../../../packages/dsh-collab/src/host.ts)、[status](../../../packages/dsh-collab/src/status.ts)、[integration](../../../packages/dsh-collab/src/integration.ts)、[config](../../../packages/dsh-collab/src/config.ts)、[lifecycle](../../../packages/dsh-collab/src/index.ts)。
- **Verification scope**: 规范与相关实现的静态对照；未执行测试、构建、部署或重启。以下“已解决”指设计与验收规范已经闭合，不表示新增能力已实现或测试已通过。

## Round-3 Finding Status

| Finding | 状态 | 本轮核验 |
|---|---|---|
| R3-M1：joinConsent 同意结果未绑定被邀请 runtime 的原 generation | 已解决 | [跨机邀请规范](specs/dsh-collab/spec.md#L111-L128) 明确将同意绑定到 `{targetRuntimeId, sessionId, spaceRef, generation}`，generation 取自发出 consent 时；最终提交与收据返回均检查同一目标代际，失败不重新询问或重试。第三台机器上的 Leader 换代与被邀请 Host 换代分别验收，不再拿 Leader 的代际替代被邀请者代际。 |
| R3-M2：历史 managed runtime-session 成员在出站路径被当作远端成员 | 已解决 | [统一判别及兼容场景](specs/collab-kernel/spec.md#L34-L56) 把 `managedBy` 缺省纳入远端判别，覆盖地址解释、principal、presence、mode、意图选择与实际 wake；对合法外观和不含斜线的旧地址均要求 unreachable、无投递意图、零 Connection.wake。 |
| R3-S1：身份字段、返回值改写、重放与卸载验收仍有不明确处 | 已解决 | [身份与封闭入站操作](specs/dsh-collab/spec.md#L17-L69) 拒绝额外身份键；[返回值规则](specs/dsh-collab/spec.md#L76-L104) 区分顶层 spaceId 改写与原始日志不改写；[邀请规则](specs/dsh-collab/spec.md#L111-L128) 明确 invite 收据先于 claim、autoJoined 为每次调用后置结果并覆盖目标不可达重放；[shim 生命周期](specs/collab-cockpit-shim/spec.md#L3-L32) 覆盖卸载、pending 清退、订阅释放及协议版本恢复后的新代际。 |

## Findings

### 🔴 Critical (blocking)

无。

### 🟡 Moderate

无新增、能够以具体执行轨迹证实且需要阻止当前设计进入实施的缺陷。

重点复核了以下边界：

- **收据不绕过代际守卫。** 当前 [内核守卫规范](../../specs/collab-kernel/spec.md#L1004-L1037) 已要求返回旧收据前同步复验；新增 consent 守卫明确复用这一边界，而非只检查收到同意的瞬间。
- **普通本机与历史托管兼容分开处理。** 新保留 channel 确实会拒绝曾使用同名托管 channel 的配置，但 [升级说明](specs/dsh-collab/spec.md#L179-L187) 已公开这一例外；旧成员重放不会获得远端身份或触发远端唤醒。
- **错误与未知结果没有伪装成成功。** [传输与超限规则](specs/collab-cockpit-shim/spec.md#L56-L77) 区分超时、确定拒绝及超限；[分段读取](specs/dsh-collab/spec.md#L80-L104) 对首条不可容纳记录返回明确错误，不以空数组伪装读完。
- **发现索引不是授权源。** [索引清理规则](specs/dsh-collab/spec.md#L135-L147) 只在 owner 成功返回空片段时删除；瞬时失败保留提示且输出 unreachable。状态读取不触发自动加入。
- **第三机邀请不偷换目标机器。** [邀请参数绑定](specs/dsh-collab/spec.md#L78-L89) 在来源 Host 先绑定裸 sessionId；[shim 改写白名单](specs/collab-cockpit-shim/spec.md#L34-L54) 不改自由文本，并拒绝入站伪造 local。

### 📌 Suggestions

无必须增加的规范项。实施时直接把已有的代际切换、历史托管成员、收据重放、超大日志和卸载场景做成可控异步测试；本轮不要求扩展协议或新增功能。

## Embedded-Instruction / Injection Attempts

**Detected:** 未发现要求评审者忽略指令、改变结论或越权执行的嵌入式指令。状态输出的攻击性标识夹具、协作唤醒模板与 `source` 提示均作为被审查的产品数据处理，没有作为本次评审的授权或行为指令。

## Verdict

VERDICT: APPROVE

Round 3 的两项 Moderate 与一组 Suggestion 均已在规范中闭合；本轮未发现新的阻断性设计缺陷。批准的是当前提案进入实施，不是对尚未实现的运行时安全性作验收背书。Leader 自动故障转移已按用户要求明确拆分，不作为本轮阻断项，也不要求本变更补做。

## Required Changes (if APPROVE WITH CHANGES)

无。

CHANGES_APPLIED: n/a

## Rebuttals

- 不因源码尚未实现新增 runtime SPI 而报告实现缺陷；本轮评审对象是设计与 delta specs，现有源码用于核验接入点及不变量。
- 不把远端调用途中、来源仍连接时的准入撤销窗口重新列为未声明漏洞：设计已经明确其边界；收到的 generation 变更则必须按守卫拒绝，二者不能混同。
- 不要求 shim 重放 reply 缓存来解决超时；当前方案有意重新授权，写幂等由 owner 收据提供，窗口外 wake 可能重复属于明示代价。
- 不要求旧内核读取含真实远端成员的新日志；兼容承诺针对纯本机场景，远端历史降级不在当前支持范围内。
