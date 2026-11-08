## Test Plan

<!-- 339 scenarios: 293 in specs/pet-locus-collaboration/spec.md, 46 in specs/pet-locus-doc-comments/spec.md. One row per scenario. -->
<!-- LIVE LEDGER: flip 🔴 red → 🟢 green as each test passes. ⚪ rows are carried forward and stay ⚪ until their file is ported (then re-run; they must pass). -->

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 新建入口默认只读 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "新建入口默认只读" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 来源会话可写时新建入口仍为只读 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "来源会话可写时新建入口仍为只读" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 常驻空闲时变更访问模式 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "常驻空闲时变更访问模式" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 非驻留时只写行 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "非驻留时只写行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 释放失败时行不变 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "释放失败时行不变" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 释放后 CAS 失败时下次按旧行冷恢复 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "释放后 CAS 失败时下次按旧行冷恢复" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 只释放目标子会话 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "只释放目标子会话" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 目标不在 resident 时须确认已退出 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "目标不在 resident 时须确认已退出" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | parent 已过期时拒绝 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "parent 已过期时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | drain 抛错但子会话已不存在 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "drain 抛错但子会话已不存在" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | drain 与 CAS 之间父会话回复不能冷恢复发布 | packages/dsh-pet/test/locus-retired-child-veto.test.ts | spec Scenario "drain 与 CAS 之间父会话回复不能冷恢复发布" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | inbox 有待处理输入时拒绝变更 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "inbox 有待处理输入时拒绝变更" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | live 不空闲时拒绝变更 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "live 不空闲时拒绝变更" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | acquire 与到达的 at 在写队列内竞争（acquire 先） | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "acquire 与到达的 at 在写队列内竞争（acquire 先）" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | acquire 与到达的 at 在写队列内竞争（at 先） | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "acquire 与到达的 at 在写队列内竞争（at 先）" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 入口忙时拒绝变更 | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "入口忙时拒绝变更" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 变更与停止、改绑、迁移、重建互斥 | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "变更与停止、改绑、迁移、重建互斥" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 写开关关闭时拒绝授予 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "写开关关闭时拒绝授予" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 写开关关闭时迁移得到的完全访问入口可改回只读 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "写开关关闭时迁移得到的完全访问入口可改回只读" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 写开关关闭时既有完全访问入口拒绝服务且行不改写 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "写开关关闭时既有完全访问入口拒绝服务且行不改写" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 完全访问入口拒绝非 allowlist 成员 | packages/dsh-pet/test/locus-admission.test.ts | spec Scenario "完全访问入口拒绝非 allowlist 成员" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 旧命令不再改变状态 | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "旧命令不再改变状态" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | 变更不写审计行 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "变更不写审计行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 访问模式 | stopped 与 invalid 的行不受理访问模式变更 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "stopped 与 invalid 的行不受理访问模式变更" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 完全访问由 allowlist 显式授予且如实说明 | 授予完全访问 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "授予完全访问" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 完全访问由 allowlist 显式授予且如实说明 | 下次组装回读不符时拒绝发布 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "下次组装回读不符时拒绝发布" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 完全访问由 allowlist 显式授予且如实说明 | 授予不依赖上下文确认 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "授予不依赖上下文确认" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 完全访问由 allowlist 显式授予且如实说明 | 非 allowlist 变更被拒 | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "非 allowlist 变更被拒" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 完全访问由 allowlist 显式授予且如实说明 | 关闭期间管理面只禁用完全访问选项 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "关闭期间管理面只禁用完全访问选项" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 完全访问由 allowlist 显式授予且如实说明 | 拒绝必须给出原因而非重试提示 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "拒绝必须给出原因而非重试提示" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 整群重置原语 resetChat | 重置一个群 | packages/dsh-pet/test/locus-reset-chat.test.ts | spec Scenario "重置一个群" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 整群重置原语 resetChat | clearDefaultQa 清除标记 | packages/dsh-pet/test/locus-reset-chat.test.ts | spec Scenario "clearDefaultQa 清除标记" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 整群重置原语 resetChat | backlog 按事务内的投递表改指 | packages/dsh-pet/test/locus-reset-chat.test.ts | spec Scenario "backlog 按事务内的投递表改指" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 整群重置原语 resetChat | 已交给 runtime 的投递不被改指 | packages/dsh-pet/test/locus-reset-chat.test.ts | spec Scenario "已交给 runtime 的投递不被改指" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 整群重置原语 resetChat | stopped 群行下仍有 active 话题时整群重置 | packages/dsh-pet/test/locus-reset-chat.test.ts | spec Scenario "stopped 群行下仍有 active 话题时整群重置" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 整群重置原语 resetChat | 事务内发现 current 则整体回滚 | packages/dsh-pet/test/locus-reset-chat.test.ts | spec Scenario "事务内发现 current 则整体回滚" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 改绑到其他会话 | 改绑成功 | packages/dsh-pet/test/locus-rebind.test.ts | spec Scenario "改绑成功" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 改绑到其他会话 | 目标 W 尚无 locus 主会话 | packages/dsh-pet/test/locus-rebind.test.ts | spec Scenario "目标 W 尚无 locus 主会话" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 改绑到其他会话 | 默认 Q&A 标记被清除且不占用 W1 的默认位 | packages/dsh-pet/test/locus-rebind.test.ts | spec Scenario "默认 Q&A 标记被清除且不占用 W1 的默认位" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 改绑到其他会话 | 存在 backlog 时改绑并改指 | packages/dsh-pet/test/locus-rebind.test.ts | spec Scenario "存在 backlog 时改绑并改指" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 改绑到其他会话 | 改绑被拒绝的各种情形 | packages/dsh-pet/test/locus-rebind.test.ts | spec Scenario "改绑被拒绝的各种情形" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 改绑到其他会话 | 提交前出现 current 时回滚并只补偿本操作的资源 | packages/dsh-pet/test/locus-rebind.test.ts | spec Scenario "提交前出现 current 时回滚并只补偿本操作的资源" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 改绑到其他会话 | 已有 M1 在失败时不受影响 | packages/dsh-pet/test/locus-rebind.test.ts | spec Scenario "已有 M1 在失败时不受影响" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 改绑到其他会话 | 新建 M1 后进程崩溃 | packages/dsh-pet/test/locus-reconcile.test.ts | spec Scenario "新建 M1 后进程崩溃" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 已退役的 locus 子会话不能再运行 | 首次创建经 staged 精确匹配 claim 一次 | packages/dsh-pet/test/locus-retired-child-veto.test.ts | spec Scenario "首次创建经 staged 精确匹配 claim 一次" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 已退役的 locus 子会话不能再运行 | 首图降级轮换后的首次创建 | packages/dsh-pet/test/locus-retired-child-veto.test.ts | spec Scenario "首图降级轮换后的首次创建" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 已退役的 locus 子会话不能再运行 | 被替换的旧子会话冷恢复被拒绝 | packages/dsh-pet/test/locus-retired-child-veto.test.ts | spec Scenario "被替换的旧子会话冷恢复被拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 已退役的 locus 子会话不能再运行 | 存在首次创建恢复债时冷恢复与父回复都被拒绝 | packages/dsh-pet/test/locus-retired-child-veto.test.ts | spec Scenario "存在首次创建恢复债时冷恢复与父回复都被拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 已退役的 locus 子会话不能再运行 | 访问模式变更期间发布被拒绝 | packages/dsh-pet/test/locus-retired-child-veto.test.ts | spec Scenario "访问模式变更期间发布被拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 已退役的 locus 子会话不能再运行 | 普通会话不受影响 | packages/dsh-pet/test/locus-retired-child-veto.test.ts | spec Scenario "普通会话不受影响" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层 v20 只承载同构的 locus 入口行 | 合规数据正常就绪 | packages/dsh-pet/test/locus-host-wiring.test.ts | spec Scenario "合规数据正常就绪" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层 v20 只承载同构的 locus 入口行 | 话题行没有群行使 Domain 打开失败 | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "话题行没有群行使 Domain 打开失败" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层 v20 只承载同构的 locus 入口行 | 群行的 M 无配对使启动对账失败 | packages/dsh-pet/test/locus-reconcile.test.ts | spec Scenario "群行的 M 无配对使启动对账失败" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层 v20 只承载同构的 locus 入口行 | 重复 sessionId 被拒绝 | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "重复 sessionId 被拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层 v20 只承载同构的 locus 入口行 | 全部索引按行重建 | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "全部索引按行重建" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层 v20 只承载同构的 locus 入口行 | 默认 Q&A 经标记查找 | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "默认 Q&A 经标记查找" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层 v20 只承载同构的 locus 入口行 | 同一 M 下两个默认 Q&A 标记被拒绝 | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "同一 M 下两个默认 Q&A 标记被拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层 v20 只承载同构的 locus 入口行 | 从未建立 locus 主会话的会话首次打开 Q&A | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "从未建立 locus 主会话的会话首次打开 Q&A" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层 v20 只承载同构的 locus 入口行 | chat_bindings 旧标记不再被 locus 读取 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "chat_bindings 旧标记不再被 locus 读取" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | dry-run 只读并列出归并 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "dry-run 只读并列出归并" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 确认后整形 locus 行 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "确认后整形 locus 行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | accessMode 只在写加 shell 时为完全访问 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "accessMode 只在写加 shell 时为完全访问" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | retired 改为 stopped 并保留停止时间 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "retired 改为 stopped 并保留停止时间" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 没有任何会话 id 的非 active 行得到新的预留 sessionId | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "没有任何会话 id 的非 active 行得到新的预留 sessionId" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 话题与群的 M 不一致时归并并原地重建 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "话题与群的 M 不一致时归并并原地重建" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 同 W 跨配对群被归并到唯一 active M | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "同 W 跨配对群被归并到唯一 active M" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 归并后默认 Q&A 可发现且不外部建群 | packages/dsh-pet/test/migrate-cli-v20.test.ts (persistence half, A2) + packages/dsh-pet/test/locus-migrated-qa.test.ts (controller half, impl-b) | spec Scenario "归并后默认 Q&A 可发现且不外部建群" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 同 W 没有 active 配对时不归并 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "同 W 没有 active 配对时不归并" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 归并后出现多个默认 Q&A 候选时全部清除（含 stopped 群行） | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "归并后出现多个默认 Q&A 候选时全部清除（含 stopped 群行）" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 全部投递保留并改名 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "全部投递保留并改名" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | default-qa 指针按表改写为群行标记 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "default-qa 指针按表改写为群行标记" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 切换通知与操作被清空，权限审计不变 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "切换通知与操作被清空，权限审计不变" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 非 locus 表逐字节不变 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "非 locus 表逐字节不变" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 话题行没有群行时拒绝 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "话题行没有群行时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | switching、provisioning 与 inherited 行时拒绝 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "switching、provisioning 与 inherited 行时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 存在非终态投递时拒绝 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "存在非终态投递时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 存在未完成的操作时拒绝 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "存在未完成的操作时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 预检通过后出现非终态投递时锁内拒绝 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "预检通过后出现非终态投递时锁内拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 旧形状预检与最终校验分离 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "旧形状预检与最终校验分离" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 整形结果校验失败时回滚 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "整形结果校验失败时回滚" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 从 v18 迁移时先清除旧模型行 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "从 v18 迁移时先清除旧模型行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 从更早版本迁移时全部 locus 行都是旧模型 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "从更早版本迁移时全部 locus 行都是旧模型" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 预检后版本已变化 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "预检后版本已变化" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 未确认时不写入 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "未确认时不写入" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 已是目标版本时无操作 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "已是目标版本时无操作" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 已安装的命令在仓库外可用 | packages/dsh-pet/test/migrate-cli-installed.test.ts | spec Scenario "已安装的命令在仓库外可用" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧数据经 v20 离线迁移清除并整形 | 自检导入全部整形与预检模块 | packages/dsh-pet/test/migrate-cli-installed.test.ts | spec Scenario "自检导入全部整形与预检模块" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话分组且每个入口一行 | 同一工作会话的多个群只出现一次 W | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "同一工作会话的多个群只出现一次 W" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话分组且每个入口一行 | 话题按 chatId 嵌套在群行之下 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "话题按 chatId 嵌套在群行之下" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话分组且每个入口一行 | 原地重建后仍是一行 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "原地重建后仍是一行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话分组且每个入口一行 | 访问模式以单值呈现 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "访问模式以单值呈现" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话分组且每个入口一行 | 投递中由投递表推出 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "投递中由投递表推出" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话分组且每个入口一行 | 改绑后的群行显示来源 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "改绑后的群行显示来源" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话与入口状态筛选，条件由筛选控件自述 | W 已归档的组默认隐藏，勾选「已归档」后显示并提示可改绑 | packages/dsh-pet/test/locus-view.test.ts | W 已归档的组默认隐藏，勾选「已归档」后显示并提示可改绑 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话与入口状态筛选，条件由筛选控件自述 | 停止已归档 W 的群行后被默认隐藏 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "停止已归档 W 的群行后被默认隐藏" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话与入口状态筛选，条件由筛选控件自述 | 默认隐藏已停止与已失效的入口 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "默认隐藏已停止与已失效的入口" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话与入口状态筛选，条件由筛选控件自述 | 未创建入口默认可见 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "未创建入口默认可见" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话与入口状态筛选，条件由筛选控件自述 | 已停止群行下仍有活跃话题 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "已停止群行下仍有活跃话题" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话与入口状态筛选，条件由筛选控件自述 | 筛选只影响呈现 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "筛选只影响呈现" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面按工作会话与入口状态筛选，条件由筛选控件自述 | 筛选后为空时说明可放宽的条件 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "筛选后为空时说明可放宽的条件" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的变更动作只有停止、访问模式与改绑，且以 locusId 加 revision 为围栏 | 停止请求以 locusId 与 revision 为围栏 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "停止请求以 locusId 与 revision 为围栏" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的变更动作只有停止、访问模式与改绑，且以 locusId 加 revision 为围栏 | 修改访问模式提交目标值 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "修改访问模式提交目标值" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的变更动作只有停止、访问模式与改绑，且以 locusId 加 revision 为围栏 | 回执不声称已应用 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "回执不声称已应用" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的变更动作只有停止、访问模式与改绑，且以 locusId 加 revision 为围栏 | 写开关关闭时完全访问不可选 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "写开关关闭时完全访问不可选" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的变更动作只有停止、访问模式与改绑，且以 locusId 加 revision 为围栏 | 投递中时访问模式与停止都置灰 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "投递中时访问模式与停止都置灰" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的变更动作只有停止、访问模式与改绑，且以 locusId 加 revision 为围栏 | 围栏过期时拒绝而不乐观改写 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "围栏过期时拒绝而不乐观改写" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用 | 原 W 已归档时提交改绑 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "原 W 已归档时提交改绑" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用 | 改绑后各入口重置而停止的保持停止 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "改绑后各入口重置而停止的保持停止" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用 | 原 W 未归档时不显示改绑控件 | packages/dsh-pet/test/locus-surface.test.ts | 原 W 未归档时不显示改绑控件 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用 | 无法证明归档时同样不显示改绑控件 | packages/dsh-pet/test/locus-surface.test.ts | 无法证明归档时同样不显示改绑控件 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用 | 有入口在投递时置灰 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "有入口在投递时置灰" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用 | 话题行与评论行没有改绑控件 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "话题行与评论行没有改绑控件" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用 | Host 拒绝目标时不乐观改写 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "Host 拒绝目标时不乐观改写" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供「改绑到其他会话」，仅在原 W 已归档且无 current 投递时可用 | 空输入不可提交 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "空输入不可提交" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 普通资料发布 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "普通资料发布" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 决策往返 | packages/dsh-pet/test/locus-official-queue-turn.test.ts | spec Scenario "决策往返" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 多人连续提问 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "多人连续提问" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 父回复与下一条飞书消息不会合批 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "父回复与下一条飞书消息不会合批" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 超时不重建会话 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "超时不重建会话" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 全部飞书工作统一为子会话常规交互 | 业务结算后下一条仍为独立轮次 | packages/dsh-pet/test/locus-official-queue-turn.test.ts | 业务结算后下一条仍为独立轮次: B uses official queue/user and a new turn/UUID while settled A is still running; parent sendMessage only continues A | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 长父历史不能冒充子身份 | packages/dsh-pet/test/locus-child-context.test.ts | spec Scenario "长父历史不能冒充子身份" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 业务完成只经统一工具提交 | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "业务完成只经统一工具提交" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 无法证明独立能力时拒绝创建 | packages/dsh-pet/test/locus-lazy-child.test.ts | spec Scenario "无法证明独立能力时拒绝创建" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 历史不含最新目录 | packages/dsh-pet/test/locus-context.test.ts | spec Scenario "历史不含最新目录" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 主会话无法回答 | packages/dsh-pet/test/locus-context.test.ts | spec Scenario "主会话无法回答" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 跨 turn 父回复继续 current Delivery | packages/dsh-pet/test/locus-official-queue-turn.test.ts | spec Scenario "跨 turn 父回复继续 current Delivery" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 单独的 agent 消息不能获得飞书能力 | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "单独的 agent 消息不能获得飞书能力" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | GUI 流量仍不能消费 current | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "GUI 流量仍不能消费 current" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 新话题上下文 | packages/dsh-pet/test/locus-child-context.test.ts | spec Scenario "新话题上下文" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 子会话发现不自动成为主会话认知 | packages/dsh-pet/test/locus-child-context.test.ts | 子会话发现不自动成为主会话认知 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 用户主动查阅受实际能力约束 | packages/dsh-pet/test/locus-context.test.ts | spec Scenario "用户主动查阅受实际能力约束" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 冷恢复保留独立历史 | packages/dsh-pet/test/locus-child-preset-runtime.test.ts | spec Scenario "冷恢复保留独立历史" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 旧 fork child 不受影响 | packages/dsh-pet/test/locus-child-context.test.ts | 旧 fork child 不受影响 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 重建后的子会话不继承旧子会话历史 | packages/dsh-pet/test/locus-child-context.test.ts | spec Scenario "重建后的子会话不继承旧子会话历史" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 群级引用触发消息 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "群级引用触发消息": the reply target is the current Delivery's own trigger, never a backlog message | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 话题回复留在原话题 | packages/dsh-pet/test/channel-lark.test.ts | spec Scenario "话题回复留在原话题": uses explicit thread reply semantics for a topic Delivery | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 文档评论回复回到触发评论 | packages/dsh-pet/test/locus-doc-finish.test.ts | spec Scenario "文档评论回复回到触发评论": an anchored entry replies under c2 and records completed/replied | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 文档回复目标与入口不符 | packages/dsh-pet/test/locus-doc-finish.test.ts | spec Scenario "文档回复目标与入口不符": no send, never finishing | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 升级需离线迁移并先备份 | packages/dsh-pet/test/migrate-cli-v20.test.ts | spec Scenario "升级需离线迁移并先备份" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 未迁移时当前版本拒绝打开 | packages/dsh-pet/test/pet-storage-backend.test.ts | refuses a unit whose medium stamp disagrees with the descriptor | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | v15 拒绝打开新版本库 | packages/dsh-pet/test/pet-storage-backend.test.ts | a v15 descriptor refuses a medium stamped 16 with version-mismatch and changes nothing | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | turn 结束不完成请求 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "turn 结束不完成请求": A stays current after its turn ends and B is not delivered | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 相对等待受绝对上限约束 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "相对等待受绝对上限约束": uses the fixed acceptance deadline and hard 24-hour cap for repeated waits | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 超时自动开放下一条 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "超时自动开放下一条": an expired A releases B onto the same child | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 完成与超时竞争 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "完成与超时竞争": the losing finish neither sends nor touches the next Delivery | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 迟到 finish 不消费下一条 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "迟到 finish 不消费下一条": after A expires and B is current, a late finish for A cannot reserve or end B | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 发送确认未知不重放 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "发送确认未知不重放": unknown-terminal advances the queue and is never re-queued | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | Host 重启恢复未过期 current | packages/dsh-pet/test/locus-startup-recovery.test.ts | spec Scenario "Host 重启恢复未过期 current" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | Host 重启处理遗留 finishing | packages/dsh-pet/test/locus-reconcile.test.ts | spec Scenario "Host 重启处理遗留 finishing" | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 私聊与群消息交错 | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "私聊与群消息交错": a GUI turn gets no current capability, sends nothing and leaves the Feishu Delivery to its owner | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 旧代际迟到结算 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "旧代际迟到结算" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 宿主重启无法证明关联 | packages/dsh-pet/test/locus-startup-recovery.test.ts | spec Scenario "宿主重启无法证明关联" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 唯一命中的整词引用成为真实提醒 | packages/dsh-pet/test/channel-lark.test.ts | spec Scenario "唯一命中的整词引用成为真实提醒": renders a plain @display-name into a real mention before sending | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 裸 open_id 引用也成为真实提醒 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "裸 open_id 引用也成为真实提醒": renders a member open id the agent wrote instead of a display name | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 同名歧义不改写 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "同名歧义不改写": leaves an ambiguous display name untouched | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 非成员名字与词内 @ 不改写 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "非成员名字与词内 @ 不改写": a non-member name and an in-word @ in one reply both stay as written | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 非成员 open_id 不改写 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "非成员 open_id 不改写": leaves an open id that is not a member of this chat as written | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 已是标记形式则不改写 | packages/dsh-pet/test/channel-mentions.test.ts | spec Scenario "已是标记形式则不改写": does not rewrite text that already carries markup | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 成员表不可读时仍能发出 | packages/dsh-pet/test/channel-lark.test.ts | spec Scenario "成员表不可读时仍能发出": original text sent, ONE low-cardinality diagnostic, reply outcome intact | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 注入说明平台写法 | packages/dsh-pet/test/locus-context.test.ts | spec Scenario "注入说明平台写法": states the platform mention contract in both delivery variants | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 出站业务回复的 @ 引用渲染为平台真实提醒 | 文档回复不渲染 @ | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "文档回复不渲染 @": text goes out as a plain text element, @ left as typed | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → current Delivery capability 拒绝可判定且不削弱来源隔离 | claim 先于 durable bind 后恢复 | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "claim 先于 durable bind 后恢复" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → current Delivery capability 拒绝可判定且不削弱来源隔离 | GUI steer 继续 fail closed | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "GUI steer 继续 fail closed" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → current Delivery capability 拒绝可判定且不削弱来源隔离 | 到期晋升后迟到执行可辨别 | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "到期晋升后迟到执行可辨别" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → current Delivery capability 拒绝可判定且不削弱来源隔离 | 冷恢复关联无法证明 | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "冷恢复关联无法证明" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 回复被拒且本轮未续进的 Delivery 收尾为失败 | 回复被拒后本轮结束 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "回复被拒后本轮结束" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 回复被拒且本轮未续进的 Delivery 收尾为失败 | 被拒后同轮改正 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "被拒后同轮改正" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 回复被拒且本轮未续进的 Delivery 收尾为失败 | 无关联或迟到旧执行不消费新请求 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "无关联或迟到旧执行不消费新请求" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 回复被拒且本轮未续进的 Delivery 收尾为失败 | 被拒后声明继续等待 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "被拒后声明继续等待" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 回复被拒且本轮未续进的 Delivery 收尾为失败 | 未调用 finish 的普通结束不受影响 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "未调用 finish 的普通结束不受影响" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 回复被拒且本轮未续进的 Delivery 收尾为失败 | 收尾与超时竞争 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "收尾与超时竞争" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus child 具备 caller-bound 的当前入口群只读能力 | safe 档 child 读取当前入口群 | packages/dsh-pet/test/locus-chat-history-tool.test.ts | spec Scenario "safe 档 child 读取当前入口群" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus child 具备 caller-bound 的当前入口群只读能力 | 话题入口读取自己绑定的话题 | packages/dsh-pet/test/locus-chat-history-tool.test.ts | reads the bound topic when the entrance is a topic, never the whole group | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → Locus child 具备 caller-bound 的当前入口群只读能力 | 指定其它目标或未知参数时拒绝且不读取 | packages/dsh-pet/test/locus-chat-history-tool.test.ts | rejects unknown arguments without reading anything | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → Locus child 具备 caller-bound 的当前入口群只读能力 | 游标被篡改或跨域使用 | packages/dsh-pet/test/locus-chat-history-tool.test.ts | spec Scenario "游标被篡改或跨域使用" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus child 具备 caller-bound 的当前入口群只读能力 | 等待期间入口或代际变化 | packages/dsh-pet/test/locus-chat-history-tool.test.ts | spec Scenario "等待期间入口或代际变化" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus child 具备 caller-bound 的当前入口群只读能力 | 截断可识别且可继续 | packages/dsh-pet/test/locus-chat-history-tool.test.ts | bounds the result, marks truncation and hands out a continuation cursor | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → Locus child 具备 caller-bound 的当前入口群只读能力 | 窗口边界不重不漏 | packages/dsh-pet/test/locus-chat-history-tool.test.ts | applies the half-open window and a deterministic order | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → Locus child 具备 caller-bound 的当前入口群只读能力 | 失败与空结果可区分 | packages/dsh-pet/test/locus-chat-history-tool.test.ts | distinguishes a failed read from an empty window | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 按入口过滤 | packages/dsh-pet/test/locus-context-tools.test.ts | 按入口过滤 | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 话题可见所在群条目 | packages/dsh-pet/test/locus-context-tools.test.ts | 话题可见所在群条目 | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 子会话向父询问并在同一 current 上继续 | packages/dsh-pet/test/locus-context-tools.test.ts | 子会话向父询问并在同一 current 上继续 | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 旧代子会话不能询问 | packages/dsh-pet/test/locus-context-tools.test.ts | spec Scenario "旧代子会话不能询问" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话读共识与 locus 主会话工具 | 回复非现行代子会话被拒 | packages/dsh-pet/test/locus-context-tools.test.ts | spec Scenario "回复非现行代子会话被拒" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 首次投递收到完整前言 | packages/dsh-pet/test/locus-preamble-durability.test.ts | spec Scenario "首次投递收到完整前言" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 渲染成功但未入队不消耗首投 | packages/dsh-pet/test/locus-preamble-durability.test.ts | keeps the full preamble while the previous Delivery never bound | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | backlog 中已有其它已接受投递 | packages/dsh-pet/test/locus-preamble-durability.test.ts | does not let an accepted-but-unbound backlog row consume the preamble | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 队列已接受但持久绑定失败 | packages/dsh-pet/test/locus-preamble-durability.test.ts | spec Scenario "队列已接受但持久绑定失败" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 绑定已提交但控制回执丢失 | packages/dsh-pet/test/locus-preamble-durability.test.ts | spec Scenario "绑定已提交但控制回执丢失" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 第二次投递不重复前言但声明档位 | packages/dsh-pet/test/locus-preamble-durability.test.ts | spec Scenario "第二次投递不重复前言但声明档位" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 重启后按送达证据决定 | packages/dsh-pet/test/locus-preamble-durability.test.ts | decides from durable proof after a restart, not from runtime state | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 受既有缺陷影响的 child | packages/dsh-pet/test/locus-preamble-durability.test.ts | spec Scenario "受既有缺陷影响的 child" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 改绑后的首次创建携带来历说明 | packages/dsh-pet/test/locus-delivery-prompt.test.ts | spec Scenario "改绑后的首次创建携带来历说明" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 从零创建的首投前言不含来历说明 | packages/dsh-pet/test/locus-delivery-prompt.test.ts | spec Scenario "从零创建的首投前言不含来历说明" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 原地重建不追加说明 | packages/dsh-pet/test/locus-delivery-prompt.test.ts | spec Scenario "原地重建不追加说明" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 改绑说明在后续重建后仍然出现 | packages/dsh-pet/test/locus-delivery-prompt.test.ts | spec Scenario "改绑说明在后续重建后仍然出现" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 投递 prompt 的首投前言与逐次档位声明 | 文档入口的改绑说明指向文档上下文工具 | packages/dsh-pet/test/locus-delivery-prompt.test.ts | spec Scenario "文档入口的改绑说明指向文档上下文工具" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首条图片不支持时安全降为文本 | packages/dsh-pet/test/locus-first-image-fallback.test.ts | spec Scenario "首条图片不支持时安全降为文本" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首图降级交接使用新快照 | packages/dsh-pet/test/locus-first-image-fallback.test.ts | 首图降级交接使用新快照: keeps original A current, rotates the persisted veto id and executes text once (published=%s) | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首图补偿失败保留恢复债务 | packages/dsh-pet/test/locus-first-delivery-publication.test.ts | 首图补偿失败保留恢复债务: leaves recovery debt if atomic text compensation fails (published=%s) | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首图降级跨崩溃最多一次文本 | packages/dsh-pet/test/locus-first-image-fallback.test.ts | 首图降级跨崩溃最多一次文本: retains text-only disposition and the fresh identity across capacity refusal and restart recovery | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 已接受或认领的图片拒绝不重放 | packages/dsh-pet/test/locus-first-image-fallback.test.ts | 已接受或认领的图片拒绝不重放: never retries a code-shaped image error after the first prompt was really claimed | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首条消息即首个 prompt | packages/dsh-pet/test/locus-lazy-child.test.ts | spec Scenario "首条消息即首个 prompt" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | API 返回前首轮已能解析身份 | packages/dsh-pet/test/locus-lazy-child.test.ts | API 返回前首轮已能解析身份 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首工具等待持久绑定 | packages/dsh-pet/test/locus-host-wiring.test.ts | 首工具等待持久绑定 / 首轮持久绑定失败拒绝执行: gates first caller-bound body on deferred durable UUID bind: %s | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首轮持久绑定失败拒绝执行 | packages/dsh-pet/test/locus-host-wiring.test.ts | 首工具等待持久绑定 / 首轮持久绑定失败拒绝执行: gates first caller-bound body on deferred durable UUID bind: %s | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 回调内发布后创建被拒时回滚 | packages/dsh-pet/test/locus-lazy-child.test.ts | spec Scenario "回调内发布后创建被拒时回滚" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 创建失败不推进代际 | packages/dsh-pet/test/locus-lazy-child.test.ts | spec Scenario "创建失败不推进代际" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 名额不足时保留原请求 | packages/dsh-pet/test/locus-lazy-child.test.ts | spec Scenario "名额不足时保留原请求" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | provider 不能证明独立上下文 | packages/dsh-pet/test/locus-lazy-child.test.ts | provider 不能证明独立上下文 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 首次创建按行上的 accessMode 组装 | packages/dsh-pet/test/locus-lazy-child.test.ts | spec Scenario "首次创建按行上的 accessMode 组装" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 子会话在首条消息到达时创建 | 无法证明释放成功时留下恢复债务 | packages/dsh-pet/test/locus-first-publication-v20.test.ts | spec Scenario "无法证明释放成功时留下恢复债务" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 受管 finish 正常发送 | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "受管 finish 正常发送" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 旁路不可达 | packages/dsh-pet/test/locus-lark-cli-egress-guard.test.ts | spec Scenario "shell 旁路不可达" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 档误用 lark-cli 发送被拦截 | packages/dsh-pet/test/locus-lark-cli-egress-guard.test.ts | spec Scenario "shell 档误用 lark-cli 发送被拦截" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 档读取当前群不被拦截 | packages/dsh-pet/test/locus-lark-cli-egress-guard.test.ts | spec Scenario "shell 档读取当前群不被拦截" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 档的出站保证如实表述 | packages/dsh-pet/test/locus-access-mode.test.ts | spec Scenario "shell 档的出站保证如实表述" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 子委派不能洗白权限 | packages/dsh-pet/test/locus-composition.test.ts | spec Scenario "子委派不能洗白权限" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 收紧层未安装时不发布 | packages/dsh-pet/test/locus-composition.test.ts | spec Scenario "收紧层未安装时不发布" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 隔离能力无法证明时不发布 | packages/dsh-pet/test/locus-composition.test.ts | spec Scenario "隔离能力无法证明时不发布" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | safe-v1 行继续服务 | packages/dsh-pet/test/pet-storage-backend.test.ts | spec Scenario "safe-v1 行继续服务" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 主会话 preset 不影响子会话工具面 | packages/dsh-pet/test/locus-composition.test.ts | spec Scenario "主会话 preset 不影响子会话工具面" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 冷恢复不回落到父组合 | packages/dsh-pet/test/locus-composition.test.ts | spec Scenario "冷恢复不回落到父组合" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 升级前的 legacy child 不可恢复服务 | packages/dsh-pet/test/locus-composition.test.ts | spec Scenario "升级前的 legacy child 不可恢复服务" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | 同一干活主会话服务多个入口 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "同一干活主会话服务多个入口" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | 群行独占 M 与工作区 | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "群行独占 M 与工作区" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | 话题行没有群行时集合校验失败 | packages/dsh-pet/test/locus-persistence-v20.test.ts | spec Scenario "话题行没有群行时集合校验失败" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | locus 主会话归 DSH Pet，入口仍关联干活项目 | packages/dsh-pet/test/locus-three-tier-entity.test.ts | spec Scenario "locus 主会话归 DSH Pet，入口仍关联干活项目" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | locus 主会话工具面锁死 | packages/dsh-pet/test/locus-three-tier-entity.test.ts | locus 主会话工具面锁死 | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | 插件挂入自有作用域的委派工具在执行时被拒 | packages/dsh-pet/test/locus-host-wiring.test.ts | 插件挂入自有作用域的委派工具在执行时被拒: refuses Agent Team tools mounted in its own scope | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → Locus 三层实体 | 干活主会话不得是子会话 | packages/dsh-pet/test/locus-three-tier-entity.test.ts | 干活主会话不得是子会话 | 🟢 green (carried) |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | auto 建立 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "auto 建立" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 话题内首次 bind 一次建出群行和话题行 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "话题内首次 bind 一次建出群行和话题行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 话题首次 at 同样补出群行 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "话题首次 at 同样补出群行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 群已存在时话题追加不触碰外部 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "群已存在时话题追加不触碰外部" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 绑定到已有干活主会话复用 locus 主会话 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "绑定到已有干活主会话复用 locus 主会话" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 跨 W 的 bind 被拒绝且不触碰 Host | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "跨 W 的 bind 被拒绝且不触碰 Host" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 同一 W 的 bind 幂等 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "同一 W 的 bind 幂等" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 同群两个话题同时首次 at | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "同群两个话题同时首次 at" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 话题 bind 与群首次 at 同时到达（bind 先获得群锁） | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "话题 bind 与群首次 at 同时到达（bind 先获得群锁）" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 群首次 at 先于话题 bind 到达 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "群首次 at 先于话题 bind 到达" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 同一 W 的 Q&A 与首次 bind 并发 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "同一 W 的 Q&A 与首次 bind 并发" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 提交前失败只补偿本操作的资源 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "提交前失败只补偿本操作的资源" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 提交后 finalize 失败走已提交操作恢复 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "提交后 finalize 失败走已提交操作恢复" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 入口建立统一为一条路径 | 建立失败不留半成品 | packages/dsh-pet/test/locus-dual-creation.test.ts | spec Scenario "建立失败不留半成品" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 干活主会话归档 | packages/dsh-pet/test/locus-serviceability.test.ts | spec Scenario "干活主会话归档" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 子会话不可用只换该入口一代 | packages/dsh-pet/test/locus-controller.test.ts | spec Scenario "子会话不可用只换该入口一代" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 名额不足的冷恢复保留原代际 | packages/dsh-pet/test/locus-capacity.test.ts | spec Scenario "名额不足的冷恢复保留原代际" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 组合失败的分类处理 | packages/dsh-pet/test/locus-composition.test.ts | spec Scenario "组合失败的分类处理" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | locus 主会话不可用时整体迁移 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "locus 主会话不可用时整体迁移" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 任何群有 current 投递时不迁移 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "任何群有 current 投递时不迁移" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 无新 at 时结算推进 backlog，先核验 M 并迁移再派发 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "无新 at 时结算推进 backlog，先核验 M 并迁移再派发" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 无 active 配对时一次触发迁移所有配对下的群 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "无 active 配对时一次触发迁移所有配对下的群" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 已交给 runtime 的投递同样阻止迁移 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "已交给 runtime 的投递同样阻止迁移" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 其它群有 current 时 backlog 保持 backlog | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "其它群有 current 时 backlog 保持 backlog" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 静默 backlog 只在触发时检查硬上限 | packages/dsh-pet/test/locus-delivery-lifecycle-v20.test.ts | spec Scenario "静默 backlog 只在触发时检查硬上限" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 只有 backlog 不阻止迁移 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "只有 backlog 不阻止迁移" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 两个触发同时到达只建一个 M1 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "两个触发同时到达只建一个 M1" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | M1 再次不可用时重复同一机制 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "M1 再次不可用时重复同一机制" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 事务内复查发现 current 则整体回滚 | packages/dsh-pet/test/locus-migrate-whole-w.test.ts | spec Scenario "事务内复查发现 current 则整体回滚" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 忙时拒绝停止 | packages/dsh-pet/test/locus-controller.test.ts | spec Scenario "忙时拒绝停止" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 停止群行不连带停止话题行 | packages/dsh-pet/test/locus-controller.test.ts | spec Scenario "停止群行不连带停止话题行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 停止的入口重新绑定同一 W | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "停止的入口重新绑定同一 W" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 换绑与归档按层处理 | 停止的群行只重启群行 | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "停止的群行只重启群行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的会话可用性以持久证据判定 | 重启后未加载的会话不得报为不可用 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "重启后未加载的会话不得报为不可用" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的会话可用性以持久证据判定 | 已归档优先于可读 | packages/dsh-pet/test/locus-management.test.ts | reports an archived session as archived without inspecting it | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的会话可用性以持久证据判定 | 缺少冷读能力不臆测 | packages/dsh-pet/test/locus-management.test.ts | omits availability when the Host cannot cold-read at all | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的会话可用性以持久证据判定 | 未创建入口的预留会话不报缺失 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "未创建入口的预留会话不报缺失" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 同名入口仍可区分 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "同名入口仍可区分" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 名称不可得时不猜测 | packages/dsh-pet/test/locus-surface.test.ts | never says 兜底显示: an unnamed entry reads 入口 · <code> / 话题 · <code> | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 短码不是身份 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "短码不是身份" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 文档入口短码确定且与群可区分 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "文档入口短码确定且与群可区分" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 多个文档入口短码互不相同 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "多个文档入口短码互不相同" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 同前缀的评论入口短码可区分 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "同前缀的评论入口短码可区分": reversed comment ids | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面的标识以确定性短码表达且名称与短码成对 | 文档标题不可得 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "文档标题不可得": 文档 · <code> and 评论 · <code> fallbacks, marked as placeholders | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供双向可达且目标不可达时 fail closed | 两种读法同源一致 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "两种读法同源一致" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供双向可达且目标不可达时 fail closed | 父会话已归档时不可跳转 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "父会话已归档时不可跳转" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供双向可达且目标不可达时 fail closed | 话题身份不可证时退化 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "话题身份不可证时退化" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面提供双向可达且目标不可达时 fail closed | 未创建的入口没有子会话可跳转 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "未创建的入口没有子会话可跳转" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 默认 Q&A 在管理面只读呈现 | 默认 Q&A 只做标记 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "默认 Q&A 只做标记" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 默认 Q&A 在管理面只读呈现 | 尚无默认 Q&A 时说明出处 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "尚无默认 Q&A 时说明出处" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面不提供新建外部资源的入口 | 管理面无绑定控件 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "管理面无绑定控件" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面不提供新建外部资源的入口 | 生命周期动作仍可用 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "生命周期动作仍可用" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面不提供新建外部资源的入口 | 话题行不接受会话标识输入 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "话题行不接受会话标识输入" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面如实呈现全部生命周期状态 | 正在建树的入口可见 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "正在建树的入口可见" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面如实呈现全部生命周期状态 | 非活跃状态不被省略 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "非活跃状态不被省略" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面如实呈现全部生命周期状态 | 含未创建入口的快照可加载 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "含未创建入口的快照可加载" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 管理面如实呈现全部生命周期状态 | 未知状态值不伪装成活跃 | packages/dsh-pet/test/locus-surface.test.ts | spec Scenario "未知状态值不伪装成活跃" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 全文评论进入文档级入口 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "全文评论进入文档级入口" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 划词评论进入评论级入口 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "划词评论进入评论级入口" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 重启后再投递排队中的划词评论 | packages/dsh-pet/test/locus-doc-redelivery.test.ts | (describe) spec Scenario "重启后再投递排队中的划词评论" | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 划词评论下的后续回复留在同一入口 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "划词评论下的后续回复留在同一入口": an add_reply keeps the comment endpoint with its new reply_id | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 划词评论先于文档级 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "划词评论先于文档级" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 知识库文档以底层 token 为根 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "知识库文档以底层 token 为根": the root is the event's obj token, never a wiki node | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 评论查询一次失败后重试成功 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "评论查询一次失败后重试成功" | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 评论查询重试期间停用 channel | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "评论查询重试期间停用 channel": no further query, no admission | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 无法判定全文或划词 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "无法判定全文或划词": three failed calls end in comment-scope-unknown, nothing admitted | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 文档评论按全文/划词同构映射为文档级与评论级入口 | 非 docx 评论 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "非 docx 评论": no comment query | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 非 allowlist 成员在已授权文档提问 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "非 allowlist 成员在已授权文档提问" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 非 allowlist 成员首次 @ 未初始化文档 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "非 allowlist 成员首次 @ 未初始化文档" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | shell 档文档拒绝他人 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "shell 档文档拒绝他人" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 划词评论先建立时也披露 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "划词评论先建立时也披露" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 建立回执披露提问范围 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | spec Scenario "建立回执披露提问范围": the first whole-doc entry discloses to the asker (a new mentioning full comment) | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 未 @bot 的评论 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "未 @bot 的评论": dropped before any query | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 来自 agent 或 bot 的评论 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "来自 agent 或 bot 的评论" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 同一回复重复到达 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "同一回复重复到达": the dedup key is the composite message id, never event_id | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 长线程中的触发回复 | packages/dsh-pet/test/channel-lark-drive.test.ts | spec Scenario "长线程中的触发回复": pages +list-replies until the trigger is found | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 评论准入与群消息准入同构且静默 fail closed | 触发回复正文不可得 | packages/dsh-pet/test/doc-comment-admission.test.ts | spec Scenario "触发回复正文不可得" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 全文评论绑定已知会话 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "全文评论绑定已知会话" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 文档改绑后已有划词评论不迁移 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "文档改绑后已有划词评论不迁移" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 划词评论内绑定只影响该评论 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "划词评论内绑定只影响该评论" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 划词评论内首次绑定同时建立文档根 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "划词评论内首次绑定同时建立文档根" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 跨 W 的评论内绑定被拒绝 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "跨 W 的评论内绑定被拒绝" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 控制命令在评论中按所在入口生效 | 非 allowlist 控制命令 | packages/dsh-pet/test/doc-comment-intake.test.ts | spec Scenario "非 allowlist 控制命令" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 划词评论回复回到触发评论 | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "划词评论回复回到触发评论": an anchored entry replies under its own comment, never a new comment | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 全文评论以新全文评论答复并提及提问者 | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "全文评论以新全文评论答复并提及提问者": a whole-doc entry never replies to c1; it opens a new full comment mentioning the asker | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 回复目标与入口不符 | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "回复目标与入口不符": a different comment or token sends nothing | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 过期的反馈 | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "过期的反馈": expiry is the failed phase (Typing removed, CRY added, no text) | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 表情接口失败 | packages/dsh-pet/test/locus-on-demand-provisioning.test.ts | (describe) spec Scenario "表情接口失败": feedback failure never changes Delivery truth | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | 评论回复发送结果未知 | packages/dsh-pet/test/doc-comment-egress.test.ts | spec Scenario "评论回复发送结果未知": a timeout or vague output is unknown, never retried | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 评论出站只经受管完成工具且反馈 fail-soft | shell 档直接调用评论或文档写命令 | packages/dsh-pet/test/locus-lark-cli-egress-guard.test.ts | spec Scenario "shell 档直接调用评论或文档写命令" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 文档子会话的工具面 | packages/dsh-pet/test/locus-doc-context-tool.test.ts | spec Scenario "文档子会话的工具面" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 文档 Delivery 不调用 IM 接口 | packages/dsh-pet/test/locus-delivery-prompt.test.ts | spec Scenario "文档 Delivery 不调用 IM 接口" (prompt side): no group-read probe text, no @ promise, no chat history tool | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 触发者姓名查询失败 | packages/dsh-pet/test/locus-delivery-prompt.test.ts | (describe) spec Scenario "触发者姓名查询失败" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | 文档待办跳转 | packages/dsh-pet/test/ledger-view.test.ts | spec Scenario "文档待办跳转": a doc-level todo carries no comment note | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → IM 专属能力在文档入口按明确规则处置 | IM 入口不受影响 | packages/dsh-pet/test/locus-delivery-prompt.test.ts | spec Scenario "IM 入口不受影响": the group prompt is unchanged | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 文档入口具备 caller-bound 的只读上下文 | 读取当前评论线程与文档 | packages/dsh-pet/test/locus-doc-context-tool.test.ts | spec Scenario "读取当前评论线程与文档": thread first, body truncated inside the combined 28000 budget | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 文档入口具备 caller-bound 的只读上下文 | 内容中嵌入指令 | packages/dsh-pet/test/locus-doc-context-tool.test.ts | spec Scenario "内容中嵌入指令": the line only appears after the untrusted label, inside the tool text | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 文档入口具备 caller-bound 的只读上下文 | 无 current Delivery 时读取 | packages/dsh-pet/test/locus-doc-context-tool.test.ts | spec Scenario "无 current Delivery 时读取": refuses with no-current and reads nothing | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 文档入口具备 caller-bound 的只读上下文 | bot 失去文档读取权限 | packages/dsh-pet/test/locus-doc-context-tool.test.ts | spec Scenario "bot 失去文档读取权限": a failed body read reports failure and the platform code | 🟢 green (carried) |
| specs/pet-locus-doc-comments/spec.md → 管理面呈现文档入口且不提供新建入口 | 文档与评论嵌套呈现 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "文档与评论嵌套呈现": the doc root carries title/url, comments nest by chatId with their quote | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 管理面呈现文档入口且不提供新建入口 | 标题不可得 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "标题不可得": a failing resolver leaves the facts out instead of failing the view | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 管理面呈现文档入口且不提供新建入口 | 无建立控件 | packages/dsh-pet/test/locus-management.test.ts | spec Scenario "无建立控件" | 🟢 green |
| specs/pet-locus-doc-comments/spec.md → 管理面呈现文档入口且不提供新建入口 | 改绑动作只在文档根行 | packages/dsh-pet/test/locus-view.test.ts | spec Scenario "改绑动作只在文档根行" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 改绑到其他会话 | 改绑目标的 locus 主会话已不可用 | packages/dsh-pet/test/locus-rebind.test.ts | 目标 W 的 M 不可用：管理面改绑先整 W 迁移 (D7) — 三个用例（fake + real） | 🟢 green |
| specs/pet-locus-collaboration/spec.md → provisioning 失败超时后不再阻塞 | 超时后重试 | packages/dsh-pet/test/locus-provisioning-timeout.test.ts | 超时后重试 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → provisioning 失败超时后不再阻塞 | 超时前仍阻塞 | packages/dsh-pet/test/locus-provisioning-timeout.test.ts | 超时前仍阻塞 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → provisioning 失败超时后不再阻塞 | 补偿失败继续阻塞 | packages/dsh-pet/test/locus-provisioning-timeout.test.ts | 补偿失败继续阻塞 | 🟢 green |
| specs/pet-locus-collaboration/spec.md → provisioning 失败超时后不再阻塞 | 未创建任何资源的失败不阻塞 | packages/dsh-pet/test/locus-provisioning-timeout.test.ts | 失败且没有任何 resourceRefs：立刻可重试 | 🟢 green |

## Coverage Notes

- Rows: 339. At planning time (334 rows) 🔴 red 241, ⚪ existing carried forward 93, 🟢 green 0; the 5 later rows were added during implementation as 🟢.
- By capability: collaboration 293 (288 at planning time: 🔴 225, ⚪ 63); doc-comments 46 (🔴 16, ⚪ 30).
- ⚪ rule applied: the scenario text is byte-identical to the current spec (compared by requirement + name, plus five migration-gate scenarios identical under their old requirement) AND an existing test title carries the scenario name (or, for 12 scenarios, is the one existing test that asserts it; those titles are quoted exactly). Everything else is 🔴, including every scenario whose text changed and every unchanged scenario for which no existing test could be named. A ⚪ row still needs its owner to port that test's fixtures to the v20 row shape (see "Fixture port" below); it must pass after the contract freeze, it is not new work.
- New test files are marked (new); a path under packages/dsh-pet/test/ that does not exist yet is created by its owner.

### Test files by owner (each file belongs to exactly one owner scope of design D14)

**Owner A = persistence + migration**

- A: `packages/dsh-pet/test/locus-controller-persistence-adapter.test.ts` (existing) — 🔴 1, ⚪ 0
- A: `packages/dsh-pet/test/locus-delivery.test.ts` (existing) — 🔴 2, ⚪ 1
- A: `packages/dsh-pet/test/locus-persistence.test.ts` (existing) — 🔴 0, ⚪ 1
- A: `packages/dsh-pet/test/locus-persistence-v20.test.ts` (new) — 🔴 11, ⚪ 0
- A: `packages/dsh-pet/test/locus-reconcile.test.ts` (existing) — 🔴 2, ⚪ 0
- A: `packages/dsh-pet/test/locus-reset-chat.test.ts` (new) — 🔴 6, ⚪ 0
- A: `packages/dsh-pet/test/locus-startup-recovery.test.ts` (existing) — 🔴 2, ⚪ 0
- A: `packages/dsh-pet/test/migrate-cli.test.ts` (existing) — 🔴 0, ⚪ 4
- A: `packages/dsh-pet/test/migrate-cli-installed.test.ts` (existing) — 🔴 1, ⚪ 1
- A: `packages/dsh-pet/test/migrate-cli-v20.test.ts` (new) — 🔴 23, ⚪ 0
- A: `packages/dsh-pet/test/pet-storage-backend.test.ts` (existing) — 🔴 1, ⚪ 2

**Owner B = controller / bind / control / resolution / serviceability / channel / collab tools / index.ts**

- B: `packages/dsh-pet/test/channel-lark.test.ts` (existing) — 🔴 0, ⚪ 3
- B: `packages/dsh-pet/test/channel-lark-drive.test.ts` (existing) — 🔴 0, ⚪ 1
- B: `packages/dsh-pet/test/channel-mentions.test.ts` (existing) — 🔴 0, ⚪ 5
- B: `packages/dsh-pet/test/doc-comment-egress.test.ts` (existing) — 🔴 0, ⚪ 6
- B: `packages/dsh-pet/test/doc-comment-intake.test.ts` (existing) — 🔴 9, ⚪ 6
- B: `packages/dsh-pet/test/locus-capacity.test.ts` (existing) — 🔴 1, ⚪ 0
- B: `packages/dsh-pet/test/locus-chat-history-tool.test.ts` (existing) — 🔴 3, ⚪ 5
- B: `packages/dsh-pet/test/locus-context-tools.test.ts` (existing) — 🔴 2, ⚪ 3
- B: `packages/dsh-pet/test/locus-control.test.ts` (existing) — 🔴 4, ⚪ 0
- B: `packages/dsh-pet/test/locus-controller.test.ts` (existing) — 🔴 4, ⚪ 0
- B: `packages/dsh-pet/test/locus-doc-context-tool.test.ts` (existing) — 🔴 1, ⚪ 4
- B: `packages/dsh-pet/test/locus-doc-finish.test.ts` (existing) — 🔴 0, ⚪ 2
- B: `packages/dsh-pet/test/locus-doc-redelivery.test.ts` (existing) — 🔴 0, ⚪ 1
- B: `packages/dsh-pet/test/locus-dual-creation.test.ts` (new) — 🔴 18, ⚪ 0
- B: `packages/dsh-pet/test/locus-host-wiring.test.ts` (existing) — 🔴 1, ⚪ 3
- B: `packages/dsh-pet/test/locus-migrate-whole-w.test.ts` (new) — 🔴 10, ⚪ 0
- B: `packages/dsh-pet/test/locus-official-queue-turn.test.ts` (existing) — 🔴 2, ⚪ 1
- B: `packages/dsh-pet/test/locus-on-demand-provisioning.test.ts` (existing) — 🔴 0, ⚪ 2
- B: `packages/dsh-pet/test/locus-rebind.test.ts` (new) — 🔴 7, ⚪ 0
- B: `packages/dsh-pet/test/locus-reply-tool.test.ts` (existing) — 🔴 8, ⚪ 1
- B: `packages/dsh-pet/test/locus-retired-child-veto.test.ts` (new) — 🔴 7, ⚪ 0
- B: `packages/dsh-pet/test/locus-serviceability.test.ts` (existing) — 🔴 1, ⚪ 0
- B: `packages/dsh-pet/test/locus-settlement-integration.test.ts` (existing) — 🔴 9, ⚪ 6
- B: `packages/dsh-pet/test/locus-three-tier-entity.test.ts` (existing) — 🔴 1, ⚪ 2

**Owner C = access-mutation / composition / policy / admission / lazy-child / child-delivery / first-delivery / staging / first-delivery preamble**

- C: `packages/dsh-pet/test/doc-comment-admission.test.ts` (existing) — 🔴 3, ⚪ 5
- C: `packages/dsh-pet/test/locus-access-mode.test.ts` (new) — 🔴 21, ⚪ 0
- C: `packages/dsh-pet/test/locus-admission.test.ts` (existing) — 🔴 1, ⚪ 0
- C: `packages/dsh-pet/test/locus-child-context.test.ts` (existing) — 🔴 3, ⚪ 2
- C: `packages/dsh-pet/test/locus-child-preset-runtime.test.ts` (existing) — 🔴 0, ⚪ 1
- C: `packages/dsh-pet/test/locus-composition.test.ts` (existing) — 🔴 7, ⚪ 0
- C: `packages/dsh-pet/test/locus-context.test.ts` (existing) — 🔴 1, ⚪ 3
- C: `packages/dsh-pet/test/locus-delivery-prompt.test.ts` (existing) — 🔴 5, ⚪ 3
- C: `packages/dsh-pet/test/locus-first-delivery-publication.test.ts` (existing) — 🔴 0, ⚪ 1
- C: `packages/dsh-pet/test/locus-first-image-fallback.test.ts` (existing) — 🔴 1, ⚪ 3
- C: `packages/dsh-pet/test/locus-lark-cli-egress-guard.test.ts` (existing) — 🔴 4, ⚪ 0
- C: `packages/dsh-pet/test/locus-lazy-child.test.ts` (existing) — 🔴 6, ⚪ 2
- C: `packages/dsh-pet/test/locus-preamble-durability.test.ts` (existing) — 🔴 5, ⚪ 3

**Owner D = management / routes / client**

- D: `packages/dsh-pet/test/ledger-view.test.ts` (existing) — 🔴 0, ⚪ 1
- D: `packages/dsh-pet/test/locus-management.test.ts` (existing) — 🔴 8, ⚪ 4
- D: `packages/dsh-pet/test/locus-surface.test.ts` (existing) — 🔴 18, ⚪ 0
- D: `packages/dsh-pet/test/locus-view.test.ts` (existing) — 🔴 21, ⚪ 5

Note: several carried files are not named in the D14 write-scope table (channel/lark, channel/mentions, doc-comment-*, locus-doc-*, locus-settlement-integration, locus-official-queue-turn, locus-reply-tool, locus-chat-history-tool, locus-child-*, locus-delivery-prompt, locus-context, locus-three-tier-entity, ledger-view, pet-storage-backend). They were assigned to the owner whose D14 source files they import; lead to confirm. None of them gets a new 🔴 assertion except where listed in the table above.

### Shared fixtures (build once, before the 2A–2D work that needs them)

- v19 raw-SQLite seed helpers (owner A, `packages/dsh-pet/test/support/v19-seed.ts`, new): write real v19-shaped `loci`, `locus_deliveries`, `locus_indexes` (real `default-qa` shape `{key: 'default-qa:<M>', locusIds: [<old locusId>]}`, truncated-key variants), `locus_mains` (active + retired pairings), `locus_operations`, `locus_switch_notices`, `locus_permission_audit`, `ledger_item` rows directly with SQLite, with a builder for multi-generation entries, rows with neither `childSessionId` nor `reservedChildSessionId`, topic rows on a different M than their group row, and a v18/v17 variant. Used by `migrate-cli-v20.test.ts`, `migrate-cli-installed.test.ts`, `locus-persistence-v20.test.ts` (version-mismatch of a v19 DB), `pet-storage-backend.test.ts`.
- accepted + backlog delivery fixture (owner A, `support/delivery-fixtures.ts`, new): a Delivery persisted exactly as acceptance writes it (`accepted`, in backlog, with NO execution / inbox / turn evidence), plus `queued` / `running` / `finishing` variants carrying their proof fields. Used by `locus-reset-chat.test.ts`, `locus-rebind.test.ts`, `locus-migrate-whole-w.test.ts`, `locus-delivery.test.ts`. "queued but uninjected" MUST NOT be used.
- two-sibling live child fixture (owner C, `support/sibling-children.ts`, new): one locus main session with two resident children (A, B), a fake `drainChildren(exactLiveParent, [childIds])` that releases only the listed ids, records its arguments, and can be told to succeed as a no-op for an absent target, to reject on a stale parent, or to reject after the child is already gone. Used by `locus-access-mode.test.ts` and `locus-retired-child-veto.test.ts`.
- paused-CAS repository seam (owner A, `support/delivery-fixtures.ts`): lets a test hold the access-change CAS commit in flight to run the drain→CAS window scenarios and the acquire-vs-accept ordering in both directions.
- whole-W topology builder (owner B, `support/w-topology.ts`, new): a W with N pairings (active / retired / archived M, M missing, wrong preset, outside the DSH Pet workspace), chats under each, current / backlog deliveries per chat, and call-order recorders for `beginProvisioning`, `ensureLocusMain`, `createAutoWorkSession`, `startContinuable`. Used by `locus-dual-creation`, `locus-rebind`, `locus-migrate-whole-w`.
- management snapshot builder (owner D, `support/mgmt-snapshot.ts`, new): v20-shaped view rows (`work`, `locusMain`, `accessMode`, `revision`, `reboundFrom`, `defaultQa`, in-flight flag) shared by `locus-view`, `locus-management`, `locus-surface`.

### Files expected to be deleted or rewritten wholesale

- delete: `packages/dsh-pet/test/locus-carry-topics.test.ts` — its subject module is deleted by D11/D8; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-retirement.test.ts` — its subject module is deleted by D11/D8; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-switch-notice.test.ts` — its subject module is deleted by D11/D8; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-pending-application-repository.test.ts` — its subject module is deleted by D11/D8; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-pending-file-permission.test.ts` — its subject module is deleted by D11/D8; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-pending-permission.test.ts` — its subject module is deleted by D11/D8; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-pending-tier-prompt.test.ts` — its subject module is deleted by D11/D8; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-tool-tier-mutation.test.ts` — its subject module is deleted by D11/D8; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-permission-mutation.test.ts` — its subject module is deleted by D11/D8; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-persistence-v19.test.ts` — replaced by locus-persistence-v20.test.ts; record each removed test in `deleted-tests.md`.
- delete: `packages/dsh-pet/test/locus-rebind-archive.test.ts` — replaced by locus-rebind.test.ts; record each removed test in `deleted-tests.md`.
- rewrite (keep the file, replace the v19-shaped parts; carried ⚪ tests in them must survive): `migrate-cli.test.ts`, `locus-controller.test.ts`, `locus-repository.test.ts`, `locus-persistence.test.ts`, `locus-validate-set.test.ts`, `locus-reconcile.test.ts`, `locus-controller-persistence-adapter.test.ts`, `locus-management.test.ts`, `locus-routes.test.ts`, `locus-view.test.ts`, `locus-surface.test.ts`, `locus-global-write-disable.test.ts`, `wire-locus.test.ts`, `locus-startup-recovery.test.ts`, `locus-delivery.test.ts`. In `migrate-cli.test.ts` only the v19 target/clean-up parts go; the four preflight/lock/confirm tests carried by the ⚪ rows (存在非终态投递时拒绝, 存在未完成的操作时拒绝, 预检通过后出现非终态投递时锁内拒绝, 未确认时不写入) stay and move to the v19 → v20 target.

### Fixture port (⚪ files that still compile against removed fields)

Existing locus-related test files that reference removed row fields (`parentLocusId`, `childComposition`, `toolTier`, `contextAnchor`, `replacesLocusId`, `reservedChildSessionId`, `permission:{…}`) and must be ported to the v20 shape by their owner after the contract freeze: `doc-comment-admission` (C), `locus-admission` (C), `locus-architecture-acceptance` (A), `locus-child-context` (C), `locus-child-contract` (?), `locus-child-delivery` (?), `locus-composition` (C), `locus-context-repository` (?), `locus-context-tool` (?), `locus-context` (C), `locus-control` (B), `locus-controller-persistence-adapter` (A), `locus-controller-races` (?), `locus-controller` (B), `locus-delivery-prompt` (C), `locus-diagnostics` (?), `locus-doc-finish` (B), `locus-doc-redelivery` (B), `locus-first-delivery-publication` (C), `locus-first-image-fallback` (C), `locus-global-write-disable` (?), `locus-host-wiring` (B), `locus-interrupted-current-cas` (?), `locus-lazy-child` (C), `locus-management` (D), `locus-official-queue-turn` (B), `locus-on-demand-provisioning` (B), `locus-persistence` (A), `locus-policy-verification` (?), `locus-preamble-durability` (C), `locus-prepublication-staging` (C), `locus-preset` (?), `locus-reconcile` (A), `locus-reply-tool` (B), `locus-repository` (?), `locus-resolution` (?), `locus-serviceability` (B), `locus-settlement-integration` (B), `locus-shutdown-freeze` (?), `locus-sibling-boundary` (?), `locus-startup-cold-read` (?), `locus-startup-official-cold-read` (?), `locus-surface` (D), `locus-three-tier-entity` (B), `locus-validate-set` (?), `locus-view` (D), `migrate-cli` (A), `wire-locus` (?). Files with owner "?" are not referenced by any plan row; the lead assigns them at integration.
- `ledger_item` `generation` (D13.8): the ledger parser change is covered by the ⚪ rows carried from the ledger/doc tests plus the 非 locus 表逐字节不变 row; `ledger-store.test.ts`, `ledger-todo.test.ts` etc. only need fixtures that stop writing `generation`.

### Scenarios whose assertions cross an owner seam (placed by primary seam)

- Locus 访问模式 → drain 与 CAS 之间父会话回复不能冷恢复发布 → `locus-retired-child-veto (B)`: needs C's `accessChanging` set exposed through the repository port (A) before the `agent/created` lookup can consult it.
- 已退役的 locus 子会话不能再运行 → 访问模式变更期间发布被拒绝 → `locus-retired-child-veto (B)`: same dependency as above.
- 完全访问由 allowlist 显式授予且如实说明 → 拒绝必须给出原因而非重试提示 → `locus-access-mode (C)`: the Feishu control reply text is B (control.ts), the management text is D; this row asserts the access-mutation reason codes only, the surface texts are asserted by 管理面的变更动作 rows (D) and 旧命令不再改变状态 (B).
- Locus 业务出站只能经受管 finish → shell 档的出站保证如实表述 → `locus-access-mode (C)`: the management/receipt wording is rendered by D and B; the row asserts the shared disclosure string produced in C.
- 换绑与归档按层处理 → 组合失败的分类处理 → `locus-composition (C)`: class A also sets `invalid` through the controller (B); the row injects faults at the composition seam and asserts the resulting row/outcome.
- 换绑与归档按层处理 → 事务内复查发现 current 则整体回滚 → `locus-migrate-whole-w (B)`: the repository half (rows/pairing unchanged) is also asserted by 整群重置原语 → 事务内发现 current 则整体回滚 (A); compensation of the new M1/space is B.
- 改绑到其他会话 → 新建 M1 后进程崩溃 → `locus-reconcile (A)`: compensator is invoked from startup reconcile (A); the operation record is written by B's `beginProvisioning(kind:'rebind')`.
- 持久层 v20 只承载同构的 locus 入口行 → 合规数据正常就绪 → `locus-host-wiring (B)`: Pet ready + routes registered is index.ts (B); the Domain/reconcile outcomes are asserted by the two A rows that follow it.
- 入口建立统一为一条路径 → 提交后 finalize 失败走已提交操作恢复 → `locus-dual-creation (B)`: recovery of a committed operation runs in A (`startup-recovery`); the row drives it through the controller and asserts no duplicate W/M/space.
- 换绑与归档按层处理 → 无新 at 时结算推进 backlog，先核验 M 并迁移再派发 → `locus-migrate-whole-w (B)`: claim ordering is `channel/locus-controller` (B); the re-read of the new reservation is persistence (A) and the single first creation is C (`startContinuable` count).
- 管理面按工作会话分组且每个入口一行 → 投递中由投递表推出 / 改绑后的群行显示来源 → `locus-management (D)`: relies on A's delivery-table projection but asserts only the view row.
- 文档评论按全文/划词同构映射… → 划词评论先于文档级 / 全文评论进入文档级入口 / 划词评论进入评论级入口 → `doc-comment-intake (B)`: one-commit dual creation is the same controller path as the IM rows (B) over A's `commitProvisioning`.

### Ordering notes for the live ledger

- Rows owned by A and B in `locus-dual-creation`, `locus-rebind`, `locus-migrate-whole-w` cannot go green until A has landed `commitProvisioning({rows, main?})`, `resetChat`, `rebindChat`/migrate commit and the `parent-loci` index; rows owned by D in `locus-surface` need B's `rebind` action; rows in `locus-access-mode` need A's `acquireAccessChange`.
- The 12 ⚪ rows whose test title does not carry the scenario name (chat-history tool ×5, management availability ×2, preamble durability ×3, storage backend ×2) were matched by reading the existing test; the owner re-checks the assertion when porting.
