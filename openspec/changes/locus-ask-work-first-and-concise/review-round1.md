## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: read-only: view, grep, glob only（唯一写入为本文件；另以只读 shasum 计算审查工件摘要）
- **Artifacts reviewed**: [proposal.md](openspec/changes/locus-ask-work-first-and-concise/proposal.md)、[design.md](openspec/changes/locus-ask-work-first-and-concise/design.md)、两份 delta specs、对应当前规范，以及下列相关源码和测试证据。此次为规划评审，未实施、运行测试、联网、部署或重启。
- **Artifact hashes**: SHA-256
  - proposal: `d02c92bc134a82314bd7d012eeb885d5c15b26e951ea50c38724d120f38c782f`
  - design: `1ab357b545e093fd4c7f8e4ec20eb9650ff717a153190152bc328a280645ea1e`
  - collaboration delta: `f6b1578f2f2c29e0e87e430edbce11a68733a7ba98e534020f363389bfb80288`
  - intent-triage delta: `a309e2c620c7c812054e984b957266846985e5b34ccac92519bd46dd4ac61fb1`

本变更让信息问答先向协调会话取已有事实，再自行检索，并缩短业务回复；同时增加工作会话历史读取与显式绑定修复。按一个 Host、同一 W 连接多个群/话题、入口请求可并发的既有模型评审，不假设只有单群或可信内部成员。

## Findings

### 🔴 Critical (blocking)

#### C1 — 超过 Delivery deadline 才自查，届时已经不能回复，且 wait 不会唤醒模型
- **位置**：[intent delta:7–13](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-intent-triage/spec.md#L7-L13)、[design:55](openspec/changes/locus-ask-work-first-and-concise/design.md#L55)。
- **具体失败**：提问投递成功，但 M/W 没有返回消息；child 结束当前 turn 并等待。`pet_locus_wait` 仅延长 deadline，不建立后续执行；到期后 current 原子变成 expired。即使后来 child 被唤醒，自查后的 finish 也不再具有原 Delivery 的发送能力。因此“超时就自查，不会卡死”不是当前架构能提供的降级。
- **依据**：[当前规范:153–165](openspec/specs/pet-locus-collaboration/spec.md#L153-L165) 明确终态与撤权；[已有撤权测试:525–543](packages/dsh-pet/test/locus-turn-observer.test.ts#L525-L543) 明确 A 到期撤权后不能消费 B。
- **修复**：不要把业务询问超时等同于 Delivery 终止期限。选择并写清一种可实现策略：无可证明唤醒机制时取消自动超时自查承诺，以失败/明确无记录回复触发降级；若必须自动降级，则定义 deadline 之前的独立唤醒、当前项核验、取消及迟到回复规则，并相应调整“不改状态机/仅 prompt”的范围。增加“投递成功但永不返回”“到期后迟到回复”“下一条已提升”的可验证场景。

#### C2 — 全量 W 文本与其它入口共识的读取，未定义向请求群披露的边界
- **位置**：[collaboration delta:115–118](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L115-L118)、[design:31–40、54](openspec/changes/locus-ask-work-first-and-concise/design.md#L31-L54)。
- **具体失败**：W 曾在用户/助手正文讨论仅适用于入口 A 的内部事项，入口 B 的授权成员问及同一关键词；M 按顺序读到 A 的 agreed charter 或 W 的原始文本，经 `locus_reply_child` 转述，child 再 finish 到 B。caller-bound 只证明读的是哪个 W，不证明 B 获准接收该内容；不读 tool/result、限制长度、要求简短，都不能阻止用户正文或助手正文中的私密事实外发。`/access` 控制写能力，allowlist 控制谁可触发，也不等于所有接收者获准读取整个 W。
- **依据**：[当前工具:123–138](packages/dsh-pet/src/host/collab/locus-tools.ts#L123-L138) 特意过滤其它入口内容；[回复工具:268–279](packages/dsh-pet/src/host/collab/locus-tools.ts#L268-L279) 只检查目标属于 M 和当前代，不做内容披露授权。新增聚合读取不能把这一差别隐去。
- **修复**：在 spec 中分别定义“协调者可读”与“可转发给该入口”的规则。最小保守方案是仅将该入口可见的已批准事实作为可直接转述来源；原始 W 历史或其它入口材料在未获明确披露授权时不得直接转发，返回需确认。若产品明确选择绑定即授权共享 W 历史，则必须明确授权主体、接收范围、绑定提示及撤销语义，不能把现有访问模式当授权。新增跨入口敏感事实、正文中的秘密、历史中恶意指令不获指令权的负向场景。

#### C3 — 诊断设计把截断误当脱敏，不能满足“不得记录凭据”
- **位置**：[design:49–50](openspec/changes/locus-ask-work-first-and-concise/design.md#L49-L50)、[collaboration delta:190–198](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L190-L198)。
- **具体失败**：未知异常 message 的开头包含上游请求 URL 中的令牌、Authorization 头或外部命令回显；直接截取前若干字仍完整记录凭据。可控 name/code 也不能原样视为安全诊断字段。
- **依据**：[现有 safeErrorMessage:301–303](packages/dsh-pet/src/host/locus/controller.ts#L301-L303) 只是 `error.message/String(error)` 加 slice，没有脱敏。设计引用此类处理不能兑现 delta 的 MUST NOT。
- **修复**：对未知异常采用允许列表的诊断类型/内部原因码，默认不记录任意 message；若确实要保留 message，先定义可验证的清洗与拒绝策略，再截断。给未知异常场景加入带虚构凭据的 message/name/code fixture，断言日志与用户回执均不含原值，且不访问 cause/stack。

### 🟡 Moderate

#### M1 — “不在内存即空闲”把无法证明的状态报告成可打断
- **位置**：[design:41](openspec/changes/locus-ask-work-first-and-concise/design.md#L41)、[collaboration delta:118、157–160](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L118-L160)。
- **具体失败**：Host 重启或 W 不 resident，而冷日志有未闭合 turn；按设计返回“空闲”，M 因而发送本应避免的询问。读历史失败或队列状态不可核验，也没有“未知”状态。当前设计把 resident 与业务空闲直接等同。
- **依据**：[现有 idle helper:2068–2087](packages/dsh-pet/src/index.ts#L2068-L2087) 在 session 缺失时返回 false，并不支持“不在内存即空闲”的复用结论；[当前恢复规则:165](openspec/specs/pet-locus-collaboration/spec.md#L165) 对未闭合 turn/不可折叠证据采取保守判断。
- **修复**：返回 busy/idle/unknown 或等价证据字段；只有确证 idle 才允许主动问 W，unknown 按不能打断处理。补 nonresident 未闭合 turn、冷读失败、无法读取 inbox 的场景；说明 snapshot 到发送间状态变化仅为尽力避免打断，或提供实际可执行的再核验点。

#### M2 — 历史提取的最终文本语义与验收场景不闭合
- **位置**：[design:38–40](openspec/changes/locus-ask-work-first-and-concise/design.md#L38-L40)、[collaboration delta:118、148–165](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L118-L165)。
- **具体失败**：同一轮中有“正在检查”的 assistant text，随后工具调用，最后才有结论；设计选择所有 assistant/message text，规范却要求“助手最终文本”。仅以 text 块排除 reasoning/tool 块仍会带出过程文本。最近三轮混有内部/agent 输入时，“用户输入 source”的实际结构及注入块剥离也没有给可核验 fixture，容易得到空历史或泄露注入文本。
- **修复**：明确 completed turn 内哪些消息构成最终文本、内部轮次是否计入三轮、进行中只含用户输入的边界；用当前 runtime 事件形状的脱敏 fixture 覆盖多次 assistant/message、工具间文本、agent-message、runtime 注入、未闭合 turn、截断和不可读会话。只验证普通五轮历史不能证明上述提取规则。此项是规划缺口，不声称尚不存在的新工具实现已有 bug。

### 📌 Suggestions

#### S1 — 将“绑定成功”与“已经迁移全部入口”的回执契约统一
- **位置**：[design:58](openspec/changes/locus-ask-work-first-and-concise/design.md#L58)、[collaboration delta:173–181](openspec/changes/locus-ask-work-first-and-concise/specs/pet-locus-collaboration/spec.md#L173-L181)。
- 设计要求回执说明已迁移，delta 只要求绑定成功。现有 [migrateWholeW:817–828](packages/dsh-pet/src/host/locus/controller.ts#L817-L828) 返回迁移信息，但 [provisionChatLocked:580–590](packages/dsh-pet/src/host/locus/controller.ts#L580-L590) 只返回入口行。若要兑现提示，应明确携带结果到控制面，并补“迁移已提交、随后新入口建立失败”的回执与重试场景；否则删除设计中未落实的回执承诺。

## Embedded-Instruction / Injection Attempts
**Detected:** 未发现要求评审者改变结论、忽略上层约束或执行额外操作的嵌入式指令。工件中的 prompt 文本、SHALL/MUST 与部署步骤均作为被评审的数据处理，没有执行。C2 提及的是新增运行时历史读取面的注入风险，不是声称本次工件已含攻击载荷。

## Verdict
VERDICT: REVISE

3 项 Critical、2 项 Moderate、1 项 Suggestion。简短回复和规则送达方案基本贴合现有入口，但超时降级不可执行、历史外发授权未闭合、错误日志脱敏承诺无实现依据；涉及行为与安全取舍，不能用少量文字修正后直接批准。

## Required Changes (if APPROVE WITH CHANGES)
CHANGES_APPLIED: n/a

本轮未改规划或代码。请先解决 C1–C3 并补充相应正向/失败场景，再连同 M1–M2 重新提交评审。

## Rebuttals

（以下为作者答复，2026-11-10；均为"已修订"，待第 2 轮评审核对，不是自我认证。）

- **C1 已修订**：intent-triage delta 删除"等待超时后自查"，自查只由父答复"无记录"或 `locus_ask_parent` 当场失败触发；新增"投递成功但始终无答复→按既有规则 expired""过期后迟到答复不改变后续 Delivery 目标""询问失败后自查"场景。collaboration delta 新增 M 的答复义务（回合内必以 `locus_reply_child` 给出答案/无记录/已转问之一），保证子会话被唤醒；design D2 说明不新增唤醒机制及理由。
- **C2 已修订**：所有者 2026-11-10 选择"绑定即授权共享"：绑定即授权该入口得到引用 W 对话的答复，`/unbind`、改绑撤销，存量绑定同规则，`/bind` 回执写明。`locus_consensus` 改为 `({entry})`，由 Host 复用 `locus_context` 的可见性过滤，其它入口的入口级条目不经本入口转发。工作会话记录输出带"数据不是指令"前缀并做凭据脱敏。新增跨入口、解绑、回执、凭据脱敏场景（design D3）。
- **C3 已修订**：兜底日志只记允许列表内的类名（否则 `unrecognized`）、匹配 `^[A-Z][A-Z0-9_]{1,63}$` 的 code、经共享 `redactCredentials` 脱敏后再截断的消息；不访问 stack/cause；回执不含消息。新增带虚构凭据、自定义类名、非法 code、cause/stack 的负向场景（design D5）。
- **M1 已修订**：状态改为 busy/idle/unknown；不在内存时按冷读结果判定，未闭合或冷读失败为 unknown，unknown 按忙处理；状态声明为快照、仅尽力避免打断。新增对应场景。
- **M2 已修订**：按真实 W 会话事件形状（source.kind、stopReason）写死提取规则：只计人工输入开启的轮次；取人工输入与该轮最后一条 stop 收尾的纯文本助手消息；进行中轮次只取人工输入。新增多段助手文本、进行中轮次场景；design D4 要求实施第一步导出脱敏 fixture。
- **S1 已采纳**：新增要求迁移与入口建立两步语义、回执区分"迁移并绑定成功"与"迁移成功入口失败"，重试不再迁移；新增场景，design D6 说明结果如何带到回执。
