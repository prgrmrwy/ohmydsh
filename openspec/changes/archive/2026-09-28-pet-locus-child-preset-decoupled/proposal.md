## Why

所有者在飞书群里发 `@小小芒果 /bind 381198bb-314c` 绑定自己的工作会话，收到「没有匹配到唯一的会话」。前缀其实唯一命中一个未归档主会话，只是该会话运行 `standard` preset。

根因有两层：

1. locus child 通过 `composedPreset(parent.ctx)` 从主会话派生组合。`standard` 的 `tool-subagent` 行带 `modelSelectionSettings: true`，会把 `subagent` 注册进 child 的自有层，而 `LOCUS_SAFE_TOOL_FILTER` 只过滤继承层，删不掉它。这会破坏单出口不变量。为了守住它，此前在 controller 里加了「显式绑定的主会话必须运行 `dsh-pet-executor`」的门（commit `6329b209`），但没改 spec。当前 spec 写的是 `/bind` 唯一匹配**未归档主会话**，preset 不是条件。
2. control 层把所有 `PARENT_NOT_ALLOWED` 都映射成 `prefix-unresolved`，所以这个 preset 拒绝被伪装成了前缀打错。

排查中还发现：compat patch 的两条冷恢复路径（`materializeForAccess`、`coldResume`）没有把 descriptor 里的 `agentPreset` 传给 `materialize`。于是 independent child 重启后实际走 `composeFrom(parent)`，违反 spec 的「创建和冷恢复 SHALL 使用同一份…不可由 parent/user preset 漂移的 safe composition」。

## What Changes

- compat `ContinuableStartSpec` 新增 `agentPreset?`，仅与 `independent-v1` 同用，由调用方显式指定 child 的 preset，并新增 marker `supportsIndependentChildAgentPreset`。
- compat 两条冷恢复路径从 descriptor 读回 `agentPreset` 并 mount。缺失时返回 `NOT_RESUMABLE`，不回落到 `composeFrom`。
- Pet 创建 locus child 时固定传 `LOCUS_CHILD_PRESET = 'dsh-pet-executor'`。runtime 缺该 marker 时，child seam 整体 unavailable，fail closed。
- 删除 controller 的 preset 绑定门。`/bind` 可绑定任何未归档主会话。
- `PARENT_NOT_ALLOWED` 的受控回执只保留「前缀命中子会话」这一种。
- `LOCUS_MAIN_PRESET` 保留，只用于 Pet 自建主会话，不再承担安全职责。

## Capabilities

### Modified Capabilities

- `pet-locus-collaboration`：「显式绑定可替换自动关联并警告上下文改变」明确 preset 不是绑定条件；「Locus 业务出站只能经受管 finish」明确 child preset 由 Pet 指定，且冷恢复 mount 持久 preset。

## Impact

- `packages/dsh-pet/compat/subagent/settlement-notice.patch`：33→34 hunk。仍只触及 `subagent/subagent` 一个上游包，seam 数不变（仍 4 个），marker 从 4 个增加到 5 个。patch hash 变更后，下次 Host 启动会触发 launcher 重建。
- `packages/dsh-pet/src/host/locus/{aggregate,child,controller,control,dsh-port}.ts`、`src/index.ts`。
- 既有数据：此前被拒绝的绑定没有落行，无需迁移。已在 `standard` 主会话下创建的旧 child 不存在，因为门早于此已拦截。
