## REMOVED Requirements

### Requirement: Send CR 是一个普通的独立 Skill
**Reason**: 依赖组织内部的 MR 读取 CLI,只对单一组织有意义;按 repo-layout「公开仓库不硬编码组织专属值」迁出。
**Migration**: skill、manifest 条目与本规范整体迁入私有 overlay 仓库(`skills/send-cr/`、`dsh.yaml` 条目、`docs/specs/send-cr-skill.md`),行为不变。

### Requirement: Send CR 自行校验执行前提
**Reason**: 同上,随 skill 迁出。
**Migration**: 见私有仓库 `docs/specs/send-cr-skill.md`。

### Requirement: Send CR 发送前必须用户确认
**Reason**: 同上,随 skill 迁出。
**Migration**: 见私有仓库 `docs/specs/send-cr-skill.md`。

### Requirement: Send CR 经 lark-cli 有界发送
**Reason**: 同上,随 skill 迁出。
**Migration**: 见私有仓库 `docs/specs/send-cr-skill.md`。
