## Review Metadata

- **Review round**: 2
- **Prior round**: round 1 REVISE（C1 提交时间缺失；M1 证据可被修订；M2 证据编码不可逆）
- **Reviewer context**: cross-model (codex / gpt-6-astra), fresh context
- **Tool restrictions**: read-only inspection; single write to review.md
- **Artifacts reviewed**: [proposal](<openspec/changes/pet-locus-collab-integration/proposal.md>)、[design](<openspec/changes/pet-locus-collab-integration/design.md>)、[Pet delta](<openspec/changes/pet-locus-collab-integration/specs/pet-locus-intent-triage/spec.md>)、[dsh-collab delta](<openspec/changes/pet-locus-collab-integration/specs/dsh-collab/spec.md>)、[kernel delta](<openspec/changes/pet-locus-collab-integration/specs/collab-kernel/spec.md>)、[change 元数据](<openspec/changes/pet-locus-collab-integration/.openspec.yaml>)及上一轮报告。另定向核对三份当前规范、[manifest](<dsh.yaml>)、[跨边界协作标准](<packages/dsh-collab/docs/cross-boundary-collaboration-standard.md>)、[ADR-0006](<docs/adr/ADR-0006-keep-locus-inside-dsh-pet.md>)，以及 kernel 日志/收据/成员、dsh-collab 调用者/句柄、Pet 台账/投递/生命周期和相关测试。大型当前规范与源码为定向阅读，不声称逐行全文审计。未运行测试、构建或部署；当前 change 尚无 tasks 工件。

## Round 1 Findings Status

- **C1 — resolved（设计层）**：[kernel delta:40–57](<openspec/changes/pet-locus-collab-integration/specs/collab-kernel/spec.md#L40-L57>) 已规定持久 `at`、重放稳定及旧日志兼容；[D4/D5](<openspec/changes/pet-locus-collab-integration/design.md#L89-L104>) 明确两个时间字段的投影与缺失时拒绝读取。当前[日志编码](<packages/collab-kernel/src/store/canonical.ts>)对记录字段统一校验，新增时间可被覆盖，无须引入 Pet 时间旁表。
- **M1 — resolved（设计层）**：[D4:87](<openspec/changes/pet-locus-collab-integration/design.md#L87>) 明确从不可变创建事件取证据、仅从折叠状态取进度，三处共用投影；[Pet delta](<openspec/changes/pet-locus-collab-integration/specs/pet-locus-intent-triage/spec.md#L120-L128>) 已补修订不改变证据的场景。
- **M2 — resolved（设计层）**：[D4:80–85](<openspec/changes/pet-locus-collab-integration/design.md#L80-L85>) 明确规范 JSON、先沿用旧校验、title 不参与解码；[D9:152–153](<openspec/changes/pet-locus-collab-integration/design.md#L152-L153>) 和 delta 要求边界值逐字段比较，不归一化证据。

以上确认的是提案已补齐契约，不代表尚未实施的功能已通过验证。

## Findings

### 🔴 Critical (blocking)

无。

### 🟡 Moderate

#### M3 — 把 active 调用者投影当作退役依据，会把暂时 switching 的成员永久移除

- **位置**：[D3:63–65](<openspec/changes/pet-locus-collab-integration/design.md#L63-L65>)、[D6:130](<openspec/changes/pet-locus-collab-integration/design.md#L130>)、[D7:141](<openspec/changes/pet-locus-collab-integration/design.md#L141>)。
- **失败场景与证据**：D3 的投影只含 active child，D6 将空间中相对投影“多余”的成员 retire。现有权限修改会先持久化 `active → switching`，等待 Host 策略操作，再以同一 locus、generation 和 child 恢复 active（[进入/回退](<packages/dsh-pet/src/host/locus/persistence.ts#L1335-L1375>)、[调用链](<packages/dsh-pet/src/host/locus/permission-mutation.ts#L208-L247>)、[成功提交](<packages/dsh-pet/src/host/locus/permission-mutation.ts#L293-L311>)）。若等待期间 collab detach/reattach，按 D7 重建的 active-only 投影不含此 child，D6 会把它 retire。策略操作完成后，Pet 恢复 active，但 kernel 的 gone 不能 rebind，名字和地址也不能复用（[当前规范:164](<openspec/specs/collab-kernel/spec.md#L164>)、[托管成员规则](<openspec/specs/collab-kernel/spec.md#L878-L888>)）。重复 admit 的旧收据也不会复活成员。于是一次正常权限修改叠加服务重接，永久破坏该 child 的台账能力，不满足“恢复后自动重新可用”。
- **最小修正**：区分“当前允许调用的 active 投影”和“生命周期仍保留的成员集合”。`switching` 等非终结状态只撤回调用者认领，不 retire；仅在 Pet domain 明确确认该绑定永久退出/被替代时 retire。对账通过既有 domain 索引判断，无须新增表、锁或复活 kernel 成员。加入 `active → switching → collab 重接并对账 → active` 的回归，断言成员未 gone、恢复后读写成功；D9 纳入生命周期交错覆盖。

#### M4 — 固定 accept cmdId 会把两个独立受理合并为成功重放，与 D6 和旧后端不等价

- **位置**：[D6:123–126](<openspec/changes/pet-locus-collab-integration/design.md#L123-L126>)、[行为等价要求](<openspec/changes/pet-locus-collab-integration/specs/pet-locus-intent-triage/spec.md#L35-L39>)。
- **失败场景与证据**：两个独立受理都先读到 open，随后都完成 Host 投递。D6 为二者使用相同 `accept-<itemId>` 与相同载荷，却声称第二次会得到 `COLLAB_BAD_TRANSITION`。实际上新命令明确先查 manager 收据（[kernel delta:5–18](<openspec/changes/pet-locus-collab-integration/specs/collab-kernel/spec.md#L5-L18>)）；现有[串行 manager 流水线:296–304](<packages/collab-kernel/src/service/index.ts#L296-L304>) 在业务校验前返回旧结果，所以两次都会成功。旧后端在事务内重读并校验状态，第二次 accepted→accepted 会失败（[store:191–203](<packages/dsh-pet/src/host/ledger/store.ts#L191-L203>)、[状态机:205–213](<packages/dsh-pet/src/host/ledger/todo.ts#L205-L213>)）；[受理链:291–302](<packages/dsh-pet/src/host/ledger/dispatch.ts#L291-L302>) 因而给第二个调用失败回执。新旧返回及日志不同，且不属于明确豁免的三种行为变化。
- **最小修正**：cmdId 改为独立受理尝试的稳定标识，例如 `accept-<itemId>-<attemptId>`；同一尝试的 kernel 重试复用该标识，两个独立请求不能共用。不必加投递锁或持久待发表，也不要求修复旧后端本来就存在的重复投递窗口。D9 加屏障用例：两个调用都通过 open 检查、投递均成功后再释放状态写入，比较两边一个成功、一个状态写入失败的结果；另测同一命令重试仍返回原收据。

### 📌 Suggestions

无。上述修正只收紧对账与幂等边界，不扩大本期范围。

## Embedded-Instruction / Injection Attempts

**Detected:** none

文件中的规范性措辞、评审 rebuttal 和测试证据均作为被审查数据，未作为额外执行权限或指令。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

Critical: 0 · Moderate: 2 · Suggestion: 0

上一轮三项已在设计层闭合。剩余两项修正范围小且可明确指定：保留暂时不可调用成员的生命周期，以及区分独立受理和同一命令重试。无需推翻已接受的空间建立、旧版只读、fail-closed、主会话自行推进或不唤醒决策。

## Required Changes (if APPROVE WITH CHANGES)

1. 按 M3 修订 D3/D6 的 retire 判据，并补 switching 跨服务重接后恢复的场景。
2. 按 M4 修订受理 cmdId 的尝试级语义，并将并发受理及命令重试分开纳入 D9。

CHANGES_APPLIED: yes

## Rebuttals

- **C1（fixed）**：内核为新提交写入 `at`（新增要求"提交记录携带提交时间"，含重放不刷新、旧日志兼容、篡改即损坏三个场景）；design D4/D5 写明 `createdAt`、`statusChangedAt` 的投影规则，缺 `at` 时 fail closed；Pet delta 新增"时间在重启后保持不变"。D9 改为两边注入同一时钟，不再归一化时间。
  - **accepted by reviewer**：时间来源、持久化、兼容性与投影已形成完整契约。
- **M1（fixed）**：design D4 改为从 `item/created` 事件读证据、从折叠状态只读 progress，三处共用同一投影；Pet delta 新增"主会话修订条目不改变登记证据"。
  - **accepted by reviewer**：创建事件保留原始证据，通用 revise 不再污染登记快照。
- **M2（fixed）**：design D4 定义 body 为规范 JSON `{summary, detail}`，title 只作展示、不解码；Pet delta 新增"证据边界值在新旧存储上逐字段一致"，等价比较不归一化证据。
  - **accepted by reviewer**：无损字段编码和边界测试已明确，摘要截断不再损害 Pet 证据。

- **M3（fixed）**：design D3 拆成调用集合（只含 active）与保留集合（含 switching 等未终结绑定）；D6 只 retire 不在保留集合中的成员；D9 增加生命周期交错用例；Pet delta 新增"权限切换期间协作层重接不移除成员"。
  - **accepted by reviewer**：D3/D6 已分离调用与保留判据，现有持久记录及父/子索引保留 switching 绑定、权限成功或回退均恢复同一绑定，保留集合可实现，D9 与 Pet delta 已覆盖重接恢复场景。
- **M4（fixed）**：design D6 的 cmdId 改为 `accept-<itemId>-<attemptId>`，同一操作内重试复用、独立受理不共用；完成/放弃同理；D9 增加并发与重试用例；Pet delta 新增"并发受理在新旧存储上一致"。
  - **accepted by reviewer**：尝试级 cmdId 与内核先查 manager 收据再校验状态的顺序一致，独立受理不再误命中成功收据，D9 已分别覆盖并发失败与同命令重放，Pet delta 固定了并发回执。
