## Context

见 proposal.md。当前 wakeRecipients、话题计数、mode 选取、戳投影和 Pet 代理均把 needsReply 当作通知开关；status 则把它当待回复问题。旧收据对原命令参数做规范化哈希；旧日志与已发布约定不可改写。

## Goals / Non-Goals

**Goals:** 两种意图可独立表达；旧调用、日志、收据和安全投影保持兼容。

**Non-Goals:** 不做未读系统、不修改 GUI 队列、不自动重发、不改 Host followup 语义、不增加新的投递来源或接入运行时。

## Decisions

1. 新增可选 notify。有效通知值为 notify ?? needsReply ?? false；显式 false 可静默保留问题，显式 true 可通知而无需回复。不选“默认所有消息唤醒”，以保留既有静默消息语义。
2. 新消息持久化有效 notify；Message.notify 类型保持可选以接纳旧日志。领域内使用一处兼容判断；Pet 维持无内核运行时依赖的结构接口，局部使用相同规则。
3. 参数校验拒绝非布尔 notify。只在业务决定阶段计算默认值，原始输入参与收据哈希，不破坏升级前同参数重试。
4. wake、mode 选取、话题计数和戳投影都使用有效通知意图。mode 前提改为通知为真。status 不新增字段，仍只看 needsReply。
5. 所有实际产生 wake intent 的消息均计入原 20 条话题限额；notify:false 与不可达不计数。旧日志计数用 needsReply 回退，恢复与提交判定一致。
6. 约定 v4 从 v3 复制修订，版本 1–3 保持原字节；新空间默认 v4，已有空间的版本不迁移。工具说明直接包含新参数语义，让旧空间成员也能发现新能力。

## Risks / Trade-offs

- 旧调用不填写 notify 时仍使用旧缺省 → 明确工具说明、提供结果通知示例。
- 接入层仍按 needsReply 判断会漏通知或泄漏投递可见性 → 覆盖戳投影和 Pet 路由实集成测试。
- 同一字段增量可能破坏旧收据 → 用升级前原哈希的记录重试验证，不补参后再哈希。
- 回滚旧实现将无法正确解释新通知和 topic 计数 → 本轮不部署；将来部署须保持新内核、consumer 和 Pet 同批，保留台账，不用旧实现继续写新日志。

## Migration Plan

本轮只在托管 worktree 实现并验证。无日志迁移，无依赖变更，无生产 build/restart。后续部署由用户决定；合入和 worktree 清理须另获明确批准。
