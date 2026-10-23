## Test Plan

Every scenario in `specs/` maps to a named test. The ledger is live: during apply, each row moves from 🔴 to 🟢 as its test passes.

- **`🟢 green (regression)`** rows are scenarios carried unchanged in MODIFIED requirements, already covered by existing tests (baseline: kernel 38 files / 224 tests, dsh-collab vitest 6 files / 118 tests, all green on 2026-10-23). They must stay green throughout; no red-first step is invented for them.
- **`🔴 red (changed)`** rows are existing tests whose assertions this change extends:
  - `members-05` must also cover `previousBindings`;
  - `admit-05` must use a subagent that no integrator resolves;
  - `tool-06` must also assert that `collab_space` has the four actions and no admit/execute entry.

  Write the new assertion first and watch it fail.
- **`🔴 red`** rows are new behavior, written first and failing for the expected reason.

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 动作记为 principal 反查到的成员 | packages/collab-kernel/test/auth.test.ts | auth-01：动作记为 principal 反查到的成员 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 首次创建与创建重放 | packages/collab-kernel/test/auth.test.ts | auth-02：首次创建与创建重放 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 重复创建同一协作空间 | packages/collab-kernel/test/auth.test.ts | auth-03：重复创建同一协作空间 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 已移除的 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | auth-04：已移除的 internal purpose 被拒绝 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 不存在的协作空间先于成员反查报错 | packages/collab-kernel/test/auth.test.ts | auth-05：不存在的协作空间先于成员反查报错 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 公开命令与授权表一致 | packages/collab-kernel/test/auth.test.ts | auth-06：公开命令与授权表一致 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 没有按字符串分发的入口 | packages/collab-kernel/test/auth.test.ts | auth-07：没有按字符串分发的入口 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 非 Leader 邀请被拒 | packages/collab-kernel/test/auth.test.ts | auth-08：非 Leader 邀请被拒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 他人代为加入被拒 | packages/collab-kernel/test/auth.test.ts | auth-09：他人代为加入被拒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | provider 代表其他 channel 被拒 | packages/collab-kernel/test/auth.test.ts | auth-10：provider 代表其他 channel 被拒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 不能执行成员命令 | packages/collab-kernel/test/auth.test.ts | auth-12：internal 不能执行成员命令 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | gone 成员不能读写 | packages/collab-kernel/test/auth.test.ts | auth-13：gone 成员不能读写 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 可以读取任意空间 | packages/collab-kernel/test/auth.test.ts | auth-14：host-index 可以读取任意空间 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 不能执行任何写命令 | packages/collab-kernel/test/auth.test.ts | auth-15：host-index 不能执行任何写命令 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 在已关闭空间执行成员命令仍为 FORBIDDEN | packages/collab-kernel/test/auth.test.ts | auth-16：internal 在已关闭空间执行成员命令仍为 FORBIDDEN | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | manager principal 不能执行成员命令或读取 | packages/collab-kernel/test/auth.test.ts | auth-m-01：manager principal 不能执行成员命令或读取 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 未声明托管的 provider 不能作为 manager | packages/collab-kernel/test/auth.test.ts | auth-m-02：未声明托管的 provider 不能作为 manager | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 未知 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | auth-17：未知 internal purpose 被拒绝 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 唯一认领后加入 | packages/collab-kernel/test/members.test.ts | members-01：唯一认领后加入 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 无人认领 | packages/collab-kernel/test/members.test.ts | members-02：无人认领 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 多个认领 | packages/collab-kernel/test/members.test.ts | members-03：多个认领 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 不能新增人类成员 | packages/collab-kernel/test/members.test.ts | members-04：不能新增人类成员 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 旧日志中的人类成员按普通成员重放 | packages/collab-kernel/test/members.test.ts | members-08：旧日志中的人类成员按普通成员重放 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 同一地址不能成为两个成员 | packages/collab-kernel/test/members.test.ts | members-05：地址与名字不能复用包括gone/declined | 🔴 red (changed) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | agent 创建者不能声明为人类 | packages/collab-kernel/test/members.test.ts | members-06：agent不能自称human | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 非法成员名 | packages/collab-kernel/test/members.test.ts | members-07：非法成员名 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 创建者成为 Leader | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-01：创建者成为Leader | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 直接转交 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-02：Leader直接转交 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 不能转交给非 active 成员 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-03：不能转交给非active或自己 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 离开后自动接手 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-04：离开后自动接手 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 无人可接手时关闭 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-05：无人接手关闭 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 主动关闭后仍可读取 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-06：主动关闭后只读 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 创建时记录用途 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-07：创建时记录用途 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 非法用途被拒 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-08：非法用途被拒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 变化不唤醒 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-09：Leader 变化不唤醒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 重放返回原结果 | packages/collab-kernel/test/idempotency.test.ts | idempotency-01：原结果和序号重放不新增 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 状态已变化的命令仍可重放 | packages/collab-kernel/test/idempotency.test.ts | idempotency-02：join后状态变化仍可重放 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 关闭后的历史重放 | packages/collab-kernel/test/idempotency.test.ts | idempotency-03：关闭后历史重放优先于closed | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 同 cmdId 不同载荷 | packages/collab-kernel/test/idempotency.test.ts | idempotency-04：同cmdId不同参数或命令冲突 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 重启后幂等仍成立 | packages/collab-kernel/test/idempotency.test.ts | idempotency-05：重启后幂等仍成立 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 失败命令可以重试 | packages/collab-kernel/test/idempotency.test.ts | idempotency-06：失败无收据可修正重试 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 成员与旧 internal 收据互不冲突 | packages/collab-kernel/test/idempotency.test.ts | idempotency-07：成员与旧 internal 收据互不冲突 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | manager 收据与同名成员互不冲突 | packages/collab-kernel/test/idempotency.test.ts | idempotency-m-01：manager 收据与同名成员互不冲突 | 🔴 red |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | ref 是幂等载荷的一部分 | packages/collab-kernel/test/idempotency.test.ts | idempotency-08：ref 是幂等载荷的一部分 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 需回复消息叫醒收件人 | packages/collab-kernel/test/wake.test.ts | wake-01：需回复消息叫醒收件人 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 状态更新不叫醒 | packages/collab-kernel/test/wake.test.ts | wake-02：状态更新不叫醒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 不叫醒自己 | packages/collab-kernel/test/wake.test.ts | wake-03：不叫醒自己 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 邀请叫醒被邀请者 | packages/collab-kernel/test/wake.test.ts | wake-04：邀请叫醒被邀请者但不授予读取权限 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 不可达成员不记账 | packages/collab-kernel/test/presence.test.ts | binding-01：不可达成员不记账 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 不支持唤醒的绑定不记账 | packages/collab-kernel/test/presence.test.ts | binding-02：不支持唤醒的绑定不记账 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 采样后换代的收件人不沿用旧样本 | packages/collab-kernel/test/presence-binding.test.ts | binding-m-01：采样后换代的收件人不沿用旧样本 | 🔴 red |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 反方向换代同样不沿用 | packages/collab-kernel/test/presence-binding.test.ts | binding-m-02：反方向换代同样不沿用 | 🔴 red |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 与唤醒无关的成员换代不影响命令 | packages/collab-kernel/test/presence-binding.test.ts | binding-m-03：与唤醒无关的成员换代不影响命令 | 🔴 red |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 总览不把旧样本标到新绑定 | packages/collab-kernel/test/presence-binding.test.ts | binding-m-04：总览不把旧样本标到新绑定 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 授权后接纳、换代与退役 | packages/collab-kernel/test/managed.test.ts | managed-01：授权后接纳、换代与退役 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 未授权的接入方与非成员不可区分 | packages/collab-kernel/test/managed.test.ts | managed-02：未授权的接入方与非成员不可区分 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 不能授权普通 provider 或重复授权 | packages/collab-kernel/test/managed.test.ts | managed-03：不能授权普通 provider 或重复授权 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 非 Leader 不能授权 | packages/collab-kernel/test/managed.test.ts | managed-04：非 Leader 不能授权 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 撤销同时退役全部托管成员 | packages/collab-kernel/test/managed.test.ts | managed-05：撤销同时退役全部托管成员 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 只能管理本 channel 的成员 | packages/collab-kernel/test/managed.test.ts | managed-06：只能管理本 channel 的成员 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 历史地址不能复用 | packages/collab-kernel/test/managed.test.ts | managed-07：历史地址不能复用 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 认领挂起期间被撤销 | packages/collab-kernel/test/managed.test.ts | managed-08：认领挂起期间被撤销 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 认领挂起期间目标被标记离开 | packages/collab-kernel/test/managed.test.ts | managed-09：认领挂起期间目标被标记离开 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 并发的同 cmdId 接纳只提交一次 | packages/collab-kernel/test/managed.test.ts | managed-10：并发的同 cmdId 接纳只提交一次 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 认领期间地址被抢占 | packages/collab-kernel/test/managed.test.ts | managed-11：认领期间地址被抢占 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 收据重放不再认领 | packages/collab-kernel/test/managed.test.ts | managed-12：收据重放不再认领 | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 托管 provider 声明非法 channel | packages/collab-kernel/test/managed.test.ts | managed-13：托管 provider 声明非法 channel | 🔴 red |
| specs/collab-kernel/spec.md → 接入方按空间托管成员 | 换代后旧收据仍按成员名命中 | packages/collab-kernel/test/managed.test.ts | managed-14：换代后旧收据仍按成员名命中 | 🔴 red |
| specs/collab-kernel/spec.md → 调用级守卫在提交与读取边界重验 | 入口通过后、提交前守卫失效 | packages/collab-kernel/test/guard.test.ts | guard-01：入口通过后、提交前守卫失效 | 🔴 red |
| specs/collab-kernel/spec.md → 调用级守卫在提交与读取边界重验 | 读取期间守卫失效不返回数据 | packages/collab-kernel/test/guard.test.ts | guard-02：读取期间守卫失效不返回数据 | 🔴 red |
| specs/collab-kernel/spec.md → 调用级守卫在提交与读取边界重验 | 守卫失效时连收据也不返回 | packages/collab-kernel/test/guard.test.ts | guard-03：守卫失效时连收据也不返回 | 🔴 red |
| specs/collab-kernel/spec.md → 调用级守卫在提交与读取边界重验 | 托管 channel 的调用缺少守卫被拒 | packages/collab-kernel/test/guard.test.ts | guard-04：托管 channel 的调用缺少守卫被拒 | 🔴 red |
| specs/collab-kernel/spec.md → 调用级守卫在提交与读取边界重验 | 守卫抛错按失效处理 | packages/collab-kernel/test/guard.test.ts | guard-05：守卫抛错按失效处理 | 🔴 red |
| specs/collab-kernel/spec.md → 调用级守卫在提交与读取边界重验 | 普通成员不带守卫不受影响 | packages/collab-kernel/test/guard.test.ts | guard-06：普通成员不带守卫不受影响 | 🔴 red |
| specs/collab-kernel/spec.md → 托管成员不承担 Leader 与自助成员操作 | Leader 离开时跳过托管成员 | packages/collab-kernel/test/managed-leader.test.ts | managed-leader-01：Leader 离开时跳过托管成员 | 🔴 red |
| specs/collab-kernel/spec.md → 托管成员不承担 Leader 与自助成员操作 | 只剩托管成员时关闭 | packages/collab-kernel/test/managed-leader.test.ts | managed-leader-02：只剩托管成员时关闭 | 🔴 red |
| specs/collab-kernel/spec.md → 托管成员不承担 Leader 与自助成员操作 | 不能转交给托管成员 | packages/collab-kernel/test/managed-leader.test.ts | managed-leader-03：不能转交给托管成员 | 🔴 red |
| specs/collab-kernel/spec.md → 托管成员不承担 Leader 与自助成员操作 | 托管成员不能自行离开 | packages/collab-kernel/test/managed-leader.test.ts | managed-leader-04：托管成员不能自行离开 | 🔴 red |
| specs/collab-kernel/spec.md → 托管成员不承担 Leader 与自助成员操作 | Leader 可以标记托管成员离开 | packages/collab-kernel/test/managed-leader.test.ts | managed-leader-05：Leader 可以标记托管成员离开 | 🔴 red |
| specs/collab-kernel/spec.md → 托管成员不承担 Leader 与自助成员操作 | 邀请不经托管 provider 认领 | packages/collab-kernel/test/managed-leader.test.ts | managed-leader-06：邀请不经托管 provider 认领 | 🔴 red |
| specs/collab-kernel/spec.md → 条目与消息可携带接入方附加数据 | 附加数据原样存储并随修改保留 | packages/collab-kernel/test/ext.test.ts | ext-01：附加数据原样存储并随修改保留 | 🔴 red |
| specs/collab-kernel/spec.md → 条目与消息可携带接入方附加数据 | 非法附加数据被拒 | packages/collab-kernel/test/ext.test.ts | ext-02：非法附加数据被拒 | 🔴 red |
| specs/collab-kernel/spec.md → 条目与消息可携带接入方附加数据 | 不能通过修改替换附加数据 | packages/collab-kernel/test/ext.test.ts | ext-03：不能通过修改替换附加数据 | 🔴 red |
| specs/collab-kernel/spec.md → 条目与消息可携带接入方附加数据 | 附加数据不进入指针 | packages/collab-kernel/test/ext.test.ts | ext-04：附加数据不进入指针 | 🔴 red |
| specs/collab-kernel/spec.md → 条目与消息可携带接入方附加数据 | 附加数据是幂等载荷的一部分 | packages/collab-kernel/test/ext.test.ts | ext-05：附加数据是幂等载荷的一部分 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒可指定投递方式 | 支持的方式随投递传递 | packages/collab-kernel/test/mode.test.ts | mode-01：支持的方式随投递传递 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒可指定投递方式 | 不支持或非法方式被拒 | packages/collab-kernel/test/mode.test.ts | mode-02：不支持或非法方式被拒 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒可指定投递方式 | supportsMode 抛错视为不支持 | packages/collab-kernel/test/mode.test.ts | mode-03：supportsMode 抛错视为不支持 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒可指定投递方式 | 方式不绕过话题上限 | packages/collab-kernel/test/mode.test.ts | mode-04：方式不绕过话题上限 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒可指定投递方式 | 普通唤醒不带方式 | packages/collab-kernel/test/mode.test.ts | mode-05：普通唤醒不带方式 | 🔴 red |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 跨 workspace 调用仍归属实际会话 | packages/dsh-collab/test/session-provider.test.ts | admit-01：跨 workspace 调用仍归属实际会话 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 参数伪造身份被拒绝 | packages/dsh-collab/test/session-provider.test.ts | admit-02：参数伪造身份被拒绝 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 无调用会话不能访问 | packages/dsh-collab/test/session-provider.test.ts | admit-03：无调用会话不能访问 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 邀请模式下未配置名单的普通会话可建空间 | packages/dsh-collab/test/session-provider.test.ts | admit-04：邀请模式下未配置名单的普通会话可建空间 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 排除名单与派生会话不可调用 | packages/dsh-collab/test/session-provider.test.ts | admit-05：排除名单与派生会话不可调用 | 🔴 red (changed) |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 名单模式下托管调用者不需要列入名单 | packages/dsh-collab/test/tools.test.ts | caller-m-01：名单模式下托管调用者不需要列入名单 | 🔴 red |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 兼容模式保持首版行为 | packages/dsh-collab/test/session-provider.test.ts | admit-06：兼容模式保持首版行为 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 调用身份来自实际执行会话 | 非法配置拒绝启动 | packages/dsh-collab/test/session-provider.test.ts | admit-07：非法配置拒绝启动 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 创建邀请加入与协商闭环 | packages/dsh-collab/test/tools.test.ts | tool-01：创建邀请加入与协商闭环 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 相同命令结果未知后重试 | packages/dsh-collab/test/tools.test.ts | tool-02：相同命令结果未知后重试 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 枚举取值与字段不匹配被拒绝 | packages/dsh-collab/test/tools.test.ts | tool-03：枚举取值与字段不匹配被拒绝 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 旧命令的重试不被插件挡住 | packages/dsh-collab/test/tools.test.ts | tool-04：旧命令的重试不被插件挡住 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 工具描述携带重试与重读规则 | packages/dsh-collab/test/controller-seams.test.mjs | tool-05：工具描述携带重试与重读规则 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 内部与人类能力不出现在工具面 | packages/dsh-collab/test/controller-seams.test.mjs | tool-06：内部与人类能力不出现在工具面 | 🔴 red (changed) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | ref 与 purpose 原样传给内核 | packages/dsh-collab/test/tools.test.ts | tool-07：ref 与 purpose 原样传给内核 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 升级前的创建重试仍命中收据 | packages/dsh-collab/test/tools.test.ts | tool-08：升级前的创建重试仍命中收据 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 不填 ref 时输入不含该键 | packages/dsh-collab/test/tools.test.ts | tool-09：不填 ref 时输入不含该键 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 授权与撤销托管 channel | packages/dsh-collab/test/tools.test.ts | tool-m-01：授权与撤销托管 channel | 🔴 red |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 超出话题上限原样返回 | packages/dsh-collab/test/tools.test.ts | tool-10：超出话题上限原样返回 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 运行中目标下一回合收到 | packages/dsh-collab/test/component-seams.test.mjs | wake-01：运行中目标下一回合收到 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 空闲目标收到带来源指针 | packages/dsh-collab/test/session-provider.test.ts | wake-02：空闲目标收到带来源指针 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 成员信任下的唤醒文本是常设授权 | packages/dsh-collab/test/session-provider.test.ts | trust-06：唤醒文本按 memberTrust 取两套固定说明 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 关闭成员信任保持原说明 | packages/dsh-collab/test/session-provider.test.ts | trust-07：关闭成员信任保持原说明 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 邀请指针不能替代加入 | packages/dsh-collab/test/session-provider.test.ts | wake-04：邀请指针不能读取空间 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 不满足准入条件的目标不投递 | packages/dsh-collab/test/session-provider.test.ts | wake-03：不满足准入条件的目标不投递 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 话题唤醒携带话题根 | packages/dsh-collab/test/session-provider.test.ts | wake-05：话题唤醒携带话题根 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 非整数 thread 不被转发 | packages/dsh-collab/test/session-provider.test.ts | wake-06：非整数 thread 不被转发 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 唤醒文本不再提及决策工具 | packages/dsh-collab/test/session-provider.test.ts | wake-07：唤醒文本不再提及决策工具 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 邀请只暴露最少信息 | packages/dsh-collab/test/status.test.ts | status-next-01：邀请只暴露最少信息 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 联系人只来自种子名单 | packages/dsh-collab/test/status.test.ts | status-next-02：联系人只来自种子名单 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 元数据不可用时联系人为空 | packages/dsh-collab/test/status.test.ts | status-next-03：元数据不可用时联系人为空 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 托管调用者没有联系人 | packages/dsh-collab/test/status.test.ts | status-m-01：托管调用者没有联系人 | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 没有待办时没有建议 | packages/dsh-collab/test/status.test.ts | status-next-04：没有待办时没有建议 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 宿主声明可托管成员的接入方 channel | 未声明的 channel 不能接入 | packages/dsh-collab/test/integration.test.ts | attach-01：未声明的 channel 不能接入 | 🔴 red |
| specs/dsh-collab/spec.md → 宿主声明可托管成员的接入方 channel | 非法配置拒绝启动 | packages/dsh-collab/test/integration.test.ts | attach-02：非法配置拒绝启动 | 🔴 red |
| specs/dsh-collab/spec.md → 宿主声明可托管成员的接入方 channel | 接入方离开后不可投递 | packages/dsh-collab/test/integration.test.ts | attach-03：接入方离开后不可投递 | 🔴 red |
| specs/dsh-collab/spec.md → 宿主声明可托管成员的接入方 channel | 未声明托管 channel 时工具面与行为不变 | packages/dsh-collab/test/integration.test.ts | attach-04：未声明托管 channel 时工具面与行为不变 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | Leader 授权后接入方接纳成员 | packages/dsh-collab/test/integration.test.ts | handle-01：Leader 授权后接入方接纳成员 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 未授权空间的响应完全一致 | packages/dsh-collab/test/integration.test.ts | handle-02：未授权空间的响应完全一致 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 旧句柄的在途托管命令不提交 | packages/dsh-collab/test/integration.test.ts | handle-03：旧句柄的在途托管命令不提交 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 认领后、提交前地址被撤回 | packages/dsh-collab/test/integration.test.ts | handle-04：认领后、提交前地址被撤回 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方经句柄托管成员 | 句柄没有 Leader 能力 | packages/dsh-collab/test/integration.test.ts | handle-05：句柄没有 Leader 能力 | 🔴 red |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 受管子会话以托管成员身份写入 | packages/dsh-collab/test/managed-caller.test.ts | mcaller-01：受管子会话以托管成员身份写入 | 🔴 red |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 解除绑定后立即失去身份 | packages/dsh-collab/test/managed-caller.test.ts | mcaller-02：解除绑定后立即失去身份 | 🔴 red |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 在途调用在失效后不能完成 | packages/dsh-collab/test/managed-caller.test.ts | mcaller-03：在途调用在失效后不能完成 | 🔴 red |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 状态入口在返回前重验 | packages/dsh-collab/test/managed-caller.test.ts | mcaller-04：状态入口在返回前重验 | 🔴 red |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 普通会话不能被接入方冒认 | packages/dsh-collab/test/managed-caller.test.ts | mcaller-05：普通会话不能被接入方冒认 | 🔴 red |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 排除名单与归档对托管调用者同样生效 | packages/dsh-collab/test/managed-caller.test.ts | mcaller-06：排除名单与归档对托管调用者同样生效 | 🔴 red |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 未被认领的子会话仍被拒绝 | packages/dsh-collab/test/managed-caller.test.ts | mcaller-07：未被认领的子会话仍被拒绝 | 🔴 red |
| specs/dsh-collab/spec.md → 工具调用者可解析为托管成员 | 托管调用者的状态入口 | packages/dsh-collab/test/managed-caller.test.ts | mcaller-08：托管调用者的状态入口 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方以真实调用会话执行带附加数据的命令 | 托管成员写入带来源的请求 | packages/dsh-collab/test/integration.test.ts | hcommand-01：托管成员写入带来源的请求 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方以真实调用会话执行带附加数据的命令 | 只能使用本 channel 的投递方式 | packages/dsh-collab/test/integration.test.ts | hcommand-02：只能使用本 channel 的投递方式 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方以真实调用会话执行带附加数据的命令 | 模型工具不接受附加数据与方式 | packages/dsh-collab/test/integration.test.ts | hcommand-03：模型工具不接受附加数据与方式 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方以真实调用会话执行带附加数据的命令 | 换代后的新会话可凭原 cmdId 确定结果 | packages/dsh-collab/test/integration.test.ts | hcommand-04：换代后的新会话可凭原 cmdId 确定结果 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方以真实调用会话执行带附加数据的命令 | 不能经句柄执行成员管理 | packages/dsh-collab/test/integration.test.ts | hcommand-05：不能经句柄执行成员管理 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方可为普通会话收件人注册投递方式 | 询问方式交给接入方的独立轮次 | packages/dsh-collab/test/session-mode.test.ts | smode-01：询问方式交给接入方的独立轮次 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方可为普通会话收件人注册投递方式 | 方式注销后投递失败而不降级 | packages/dsh-collab/test/session-mode.test.ts | smode-02：方式注销后投递失败而不降级 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方可为普通会话收件人注册投递方式 | 未注册的方式在发送时被拒 | packages/dsh-collab/test/session-mode.test.ts | smode-03：未注册的方式在发送时被拒 | 🔴 red |
| specs/dsh-collab/spec.md → 接入方可为普通会话收件人注册投递方式 | 不能注册他人前缀 | packages/dsh-collab/test/session-mode.test.ts | smode-04：不能注册他人前缀 | 🔴 red |

## Coverage Notes

- **Fixtures.**
  - The kernel tests need a managed test provider with `managed: true`, `claim`, `presence` and `supportsMode`, plus controllable Promises for `claim` and `presence`. Extend the existing `test/support` world rather than building a parallel one.
  - Guards are plain closures over a mutable flag, so "becomes false while suspended" is a flag flip between two awaits.
- **Concurrency oracles.**
  - `guard-*`, the `managed` claim-suspension rows and the `binding-m-*` rows all suspend a provider Promise.
  - Each mutates state through a second, independent command or flag.
  - Each then asserts log length or bytes, receipts and `dispatch/intended`.
  - Never assert only the returned error.
- **dsh-collab integration tests.**
  - `integration.test.ts`, `managed-caller.test.ts` and `session-mode.test.ts` drive the real `apply()` through `test/support/world.ts`.
  - The integrator is a test adapter attached through the provided `dshCollab` service, not by importing internals. This checks that the service is really published (pitfall: declared but never wired).
  - Agent-object replacement is simulated by swapping the object in the fake `agents` map; archiving by pushing to `archivedSessionIds`.
- **Disclosure equivalence.**
  - `handle-02` reuses the six-space setup of the existing "无权空间的响应完全一致" test (S1–S6), driven through the handle instead of tools.
- **Component and size checks.**
  - `tool-06` and the 4200 budget (`surface-04` in the archived plan) run under `npm run test:components`.
  - That suite needs the full-dependency copy described in memory card `ohmydsh-worktree-full-deps-test-copy`; record the measured header size in verify.
- **Not covered here.** Real Host acceptance with a real Pet integrator is out of scope; Pet is untouched. It belongs to the Locus integration change. This change's acceptance uses the scripted adapter in the isolated component Host only.
