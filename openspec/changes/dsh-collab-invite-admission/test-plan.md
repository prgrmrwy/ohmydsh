## Test Plan

<!-- LIVE LEDGER：apply 期间测试通过时把对应行由 🔴 red 改为 🟢 green；verify 阶段任何一行仍为 red 都会阻塞。 -->

测试名一律以 `<id>：<场景名>` 作为 `it()` 标题，便于按 id grep。"既有"表示该场景行为在本 change 中不变、已有同名或等价测试；这类行仍从 🔴 red 开始，apply 时按新代码重新运行并迁移到新工具名后才能翻绿，不追认历史结果。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 跨 workspace 调用仍归属实际会话 | packages/dsh-collab/test/session-provider.test.ts | `admit-01：跨 workspace 调用仍归属实际会话`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 参数伪造身份被拒绝 | packages/dsh-collab/test/session-provider.test.ts | `admit-02：参数伪造身份被拒绝` | 🟢 green |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 无调用会话不能访问 | packages/dsh-collab/test/session-provider.test.ts | `admit-03：无调用会话不能访问`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 邀请模式下未配置名单的普通会话可建空间 | packages/dsh-collab/test/session-provider.test.ts | `admit-04：邀请模式下未配置名单的普通会话可建空间` | 🟢 green |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 排除名单与派生会话不可调用 | packages/dsh-collab/test/session-provider.test.ts | `admit-05：排除名单与派生会话不可调用` | 🟢 green |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 兼容模式保持首版行为 | packages/dsh-collab/test/session-provider.test.ts | `admit-06：兼容模式保持首版行为` | 🟢 green |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 非法配置拒绝启动 | packages/dsh-collab/test/session-provider.test.ts | `admit-07：非法配置拒绝启动` | 🟢 green |
| specs/dsh-collab/spec.md → 发现与绑定只使用精确普通会话身份 | 邀请即授权且无需重启 | packages/dsh-collab/test/session-provider.test.ts | `claim-01：邀请即授权且无需重启` | 🟢 green |
| specs/dsh-collab/spec.md → 发现与绑定只使用精确普通会话身份 | 被邀请不等于可读 | packages/dsh-collab/test/session-provider.test.ts | `claim-02：被邀请不等于可读` | 🟢 green |
| specs/dsh-collab/spec.md → 发现与绑定只使用精确普通会话身份 | 短前缀不能邀请 | packages/dsh-collab/test/session-provider.test.ts | `claim-03：短前缀不能邀请`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 发现与绑定只使用精确普通会话身份 | 不认领人、排除项或受管子代理 | packages/dsh-collab/test/session-provider.test.ts | `claim-04：不认领人、排除项或受管子代理` | 🟢 green |
| specs/dsh-collab/spec.md → 发现与绑定只使用精确普通会话身份 | 冷核验只读元数据 | packages/dsh-collab/test/session-provider.test.ts | `claim-05：冷核验只读元数据` | 🟢 green |
| specs/dsh-collab/spec.md → 发现与绑定只使用精确普通会话身份 | 元数据列表不可用时不认领 | packages/dsh-collab/test/session-provider.test.ts | `claim-06：元数据列表不可用时不认领` | 🟢 green |
| specs/dsh-collab/spec.md → 冷恢复与presence不伪造可达性 | 冷恢复保留真实工具装配 | packages/dsh-collab/test/controller-seams.test.mjs | `cold-01：冷恢复保留真实工具装配`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 冷恢复与presence不伪造可达性 | 邀请模式下名单外冷会话可投递 | packages/dsh-collab/test/session-provider.test.ts | `cold-02：邀请模式下名单外冷会话可投递` | 🟢 green |
| specs/dsh-collab/spec.md → 冷恢复与presence不伪造可达性 | presence不触发恢复 | packages/dsh-collab/test/session-provider.test.ts | `cold-03：presence不触发恢复`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 冷恢复与presence不伪造可达性 | 枚举缺失不能证明删除 | packages/dsh-collab/test/session-provider.test.ts | `cold-04：枚举缺失不能证明删除`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 冷恢复与presence不伪造可达性 | 恢复期间被归档不晚发 | packages/dsh-collab/test/session-provider.test.ts | `cold-05：恢复期间被归档不晚发` | 🟢 green |
| specs/dsh-collab/spec.md → 冷恢复与presence不伪造可达性 | 排除名单变更经重启生效且不晚发 | packages/dsh-collab/test/session-provider.test.ts | `cold-06：排除名单变更经重启生效且不晚发` | 🟢 green |
| specs/dsh-collab/spec.md → 冷恢复与presence不伪造可达性 | 关闭时未结束恢复不晚发 | packages/dsh-collab/test/session-provider.test.ts | `cold-07：关闭时未结束恢复不晚发`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 创建邀请加入与协商闭环 | packages/dsh-collab/test/tools.test.ts | `tool-01：创建邀请加入与协商闭环`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 相同命令结果未知后重试 | packages/dsh-collab/test/tools.test.ts | `tool-02：相同命令结果未知后重试` | 🟢 green |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 枚举取值与字段不匹配被拒绝 | packages/dsh-collab/test/tools.test.ts | `tool-03：枚举取值与字段不匹配被拒绝` | 🟢 green |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 旧命令的重试不被插件挡住 | packages/dsh-collab/test/tools.test.ts | `tool-04：旧命令的重试不被插件挡住` | 🟢 green |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 工具描述携带重试与重读规则 | packages/dsh-collab/test/controller-seams.test.mjs | `tool-05：工具描述携带重试与重读规则` | 🟢 green |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 工具面封闭 | packages/dsh-collab/test/controller-seams.test.mjs | `tool-06：工具面封闭` | 🟢 green |
| specs/dsh-collab/spec.md → 残留锁只在死亡证明后解除 | 上次异常退出留下的锁在重启后自动清理 | packages/dsh-collab/test/released-host-seams.mjs | `lock-01：上次异常退出留下的锁在重启后自动清理` | 🟢 green |
| specs/dsh-collab/spec.md → 残留锁只在死亡证明后解除 | 无日志的孤儿锁在重启后清理并允许重新创建 | packages/dsh-collab/test/host.test.ts | `lock-02：无日志的孤儿锁在重启后清理并允许重新创建` | 🟢 green |
| specs/dsh-collab/spec.md → 残留锁只在死亡证明后解除 | 孤儿锁的进程仍存活时保留 | packages/dsh-collab/test/host.test.ts | `lock-03：孤儿锁的进程仍存活时保留` | 🟢 green |
| specs/dsh-collab/spec.md → 残留锁只在死亡证明后解除 | 活进程或无法判断的锁被保留 | packages/dsh-collab/test/host.test.ts | `lock-04：活进程或无法判断的锁被保留` | 🟢 green |
| specs/dsh-collab/spec.md → 残留锁只在死亡证明后解除 | 两次读取之间锁被替换时保留 | packages/dsh-collab/test/host.test.ts | `lock-05：两次读取之间锁被替换时保留` | 🟢 green |
| specs/dsh-collab/spec.md → 残留锁只在死亡证明后解除 | 一个被锁空间不吞掉其他空间 | packages/dsh-collab/test/host.test.ts | `lock-06：一个被锁空间不吞掉其他空间`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 残留锁只在死亡证明后解除 | 运行期不自动解锁 | packages/dsh-collab/test/host.test.ts | `lock-07：运行期不自动解锁` | 🟢 green |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 运行中目标下一回合收到 | packages/dsh-collab/test/component-seams.test.mjs | `wake-01：运行中目标下一回合收到`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 空闲目标收到带来源与入口提示的指针 | packages/dsh-collab/test/session-provider.test.ts | `wake-02：空闲目标收到带来源与入口提示的指针` | 🟢 green |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 不满足准入条件的目标不投递 | packages/dsh-collab/test/session-provider.test.ts | `wake-03：不满足准入条件的目标不投递` | 🟢 green |
| specs/dsh-collab/spec.md → 验收不触碰日常会话与部署 | 真实隔离Host验证完整接缝 | packages/dsh-collab/test/released-host-seams.mjs | `accept-01：真实隔离Host验证完整接缝` | 🟢 green |
| specs/dsh-collab/spec.md → 验收不触碰日常会话与部署 | 未执行真实Host实验不能宣称完成 | packages/dsh-collab/test/released-host-seams.mjs | `accept-02：未执行真实Host实验不能宣称完成`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 验收不触碰日常会话与部署 | 移除保留持久日志 | packages/dsh-collab/test/released-host-seams.mjs | `accept-03：移除保留持久日志`（既有） | 🟢 green |
| specs/dsh-collab/spec.md → 错误披露不泄露无权空间 | 无权空间的响应完全一致 | packages/dsh-collab/test/tools.test.ts | `disclose-01：无权空间的响应完全一致` | 🟢 green |
| specs/dsh-collab/spec.md → 错误披露不泄露无权空间 | 成员仍得到业务错误 | packages/dsh-collab/test/tools.test.ts | `disclose-02：成员仍得到业务错误` | 🟢 green |
| specs/dsh-collab/spec.md → 错误披露不泄露无权空间 | 创建冲突是唯一例外 | packages/dsh-collab/test/tools.test.ts | `disclose-03：创建冲突是唯一例外` | 🟢 green |
| specs/dsh-collab/spec.md → 损坏日志可离线抢救或换新空间重建 | 抢救后重启即可继续 | packages/dsh-collab/test/salvage.test.ts | `salvage-01：抢救后重启即可继续` | 🟢 green |
| specs/dsh-collab/spec.md → 损坏日志可离线抢救或换新空间重建 | 空间被持有时拒绝抢救 | packages/dsh-collab/test/salvage.test.ts | `salvage-02：空间被持有时拒绝抢救` | 🟢 green |
| specs/dsh-collab/spec.md → 损坏日志可离线抢救或换新空间重建 | 写临时文件失败时原日志不变 | packages/dsh-collab/test/salvage.test.ts | `salvage-03：写临时文件失败时原日志不变` | 🟢 green |
| specs/dsh-collab/spec.md → 损坏日志可离线抢救或换新空间重建 | 替换前中断时原日志仍在 | packages/dsh-collab/test/salvage.test.ts | `salvage-04：替换前中断时原日志仍在` | 🟢 green |
| specs/dsh-collab/spec.md → 损坏日志可离线抢救或换新空间重建 | 首行即损坏时允许原 ID 重新创建 | packages/dsh-collab/test/salvage.test.ts | `salvage-05：首行即损坏时允许原 ID 重新创建` | 🟢 green |
| specs/dsh-collab/spec.md → 损坏日志可离线抢救或换新空间重建 | 换新空间重建无需停机 | packages/dsh-collab/test/salvage.test.ts | `salvage-06：换新空间重建无需停机` | 🟢 green |
| specs/dsh-collab/spec.md → 抢救如实报告后果与中断状态 | 输出含收据丢失与 seq 复用提示 | packages/dsh-collab/test/salvage.test.ts | `salvage-report-01：输出含收据丢失与 seq 复用提示` | 🟢 green |
| specs/dsh-collab/spec.md → 抢救如实报告后果与中断状态 | 抢救后游标重置可读到新提交 | packages/dsh-collab/test/salvage.test.ts | `salvage-report-02：抢救后游标重置可读到新提交` | 🟢 green |
| specs/dsh-collab/spec.md → 抢救如实报告后果与中断状态 | 上次抢救中断时拒绝重跑 | packages/dsh-collab/test/salvage.test.ts | `salvage-report-03：上次抢救中断时拒绝重跑` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 被唤醒后一次调用即知下一步 | packages/dsh-collab/test/status.test.ts | `status-shape-01：被唤醒后一次调用即知下一步` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 成员文本不进入输出 | packages/dsh-collab/test/status.test.ts | `status-shape-02：成员文本不进入输出` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口隐藏不合规标识 | 旧台账的不合规 itemId 被隐藏 | packages/dsh-collab/test/status.test.ts | `status-ident-01：旧台账的不合规 itemId 被隐藏` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口隐藏不合规标识 | 不合规的 spaceId 不出现 | packages/dsh-collab/test/status.test.ts | `status-ident-02：不合规的 spaceId 不出现` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口隐藏不合规标识 | 合规标识原样输出 | packages/dsh-collab/test/status.test.ts | `status-ident-03：合规标识原样输出` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | Leader 转交后邀请者仍正确 | packages/dsh-collab/test/status.test.ts | `status-pending-01：Leader 转交后邀请者仍正确` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 关闭的空间不产生建议 | packages/dsh-collab/test/status.test.ts | `status-pending-02：关闭的空间不产生建议` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 已拒绝或已离开的空间不出现 | packages/dsh-collab/test/status.test.ts | `status-pending-03：已拒绝或已离开的空间不出现` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 回复后不再出现 | packages/dsh-collab/test/status.test.ts | `status-pending-04：回复后不再出现` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 回复后对方再提问重新出现 | packages/dsh-collab/test/status.test.ts | `status-pending-05：回复后对方再提问重新出现` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 与内核状态一致 | packages/dsh-collab/test/status.test.ts | `status-pending-06：与内核状态一致` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 邀请只暴露最少信息 | packages/dsh-collab/test/status.test.ts | `status-next-01：邀请只暴露最少信息` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 联系人只来自种子名单 | packages/dsh-collab/test/status.test.ts | `status-next-02：联系人只来自种子名单` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 元数据不可用时联系人为空 | packages/dsh-collab/test/status.test.ts | `status-next-03：元数据不可用时联系人为空` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 没有待办时没有建议 | packages/dsh-collab/test/status.test.ts | `status-next-04：没有待办时没有建议` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口是可过滤的纯读取 | 过滤到有权空间 | packages/dsh-collab/test/status.test.ts | `status-pure-01：过滤到有权空间` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口是可过滤的纯读取 | 过滤到无关或不存在的空间返回空 | packages/dsh-collab/test/status.test.ts | `status-pure-02：过滤到无关或不存在的空间返回空` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口是可过滤的纯读取 | 一个坏空间不拖垮入口 | packages/dsh-collab/test/status.test.ts | `status-pure-03：一个坏空间不拖垮入口` | 🟢 green |
| specs/dsh-collab/spec.md → 状态入口是可过滤的纯读取 | 状态入口是纯读取 | packages/dsh-collab/test/status.test.ts | `status-pure-04：状态入口是纯读取` | 🟢 green |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | 生命周期前后工具定义字节一致 | packages/dsh-collab/test/controller-seams.test.mjs | `surface-01：生命周期前后工具定义字节一致` | 🟢 green |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | schema 体积在预算内 | packages/dsh-collab/test/controller-seams.test.mjs | `surface-02：schema 体积在预算内` | 🟢 green |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | 超预算夹具被测试拦住 | packages/dsh-collab/test/controller-seams.test.mjs | `surface-03：超预算夹具被测试拦住` | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 动作记为 principal 反查到的成员 | packages/collab-kernel/test/auth.test.ts | `auth-01：动作记为 principal 反查到的成员`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 首次创建与创建重放 | packages/collab-kernel/test/auth.test.ts | `auth-02：首次创建与创建重放`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 重复创建同一协作空间 | packages/collab-kernel/test/auth.test.ts | `auth-03：重复创建同一协作空间`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 命令不做成员反查 | packages/collab-kernel/test/auth.test.ts | `auth-04：internal 命令不做成员反查`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 不存在的协作空间先于成员反查报错 | packages/collab-kernel/test/auth.test.ts | `auth-05：不存在的协作空间先于成员反查报错`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 公开命令与授权表一致 | packages/collab-kernel/test/auth.test.ts | `auth-06：公开命令与授权表一致`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 没有按字符串分发的入口 | packages/collab-kernel/test/auth.test.ts | `auth-07：没有按字符串分发的入口`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 非 Leader 邀请被拒 | packages/collab-kernel/test/auth.test.ts | `auth-08：非 Leader 邀请被拒`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 他人代为加入被拒 | packages/collab-kernel/test/auth.test.ts | `auth-09：他人代为加入被拒`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | provider 代表其他 channel 被拒 | packages/collab-kernel/test/auth.test.ts | `auth-10：provider 代表其他 channel 被拒`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | agent 调用 confirmDecision 被拒 | packages/collab-kernel/test/auth.test.ts | `auth-11：agent 调用 confirmDecision 被拒`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 不能执行成员命令 | packages/collab-kernel/test/auth.test.ts | `auth-12：internal 不能执行成员命令`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | gone 成员不能读写 | packages/collab-kernel/test/auth.test.ts | `auth-13：gone 成员不能读写`（既有） | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 可以读取任意空间 | packages/collab-kernel/test/auth.test.ts | `auth-14：host-index 可以读取任意空间` | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 不能执行任何写命令 | packages/collab-kernel/test/auth.test.ts | `auth-15：host-index 不能执行任何写命令` | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 在已关闭空间执行成员命令仍为 FORBIDDEN | packages/collab-kernel/test/auth.test.ts | `auth-16：internal 在已关闭空间执行成员命令仍为 FORBIDDEN` | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 未知 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | `auth-17：未知 internal purpose 被拒绝` | 🟢 green |
| specs/collab-kernel/spec.md → 公开纯状态推导函数 | 公开推导与内核状态一致 | packages/collab-kernel/test/public-entry.test.ts | `reduce-01：公开推导与内核状态一致` | 🟢 green |
| specs/collab-kernel/spec.md → 公开纯状态推导函数 | 推导不修改输入 | packages/collab-kernel/test/public-entry.test.ts | `reduce-02：推导不修改输入` | 🟢 green |
| specs/collab-kernel/spec.md → 公开纯状态推导函数 | 推导函数不接触外部 | packages/collab-kernel/test/public-entry.test.ts | `reduce-03：推导函数不接触外部` | 🟢 green |

## Coverage Notes

- **共享夹具**：
  - `packages/dsh-collab/test/support/` 新增 `world.ts`：一个可配置 `admission`/`allowedSessionIds`/`denySessionIds` 的 `SessionAccess` 替身，加上可让 `listSessions`、`observeSession`、`inspect`、`resolveAgent`、`presence` 一经调用即抛错的计数替身，供 `claim-*`、`status-*` 断言调用次数为 0。
  - `salvage.test.ts` 用临时目录与可注入的 `fs` 替身制造 fsync、link、rename 失败，以及在第 ④⑤ 步之间终止。临时目录删除前核验其真实父目录和前缀。
  - 锁测试（`lock-*`）用注入的 pid 探测替身返回 ESRCH、存活、EPERM，不杀死任何无关进程。
- **真实宿主层**：`controller-seams.test.mjs`、`component-seams.test.mjs`、`released-host-seams.mjs` 只在隔离临时 HOME、合成会话和本地 ScriptedAdapter 下运行（沿用基线 test/README 的依赖准备）。`lock-01` 的"重启后自动清理"在 `released-host-seams.mjs` 中复用现有 SIGKILL 子验收：第二个官方进程启动后，断言锁被清理、日志被重放。`accept-01` 用同一入口改写 budget/kill 两个子验收的预期。
- **体积测试**（`surface-02`、`surface-03`）：从真实 request header 的 `tools` 数组按原顺序取 `collab_` 前缀的工具对象，以 `JSON.stringify(...).length` 计数，上限 4200。超预算夹具通过替换一个工具的描述触发失败，断言失败消息包含实际长度。
- **一致性测试**：`status-pending-06`（与内核状态一致）与 `reduce-01` 用同一组提交记录：前者比较 status 字段，后者比较 `overview` 的 members、items、leader、status、lastSeq。
- **salvage 解码一致性**：夹具覆盖"非法 UTF-8 出现在第 N 行"，断言 salvage 保留的前缀与 `FileStore.open` 能加载的记录完全一致（第 4 轮复核补充）。
- **既有测试迁移**：标"既有"的行在实现 12 个工具后，需要把调用改为新工具名（例如 `collab_join` → `collab_member{action:'join'}`）后重新运行；只有在新代码上通过才翻绿。
- **不在本 ledger 内**：基线 change `dsh-collab` 中未被本 delta 修改的 requirement（profile 共享台账与生命周期封禁、无人类通道、产物内联当前源码）沿用其既有测试，作为回归项在全量测试中运行。
