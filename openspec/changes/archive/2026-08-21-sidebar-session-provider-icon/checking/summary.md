# 历史验收摘要：侧栏 provider 图标

最后 Loop 3 为真实 GUI 用户确认 PASS，不追溯改写此前自动化 blocked 记录。

- 已确认 DeepSeek、Codex 与 OpenCode 路由各显示正确品牌；模型选择器修改后无需发送即更新当前会话图标。
- StateDot、时间、菜单与拖拽未受影响。包 typecheck/build、21 项测试及严格规范检查通过。
- 早期隔离浏览器被原生目录选择器阻塞，未绕过 GUI 写 registry；特殊数据、冷历史冲突与 DOM 破坏仍属人工/专项边界。
- oracle 同源，独立性低；当时截图已作为 ephemeral 数据移出版本树。

## 证据退役（2026-10-27）

按用户批准移除 3 份旧 YAML 计划与 trails，保留历史 report；其完整台账只在历史版本中可追溯，不把本摘要视作可重放计划。

原件入口：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-08-21-sidebar-session-provider-icon/checking/<原相对路径>`。
