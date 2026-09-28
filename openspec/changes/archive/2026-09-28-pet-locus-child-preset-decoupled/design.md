## Context

locus child 的安全组合由三件事共同构成：
- `independent-v1`：从自己持久化的 preset 独立 mount；
- durable `toolFilter`：只过滤继承层；
- `attestLocusComposition`：在 `agent/created` 上核验实际工具面，超出即否决发布。

其中「用哪个 preset」原本取自 `composedPreset(parent.ctx)`，即主会话当时运行的 preset。

## Decisions

### D1 child preset 由 Pet 指定，不从主会话派生

**选择**：compat 增加 `ContinuableStartSpec.agentPreset`。Pet 固定传 `LOCUS_CHILD_PRESET`（`dsh-pet-executor`，其委派行无 `modelSelectionSettings`，由 `loader-composition` 测试钉住）。

**否决方案一**：保留绑定门，要求主会话必须运行 `dsh-pet-executor`。它把安全前提挂在用户可选的值上，只能靠拒绝用户的标准用法来维持，且与当前 spec 冲突。

**否决方案二**：在 child 侧 deny `subagent`。own 层不在 `restrictableNames` 里，写入会直接抛错（见 `docs/notes/dsh-plugin-integration-pitfalls.md`）。

### D2 冷恢复 mount 持久 preset

两条冷恢复路径都把 `descriptor.agentPreset` 作为 `independentAgentPreset` 传给 `materialize`。缺失时返回 `NOT_RESUMABLE`。这补上的是既有 spec 已要求、实现却漏掉的部分；descriptor 版本不变，因为字段早已持久化。

### D3 显式 preset 仅限 independent-v1

普通 child 加入父的 standing composition，显式 preset 对它没有意义。因此传了也拒绝（`INVALID_REQUEST`），不静默忽略。

### D4 fail closed 于 marker

旧 runtime 会静默忽略未知的 `agentPreset` 字段，那样 child 会拿到主会话的 preset。因此 `probeLocusChildPorts` 与 `runReservedIdleCreate` 都要求 `supportsIndependentChildAgentPreset`，缺失即 unavailable 或 `safe-composition-unsupported`。

### D5 回执

`safeControlError` 仍把 `PARENT_NOT_ALLOWED` 映射成统一的「无匹配」回执：删门后，control 命令能到达的该码只剩「前缀命中子会话」，而 spec 要求这种情况与无匹配同回执。`replaceArchivedParent` 的同码拒绝走管理面路由，不经过 control 层。

## Risks

- patch 变更会使 launcher 重建。重建失败时 Host fail closed，不回退官方 runtime（既有行为）。
- `attestLocusComposition` 继续作为纵深防御：即使 preset 行将来被改坏，发布也会被否决。
