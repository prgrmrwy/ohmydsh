# 历史验收摘要：Jev 工作流 shadow routing

本 change 仅建立 Phase-1 shadow 观测，不授权自动执行、创建 change、切 schema、调用生命周期操作或启用 Phase 2。

- 精确 pin 的 Jev/MCP bridge、上游工作流 skill 与 Anvil 物化和工具面已核验；普通 Agent 重启后的实际工具目录是就绪依据，执行 shell 未继承凭据不能据此判 Host 不可用。
- 真实 classify/decide 只发送封闭类型字段，未发送用户正文、源码、路径、标识或凭据。低置信 classify 保守保留 needs-review，后续建议只作为 shadow 记录。
- 无机械隔离的 managed Worktree Session 中，spec-superflow 被排除出可执行候选；建议未改变既有 change 的权威。
- 初始 real 样本为空，历史 Session 的活跃数量不是准确率或标签数据，不读取旧 prompt 回填。一次有界 live 调用也不足以建立 Phase-2 质量/成本/时延门槛。
- disable、rollback、fallback 与上游资源审查已有记录；后续 measurable change 对 v2 provenance、真实样本及 unavailable 门禁作进一步收紧。

## 证据退役（2026-10-27）

按用户批准移除 12 份详细 live/probe/runbook/上游审查及 shadow 报告。未搬运实际响应、日志或环境信息；不把本摘要当作完整审计或未来 Phase-2 放行证明。

原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-09-25-bootstrap-jev-workflow-routing/checking/<原相对路径>`。
