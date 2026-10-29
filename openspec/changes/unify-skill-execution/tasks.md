## 1. Native helper migration

- [x] 1.1 新增独立fixture验证两个Node入口argv/cwd/exit、发现优先级、缺失CLI；先记录入口缺失RED再回绿。
- [x] 1.2 保留memex多库、eval排除、显式lib/help直传与失败继续；以聚焦fixture验收。
- [x] 1.3 旧sh改薄转发、skill文档改Node并更新Windows driver；通过源规则和driver测试。

## 2. Integration

- [x] 2.1 验证Linux完整测试、artifact、strict、diff；原生Windows无Bash执行聚焦合同并披露未跑平台。
- [ ] 2.2 复核完整diff与归档冲突处理，提交并用受控流程合入推送；记录已知限制，不重启或清理worktree。
