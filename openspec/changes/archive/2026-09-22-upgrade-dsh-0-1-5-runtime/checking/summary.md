# 历史验收摘要：DSH 0.1.5 运行体升级

本摘要保留当时结果与负面发现，不代表当前发布物复验；具体任务状态以本 change tasks 为准。

- 最终 root 132 项通过，9 包 build/typecheck/test 全绿，旧版依赖缺口已在目标依赖树复跑消除。Session 迁移/重启、Worktree 文本/图片/文件/混合首发取得证据。
- 旧版 GUI 没有数值基线，无法构造逐项“升级前后一致”；不能把旧待跑清单当已测 oracle。
- 官方迁移库尾部截断会静默发布半截会话，不是 fail closed；中段损坏、未知代和活 writer 竞争拒绝，外部删除持有中的 lock 文件会打破排他。中断后重跑与备份恢复迁移具有确定性。库级注入不等于完整 overlay Host E2E。
- Connection RPC 缺路由引发 405，修复后通；Host fence、认证与文件读策略必须分开判断，cold Session 可解析不等于 receipt 跨 Session 可复用。
- plugin-list 同时修复覆盖式接线识别和 symlink 入口守卫。native pty 的路径归属比 maps 中数量更重要，早期“单路径即终端可用”的判据已作废。
- 回滚旧源码还必须恢复旧依赖；仅退源码导致的构建错误不证明回滚不可行。备份曾权限过宽，已改 owner-only；多帧 zstd 不能只解首帧统计事件数。
- 插件 GUI 与部分真实模型/工具通过，但未登录 provider、若干媒体/search、代理正向与真实 editor UI 等仍缺证；不能外推全矩阵通过。
- 最终候选只改显示清单代码，未重跑完整 devbox gate，依据组成输入不变作了明确豁免判断；不是纯文档 diff。host/lumevm 未由本 change 远程部署。

## 证据退役（2026-10-27）

按用户批准移除 35 份详细环境/运行时/迁移/插件报告与运维交接，保留结论、重要失败和未验边界；没有把原始输出或真实 Session 数据转存到摘要。

原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-09-22-upgrade-dsh-0-1-5-runtime/checking/<原相对路径>`。Git 仅保留当时入库文本，不承诺其外部原始证据仍存在。
