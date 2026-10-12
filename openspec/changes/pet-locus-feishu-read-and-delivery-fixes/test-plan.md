## Test Plan

每个 `#### Scenario:`（共 42 条，分布在三份 delta）都映射到至少一个具名测试。映射是**下限不是上限**：允许并鼓励额外的参数化/回归用例，但不需要在此登记。

运行方式：`cd packages/dsh-pet && npm test -- <文件>`（vitest）。路径相对 `packages/dsh-pet/`。

状态图例：

- 🔴 red：新增或改写的测试；**实施前必须先失败**，实施后通过。
- 🟡 pin：为既有（未改动）行为新增的钉子测试，预期首次即通过，用于防回归。
- 🟢 existing：该 scenario 未变化且已有测试守护；保持绿色，必要时改名以携带 scenario 名。

### pet-lark-channel（delta：specs/pet-lark-channel/spec.md）

| Requirement | Scenario | Test File | Test Name | Initial State |
|---|---|---|---|---|
| 会话内容由 Agent 自取而非预先注入 | 触发消息含富文本或转发内容 | `test/channel-context.test.ts` | `prompt omits flattened history for rich triggers` | 🟢 existing |
| 会话内容由 Agent 自取而非预先注入 | 触发者显示名随身份一并注入 | `test/channel-context.test.ts` | `sender display name from history is injected together with the open id` | 🟢 existing |
| 会话内容由 Agent 自取而非预先注入 | 成员列表不可读时只呈现 open_id 且不阻断 | `test/channel-context.test.ts` | `member lookup failure injects the open id only and never blocks delivery` | 🟢 existing |
| 会话内容由 Agent 自取而非预先注入 | bot 身份不可用时不虚报能力 | `test/channel-lark.test.ts` | `unavailable bot identity is declared and never advertised as readable` | 🟢 existing |
| 会话内容由 Agent 自取而非预先注入 | bot 身份就绪但当前入口历史不可读 | `test/channel-context.test.ts`、`test/entrance-capability.test.ts` | `states the limit and drops the read invitation when the entrance read failed`；`reports unreadable when the probe answers false` | 🟢 green |
| 会话内容由 Agent 自取而非预先注入 | 身份就绪不改变既有注入约束 | `test/channel-context.test.ts`、`test/channel-pipeline.test.ts` | `declares readability only in the readable state`；`measures this exact entrance once, before rendering, and declares success` | 🟢 green |
| 对外声明的飞书群读取能力按实测判定且不虚报 | 具备群读取能力时如实声明 | `test/channel-lark.test.ts`、`test/channel-pipeline.test.ts` | `takes one minimal real read of the exact group and returns only success`；`measures this exact entrance once, before rendering, and declares success` | 🟢 green |
| 对外声明的飞书群读取能力按实测判定且不虚报 | 不具备群读取能力时如实声明 | `test/channel-lark.test.ts`、`test/channel-pipeline.test.ts` | `reports not-readable when the probe read fails, without throwing`；`declares the limit, not a capability, when the probe is refused` | 🟢 green |
| 对外声明的飞书群读取能力按实测判定且不虚报 | 探测期间入口被重建或禁用 | `test/locus-settlement-integration.test.ts`、`test/client.test.ts` | `refuses the delivery when the renderer revalidation fails, as a rebuild mid-measurement makes it`；`measures this entrance before the prompt may claim it is readable` | 🟢 green |
| 对外声明的飞书群读取能力按实测判定且不虚报 | 探测期间投递被中止 | `test/entrance-capability.test.ts`、`test/locus-settlement-integration.test.ts` | `discards the measurement when the delivery is aborted first`；`does not even start a probe for an already-aborted delivery`；`refuses the delivery when the current is retired during the awaited render` | 🟢 green |
| 对外声明的飞书群读取能力按实测判定且不虚报 | 超时后的迟到结果不被采用 | `test/entrance-capability.test.ts` | `degrades a probe that exceeds the bounded deadline to unconfirmed`；`never adopts a late success once the deadline has expired`；`tolerates a late rejection without an unhandled rejection` | 🟢 green |
| 对外声明的飞书群读取能力按实测判定且不虚报 | 探测结论不被过期缓存替代 | `test/entrance-capability.test.ts`、`test/channel-pipeline.test.ts` | `measures again on every call instead of reusing the previous verdict`；`re-measures on every admission instead of reusing the previous verdict` | 🟢 green |
| 对外声明的飞书群读取能力按实测判定且不虚报 | 探测不污染持久层 | `test/channel-lark.test.ts`、`test/entrance-capability.test.ts` | `takes one minimal real read of the exact group and returns only success`（返回布尔、不返回正文）；`escapes as a bare verdict, never as the content it read` | 🟢 green |

### pet-locus-collaboration（delta：specs/pet-locus-collaboration/spec.md）

| Requirement | Scenario | Test File | Test Name | Initial State |
|---|---|---|---|---|
| Locus child 具备 caller-bound 的当前入口群只读能力 | safe 档 child 读取当前入口群 | `test/locus-chat-history-tool.test.ts` | `reads the bound group with bot identity and the untrusted-input label` | 🟢 green |
| 同上 | 话题入口读取自己绑定的话题 | `test/locus-chat-history-tool.test.ts`、`test/channel-lark.test.ts` | `reads the bound topic when the entrance is a topic, never the whole group`；`reads a topic entrance through the thread shortcut instead of the group` | 🟢 green |
| 同上 | 指定其它目标或未知参数时拒绝且不读取 | `test/locus-chat-history-tool.test.ts` | `rejects unknown arguments without reading anything` | 🟢 green |
| 同上 | 游标被篡改或跨域使用 | `test/locus-chat-history-tool.test.ts`、`test/locus-history-cursor.test.ts` | `rejects a forged cursor without reading anything`；`rejects a cursor issued for another locus generation or entrance`；`rejects a mutated body`；`rejects a cursor signed by a different Host process` | 🟢 green |
| 同上 | 等待期间入口或代际变化 | `test/locus-chat-history-tool.test.ts` | `discards the answer when the caller association changes during the read` | 🟢 green |
| 同上 | 截断可识别且可继续 | `test/locus-chat-history-tool.test.ts` | `bounds the result, marks truncation and hands out a continuation cursor` | 🟢 green |
| 同上 | 窗口边界不重不漏 | `test/locus-chat-history-tool.test.ts` | `applies the half-open window and a deterministic order` | 🟢 green |
| 同上 | 失败与空结果可区分 | `test/locus-chat-history-tool.test.ts`、`test/channel-lark.test.ts` | `distinguishes a failed read from an empty window`；`returns undefined when the read fails instead of an empty page` | 🟢 green |
| 投递 prompt 的首投前言与逐次档位声明 | 首次投递收到完整前言 | `test/locus-delivery-prompt.test.ts`、`test/locus-preamble-durability.test.ts` | `renders the full preamble with the record facts on a first delivery`；`gives the first accepted Delivery the full preamble before any binding exists` | 🟢 green |
| 同上 | 渲染成功但未入队不消耗首投 | `test/locus-preamble-durability.test.ts` | `keeps the full preamble while the previous Delivery never bound` | 🟢 green |
| 同上 | backlog 中已有其它已接受投递 | `test/locus-preamble-durability.test.ts` | `does not let an accepted-but-unbound backlog row consume the preamble` | 🟢 green |
| 同上 | 队列已接受但持久绑定失败 | `test/locus-preamble-durability.test.ts` | `keeps the full preamble while the previous Delivery never bound`（下一次真正投递补发一次，且不暂停） | 🟢 green |
| 同上 | 绑定已提交但控制回执丢失 | `test/locus-preamble-durability.test.ts` | `switches to the compact follow-up once a prior Delivery is bound`（持久绑定即送达证据） | 🟢 green |
| 同上 | 第二次投递不重复前言但声明档位 | `test/locus-context.test.ts`、`test/locus-preamble-durability.test.ts` | `states the safe tier and its limit on a follow-up`；`switches to the compact follow-up once a prior Delivery is bound` | 🟢 green |
| 同上 | 重启后按送达证据决定 | `test/locus-preamble-durability.test.ts` | `decides from durable proof after a restart, not from runtime state` | 🟢 green |
| 同上 | 受既有缺陷影响的 child | `test/locus-preamble-durability.test.ts` | `switches to the compact follow-up once a prior Delivery is bound`（不自动补发；档位行由续投声明保证） | 🟢 green |
| 读取守卫的拒绝可诊断且不额外放行 | 工作区外读取被拒且原因稳定 | `test/locus-project-read-guard.test.ts` | `denial carries the allowed root and how to request more paths`（原因码仍在首行）+ `allows workspace reads/globs and rejects DSH, media cache, missing paths, and symlink escapes before bodies run` | 🟢 green |
| 同上 | 指引可执行 | `test/locus-project-read-guard.test.ts` | `denial carries the allowed root and how to request more paths` | 🟢 green |
| 同上 | Host 出站不附加诊断 | `test/channel-lark.test.ts` | `appends no diagnostics or paths to a plain-text body` | 🟢 green |
| 同上 | 含提及的正文只做既有受管变换 | `test/channel-mentions.test.ts`、`test/channel-lark.test.ts` | `renders a whole-word display name into a real mention`；`renders a plain @display-name into a real mention before sending` | 🟢 green |
| 同上 | prompt 不指示模型转述诊断 | `test/locus-context.test.ts` | `never instructs the model to quote guard diagnostics into the reply body` | 🟢 green |
| 未装配的 caller-bound 能力不得以可见但必然失败的形式暴露 | 能力未装配时不可见 | `test/locus-surface.test.ts` | `unassembled collaboration context tool is not exposed to the child` | 🔴 red |
| 同上 | 装配后可用 | `test/locus-surface.test.ts` | `assembled capability registers and serves an authorized caller` | 🔴 red |
| 同上 | 冷恢复后判定一致 | `test/locus-surface.test.ts` | `cold restore keeps the same capability visibility decision` | 🔴 red |

### pet-locus-intent-triage（delta：specs/pet-locus-intent-triage/spec.md）

| Requirement | Scenario | Test File | Test Name | Initial State |
|---|---|---|---|---|
| 待办登记后的回复如实且待办工具失败反馈可执行 | 登记后回复与待办状态一致 | `test/ledger-prompt.test.ts` | `todo reply guidance matches the durable todo status` | 🔴 red |
| 同上 | 未确认路径不作为事实 | `test/ledger-prompt.test.ts` | `unconfirmed path is presented as a guess and asks for confirmation` | 🔴 red |
| 同上 | 台账不可用与台账为空可区分 | `test/ledger-read.test.ts` | `ledger dependency failure is not rendered as an empty ledger` | 🔴 red |
| 同上 | 登记失败给出操作特定指引 | `test/ledger-track.test.ts` | `track failure returns an operation-specific next step without leaking ids` | 🔴 red |
| 同上 | 待办标识不可解析时给出下一步 | `test/ledger-tool-scope.test.ts` | `unresolvable todo id points at the ledger read and enumerates nothing` | 🔴 red |

### 额外测试（下限之上，必须存在但不单独对应 scenario）

| 目的 | Test File | Test Name | Initial State |
|---|---|---|---|
| 白名单/attestation：新工具进入 caller-bound 允许清单，组合仍可证明 | `test/locus-composition.test.ts` | `is listed in the caller-bound tools and attests in safe and shell tiers` | 🟢 green |
| 两档可见性：该工具只在 Host 真的提供读取端口时装配 | `test/ledger-tool-scope.test.ts` | `registers when the Host supplies the bot read port`；`stays invisible when the runtime has no read port` | 🟢 green |
| 话题端口：支持话题/线程的 bot 端口能列出绑定话题消息 | `test/channel-lark.test.ts` | `reads a topic entrance through the thread shortcut instead of the group`（含 group/话题/分页/失败/时间归一化五条） | 🟢 green |
| 旧断言退场：`client.test.ts` 的源码串断言改为接线断言，行为由纯函数测试承载 | `test/client.test.ts` | `wires the durable Deliveries into the pure prompt renderer` | 🟢 green |

### 记录（供 verify 使用）

- **模型相关行**：`登记后回复与待办状态一致`、`未确认路径不作为事实` 的 oracle 是**持久待办状态 + 出站文本**，不是 prompt 字符串匹配；`交付 prompt 不指示转述诊断` 属提示词层断言，需配 `locus-context.test.ts` 的快照。
- **真机门（不在本文件内、不得用单测冒充）**：tasks 7.5（重启后新群 @ 一次、群与话题读取、游标篡改、拒绝文案、能力声明与实测一致）与 `pet-locus-shell-tier` task 1.2（read 档 child 等价沙箱内的真机读取）保持未完成。
- **机械 vs 模型**：状态、游标、queue 顺序、取消、预算、工具可见性均为机械断言；模型行为类只以持久状态与出站文本为独立 oracle。
