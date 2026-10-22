## Test Plan

Every scenario in `specs/` maps to a named test. The ledger is live: during apply, each row moves from 🔴 to 🟢 as its test passes.

- `🟢 green (regression)` rows pin behavior that this change must preserve and that existing tests already cover. They must stay green throughout. No red-first step is invented for them; where a test is touched only to remove a deleted concept (for example a fixture field), it stays green.
- `🔴 red` rows are new or changed behavior. They are written first and must fail for the expected reason.

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 引用先前消息 | packages/collab-kernel/test/refs.test.ts | ref-01：引用先前消息 | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 引用条目的创建 seq | packages/collab-kernel/test/refs.test.ts | ref-02：引用条目的创建 seq | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 不写 ref 时事件形状不变 | packages/collab-kernel/test/refs.test.ts | ref-03：不写 ref 时事件形状不变 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 特殊 itemId 的创建 seq 可查 | packages/collab-kernel/test/refs.test.ts | ref-04：特殊 itemId 的创建 seq 可查 | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 消息引用不存在或不可引用的 seq | packages/collab-kernel/test/refs.test.ts | ref-05：消息引用不存在或不可引用的 seq | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 条目引用非法 seq | packages/collab-kernel/test/refs.test.ts | ref-06：条目引用非法 seq | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 多重错误时先报既有校验 | packages/collab-kernel/test/refs.test.ts | ref-07：多重错误时先报既有校验 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 悬空引用的日志加载失败 | packages/collab-kernel/test/refs.test.ts | ref-08：悬空引用的日志加载失败 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 同一话题第 21 条唤醒消息被拒绝 | packages/collab-kernel/test/topics.test.ts | topic-01：同一话题第 21 条唤醒消息被拒绝 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 旧日志中的唤醒消息计入其话题 | packages/collab-kernel/test/topics.test.ts | topic-02：旧日志中的唤醒消息计入其话题 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 不写 ref 的新消息开启新话题 | packages/collab-kernel/test/topics.test.ts | topic-03：不写 ref 的新消息开启新话题 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 引用条目的消息归属条目话题 | packages/collab-kernel/test/topics.test.ts | topic-04：引用条目的消息归属条目话题 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 不唤醒的消息不受限也不计数 | packages/collab-kernel/test/topics.test.ts | topic-05：不唤醒的消息不受限也不计数 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 不可达收件人的消息不计数 | packages/collab-kernel/test/topics.test.ts | topic-06：不可达收件人的消息不计数 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 结束通知不受话题上限限制 | packages/collab-kernel/test/topics.test.ts | topic-07：结束通知不受话题上限限制 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 跨 request 的结束通知不受话题上限约束 | packages/collab-kernel/test/topics.test.ts | topic-08：跨 request 的结束通知不受话题上限约束 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 并发提交不越过上限 | packages/collab-kernel/test/topics.test.ts | topic-09：并发提交不越过上限 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 命令时判定与重新加载一致 | packages/collab-kernel/test/topics.test.ts | topic-10：命令时判定与重新加载一致 | 🔴 red |
| specs/collab-kernel/spec.md → 按话题限制往返 | 旧的成员级熔断不再阻断 | packages/collab-kernel/test/topics.test.ts | topic-11：旧的成员级熔断不再阻断 | 🔴 red |
| specs/collab-kernel/spec.md → 旧日志中已移除的事件按只读历史重放 | 含决策与熔断事件的旧日志可加载 | packages/collab-kernel/test/legacy.test.ts | legacy-01：含决策与熔断事件的旧日志可加载 | 🔴 red |
| specs/collab-kernel/spec.md → 旧日志中已移除的事件按只读历史重放 | 新内核不写已移除事件 | packages/collab-kernel/test/legacy.test.ts | legacy-02：新内核不写已移除事件 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 动作记为 principal 反查到的成员 | packages/collab-kernel/test/auth.test.ts | auth-01：动作记为 principal 反查到的成员 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 首次创建与创建重放 | packages/collab-kernel/test/auth.test.ts | auth-02：首次创建与创建重放 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 重复创建同一协作空间 | packages/collab-kernel/test/auth.test.ts | auth-03：重复创建同一协作空间 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 已移除的 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | auth-04：已移除的 internal purpose 被拒绝 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 不存在的协作空间先于成员反查报错 | packages/collab-kernel/test/auth.test.ts | auth-05：不存在的协作空间先于成员反查报错 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 公开命令与授权表一致 | packages/collab-kernel/test/auth.test.ts | auth-06：公开命令与授权表一致 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 没有按字符串分发的入口 | packages/collab-kernel/test/auth.test.ts | auth-07：没有按字符串分发的入口 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 非 Leader 邀请被拒 | packages/collab-kernel/test/auth.test.ts | auth-08：非 Leader 邀请被拒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 他人代为加入被拒 | packages/collab-kernel/test/auth.test.ts | auth-09：他人代为加入被拒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | provider 代表其他 channel 被拒 | packages/collab-kernel/test/auth.test.ts | auth-10：provider 代表其他 channel 被拒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 不能执行成员命令 | packages/collab-kernel/test/auth.test.ts | auth-12：internal 不能执行成员命令 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | gone 成员不能读写 | packages/collab-kernel/test/auth.test.ts | auth-13：gone 成员不能读写 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 可以读取任意空间 | packages/collab-kernel/test/auth.test.ts | auth-14：host-index 可以读取任意空间 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 不能执行任何写命令 | packages/collab-kernel/test/auth.test.ts | auth-15：host-index 不能执行任何写命令 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 在已关闭空间执行成员命令仍为 FORBIDDEN | packages/collab-kernel/test/auth.test.ts | auth-16：internal 在已关闭空间执行成员命令仍为 FORBIDDEN | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 未知 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | auth-17：未知 internal purpose 被拒绝 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 唯一认领后加入 | packages/collab-kernel/test/members.test.ts | members-01：唯一认领后加入 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 无人认领 | packages/collab-kernel/test/members.test.ts | members-02：无人认领 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 多个认领 | packages/collab-kernel/test/members.test.ts | members-03：多个认领 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 不能新增人类成员 | packages/collab-kernel/test/members.test.ts | members-04：不能新增人类成员 | 🔴 red |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 旧日志中的人类成员按普通成员重放 | packages/collab-kernel/test/members.test.ts | members-08：旧日志中的人类成员按普通成员重放 | 🔴 red |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 同一地址不能成为两个成员 | packages/collab-kernel/test/members.test.ts | members-05：地址与名字不能复用包括gone/declined | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | agent 创建者不能声明为人类 | packages/collab-kernel/test/members.test.ts | members-06：agent不能自称human | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 非法成员名 | packages/collab-kernel/test/members.test.ts | members-07：非法成员名 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 创建者成为 Leader | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-01：创建者成为Leader | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 直接转交 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-02：Leader直接转交 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 不能转交给非 active 成员 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-03：不能转交给非active或自己 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 离开后自动接手 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-04：离开后自动接手 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 无人可接手时关闭 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-05：无人接手关闭 | 🔴 red |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 主动关闭后仍可读取 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-06：主动关闭后只读 | 🔴 red |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 创建时记录用途 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-07：创建时记录用途 | 🔴 red |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 非法用途被拒 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-08：非法用途被拒 | 🔴 red |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 变化不唤醒 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-09：Leader 变化不唤醒 | 🔴 red |
| specs/collab-kernel/spec.md → 条目状态转换表 | 全员 ack 后 agreed | packages/collab-kernel/test/items.test.ts | items-01：全员ack后agreed | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 条目状态转换表 | 修改使旧 ack 失效 | packages/collab-kernel/test/items.test.ts | items-02：修改使旧ack失效 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 条目状态转换表 | 过期 revision 修改被拒 | packages/collab-kernel/test/items.test.ts | items-03：过期revision修改被拒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 条目状态转换表 | 过期 revision 的 ack 被拒 | packages/collab-kernel/test/items.test.ts | items-04：过期ack被拒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 条目状态转换表 | 旧日志中的 escalated 条目只读 | packages/collab-kernel/test/items.test.ts | items-05：旧日志中的 escalated 条目只读 | 🔴 red |
| specs/collab-kernel/spec.md → 条目状态转换表 | 旧日志中的 decided 条目只读 | packages/collab-kernel/test/items.test.ts | items-06：旧日志中的 decided 条目只读 | 🔴 red |
| specs/collab-kernel/spec.md → 条目状态转换表 | 非法条目字段 | packages/collab-kernel/test/items.test.ts | items-07：非法条目字段 | 🔴 red |
| specs/collab-kernel/spec.md → 条目状态转换表 | 旧快照的条目可正常修改 | packages/collab-kernel/test/items.test.ts | items-08：旧快照的条目可正常修改 | 🔴 red |
| specs/collab-kernel/spec.md → 条目状态转换表 | 修改与达成共识不唤醒 | packages/collab-kernel/test/items.test.ts | items-09：修改与达成共识不唤醒 | 🔴 red |
| specs/collab-kernel/spec.md → 消息与状态文本 | 正常发送消息 | packages/collab-kernel/test/messages.test.ts | messages-01：正常发送缺省needsReply | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 消息与状态文本 | 收件人不是 active 成员 | packages/collab-kernel/test/messages.test.ts | messages-02：收件人必须其他active | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 消息与状态文本 | 正文超限 | packages/collab-kernel/test/messages.test.ts | messages-03：正文UTF8字节边界 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 消息与状态文本 | needsReply 不做隐式转换 | packages/collab-kernel/test/messages.test.ts | messages-04：needsReply不转换 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 消息与状态文本 | 清空与超长状态 | packages/collab-kernel/test/messages.test.ts | messages-05：清空和超长状态 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 承接方正常推进 | packages/collab-kernel/test/requests.test.ts | requests-01：承接方正常推进且只在终态通知作者 | 🔴 red |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 非承接方推进被拒 | packages/collab-kernel/test/requests.test.ts | requests-02：非承接方拒绝 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 非法跳转被拒 | packages/collab-kernel/test/requests.test.ts | requests-03：非法跳转且拒绝为终态 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 拒绝也通知作者 | packages/collab-kernel/test/requests.test.ts | requests-04：拒绝也通知作者 | 🔴 red |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 自己给自己的 request 不唤醒 | packages/collab-kernel/test/requests.test.ts | requests-05：自己给自己的 request 不唤醒 | 🔴 red |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 旧日志中锁定的 request 不能推进 | packages/collab-kernel/test/requests.test.ts | requests-06：旧日志中锁定的 request 不能推进 | 🔴 red |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 重放返回原结果 | packages/collab-kernel/test/idempotency.test.ts | idempotency-01：原结果和序号重放不新增 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 状态已变化的命令仍可重放 | packages/collab-kernel/test/idempotency.test.ts | idempotency-02：join后状态变化仍可重放 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 关闭后的历史重放 | packages/collab-kernel/test/idempotency.test.ts | idempotency-03：关闭后历史重放优先于closed | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 同 cmdId 不同载荷 | packages/collab-kernel/test/idempotency.test.ts | idempotency-04：同cmdId不同参数或命令冲突 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 重启后幂等仍成立 | packages/collab-kernel/test/idempotency.test.ts | idempotency-05：重启后幂等仍成立 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 失败命令可以重试 | packages/collab-kernel/test/idempotency.test.ts | idempotency-06：失败无收据可修正重试 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 成员与旧 internal 收据互不冲突 | packages/collab-kernel/test/idempotency.test.ts | idempotency-07：成员与旧 internal 收据互不冲突 | 🔴 red |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | ref 是幂等载荷的一部分 | packages/collab-kernel/test/idempotency.test.ts | idempotency-08：ref 是幂等载荷的一部分 | 🔴 red |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 重启后状态一致 | packages/collab-kernel/test/store.test.ts | store-01：重启后状态一致 | 🔴 red |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 行校验和有固定向量 | packages/collab-kernel/test/store.test.ts | store-02: canonical JSON and both checksum calculations match the approved fixed vector | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 末尾残片被截断 | packages/collab-kernel/test/store.test.ts | store-03: loading ten complete commits truncates and fsyncs only the partial eleventh line | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 完整行损坏拒绝加载 | packages/collab-kernel/test/store.test.ts | store-04: a complete checksum-mismatched line rejects load without changing any bytes | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 短写不报告成功 | packages/collab-kernel/test/store.test.ts | store-05: half writes are completed before success, with complete independently verified lines | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 多事件命令不会只落一半 | packages/collab-kernel/test/store.test.ts | store-06：多事件命令不会只落一半 | 🔴 red |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | fsync 失败后结果交给重试判定 | packages/collab-kernel/test/store.test.ts | store-07: a complete line surviving fsync failure is resolved by same-cmdId replay without growth | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | failed 后的 close 阻止旧队列继续提交 | packages/collab-kernel/test/store.test.ts | store-08: failed X rejects queued work and close releases its lock before Y opens | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 已被锁定时拒绝打开 | packages/collab-kernel/test/store.test.ts | store-09: a live owner lock excludes a second instance and preserves exact lock bytes | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 残留锁不被自动接管 | packages/collab-kernel/test/store.test.ts | store-10: a residual lock with nonexistent pid is never automatically taken over | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 按实例 id 解除残留锁 | packages/collab-kernel/test/store.test.ts | store-11: exact-id breakLock removes a synthetic residual lock and allows a new instance | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 实例 id 不符不解除 | packages/collab-kernel/test/store.test.ts | store-12: mismatched instance id cannot remove a residual lock | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 需回复消息叫醒收件人 | packages/collab-kernel/test/wake.test.ts | wake-01：需回复消息叫醒收件人 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 状态更新不叫醒 | packages/collab-kernel/test/wake.test.ts | wake-02：状态更新不叫醒 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 不叫醒自己 | packages/collab-kernel/test/wake.test.ts | wake-03：不叫醒自己 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 邀请叫醒被邀请者 | packages/collab-kernel/test/wake.test.ts | wake-04：邀请叫醒被邀请者但不授予读取权限 | 🔴 red |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 意图与命令同提交 | packages/collab-kernel/test/dispatch.test.ts | dispatch-01：意图与命令同提交 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 正常返回记为成功 | packages/collab-kernel/test/dispatch.test.ts | dispatch-02：正常返回记为成功 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | provider 抛错记为失败 | packages/collab-kernel/test/dispatch.test.ts | dispatch-03：provider抛错记为失败 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 慢投递在结束前不写结果 | packages/collab-kernel/test/dispatch.test.ts | dispatch-05：慢投递在结束前不写结果 | 🔴 red |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 宿主不能写入投递结果 | packages/collab-kernel/test/dispatch.test.ts | dispatch-06：宿主不能写入投递结果 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 重启后未完成投递不重发 | packages/collab-kernel/test/dispatch.test.ts | dispatch-07：重启后未完成投递不重发 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 投递完成提交可持久化与重放且无收据 | packages/collab-kernel/test/dispatch.test.ts | dispatch-08：投递完成可持久化重放且无命令收据 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | failed 后不写投递完成提交 | packages/collab-kernel/test/dispatch.test.ts | dispatch-09：failed后不写投递完成提交 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 投递完成提交 fsync 失败后按日志恢复 | packages/collab-kernel/test/dispatch.test.ts | dispatch-10：completed整行落盘后fsync失败按日志恢复且不重投 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 不可达成员不记账 | packages/collab-kernel/test/presence.test.ts | binding-01：不可达成员不记账 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 不支持唤醒的绑定不记账 | packages/collab-kernel/test/presence.test.ts | binding-02：不支持唤醒的绑定不记账 | 🔴 red |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 投影列出待 ack | packages/collab-kernel/test/projection.test.ts | projection-01 中文场景：当前 charter、待 ack、request、升级、决定与投递状态 | 🔴 red |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 投影不含消息正文 | packages/collab-kernel/test/projection.test.ts | projection-02 中文场景：投影不包含消息或条目正文 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 恶意标题不能产生额外结构 | packages/collab-kernel/test/projection.test.ts | projection-03 中文场景：恶意标题不会产生用户控制的 Markdown 结构 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 转义后可见文本不变 | packages/collab-kernel/test/projection.test.ts | projection-04 中文场景：控制字符清理和标点转义后可见文本不变且为段落 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 恶意用途不能产生额外结构 | packages/collab-kernel/test/projection.test.ts | projection-05：恶意用途不能产生额外结构 | 🔴 red |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 锁定的 request 只作为历史出现 | packages/collab-kernel/test/projection.test.ts | projection-06：锁定的 request 只作为历史出现 | 🔴 red |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 投影不含已移除机制 | packages/collab-kernel/test/projection.test.ts | projection-07：投影不含已移除机制 | 🔴 red |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 总览带约定版本 | packages/collab-kernel/test/convention-integration.test.ts | convention-01：service creation records the bundled convention and authorised reads return exact bytes | 🔴 red |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 旧空间仍按原版本读取 | packages/collab-kernel/test/convention-integration.test.ts | convention-04：v1 and v2 spaces keep reading their recorded version | 🔴 red |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 已发布文本不可变 | packages/collab-kernel/test/convention.test.ts | convention-03：已发布的 v1 与 v2 文本不可变 | 🔴 red |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 未知版本 | packages/collab-kernel/test/convention.test.ts | convention-02：未知版本抛出 COLLAB_CONVENTION_UNKNOWN | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | v3 写明新规则且不含已移除机制 | packages/collab-kernel/test/convention.test.ts | convention-05：v3 写明新规则且不含已移除机制 | 🔴 red |
| specs/collab-kernel/spec.md → 公开纯状态推导函数 | 公开推导与内核状态一致 | packages/collab-kernel/test/public-entry.test.ts | reduce-01：公开推导与内核状态一致 | 🔴 red |
| specs/collab-kernel/spec.md → 公开纯状态推导函数 | 推导不修改输入 | packages/collab-kernel/test/public-entry.test.ts | reduce-02：推导不修改输入 | 🟢 green (regression) |
| specs/collab-kernel/spec.md → 公开纯状态推导函数 | 推导函数不接触外部 | packages/collab-kernel/test/public-entry.test.ts | reduce-03：推导函数不接触外部 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 创建邀请加入与协商闭环 | packages/dsh-collab/test/tools.test.ts | tool-01：创建邀请加入与协商闭环 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 相同命令结果未知后重试 | packages/dsh-collab/test/tools.test.ts | tool-02：相同命令结果未知后重试 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 枚举取值与字段不匹配被拒绝 | packages/dsh-collab/test/tools.test.ts | tool-03：枚举取值与字段不匹配被拒绝 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 旧命令的重试不被插件挡住 | packages/dsh-collab/test/tools.test.ts | tool-04：旧命令的重试不被插件挡住 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 工具描述携带重试与重读规则 | packages/dsh-collab/test/controller-seams.test.mjs | tool-05：工具描述携带重试与重读规则 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 内部与人类能力不出现在工具面 | packages/dsh-collab/test/controller-seams.test.mjs | tool-06：内部与人类能力不出现在工具面 | 🔴 red |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | ref 与 purpose 原样传给内核 | packages/dsh-collab/test/tools.test.ts | tool-07：ref 与 purpose 原样传给内核 | 🔴 red |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 升级前的创建重试仍命中收据 | packages/dsh-collab/test/tools.test.ts | tool-08：升级前的创建重试仍命中收据 | 🔴 red |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 不填 ref 时输入不含该键 | packages/dsh-collab/test/tools.test.ts | tool-09：不填 ref 时输入不含该键 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 超出话题上限原样返回 | packages/dsh-collab/test/tools.test.ts | tool-10：超出话题上限原样返回 | 🔴 red |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 运行中目标下一回合收到 | packages/dsh-collab/test/component-seams.test.mjs | wake-01：运行中目标下一回合收到 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 空闲目标收到带来源指针 | packages/dsh-collab/test/session-provider.test.ts | wake-02：空闲目标收到带来源指针 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 成员信任下的唤醒文本是常设授权 | packages/dsh-collab/test/session-provider.test.ts | trust-06：唤醒文本按 memberTrust 取两套固定说明 | 🔴 red |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 关闭成员信任保持原说明 | packages/dsh-collab/test/session-provider.test.ts | trust-07：关闭成员信任保持原说明 | 🔴 red |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 邀请指针不能替代加入 | packages/dsh-collab/test/session-provider.test.ts | wake-04：邀请指针不能读取空间 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 不满足准入条件的目标不投递 | packages/dsh-collab/test/session-provider.test.ts | wake-03：不满足准入条件的目标不投递 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 话题唤醒携带话题根 | packages/dsh-collab/test/session-provider.test.ts | wake-05：话题唤醒携带话题根 | 🔴 red |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 非整数 thread 不被转发 | packages/dsh-collab/test/session-provider.test.ts | wake-06：非整数 thread 不被转发 | 🔴 red |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 唤醒文本不再提及决策工具 | packages/dsh-collab/test/session-provider.test.ts | wake-07：唤醒文本不再提及决策工具 | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 被唤醒后一次调用即知下一步 | packages/dsh-collab/test/status.test.ts | status-shape-01：被唤醒后一次调用即知下一步 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 成员文本不进入输出 | packages/dsh-collab/test/status.test.ts | status-shape-02：成员文本不进入输出 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | request 待办带条目 seq | packages/dsh-collab/test/status.test.ts | status-shape-03：request 待办带条目 seq | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 用途只作为数据输出 | packages/dsh-collab/test/status.test.ts | status-shape-04：用途只作为数据输出 | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | Leader 转交后邀请者仍正确 | packages/dsh-collab/test/status.test.ts | status-pending-01：Leader 转交后邀请者仍正确 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 关闭的空间不产生建议 | packages/dsh-collab/test/status.test.ts | status-pending-02：关闭的空间不产生建议 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 已拒绝或已离开的空间不出现 | packages/dsh-collab/test/status.test.ts | status-pending-03：已拒绝或已离开的空间不出现 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 回复后不再出现 | packages/dsh-collab/test/status.test.ts | status-pending-04：回复后不再出现 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 回复后对方再提问重新出现 | packages/dsh-collab/test/status.test.ts | status-pending-05：回复后对方再提问重新出现 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 与内核状态一致 | packages/dsh-collab/test/status.test.ts | status-pending-06：与内核状态一致 | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | 旧日志中锁定的 request 不列为待办 | packages/dsh-collab/test/status.test.ts | status-pending-07：旧日志中锁定的 request 不列为待办 | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口的待办推导 | request seq 只取自重放推导 | packages/dsh-collab/test/status.test.ts | status-pending-08：request seq 只取自重放推导 | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 邀请只暴露最少信息 | packages/dsh-collab/test/status.test.ts | status-next-01：邀请只暴露最少信息 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 联系人只来自种子名单 | packages/dsh-collab/test/status.test.ts | status-next-02：联系人只来自种子名单 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 元数据不可用时联系人为空 | packages/dsh-collab/test/status.test.ts | status-next-03：元数据不可用时联系人为空 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 状态入口的下一步建议与联系人 | 没有待办时没有建议 | packages/dsh-collab/test/status.test.ts | status-next-04：没有待办时没有建议 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | 生命周期前后工具定义字节一致 | packages/dsh-collab/test/controller-seams.test.mjs | surface-01：生命周期前后工具定义字节一致 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | schema 体积在预算内 | packages/dsh-collab/test/controller-seams.test.mjs | surface-02：schema 体积在预算内 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | 超预算夹具被测试拦住 | packages/dsh-collab/test/controller-seams.test.mjs | surface-03：超预算夹具被测试拦住 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | 新增参数后仍在预算内 | packages/dsh-collab/test/controller-seams.test.mjs | surface-04：新增参数后仍在预算内 | 🔴 red |
| specs/dsh-collab/spec.md → 成员信任由宿主配置声明 | 缺省开启成员信任 | packages/dsh-collab/test/config.test.ts | trust-config-01：缺省开启成员信任 | 🔴 red |
| specs/dsh-collab/spec.md → 成员信任由宿主配置声明 | 非法取值拒绝启动 | packages/dsh-collab/test/session-provider.test.ts | admit-07：非法配置拒绝启动 | 🟢 green (regression) |
| specs/dsh-collab/spec.md → 成员信任由宿主配置声明 | 成员信任不放宽宿主权限 | N/A | 真实 Host 验收：宿主 sandbox/approval 规则不因成员信任放宽 | N/A — non-executable |

## Coverage Notes

- **Deleted tests.** Removed mechanisms take their tests with them, in the same batch that removes the code (tasks group 2):
  - `breaker.test.ts`;
  - `decisions.test.ts`;
  - `escalation.test.ts`;
  - the confirm cases in `presence.test.ts` (`binding-02`/`binding-03`) and `dispatch.test.ts` (`dispatch-04`);
  - the decision rows of `wake-table.test.ts`;
  - `auth-11`.

  Their surviving behavior is covered by `topic-*`, `legacy-*`, `items-05/06`, `requests-06` and `binding-02` (rewritten).
- **Legacy fixtures.** `legacy-*`, `topic-02`, `members-08`, `items-05/06/08`, `requests-06`, `idempotency-07`, `status-pending-06/07` and `projection-06` seed old-format records directly through the store: decision events, `breaker/reset{member}`, confirm intents, human members, internal-scope receipts, `deciders`/`agentEditCount` snapshots, and wake intents without `thread`. They must not build these records through the new service.
- **Rejection oracles.** They depend on whether the cmdId already has a receipt.
  - A validation, limit or legacy-field rejection of a cmdId that never committed asserts three things: the log length is unchanged, no receipt exists for that cmdId, and there is no dispatch intent.
  - `COLLAB_CMD_CONFLICT` asserts three different things: the original receipt is byte-identical, the log length is unchanged, and replaying the original payload returns the original result.
- **Topic boundaries.** `topic-01`, `topic-02`, `topic-09` and `topic-10` drive real service commands to the exact boundary. `topic-02` and `topic-10` close and reopen the space and compare the derived maps. Folding the same log twice is not accepted as evidence.
- **Plugin legacy retry.** `tool-08` creates the old receipt with the pre-change kernel record shape, including `deciders:[]`. It then calls the registered tool, not the kernel directly.
- **Real-header tests.** `controller-seams.test.mjs` needs the DSH component environment (`npm run test:components`); the tool-size budget is measured there.
- **Named tests split out of existing coverage.** `trust-07` and `trust-config-01` give scenarios that were previously asserted inside `trust-06` and the config tests their own named tests. They start red only because the named test does not exist yet; the behavior is unchanged.
- **Non-executable row.** `成员信任不放宽宿主权限` has no code test surface: sandbox, approval and worktree enforcement belong to the DSH host. It is covered by the real-Host acceptance in tasks 5.5, which repeats the check done for `dsh-collab-member-trust`.
