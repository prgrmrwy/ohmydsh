## Why

所有者在真机点击待办的「受理」后观察到"没有任何变化"，预期是**开始处理这个问题**，实得只是一次状态标记。这不是缺陷而是既有设计（`pet-locus-intent-triage` 的 D8 与 spec.md:143「状态仅可由所有者经管理面推进」）：三个按钮全是记账动作，所有者预期的"开工"在 UI 上没有任何对应物，需要他自己再点「会话」跳过去、自己复述一遍待办内容。

所有者已明确裁定语义：**「我知道了」不需要一个按钮——看到即知道；只有真开工了才叫受理。** 当前的 `accepted`「已接手但还没做」因此是一个不承载决策的空状态，它把一次点击的成本摊给所有者却不产生任何推进。

## What Changes

- **BREAKING（`accepted` 语义变更）**：「受理」从纯状态标记改为**开工动作**——置 `accepted` 与向主会话投递一条跟进任务是同一次不可分的操作。不再存在"已受理但未投递"的状态。
- 受理投递的目标是该待办台账所归属的 `parentSessionId`，不引入新的目标选择面；所有者不可指定投递去向，Host 从待办已固定的归属事实解析，不可证明时 fail closed 并保持 `open`。
- 投递正文由 Host 组装为一条**带上下文的跟进指令**，至少陈述：这是一条 locus 待办跟进、待办标识、原始请求人与登记时间、来源入口、证据摘要，以及"先读上下文再推进"的行动指引与可用的查证路径。正文由 Host 组装，MUST NOT 由模型或所有者自由撰写。
- 目标会话正忙时**排队**，按 DSH `followup` 的原生语义等其当前轮次自然结束后接上，MUST NOT steer 或打断当前步；目标未加载时先冷恢复再投递。
- 投递结果如实呈现：已投递、目标忙碌排队中、目标不可达（归档/无法恢复）三种事实分别陈述，失败不置 `accepted`。
- 受理仍 MUST NOT 产生任何飞书出站正文、表情或 Delivery——投递是**Host 到主会话的内部跟进**，与飞书入口无关。
- 「完成」「放弃」维持纯记账语义不变；`open → done`、`open → dropped` 的直达路径保留，所有者仍可不开工就直接了结一条待办。
- 模型仍不可改写待办状态（D8 中"登记是陈述事实、处置是所有者决定"的分界保持不变；本 change 只改变所有者那次决定**做了什么**，不改变**谁能做**）。

## Capabilities

### New Capabilities

无。本 change 不引入新能力，只改变既有待办处置动作的语义与副作用。

### Modified Capabilities

- `pet-locus-intent-triage`：「待办生命周期与 Delivery 结算解耦」要求中的状态语义（`accepted` 由标记变为开工，附带向主会话投递）；「管理面呈现待办并提供由固定标识派生的跳转」要求中所有者可执行的动作及其结果呈现。

## Impact

- **Pet Host**：`src/host/ledger/store.ts` 的 `advance`（`accept` 分支需与投递构成一次事务性决定）、`src/host/ledger/todo.ts`（状态机语义注释与不变量）、`src/host/routes.ts` 的 `LOCUS_ROUTES.todoAction`（返回投递结果事实）；新增一个 Host 侧跟进正文组装函数，与 `host/locus/dsh-port.ts:176` 的 `composeLocusMainBriefing` 同类但用途不同，不复用其文案。
- **Pet Web**：`src/client/settings.tsx` 的 `TODO_ACTION_LABELS` / `TODO_ACTION_HINTS`（`accept` 的文案必须自述它会开工，现文案"不发送任何飞书消息"仍真但已不完整）、`useTodoLedger.dispatch`（承接并显示投递结果）。
- **DSH 接缝**：复用已核验的现成能力，不新增 compat patch——`AgentHandle.followup(UserMessage)`（`@deepseek-ai/dsh-agent@0.1.5-rc.3` 声明：排一个独立的普通轮次并唤醒 driver）、`agents.get`/`status` 判活与判忙、`agents.resume` 冷恢复。Pet 内已有同路径先例（`src/index.ts:1832` 的 `brief`、`:1535` 的 executor followup），实现应沿用而非另造投递路径。
- **主会话是跟进的唯一可行位置**：子会话按 `pet-locus-collaboration` spec.md:221-231 默认只读，且全局写档开关当前默认关闭（理由：多个子会话共享同一工作目录，write 即完全访问，并发写入无协商机制）。这正是待办机制存在的前提，因此跟进必须落在主会话，MUST NOT 通过提升子会话权限就地完成。
- **两种 main 来源的差异必须处理**：`LocusMainSource` 为 `auto` 时主会话是 Pet 自建的协作根，其开场白（`host/locus/dsh-port.ts:184-187`）声明当时"不是任务…请只回复「了解」…保持待命"。该声明描述的是建立时的初始状态而非永久禁令，投递正文须说明待命状态到此结束。`explicit` 时主会话是所有者 `/bind` 的工作会话，无此需要。
- **数据与迁移**：不新增表、不改字段、`PET_DOMAIN_VERSION` 不变；存量 `accepted` 行的历史含义（曾经"只是标记"）与新语义不同，管理面 MUST NOT 把存量 `accepted` 呈现为"已投递"。
- **安全**：投递不扩大任何权限面——主会话本就是该 locus 树的根，且所有者是发起人；投递不授予子会话新能力，也不改变 `LOCUS_SAFE_TOOL_FILTER` 与 `attestLocusComposition` 的既有约束。
- **相邻 backlog**：B043（Pet 任务面板残留英文）与本 change 同处 `settings.tsx`/`overlay.tsx` 文案面但互不依赖，不在本期合并处理。
