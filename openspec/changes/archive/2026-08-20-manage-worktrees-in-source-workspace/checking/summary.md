# 历史验收摘要：源 Workspace 内管理 Worktree

本摘要仅保留当时的结论，不是当前版本复验或原始证据的替代品。

- 最后 Loop 4 在用户重启 Host 后完成：managed-root Bash 诊断、安全清理和 schema-v1 兼容三项通过；preflight 与 post-clean 各 16 项断言通过。
- 安全清理删除预期 worktree/任务分支，保留 cleaned audit tombstone、原 Workspace 中的 archived Session 及其历史字节。
- schema-v1 旧目标没有自动迁移；未打开时日志哈希保持。打开 blank Session 后追加了标准结束事件，不能声称打开前后 byte-identical。
- 同源 oracle 独立性低；此前轮次的 blocked/失败不回写为通过。该浏览器验收不替代包测试、类型检查、安全或性能验证。

## 证据退役（2026-10-27）

按用户批准的 checking 清理，移除 15 份旧计划、trail、门禁输出及一次性运行脚本；未迁移为新格式或改名保留原始数据。保留的 report 是历史记录，不保证其旧截图或基线仍可获取。

原文件可通过 Git 对象查阅：`git show 120f91403a36b44c47baf6f740e0fca2184e4b83:openspec/changes/archive/2026-08-20-manage-worktrees-in-source-workspace/checking/<原相对路径>`。此锚点仅追溯此前已入库文件，不保证原始外部证据留存。
