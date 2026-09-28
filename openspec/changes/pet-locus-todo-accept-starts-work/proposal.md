## Why

所有者在真机点击待办的「受理」后观察到"没有任何变化"，预期是**开始处理这个问题**，实得只是一次状态标记。这不是缺陷而是既有设计（`pet-locus-intent-triage` 的 D8 与 spec.md:143「状态仅可由所有者经管理面推进」）：三个按钮全是记账动作，所有者预期的"开工"在 UI 上没有任何对应物，需要他自己再点「会话」跳过去、自己复述一遍待办内容。

所有者已明确裁定语义：**「我知道了」不需要一个按钮——看到即知道；只有真开工了才叫受理。** 当前的 `accepted`「已接手但还没做」因此是一个不承载决策的空状态，它把一次点击的成本摊给所有者却不产生任何推进。

## What Changes

- **BREAKING（`accepted` 语义变更）**：「受理」从纯状态标记改为**开工动作**——置 `accepted` 与向主会话投递一条跟进任务属于同一次操作，不提供任何只改状态而不投递的动作。
- **投递成功后才置状态，不做乐观更新**：失败时状态自始至终是 `open`，因此不需要回滚，状态机无需新增 `accepted → open`。唯一残留窗口是"投递成功但写库失败"，表现为可见的重复投递风险而非静默丢失。
- **投递目标经「执行目标解析」得出**，表达"谁登记谁处理、无执行能力则转交"：本期子会话只读，故解析恒为转交主会话。不引入任何目标选择面，所有者与模型都不可指定去向，不可证明时 fail closed。这一层使将来子 agent 具备执行能力（本地 patch / worktree / 云端沙箱）时只需增加解析分支，无需改动受理与投递链路。
- **新增子会话侧「请求执行」工具**：登记待办的子会话可就该待办请求执行，与所有者受理共用同一次解析、同一正文组装、同一投递语义与结局。工具语义是"请求执行"而非"转交主会话"——转交只是本期的解析结果，不进入契约。该工具 MUST NOT 使模型获得改写状态的一般能力：只能就自己登记的待办、且必须伴随一次真实投递才能使其进入 `accepted`，不能标记完成或放弃。
- 投递正文由 Host 组装为一条**带上下文的跟进指令**，至少陈述：这是一条 locus 待办跟进、待办标识、原始请求人与登记时间、来源入口、证据摘要，以及"先读上下文再推进"的行动指引与可用的查证路径。正文由 Host 组装，MUST NOT 由模型或所有者自由撰写。
- **证据置于正文末段且不设结束标记**：证据由子会话依据第三方消息撰写，只出现在正文最后一段，其后无任何 Host 文本，该段无结束定界符——攻击者无法通过伪造"引用结束"让后续文本看起来回到可信区。请求人标识来自平台（`senderOpenId`）而非用户自由撰写，不受此限。该措施是**缓解**：prompt 层无法百分百受控，真正的后果上限由主会话既有权限档位决定，本 change 不改变它；因此规范只对可机械断言的模板结构设验收条件，不对模型行为设。
- 目标会话正忙时**排队**，按 DSH `followup` 的原生语义等其当前轮次自然结束后接上，MUST NOT steer 或打断当前步；目标未加载时先冷恢复再投递。
- **受理返回一次性投递回执**：区分已投递、已排队、不可达（附原因）。该回执不持久化到待办自身，管理面 MUST NOT 从行状态反推是否已投递；`done` / `drop` 不返回该字段。
- 受理仍 MUST NOT 产生任何飞书出站正文、表情或 Delivery——投递是**Host 到主会话的内部跟进**，与飞书入口无关。
- 「完成」「放弃」维持纯记账语义不变；`open → done`、`open → dropped` 的直达路径保留，所有者仍可不开工就直接了结一条待办。
- 模型仍不可把待办推进到终态。原 D8「登记是陈述事实、处置是所有者决定」的分界在此**精确化**为：模型可以把活交出去（就自己登记的待办请求执行，且必须真的投递成功），但不能宣布活干完了（标记完成/放弃仍只属于所有者）。后者才是那条禁令真正要防的"agent 说做完了但没做"。

## Capabilities

### New Capabilities

无。本 change 不引入新能力，只改变既有待办处置动作的语义与副作用。

### Modified Capabilities

- `pet-locus-intent-triage`：「待办生命周期与 Delivery 结算解耦」要求中的状态语义（`accepted` 由标记变为开工，附带向主会话投递）；「管理面呈现待办并提供由固定标识派生的跳转」要求中所有者可执行的动作及其结果呈现。

## Impact

- **Pet Host**：`src/host/ledger/store.ts` 的 `advance`（`accept` 分支需先校验状态再投递）、`src/host/ledger/todo.ts`（状态机语义注释与不变量）、`src/host/routes.ts` 的 `LOCUS_ROUTES.todoAction`（返回投递结果事实）；新增执行目标解析、跟进正文组装函数与窄投递端口。正文组装与 `host/locus/dsh-port.ts:176` 的 `composeLocusMainBriefing` 同类但用途相反，不复用其文案。
- **Pet 工具面**：新增一个 caller-bound 子会话工具（请求执行），注册在 executor 的 **scoped** agent 上下文，沿用 `pet_locus_track` 的授权形状（`src/host/ledger/track.ts`）与其 composition 白名单（`src/host/locus/composition.ts:54`）。无 scope 会静默落 global 层使普通会话看到该工具——这是本仓库已实机复现过的陷阱，须有测试固定普通会话工具面不变。同时更新 `src/host/ledger/prompt.ts` 的 WORK REQUEST 分支，使子会话知道登记后可请求执行。
- **Pet Web**：`src/client/settings.tsx` 的 `TODO_ACTION_LABELS` / `TODO_ACTION_HINTS`（`accept` 的文案必须自述它会开工，现文案"不发送任何飞书消息"仍真但已不完整）、`useTodoLedger.dispatch`（承接并显示投递结果）。
- **DSH 接缝**：复用已核验的现成能力，不新增 compat patch——`AgentHandle.followup(UserMessage)`（`@deepseek-ai/dsh-agent@0.1.5-rc.3` 声明：排一个独立的普通轮次并唤醒 driver）、`agents.get`/`status` 判活与判忙、`agents.resume` 冷恢复。Pet 内已有同路径先例（`src/index.ts:1832` 的 `brief`、`:1535` 的 executor followup），实现应沿用而非另造投递路径。
- **主会话是跟进的唯一可行位置**：子会话按 `pet-locus-collaboration` spec.md:221-231 默认只读，且全局写档开关当前默认关闭（理由：多个子会话共享同一工作目录，write 即完全访问，并发写入无协商机制）。这正是待办机制存在的前提，因此跟进必须落在主会话，MUST NOT 通过提升子会话权限就地完成。
- **两种 main 来源的差异必须处理**：`LocusMainSource` 为 `auto` 时主会话是 Pet 自建的协作根，其开场白（`host/locus/dsh-port.ts:184-187`）声明当时"不是任务…请只回复「了解」…保持待命"。该声明描述的是建立时的初始状态而非永久禁令，投递正文须说明待命状态到此结束。`explicit` 时主会话是所有者 `/bind` 的工作会话，无此需要。
- **数据与迁移**：不新增表、不改字段、`PET_DOMAIN_VERSION` 不变、无数据迁移。存量语义冲突经实测排除：`u_dsh_pet_ledger_item` 共 2 行且全部为 `open`，`accepted` 行数为 0，因此不存在"按旧语义标记过的已受理行"需要区别对待。
- **安全**：投递不扩大任何权限面——主会话本就是该 locus 树的根，且所有者是发起人；投递不授予子会话新能力，也不改变 `LOCUS_SAFE_TOOL_FILTER` 与 `attestLocusComposition` 的既有约束。
- **相邻 backlog**：B043（Pet 任务面板残留英文）与本 change 同处 `settings.tsx`/`overlay.tsx` 文案面但互不依赖，不在本期合并处理。
