# Pet目标运行时前置证据与未闭合门禁

## 本轮执行

devbox隔离HOME/DSH_HOME/XDG，无模型网络请求、真实飞书消息或生产数据写入。

- 官方源码639ed015397290b3745d163aafe02ffee4aa3f84：continuation149、preset-registry45、storage-domain33、storage-sqlite22，合计10文件249/249 PASS。
- 在干净上游checkout应用已经审查的settlement-notice.patch（SHA256 86310610709d80d540dd97b1b7fb1fbc4012a3ef1f5eadc12ba590f7905005fa），运行continuation：160/160 PASS。完成后逆向应用同一patch，git status恢复clean；未改构建产物或重新部署。
- baseline149与patched160须分别记录，不能把无补丁源码测试当作Pet四项兼容能力证明。

## 证据能证明什么

continuation使用真实AgentLoop/持久化/continuation服务与脚本化LLM适配器；测试涵盖8个live child默认名额、共享与释放、cold admission、已有resident投递、idle pending、settlement与descriptor恢复等。patched新增seam测试证明静默结算、idle创建、独立组合/保存preset以及精确child Session相关源码行为。

preset registry与storage实际契约suite通过，SQLite测试含持久化/模式/错误处理。但这不等于Pet完整Host启动配置下的SQLite跨进程单writer证明，也不是Pet UI操作及live locus全路径证明。

## 不可直接启用的旧探针

- `test/independent-runtime-probe.test.ts`固定0.1.2-rc.1 launcher basename、组件版本和旧patch hash，且本身标注helper-level、不是full child/Host acceptance。旧cold preset测试特意证明历史缺口，不能当作期望正常行为。
- `test/inquiry-runtime-probe.test.ts`同样锁历史运行体；`vitest.collaboration-runtime.config.ts`只接受历史0.1.2-locus-atomic.1 storage provenance。不得删除身份检查以让当前版本“通过”。
- 这些探针迁移属于新的测试实施范围，需要保持目标能力与来源审核；当前未改历史断言或marker，未冒称inquiry能力可用。

## 升级门禁状态

5.1、5.6、5.7、5.8继续未完成：仍缺Pet装配下真实locus/冷恢复/GUI打开路径、精确任务投递及完整单writer；真实Feishu/media更需要明确的验收账号与目标。现有2813包级测试+本轮160兼容测试不能替代这些项目。

本轮不改变本机cockpit认证产物、任何生产Host、正式pin或发布状态。整体升级仍NO-GO；已授权cockpit修复及最小真实bridge聚合链路的PASS结论不受影响。
