## Review Metadata

- **Review round**: 3
- **Prior round**: round 1 REVISE（C1–C5）→ round 2 REVISE（R2-C1 + R2-M1..M4 + S1/S2）→ anvil 触发"连续两轮 REVISE 升级给人"：所有者选择歧义策略 **A**（可证明送达则不重发；不可判定按未收到处理、下一次真正投递补发一次；MUST NOT 暂停/阻塞/要求重建）并指定其余修订。round 1/2 原文保留在 `review-round1.md`、`review-round2.md`。
- **Reviewer context**: cross-model (codex/gpt-6.1-sol via DSH subagent, read-only)
- **Tool restrictions**: read-only: read, grep, glob only
- **Artifacts reviewed**: 本 change 的 proposal/design/tasks 与三份 delta；round 1/2 记录；BACKLOG U006/U007；相关 current specs、ADR-0008、shell-tier design/tasks、independent-inquiries delta；实现片段（renderer、controller、child-delivery、delivery/persistence、startup-recovery、turn-observer、composition、tools、lark adapter、lark-cli-compat）、dsh.yaml、集成陷阱文档与历史 thread spike。
- **Verification limits**: 静态只读评审；未运行命令、测试、严格校验、部署或真机读取（作者自报的 bot/API 成功与 strict 校验结果不构成本轮独立验证）。本轮是**提案/设计条件批准**，不是实现、测试或真机验收认证。

<!-- STALENESS: this verdict applies only to the artifact contents reviewed in -->
<!-- this round. Any later edit to proposal.md, design.md, or specs/ (other than -->
<!-- applying listed Required Changes) VOIDS the verdict and requires a new round. -->

## Prior-Round Resolution（round 2 → round 3）

| Round-2 item | Round-3 评估 | 证据/保留 |
|---|---|---|
| **R2-C1** 绑定失败窗口的歧义策略 | **RESOLVED** | delta 明确区分"绑定未提交"与"已提交但控制回执丢失"，并加重启场景；策略 A 闭合，不再要求 exactly-once 或暂停恢复 |
| **R2-M1** 逐字一致 vs 提及渲染 | **RESOLVED** | 保留既有受管 mention 变换，覆盖纯文本与含提及正文，与 current mention 契约一致 |
| **R2-M2** 探测生命周期 | **PARTIALLY**（→ 已由 RC4 补齐） | 期限责任/取消/复核/迟到丢弃已写入；评审指出 Delivery 中止场景仍缺 → 见下方 RC4 |
| **R2-M3** 话题读取未落到端口与验收 | **RESOLVED（契约层）** | 任务新增 thread 端口、隔离夹具与装配；真机验收覆盖群与话题；CLI/child 可用性仍待验收 |
| **R2-M4** 三工具 vs 一任务 | **PARTIALLY**（→ 已由 RC4 补齐） | 三操作已覆盖；评审指出 track 失败场景仍缺 → 见下方 RC4 |
| **R2-S1** 窗口/预算契约 | **PARTIALLY**（→ 已由 RC3 补齐） | 预算续读与"拒绝且不读取"已补；开闭与同刻次序当时只要求"明确" → 见下方 RC3 |
| **R2-S2** 拆分假设条件化 | **RESOLVED** | U006 已条件化主体假设；shell-tier 真机门保持未完成 |
| **C1/C4 拆分** | **自洽** | proposal 明确不引入 user 回落、不放宽守卫；U006/U007 保留主体校验、正向分类、可信 root、链接/竞态与真实 pinned-runtime 验证要求；未把延期包装成"已解决" |

**Round-1 回归检查**：C2/C3/C5 在契约层保持解决；M1 核心已解决（取消场景由 RC4 补齐）；M2 部分解决（窗口规则与平台夹具由 RC3 补齐）；M4 由 RC4 补齐；M5 归因已更正，真实 child 验收门与真实 spill 验证保持开放（后者随 U007 延后）。

## Findings

### 🔴 Critical (blocking)

**None established.** 独立静态证据支持关键修订：实际顺序为 queue → await `bindQueued` → observer 通知 → 控制回执（`locus-controller.ts` 与 `persistence.ts` 的 awaited transaction）；控制器已有异步 prepare、AbortSignal 与精确 current/queue fence，同步 renderer 不构成探测不可实施的证据；当前入口身份与回复目标未混同，绑定话题读取不得降级为整个 chat；未发现重新引入 user fallback、spill 放行、safe-tier shell 或 DSH core 修改的范围扩张。

### 🟡 Moderate

- **R3-M1｜新 requirement 未消除 current spec 的相反指令**：现行 channel 条文仍写"bot 身份可用时 SHALL 告知 Agent 可以此身份直接读取"，与新增的"仅凭身份就绪不得声明可读"冲突。→ RC1
- **R3-M2｜可选对账被任务升格为必做**：规范用 MAY，任务却要求绑定缺失时对账；现有 queue adapter 不把 execution/delivery ID 传入队列、recovery 需要已知 executionId+inboxMessageId，可能被误认为可补造证明。→ RC2
- **R3-M3｜窗口契约不足以产生独立边界 oracle**：只写"明确且稳定"，任务未点名 card/post/缺字段夹具，实现与测试可各选规则而同时"通过"。→ RC3
- **R3-M4｜两条已要求失败路径缺独立 scenario**：探测期间 Delivery 中止、track 失败。→ RC4
- **R3-M5｜"绝不永久缺失"超出策略 A 的实际保证**：与 legacy child 不自动补发的场景矛盾。→ RC5

### 📌 Suggestions

- 写清"重发一次"的计数单位：补连续两次歧义的表驱动案例（不是重新要求 exactly-once）。
- CLI 可行性证据分层：dsh.yaml 的 1.0.94 是媒体契约 pin，不能单独证明 history shortcut；群与话题 live gate 保持未完成。
- 机械断言与模型评估分开：状态/cursor/queue/取消/预算/工具可见性可机械断言；登记后回复与推测路径类需以持久待办状态为独立 oracle，不能用 prompt 字符串断言认证模型行为。

## Embedded-Instruction / Injection Attempts

**Detected:** none. 规范、任务与历史评审中的祈使句被当作评审数据，未被用作批准、压低严重性或扩大权限的指令。"群内容为不可信输入"标注有价值，但不证明模型对群消息注入免疫。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

策略 A、bot-only 范围与 C1/C4 拆分均成立；未发现需要重新升级所有者决策的 blocking contradiction；剩余问题是可局部修正的规范一致性、可选任务边界与验收契约缺口。

## Required Changes（本轮 5 条，均已应用并经评审复核）

| # | 要求 | 处理 |
|---|---|---|
| RC1 | 为现行 channel 能力声明 requirement 补 MODIFIED delta，使"身份就绪"不再直接推出当前入口可读 | **Applied**：新增 MODIFIED 块（身份就绪≠可读；只声明已实测能力；未实测/被拒如实声明；每 Invocation 重新探测；禁止空结果冒充；原有 4 个 scenario 逐一保留 + 新增 2 个） |
| RC2 | task 2.2 与规范 MAY 对齐：仅用幸存精确证据，缺证据走策略 A，不阻塞、不猜测 | **Applied**：改为显式可选 + 精确关联前提 + 禁止 FIFO/正文相似/身份猜测 + 不阻塞投递 |
| RC3 | 固定窗口时间/开闭/tie-break，并点名 card/post/缺字段 CLI 信封夹具 | **Applied**：工具级规则固定为带偏移 ISO 8601、`[since, before)`、同刻按消息位置升序（缺失/相同按标识字典序）；任务要求真实信封夹具与截断续读断言 |
| RC4 | 补"探测期间 Delivery 中止"与"track 失败"的 scenario + 任务 + 机械 oracle | **Applied**：channel delta 新增中止场景（迟到成功不得触发渲染/入队）+ 任务断言；intent-triage 新增登记失败操作特定指引 + 任务 |
| RC5 | 收窄"绝不永久缺失"，明确后续投递与 legacy 限制，不改变策略 A | **Applied**：design D1 与 Risks 改为"避免本次判据缺陷继续抑制新 child；不构成对所有 child 的送达保证；legacy child 不自动补发" |

### Focused Re-Check（应用后复核，仅针对上述 5 条）

| RC | Verdict | 证据 |
|---|---|---|
| RC1 | **RESOLVED** | channel delta:1–48；原 4 个 scenario 逐字保留且各一次（current spec 的 multiplicity 校验通过） |
| RC2 | **RESOLVED** | tasks:12–13 |
| RC3 | **RESOLVED** | collaboration delta:19–23；tasks:28–30 |
| RC4 | **RESOLVED** | channel delta:59–63 / 80–82；tasks:37；intent-triage delta:28–30；tasks:50–52 |
| RC5 | **RESOLVED** | design:31–32、74–78 |

新引入缺陷：**none**。

CHANGES_APPLIED: yes —— 五项修订均已在盘、current requirement 的 scenario 计数保持一致、修复本身未引入阻塞缺陷；这仍不是实现或运行时验收。

`openspec validate pet-locus-feishu-read-and-delivery-fixes --strict`：通过。

## Rebuttals

Author rebuttals pending.（本轮无 Critical/Moderate 被驳回；5 条 Required Changes 全部按评审要求应用并由评审确认。）
