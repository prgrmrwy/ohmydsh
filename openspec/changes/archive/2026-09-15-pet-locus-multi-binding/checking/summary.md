# 历史 spike 摘要：Pet locus 多绑定

这些是 2026-09 的特定 DSH 发布物/集成调查结论，不应直接覆盖较新的运行体或后继 unified-locus 规范。

- in-process fork 当时不能单独指定 cwd；不能用跨进程 provider 的 cwd 字段推定 fork 能力。
- 事件 schema 存在 thread_id，普通群线程样本有值，但 topic 群真实事件尚未得到证明；缺 thread_id 必须保守退化，不可猜测。
- 当时 workspace-write 的根来自不可变 Session cwd；兄弟 worktree 不在根内，而子目录 worktree 会连主 checkout 一起放开。prompt 目录锚定不是沙箱隔离证明。
- child 的 caller-bound 工具与 allowlist provider 可分开安装；不能为了 context 工具覆盖 child 的继承 skill catalog。
- 父子消息 acceptance 不等于持久父信箱或 exactly-once；fork seed 仅为一次性历史快照。

## 证据退役（2026-10-27）

按用户批准移除 1 份详细 spike 记录，保留不含实际会话/工作区定位信息的结论；未复验这些旧能力。

历史原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-09-15-pet-locus-multi-binding/checking/spike-findings.md`。
