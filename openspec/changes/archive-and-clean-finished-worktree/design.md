## Context

见 `proposal.md` 的动机。当前 `wsCleanRepository`（`maintenance.ts:168`）已经完成了全部识别工作：它从 operation 的 binding 取出 `sourceSessionId`，与 Host 传入的 `archivedSessionIds` 比对，未命中即 `refused.push({ kind: 'not-archived', … })` 并 `continue`（`maintenance.ts:201-204`）。缺的不是反查能力，而是**拒绝之后的处置动作**。

归档能力在 Host 侧已存在：`ctx.workspaceRegistry.archiveSession(sessionId)`（`@deepseek-ai/dsh-workspace`），Web GUI 的归档走的正是这个调用（`dsh-host-apiproxy` 的 `workspace.archiveSession`）。其契约声明：会话可以是 live 也可以只存在于持久化中；归档不触碰 workspace accounting，归档集保留原有槽位以便取消归档时恢复。

前置 change `authorize-explicit-ws-path` 已建立面向用户的一次性确认通道（`ctx.get('userQuestions')` → `ask()`），本 change 直接复用它作为确认手段，不新增交互机制。该通道刻意不使用 `ctx.approval`：那是沙箱提权授权，在 `danger-full-access` 部署下 policy 为 `never`，会在触达用户前自动拒绝。

清理后的会话去向已有既定规范：`restore-cleaned-session-as-ordinary`（已归档）规定 cleaned 会话取消归档后绑定单调转为 `released`，会话以普通会话恢复，不创建替代资源。因此"归档 → 清理 → 需要时取消归档恢复为普通会话"是一条完整且已验收的生命周期，本 change 不改动它。

## Goals / Non-Goals

**Goals:**

- 让"工作已完成的 Worktree Session 收尾退出"成为一次可确认的动作，而不是"手动归档 + 重新清理"两步。
- 复用既有识别结果与授权通道，不新增反查逻辑、不新增交互机制。
- 保持归档提议的严格前置：只有其余安全门全通过的候选才配被提议。
- 失败如实报告，不制造"看起来一致"的中间态。

**Non-Goals:**

- 不改变任何既有安全门的判定逻辑或阈值。
- 不给 `dsh-ws` operator CLI 增加归档能力（无可信确认通道）。
- 不改变归档生命周期语义（cleaned / cleaned-archived / released 的单调性与恢复路径）。
- 不实现"关闭/卸载会话"：Host 未提供该公开 API，本 change 不触碰会话生命周期。
- 不改变 operation schema、HTTP route、远端分支与共享缓存策略。

## Decisions

### 1. 归档动作由调用方注入，maintenance 层保持对 DSH registry 无依赖

`wsCleanRepository` 目前只接收纯数据（`archivedSessionIds`、`activePaths`、`activeBoundSessionIds`），不认识 DSH 服务。保持这一点：新增两个可选注入项——一个"确认"回调与一个"归档"回调，由 `tool.ts` 从受信 Host 提供真实实现（`ctx.userQuestions` 确认 + `ctx.workspaceRegistry.archiveSession`）。

**替代方案：** maintenance 直接 import DSH workspace 服务。否决：会让这一层从纯 Git/元数据逻辑变成依赖运行时服务，破坏其可独立测试性，也让 CLI 路径被迫携带它用不到的依赖。

### 2. 归档提议的前置条件是"其余安全门全通过"，而不是"未归档"

未归档只是候选进入提议的必要条件。实现上必须先证明其余门可通过，才发起确认——否则用户会为一个注定失败的清理做授权决定，且归档了一个本不该收尾的会话。

由于单 operation 的 `wsClean` 会重新取锁并从磁盘复核，"提议前的判定"与"清理时的判定"之间存在窄窗口。设计上接受这一点：提议前的判定用于**决定是否打扰用户**，清理时的判定才是权威。窗口内状态变化的结果是"已归档但清理被拒"，这一路径在规范中被明确要求如实报告。

**替代方案：** 只要未归档就提议，把其余门留给清理阶段。否决：会把安全门失败转化为"用户已经授权了却仍然失败"，且留下不必要的归档。

### 2b. "自身源 Session 仍加载"不阻塞提议（实测修正）

真机验证（pet task `session-bcce3d7d`）暴露了首版设计的死锁：目标 worktree 被精确识别，却因 `Refusing to clean a worktree bound to active source Session` 在提议前即被拒。核对 `dsh-workspace` 实现确认 `archiveSession()` 只往归档集追加 id，**从不卸载 agent 或 dispose session**，因此该门在收尾流程中永远不会自行清除——保持武装等于要求会话先证明自己已不存在，任何 Session 都无法收尾自己的 worktree。

因此 `wsClean` 新增 `finishedSourceSessionId`：仅当它等于该 operation binding 的源 Session 时，豁免这一道门。豁免范围刻意极窄：

- 只对"用户在本次调用中明确确认收尾"的那一个 Session 生效；探针与真正清理各传一次。已归档候选不带该参数，其 live-binding 门仍须自行成立。
- **绝不豁免** `cwd === target` 与 `activePaths` 两道门——它们证明的是"没有人正站在这个 worktree 里"，与"绑定会话是否加载"是不同的事实。删掉别人脚下的地板永远不被允许。

责任落点随之明确：用户点下确认，即表示该会话不再需要这个 worktree。

### 3. 归档成功、清理失败时不回滚归档

归档是幂等的、可由用户在 GUI 取消归档回退的、且不破坏 workspace accounting 的操作。清理失败时自动取消归档会引入一个新的失败面（取消归档本身也可能失败），并可能与用户的并发操作打架。因此保留已归档状态，如实报告清理未完成，由用户决定下一步。

**替代方案：** 失败即取消归档，追求原子性。否决：这两个动作本就不构成事务，强行配对会制造更难诊断的中间态。

### 4. 每个候选独立确认，不做批量一次性授权

一次扫描可能遇到多个未归档候选。逐个确认让用户能对每个 worktree 单独判断（它们的合入状态、分支各不相同），也与既有"逐候选独立、互不阻塞"的语义一致。若用户对某个候选拒绝，其余候选照常判定。

**替代方案：** 汇总成一次"是否归档并清理这 N 个"。否决：把不同风险的候选捆成一个决定，且与逐项报告的既有结构不符。可作为后续优化，但不属于本 change。

### 5. operator CLI 保持非交互拒绝

`dsh-ws` 与 Skill shell wrapper 没有可信的用户确认通道（这正是 `authorize-explicit-ws-path` 中对 operator 路径不设授权的同一理由）。它们遇到未归档候选继续按既有语义拒绝，由 operator 自行判断。

## Risks / Trade-offs

- [用户在确认弹窗中误批准收尾] → 确认信息必须逐项列出源 Session id、分支、worktree 路径与已判定的合入/洁净状态；且只有"其余门全通过"的候选才会被提议，被提议本身已意味着它可安全丢弃。
- [归档后清理失败留下已归档但未清理的会话] → 规范要求如实报告，且该状态可由用户取消归档完整恢复（既有 released 路径）；不伪造回滚。
- [提议判定与清理判定之间的窄窗口] → 清理阶段的复核是权威判定，窗口内变化只会导致更保守的结果（拒绝清理），不会导致误删。
- [多候选逐个弹窗打扰] → 只对"未归档且其余门全通过"的候选发起，正常仓库中这类候选很少；已归档候选与被拒候选都不触发确认。

## Migration Plan

1. 无数据迁移：operation schema、归档集结构、tombstone 格式均不变。
2. 部署 package 后重启 DSH Host 使新行为生效。
3. 回滚：移除确认与归档注入即回到"未归档一律拒绝"，无持久状态残留（已由用户确认完成的归档保留，可自行取消归档）。

## Open Questions

- ~~**归档是否会使会话从 Host 卸载**~~ **已解答（实测 + 源码核对）：不会。** `archiveSession()` 仅向归档集追加 id，不触碰会话生命周期，`policy.ts:86` 的 loaded 判定因此不受影响。据此引入 `finishedSourceSessionId` 窄豁免（见决策 2b），"在当前 Worktree Session 内点 Pet 的 `ws clean` 收尾自己"因而可一步走通，无需用户先手动关闭会话。
- ~~确认文案的最终措辞~~ **已定稿**：中文；标题用 worktree/路径的末段以避免窄 UI 截断，完整路径、任务分支与源会话 id 放在正文；选项为「确认执行」/「取消」。
- **清理自身 worktree 后当前会话的后续可用性**：清理成功后该执行目录即消失，此后该会话的 bash/文件操作会失效。这是收尾语义的必然结果（会话工作已完成），既有"取消归档 → released → 恢复为普通会话"路径仍可用于查看历史。端到端验证时确认这一表现是否需要在确认文案中更醒目地提示。
