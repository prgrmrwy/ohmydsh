## Why

统一 locus 的写档此前映射到 `workspace-write`，其边界就是**子会话 cwd**；而子会话 cwd 在创建时被 DSH 写死为父会话的 cwd（不可变）。所有者的实际工作流是用 `sw` 在**兄弟目录**开 worktree 干活（实测 `git worktree list`：`corp/nexus`、`corp/nexus-2`、`corp/nexus-rpc`），因此写档在任何情况下都无法覆盖他真正在改的代码——这不是配置问题，是模型问题。

三条实机证据（2026-09-16）：

- 所有者自己的工作会话：`permission/preset` 与 `sandbox/mode` 均为 `danger-full-access`（无 cwd 边界），所以 `sw` 把工作带到哪就能在哪写；
- locus 子会话出生时继承了 `danger-full-access`（`source: delegation`），随后被 Pet 主动收窄为 `read-only`；`-s write` 时 apply `workspace-write` 成功、核验失败即回滚（日志里成对出现）；
- 由此"子会话知道去哪改"从来不是问题，**策略被收窄**才是。

上游也没有这个能力：`@deepseek-ai/dsh-subagent` 的 0.1.5-rc.2 / 0.1.6-alpha.1 里 `SubagentStartRequest`、`ContinuableCreateSpec` 均无 `cwd` 字段。所以"让所有者指定执行根"必须打宿主补丁，并要求每次换 worktree 重建 child。

所有者于 2026-09-16 明确选择**单档**：`write` 即完全访问。原始 design 早已写明这类变更的闸门——`pet-unified-locus-collaboration/design.md:266`「不隐式映射 danger-full-access；**若需更宽权限必须另作明确安全决策**」。本 change 就是那次显式决策，落档于 `docs/adr/ADR-0005-locus-write-grants-full-access.md`。

## What Changes

- **`write` 档 = `danger-full-access`**：`read` 仍是默认；`write` 由 allowlist/所有者在空闲时显式授予，授予即代表该入口成员共享**整机无边界**写能力。
- **写档核验事实改变**：由「已确认执行根 == live workspace root」改为「宿主回读的 live 模式恰为 `danger-full-access`」。`danger-full-access` 下没有有意义的 workspace root，因此根相等不再是条件。
- **上下文锚点降级为上下文事实**：执行根继续写入子会话 prompt、面板展示、按需读取，但**不再门控提权**（所有者此前遇到的"提权被根挡住"随之消失）。`unauthorized` 硬拒绝保留字段但不再参与判定（当前无写入路径）。
- **如实呈现后果**：管理面与飞书回执 MUST 原话说明该档是"完全访问（整机无边界、该入口成员共享）"，MUST NOT 再声称"写范围恰好等于已确认目录"。
- **回滚/核验路径同步**：apply 失败、回读模式不符、忙碌或持久化失败时的行为不变（不得回执成功、保持/回到 read、必要时暂停该入口），只是期望模式换成完全访问。
- 非破坏性：无 persist schema 变更（审计表沿用 desired/effective），无 wire 字段变更，无宿主补丁，无 DSH 版本升级。实测现有 4 条 locus 全为 `read`，无迁移影响。

**明确不做**：不保留「可写(限目录)」档（留作将来收紧时的选项，那时才需要 per-child cwd 补丁）；不放宽 read 档的任何既有约束；不因为该档而省略闲置检查、审计或每次投递前的 live 核验。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pet-locus-collaboration`：「默认 read 与 allowlist 授权独立于绑定」中的写授权要求改写——(1) 写档的权威事实由"确认根与 live root 精确相等"改为"宿主回读 live 模式为完全访问"；(2) 原「MUST NOT 隐式选择更广模式」改为「更广模式可由所有者显式选择，但必须显式、可审计、并在管理面写明后果」；(3) 上下文锚点明确为上下文事实、不门控提权；(4) 拒绝提权的原因从"工作根不受支持"改为"宿主拒绝应用完全访问模式"。

## Impact

- `packages/dsh-pet/src/host/locus/permission-mutation.ts`：模式词汇与 `modeFor` 映射（并把"no wider mode is representable"的注释改写为本次决策）。
- `packages/dsh-pet/src/host/locus/policy-verification.ts`：期望模式、诊断、去掉根的相等判定。
- `packages/dsh-pet/src/index.ts`：管理面 scope 路径的模式映射与回读。
- `packages/dsh-pet/src/client/settings.tsx`：权限标签（"可写（完全访问）"）、按钮 title、执行根行改为上下文说明。
- `packages/dsh-pet/test/`：`locus-policy-verification`、`locus-permission-mutation`、含模式断言的客户端/路由用例。
- `docs/adr/ADR-0005-locus-write-grants-full-access.md`：本次显式安全决策的长期记录。
- 用户可见影响：提权一次即在该入口获得整机写能力；不再需要确认执行根；面板会明确写出这条后果。
