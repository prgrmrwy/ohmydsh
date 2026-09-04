## Context

见 `proposal.md` 的动机。当前 `packages/worktree-session/src/host/tool.ts` 的 `targetFor()` 在 `args.path` 非空且存在 `exec.agent` 时直接抛错（`ws explicit path is unavailable to an Agent-bound call`），`cleanTargetFor()` 则完全不看 `path`，只用 `agent.session.header.cwd`。因此目标解析对"调用 Session 的物理 cwd"存在硬耦合。

这条约束在纯人类会话中是合理的（模型不该凭空指名路径），但它把一类**调用 Session cwd 天然不等于目标仓库**的合法调用方全部挡在门外。DSH Pet 是其中最典型的：`packages/dsh-pet/src/host/executor.ts` 刻意把执行会话 `cwd` 设为 Pet Workspace（注释："Source access is granted through trusted context and bounded tools instead"），来源仓库通过 `pet_context` 的 `repositoryRoot` 提供。session-1f3e83ad 的三轮调用证明：`pet_context` 正确返回了 `/Users/prgrmrwy/opensource/ohmydsh`，但 `ws` 的三个 action 无一可用，全部返回 `Not inside a Git repository: …/dsh-pet/workspace`。

DSH 平台提供两条面向人的接缝，本设计必须选对：

- `@deepseek-ai/dsh-user-approval`（`ctx.approval`）——**沙箱提权授权**。按会话 approval policy 前置裁决，`danger-full-access` preset 绑定 `approval: never`，此时每个请求在触达任何应答者之前即被自动拒绝。
- `@deepseek-ai/dsh-user-questions`（`ctx.userQuestions`）——**向人提问**。UI 在输入区呈现，可选可输入；实现中不含任何 approval/policy 引用，与 permission preset 完全解耦。

本 change 使用后者。首版曾误用 `ctx.approval`，真机验证暴露了后果：在 `danger-full-access` 部署（本机默认）下，Pet 执行会话拿到 policy `never`，模型看到"Approval prompts are disabled"后干脆不再传 `path`，转而在对话里用文字向用户要授权，弹窗从未出现，会话日志中也没有任何 `approval/asked`。把人类决定放在提权通道上，恰好在最需要它的部署里失效。

`ToolExecution` 已携带 `agent` 与 `signal`，`userQuestions.ask` 需要的正是这两项，无需新增管道。

## Goals / Non-Goals

**Goals:**

- 让任何 cwd 不在目标仓库的合法调用方，在用户实时授权下能够使用 `ws` 的三个 action。
- 授权是通用机制：`worktree-session` 对调用方类型（Pet、子 Agent、fork、其他 runtime）零感知。
- 默认路径零回归：省略/空 `path` 的调用解析语义、诊断文案完全不变。
- 授权只替换"路径来源信任"，绝不豁免任何既有安全门。
- 全部失败模式 fail closed，且每次授权可审计。

**Non-Goals:**

- 不为 Pet（或任何具体调用方）新增专用参数、工具、注册表或 translator。
- 不改变 `dsh-ws` operator CLI、HTTP clean route、operation schema、归档生命周期与依赖缓存策略。
- 不引入持久授权、记住选择、路径白名单或 policy 放宽。
- 不改变 `clean` 的仓库级扫描算法与逐项安全门实现。

## Decisions

### 1. 用平台 `ctx.userQuestions` 作为唯一确认接缝，而不是自建 translator 注册点

`registerWsTool()` 经 `ctx.get('userQuestions')` 反射安全读取服务，在检测到 Agent 调用携带非空 `path` 时发起 `ask()`，问题含确切 action 与路径，并给出可点选的同意/拒绝项。只有用户选中同意项才继续，其余一律走既有拒绝路径。

**替代方案：**（a）用 `ctx.approval`。**已实测否决**：`danger-full-access` preset 绑定 `approval: never`，请求在触达用户前即被自动拒绝——人类决定不属于提权通道。（b）在 `ws` 侧新增"受信调用者上下文 translator"注册点，由 Pet 注册翻译器。否决：这正是用户明确排除的耦合形态，且把判断从用户手里挪进代码。（c）Pet 恢复 `pet_clean_worktree` 之类 bounded 工具。否决：违背 Pet"runtime 不是 adapter 目录"的架构，`packages/dsh-pet/test/executor-scope.test.ts:278` 已明确断言该工具不存在。（d）把 Pet 执行会话 cwd 改成来源仓库。否决：违背 Task 可跨越/长于来源快照的设计，且会把主 checkout 当执行区。

### 2. 授权只改"路径来源"，action 语义沿用既有两条成熟路径

授权通过后不新增第三种目标语义：

- `clean` + 授权路径 → 复用 `wsCleanRepository(repoPath, …)`，即与"主 checkout 普通 Session 发起"完全相同的仓库级扫描，含主 checkout 证明、归档前置条件、逐项安全门与 cleaned/refused/ignored 汇总。
- `status`/`promote` + 授权路径 → 复用既有显式路径单 operation 语义（与 `dsh-ws` CLI 同一条 `MaintenanceTarget` 字符串分支）。

这样授权面只有一个变量（路径可信与否），不产生新的安全推理负担。

**替代方案：**为授权路径设计独立的目标解析。否决：会制造第三套语义和第三套安全门组合，显著扩大回归面。

### 3. 空字符串 `path` 的 wire 兼容行为优先于授权判断

现有代码注释明确：某些模型/工具客户端会把省略的可选 string 物化为 `''`，因此 `''` 必须继续视为"缺省"。授权分支的触发条件是 `path !== undefined && path !== ''`，与现有判定表达式完全一致，保证老客户端不会平白触发授权弹窗。

### 4. 只有"明确选中同意项"才算同意，其余全部 fail closed

用户选中拒绝项、未作答、只给自由文本、无 provider、`ask()` 抛错（步骤被中止，或调用方不是活的 runtime root）一律拒绝。沉默与自由文本都不构成同意：前者是未决定，后者无法机器判定意图。诊断文案说明"显式路径未获用户授权"，而不是伪装成绑定缺失错误，便于排查。headless/CI 无 provider，因此天然保持今天的行为。

**替代方案：**（a）把自由文本按语义解读为同意。否决：把不可判定的输入当作授权。（b）无 provider 时回退到 cwd 解析。否决：那会让"无人可问"静默变成"按调用方 cwd 猜"，与 fail closed 相悖。

### 5. 拒绝必须是可点选项，而不是"不回答"

问题始终附带显式的拒绝选项，使拒绝无需输入自由文本，也让"未作答"与"明确拒绝"在语义上分开——两者都拒绝，但前者可能只是用户还没看到。

### 6. 依赖以 peerDependency 形式声明，缺失时按 fail-closed 处理

`@deepseek-ai/dsh-user-questions` 加入 `packages/worktree-session/package.json` 的 peerDependencies（与现有 `dsh-agent`/`dsh-tools` 等同级 pin 风格一致）。若运行时 `ctx.userQuestions` 不存在，读到 `undefined`：拒绝显式路径，默认路径不受影响。

## Risks / Trade-offs

- [授权疲劳导致用户习惯性点允许] → 授权文案必须包含确切 action 与完整路径；`clean` 的既有 `dry_run` 先行约定不变，用户先看预览再授权真实删除。
- [显式路径扩大了一次调用可触达的仓库范围] → 授权是一次性的、逐次询问、无记忆；且授权后所有既有安全门（归档、active、dirty、in-flight、merge ancestry、schema）逐项照常拒绝，授权不是豁免。
- [模型可能用提示词诱导用户授权错误路径] → 路径原样展示在授权询问中，由用户核对；同时 `clean` 仍要求路径可证明为仓库主 checkout，`status`/`promote` 仍要求解析出有效 operation metadata。
- [无 questions provider 的部署静默失去该能力] → 这是刻意的 fail-closed；诊断文案明确指出原因是"无法取得用户授权"，而非绑定问题，避免误导排查。
- [不再有 approval 的结构化审计事件对] → 这是选用 `userQuestions` 的已知代价：问答留在会话对话中可回溯，但没有 `approval/asked`/`approval/decided` 那样的成对审计事件。取舍理由是 approval 通道在本部署下根本无法触达用户；若将来需要结构化审计，应作为独立 change 讨论，而不是把人类决定塞回提权通道。
- [Pet 面板的等待态呈现] → Pet 对 `approval/*` 事件有投影（`dsh-pet/src/index.ts:514`），但 `userQuestions` 不发这些事件，因此等待用户作答期间 Pet 面板可能不显示 `waiting-user`。这是呈现问题而非正确性问题：询问照常送达用户、作答照常继续执行；端到端验证时确认实际表现，必要时另立 change 补投影。

## Migration Plan

1. 实现并构建 `packages/worktree-session`，通过 `dsh build`（`node scripts/sync.mjs`）物化，重启 DSH Host 使新工具行为生效。
2. 无数据迁移：operation schema、目录布局、绑定记录均不变。
3. 回滚策略：还原 `tool.ts` 的授权分支即可回到"显式路径对 Agent 硬拒绝"，无持久状态残留。

## Open Questions

- 授权 `reason` 文案的最终措辞（需同时对人类可读并明确风险），实现时定稿。
- `skills/ws/SKILL.md` 是否需要显式点名 `pet_context` 作为"受信路径来源"的示例：倾向只描述通用条件（"由受信机制证实的仓库根"）以避免文档层耦合，实现时确认。
