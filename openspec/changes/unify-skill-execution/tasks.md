## 1. Native helper migration

- [x] 1.1 新增独立fixture验证两个Node入口argv/cwd/exit、发现优先级、缺失CLI；先记录入口缺失RED再回绿。
- [x] 1.2 保留memex多库、eval排除、显式lib/help直传与失败继续；以聚焦fixture验收。
- [x] 1.3 旧sh改薄转发、skill文档改Node并更新Windows driver；通过源规则和driver测试。

## 2. Integration

- [x] 2.1 验证Linux完整测试、artifact、strict、diff；原生Windows无Bash执行聚焦合同并披露未跑平台。
- [x] 2.2 复核完整diff与归档冲突处理，提交并用受控流程合入推送；记录已知限制，不重启或清理worktree。

## 3. Owner-requested full native acceptance

- [x] 3.1 在Linux本机、corp-mac-vm和Windows PC使用同一公开源码、独立目录/profile/prefix/端口验证初始化、link和helper合同；保留失败记录。
- [x] 3.2 以独立ASCII/Unicode对照定位Windows Node24.12同步删除失败；验证官方校验和的临时24.20运行时，更新推荐版本与逐行启动文档。
- [ ] 3.3 修复真实Windows冷启动缓存清理的Git长路径失败；先保留Native RED，再以调用级配置回绿并纳入Windows合同通道，不修改全局Git配置。
- [ ] 3.4 同一修复提交在三端完成完整build×2/no-change、doctor/dump、认证页面、真实Host启动/重启PID变化/停止释放端口；复核并交付轻量结果，单列终端关闭/桌面UI限制。
