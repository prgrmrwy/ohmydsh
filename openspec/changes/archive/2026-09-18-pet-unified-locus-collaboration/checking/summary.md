# 历史验收与研究摘要：Unified Pet locus

此摘要区分实施证明和真实验收，不将早期“未接线”调查或后续组件绿灯当作完整生产验收。

- 最后 worktree 核验记录 Pet build/typecheck、97 文件 1474 项测试、root 101 pass/1 skip；runtime override 的唯一依赖实例、silent idle child、事务介质和独占 writer 已有隔离证明。
- 生产接线缺能力时 fail closed；历史 legacy 表/Session 保留但不得回落为新的业务执行路径。停流、快照与回滚流程保留在 change 的 cutover-runbook 中。
- macOS 实际沙箱矩阵证明只读拒写、选定普通/ws/sw 根内写入与兄弟/父目录拒绝；不能用较早仅阅读 contract 的推断覆盖实测结论。
- 已捕获真实 bot-added 事件并验证 envelope；topic-message 窗口没有匹配样本，不能声称 topic 入站闭环通过。最后记录仍区分合入后物化/真实入站与仓库组件证明。
- 并发研究的可复用边界：读历史与请求父推理是不同操作；按话题分片不能自动消除父队列热点；worktree 将写时覆盖变成合入冲突，不消除语义冲突或依赖共享风险。研究建议不等于已实施产品行为。

## 证据退役（2026-10-27）

按用户批准移除 14 份详细能力调查、外部研究、旧 YAML 计划/trails 和门禁输出；没有把研究全文或原始执行数据改名留存。

原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-09-18-pet-unified-locus-collaboration/checking/<原相对路径>`。仅用于历史追溯，不是当前能力或实时外部证据承诺。
