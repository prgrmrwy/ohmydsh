# 历史验收摘要：可测量 Jev shadow 门禁

实现修复 Phase-1 的测量可达性，不启用 advisory 或自动路由；缺少任一必须证据，Phase-2 admission 仍为 not-established。

- v2 记录区分 real-vibe、synthetic-fixture 和 unknown；只有可靠标注的 real-vibe 参与真实质量/成本/失败/时延门槛。
- 旧 v1 可读，缺失事实保持 unknown/unavailable，不扫描旧 prompt 补齐。完整 classify+条件 decide 时延须用单调钟测量，缺失不当零。
- 外部成本接受、独立隐私/集成证据与用户批准不可由已测 gate 代替；pass 仅产生另行提案资格。
- 当时 focused 33 项通过，root 201 pass/2 skip/0 fail；artifact、严格规范、diff 检查通过，部署 sync 第二次无变化。
- 回滚不自动清空 local shadow 记录；旧 reader 忽略 v2 时，若需重新采集旧 schema，清除历史必须另行接受数据丢失。

## 证据退役（2026-10-27）

按用户批准移除 acceptance 与 Phase-2 gate 两份详细记录，不将固定旧阈值作为现行规则。历史原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-09-25-make-jev-shadow-gates-measurable/checking/<原相对路径>`。
