## Why

2026-11-09～10 的一次真实 Locus 交互（locus 主会话 `session-58e1d909…`，子会话 `session-f1ae1f5d…`、`session-28553176…`）暴露了三个问题：

1. **回答啰嗦、口径偏技术**：子会话把文件名、RPC 名、变量名直接发进群，直到提问人明确说"只要业务逻辑"才收敛；locus 主会话每一轮都在 GUI 里把子会话的回复整段复述一遍。
2. **不先用工作会话已有的上下文**：工作会话里已经有大量相关结论，但子会话按现有规则"按需用只读工具查"，自己跑了 7 次 grep、5 次 read；locus 主会话也没有读工作会话记录的能力，只能发消息打扰它。
3. **`/bind` 报"控制命令执行失败，请稍后重试"**：locus 主会话已归档、工作会话未归档时，对一个还没有群记录的群执行 `/bind`，Host 抛出 `LOCUS_MAIN_UNAVAILABLE`，控制面没有映射这个错误码，结果落到兜底分支，日志里也没有真实原因。

## What Changes

- **回答口径**：子会话回答默认只讲业务逻辑，先给一句结论，正文保持简短；只有提问人追问来源或实现时，才给文件、函数、接口名。locus 主会话在自己会话里的回复只留一行状态，不再复述转出的正文。
- **先问工作会话，再自己查**：信息类问题，子会话先用 `locus_ask_parent` 问 locus 主会话；只有主会话明确回复"没有相关记录"，或询问当场失败，才自己用只读工具查。不承诺"等待超时后自查"：Delivery 到期按现有规则过期。
- **locus 主会话按固定顺序找答案，且每次必须答复**：
  1. 本协作空间里已确认的结论。
  2. 配对工作会话最近 3 轮对话。
  3. 配对工作会话全文关键词搜索一次。
  4. 仍没有：工作会话确认空闲时，先回子会话"已转问"，再经协作空间问它；忙或状态未知时回复子会话"没有记录，请自查"，不打扰工作会话。
- **披露边界（所有者 2026-11-10 决定）**：入口绑定到工作会话即授权该入口得到引用该工作会话对话的答复，`/unbind` 或改绑即撤销；`/bind` 回执写明这一点。绑定到同一工作会话的群/话题之间也共享已确认结论，不做隔离；边界只到这个工作会话为止。
- **locus 主会话新增一个只读工具；询问消息直接附带本空间已确认结论**：
  - `locus_work_history({query?})`：返回配对工作会话的状态（idle / unknown；只有在内存中、无进行中轮次、队列为空才算 idle），以及最近 3 个人工轮次的输入与最终回复，或关键词命中片段。只取人工输入和每轮最终回复，不取注入说明、过程文本和工具结果；输出标记为数据、做凭据脱敏、有上限。
- **迟到答复拒收**：询问消息带上当前消息的 msgId 作为询问引用；`locus_reply_child` 增加必填参数 `askRef`，把它原样带回，Host 核对它仍是当前消息，否则回"询问已过期"。不新增状态，重启不影响。答复送达后才换代的情况不处理，作为已知缺口写明。
- **`/bind` 遇到不可用的 locus 主会话时先迁移**：工作会话 W 未归档、它的 active locus 主会话不可用时，`/bind` 先对 W 做一次整体迁移，再建立入口；有正在处理的消息就回复"忙，请稍后重试"。回执如实说明迁移结果，迁移成功但入口建立失败时也如实说明，重试不再迁移。
- **控制命令失败如实回执**：控制面按稳定原因回执 `LOCUS_MAIN_UNAVAILABLE`、`PARENT_NOT_FOUND`、`PROVISIONING_FAILED` 等错误码；兜底分支只记已定义的原因码（否则记 `unrecognized`），不记报错消息、堆栈和 cause。

不做：跨 locus（其它工作会话的协作空间）共识查询；会话侧 `/locus` 选群入口（另开 change）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pet-locus-collaboration`：
  - 子会话向主会话询问的触发条件和 locus 主会话的找答案顺序。
  - locus 主会话新增 `locus_work_history`，询问消息附带已确认结论。
  - 回答口径。
  - `/bind` 遇到不可用 M 时先迁移。
  - 控制命令失败的回执与诊断。
- `pet-locus-intent-triage`：信息交换类请求先问主会话、默认业务口径。

## Impact

- 代码（`packages/dsh-pet/src/`）：
  - 提示文本：`host/ledger/prompt.ts`、`host/locus/context.ts`、`host/locus/dsh-port.ts`（locus 主会话首次说明）。
  - 工具：`host/collab/locus-tools.ts`（投递给主会话的流程说明、询问引用、新工具逻辑）、`host/tools.ts`（工具注册）。
  - 装配：`index.ts`（工具依赖装配、控制面日志）。
  - 绑定与控制面：`host/locus/controller.ts`（`/bind` 迁移前置、报错文案）、`host/locus/control.ts`（错误映射、兜底日志）。
- 测试：`packages/dsh-pet/test/` 下的 locus-control、locus-tools、intent-triage prompt、provisioning/migrate 相关测试。
- 不改持久层 schema，不改协作空间结构，不新增外部依赖，不新增 Delivery 唤醒机制。已有的子会话和 locus 主会话都不需要重建：新规则通过续投 prompt 和每次询问消息送达。
