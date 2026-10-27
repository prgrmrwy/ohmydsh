# 历史验收摘要：清理后 Session 恢复普通会话

2026-08-21 的真实 Host/GUI 验收记录判定 PASS；这里只保留结论，不表示当前版本已复验。

- 旧 cleaned tombstone 在启动时保持 fail closed，直到真实 unarchive 事件才变为 released。
- release 后多次状态读取均不再绑定 Worktree；原 Workspace 可见并能打开完整历史，composer 为普通非空会话形态，无 Worktree 状态/开关。
- worktree/分支清单、operation 与 Workspace/Session 数量在 release 前后保持不变，审计 tombstone 仍在。
- 再次 archive/unarchive 未让 released 状态回退。验收未提交新用户消息；截图当时已按 ephemeral 规则不入库。

## 证据退役（2026-10-27）

按用户批准移除 1 份含具体环境与会话定位信息的 acceptance 记录，未将原始记录改名搬入摘要。历史原件：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-08-21-restore-cleaned-session-as-ordinary/checking/acceptance.md`。Git 追溯不等于外部截图仍可用。
