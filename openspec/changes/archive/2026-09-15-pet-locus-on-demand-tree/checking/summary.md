# 历史验收摘要：Pet 按需建树

2026-09-15 真实入站验收的三步均通过；本摘要不携带群、会话或数据库原始记录。

- 把 bot 加入由人创建的空群未建立 locus/索引/operation；未因入群启动业务建树。
- 首次明确 @ 后按需创建并正常回复。
- 未建入口时显式 bind 首代直建，无多余 auto locus 或改绑警告。首次失败来自选中了已经结束的历史会话，不是 bind 实现缺陷。
- GUI 侧栏短暂未分组但持久 Workspace 归属正确，作为独立 B041 体验问题保留；不能据此修改数据模型。
- 创建群的身份是负测前提：用 bot 自己建群不能验证随后“拉 bot 入群”的时刻。

## 证据退役（2026-10-27）

按用户批准移除 1 份详细 live 记录，未搬运实际消息或数据库快照。历史原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-09-15-pet-locus-on-demand-tree/checking/live-acceptance.md`。历史通过不代表当前部署复验。
