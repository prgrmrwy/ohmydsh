## Test Plan

Every scenario in `specs/` maps to a named test. The ledger is live: during apply, each row moves from 🔴 to 🟢 when its test passes.

Some scenarios already existed and keep their wording or meaning. They are marked `🟢 green (existing regression)`. Their tests already exist and must stay green throughout. No red-first step applies to them, because their behavior does not change.

Every scenario whose behavior is new or changed starts at 🔴 red. A scenario that only pins behavior this change must preserve (old event shapes, frozen convention bytes and reads, existing validation precedence) starts 🟢 as regression coverage. It must stay green throughout, and no red-first step is invented for it.

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 引用先前消息 | packages/collab-kernel/test/refs.test.ts | ref-01：引用先前消息 | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 引用条目的创建 seq | packages/collab-kernel/test/refs.test.ts | ref-02：引用条目的创建 seq | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 不写 ref 时事件形状不变 | packages/collab-kernel/test/refs.test.ts | ref-03：不写 ref 时事件形状不变 | 🟢 green (preserved behavior; regression) |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 特殊 itemId 的创建 seq 可查 | packages/collab-kernel/test/refs.test.ts | ref-04：特殊 itemId 的创建 seq 可查 | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 消息引用不存在或不可引用的 seq | packages/collab-kernel/test/refs.test.ts | ref-05：消息引用不存在或不可引用的 seq | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 条目引用非法 seq | packages/collab-kernel/test/refs.test.ts | ref-06：条目引用非法 seq | 🔴 red |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 多重错误时先报既有校验 | packages/collab-kernel/test/refs.test.ts | ref-07：多重错误时先报既有校验 | 🟢 green (preserved behavior; regression) |
| specs/collab-kernel/spec.md → 消息与条目可引用先前记录 | 悬空引用的日志加载失败 | packages/collab-kernel/test/refs.test.ts | ref-08：悬空引用的日志加载失败 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 同一链第 21 环被拒绝 | packages/collab-kernel/test/chain.test.ts | chain-01：同一链第 21 环被拒绝 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 不写 ref 的新消息从 1 开始 | packages/collab-kernel/test/chain.test.ts | chain-02：不写 ref 的新消息从 1 开始 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 不叫醒人的命令不受限 | packages/collab-kernel/test/chain.test.ts | chain-03：不叫醒人的命令不受限 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 条目往返计入链长 | packages/collab-kernel/test/chain.test.ts | chain-04：条目往返计入链长 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | request 进度计入链长 | packages/collab-kernel/test/chain.test.ts | chain-05：request 进度计入链长 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | request 进度不受链长限制 | packages/collab-kernel/test/chain.test.ts | chain-06：request 进度不受链长限制 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 人类决定不受链长限制 | packages/collab-kernel/test/chain.test.ts | chain-07：人类决定不受链长限制 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 邀请不归属任何链 | packages/collab-kernel/test/chain.test.ts | chain-08：邀请不归属任何链 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 旧的成员级熔断不再阻断 | packages/collab-kernel/test/chain.test.ts | chain-09：旧的成员级熔断不再阻断 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 旧日志中的 breaker/reset 照常重放 | packages/collab-kernel/test/chain.test.ts | chain-10：旧日志中的 breaker/reset 照常重放 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 引用条目时取引用那一刻的链长 | packages/collab-kernel/test/chain.test.ts | chain-11：引用条目时取引用那一刻的链长 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 命令时判定与重新加载一致 | packages/collab-kernel/test/chain.test.ts | chain-12：命令时判定与重新加载一致 | 🔴 red |
| specs/collab-kernel/spec.md → 按链长限制往返 | 并发的条目事件不越过上限 | packages/collab-kernel/test/chain.test.ts | chain-13：并发的条目事件不越过上限 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 动作记为 principal 反查到的成员 | packages/collab-kernel/test/auth.test.ts | auth-01：动作记为 principal 反查到的成员 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 首次创建与创建重放 | packages/collab-kernel/test/auth.test.ts | auth-02：首次创建与创建重放 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 重复创建同一协作空间 | packages/collab-kernel/test/auth.test.ts | auth-03：重复创建同一协作空间 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 已移除的 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | auth-04：已移除的 internal purpose 被拒绝 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 不存在的协作空间先于成员反查报错 | packages/collab-kernel/test/auth.test.ts | auth-05：不存在的协作空间先于成员反查报错 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 公开命令与授权表一致 | packages/collab-kernel/test/auth.test.ts | auth-06：公开命令与授权表一致 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 没有按字符串分发的入口 | packages/collab-kernel/test/auth.test.ts | auth-07：没有按字符串分发的入口 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 非 Leader 邀请被拒 | packages/collab-kernel/test/auth.test.ts | auth-08：非 Leader 邀请被拒 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 他人代为加入被拒 | packages/collab-kernel/test/auth.test.ts | auth-09：他人代为加入被拒 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | provider 代表其他 channel 被拒 | packages/collab-kernel/test/auth.test.ts | auth-10：provider 代表其他 channel 被拒 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | agent 调用 confirmDecision 被拒 | packages/collab-kernel/test/auth.test.ts | auth-11：agent 调用 confirmDecision 被拒 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 不能执行成员命令 | packages/collab-kernel/test/auth.test.ts | auth-12：internal 不能执行成员命令 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | gone 成员不能读写 | packages/collab-kernel/test/auth.test.ts | auth-13：gone 成员不能读写 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 可以读取任意空间 | packages/collab-kernel/test/auth.test.ts | auth-14：host-index 可以读取任意空间 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | host-index 不能执行任何写命令 | packages/collab-kernel/test/auth.test.ts | auth-15：host-index 不能执行任何写命令 | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 在已关闭空间执行成员命令仍为 FORBIDDEN | packages/collab-kernel/test/auth.test.ts | auth-16：internal 在已关闭空间执行成员命令仍为 FORBIDDEN | 🔴 red |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 未知 internal purpose 被拒绝 | packages/collab-kernel/test/auth.test.ts | auth-17：未知 internal purpose 被拒绝 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 创建者成为 Leader | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-01：创建者成为Leader | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 直接转交 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-02：Leader直接转交 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 不能转交给非 active 成员 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-03：不能转交给非active或自己 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 离开后自动接手 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-04：离开后自动接手 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 无人可接手时关闭 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-05：无人接手关闭 | 🔴 red |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 主动关闭后仍可读取 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-06：主动关闭后只读 | 🔴 red |
| specs/collab-kernel/spec.md → 消息与状态文本 | 正常发送消息 | packages/collab-kernel/test/messages.test.ts | messages-01：正常发送缺省needsReply | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 消息与状态文本 | 收件人不是 active 成员 | packages/collab-kernel/test/messages.test.ts | messages-02：收件人必须其他active | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 消息与状态文本 | 正文超限 | packages/collab-kernel/test/messages.test.ts | messages-03：正文UTF8字节边界 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 消息与状态文本 | needsReply 不做隐式转换 | packages/collab-kernel/test/messages.test.ts | messages-04：needsReply不转换 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 消息与状态文本 | 清空与超长状态 | packages/collab-kernel/test/messages.test.ts | messages-05：清空和超长状态 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 重放返回原结果 | packages/collab-kernel/test/idempotency.test.ts | idempotency-01：原结果和序号重放不新增 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 状态已变化的命令仍可重放 | packages/collab-kernel/test/idempotency.test.ts | idempotency-02：join后状态变化仍可重放 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 关闭后的历史重放 | packages/collab-kernel/test/idempotency.test.ts | idempotency-03：关闭后历史重放优先于closed | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 同 cmdId 不同载荷 | packages/collab-kernel/test/idempotency.test.ts | idempotency-04：同cmdId不同参数或命令冲突 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 重启后幂等仍成立 | packages/collab-kernel/test/idempotency.test.ts | idempotency-05：重启后幂等仍成立 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 失败命令可以重试 | packages/collab-kernel/test/idempotency.test.ts | idempotency-06：失败无收据可修正重试 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 成员与旧 internal 收据互不冲突 | packages/collab-kernel/test/idempotency.test.ts | idempotency-07：成员与旧 internal 收据互不冲突 | 🔴 red |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | ref 是幂等载荷的一部分 | packages/collab-kernel/test/idempotency.test.ts | idempotency-08：ref 是幂等载荷的一部分 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 需回复消息叫醒收件人 | packages/collab-kernel/test/wake.test.ts | wake-01：需回复消息叫醒收件人 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 状态更新不叫醒 | packages/collab-kernel/test/wake.test.ts | wake-02：状态更新不叫醒 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 不叫醒自己 | packages/collab-kernel/test/wake.test.ts | wake-03：不叫醒自己 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 邀请叫醒被邀请者 | packages/collab-kernel/test/wake.test.ts | wake-04：邀请叫醒被邀请者但不授予读取权限 | 🔴 red |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | Leader 转交不叫醒新 Leader | packages/collab-kernel/test/wake.test.ts | wake-05：Leader 转交不叫醒新 Leader | 🔴 red |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 投影列出待 ack | packages/collab-kernel/test/projection.test.ts | projection-01 中文场景：当前 charter、待 ack、request、升级、决定与投递状态 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 投影不含消息正文 | packages/collab-kernel/test/projection.test.ts | projection-02 中文场景：投影不包含消息或条目正文 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 恶意标题不能产生额外结构 | packages/collab-kernel/test/projection.test.ts | projection-03 中文场景：恶意标题不会产生用户控制的 Markdown 结构 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 转义后可见文本不变 | packages/collab-kernel/test/projection.test.ts | projection-04 中文场景：控制字符清理和标点转义后可见文本不变且为段落 | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 投影不再出现 paused | packages/collab-kernel/test/projection.test.ts | projection-05：投影不再出现 paused | 🔴 red |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 总览带约定版本 | packages/collab-kernel/test/convention-integration.test.ts | convention-01：service creation records the bundled convention and authorised reads return exact bytes | 🔴 red |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 旧空间仍按原版本读取 | packages/collab-kernel/test/convention-integration.test.ts | convention-04：v1 and v2 spaces keep reading their recorded version | 🟢 green (preserved behavior; regression) |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 已发布文本不可变 | packages/collab-kernel/test/convention.test.ts | convention-03：已发布的 v1 与 v2 文本不可变 | 🟢 green (preserved behavior; regression) |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 未知版本 | packages/collab-kernel/test/convention.test.ts | convention-02：未知版本抛出 COLLAB_CONVENTION_UNKNOWN | 🟢 green (existing regression) |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | v3 包含链长规则 | packages/collab-kernel/test/convention.test.ts | convention-05：v3 包含链长规则 | 🔴 red |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 创建邀请加入与协商闭环 | packages/dsh-collab/test/tools.test.ts | tool-01：创建邀请加入与协商闭环 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 相同命令结果未知后重试 | packages/dsh-collab/test/tools.test.ts | tool-02：相同命令结果未知后重试 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 枚举取值与字段不匹配被拒绝 | packages/dsh-collab/test/tools.test.ts | tool-03：枚举取值与字段不匹配被拒绝 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 旧命令的重试不被插件挡住 | packages/dsh-collab/test/tools.test.ts | tool-04：旧命令的重试不被插件挡住 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 工具描述携带重试与重读规则 | packages/dsh-collab/test/controller-seams.test.mjs | tool-05：工具描述携带重试与重读规则 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 内部与人类能力不出现在工具面 | packages/dsh-collab/test/controller-seams.test.mjs | tool-06：内部与人类能力不出现在工具面 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | ref 原样传给内核 | packages/dsh-collab/test/tools.test.ts | tool-07：ref 原样传给内核 | 🔴 red |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 不填 ref 时输入不含该键 | packages/dsh-collab/test/tools.test.ts | tool-08：不填 ref 时输入不含该键 | 🟢 green (preserved behavior; regression) |
| specs/dsh-collab/spec.md → 具名工具忠实适配内核 | 超出链长原样返回 | packages/dsh-collab/test/tools.test.ts | tool-09：超出链长原样返回 | 🔴 red |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 运行中目标下一回合收到 | packages/dsh-collab/test/component-seams.test.mjs | wake-01：运行中目标下一回合收到 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 空闲目标收到带来源指针 | packages/dsh-collab/test/session-provider.test.ts | wake-02：空闲目标收到带来源指针 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 成员信任下的唤醒文本是常设授权 | packages/dsh-collab/test/session-provider.test.ts | trust-06：唤醒文本按 memberTrust 取两套固定说明 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 关闭成员信任保持原说明 | packages/dsh-collab/test/session-provider.test.ts | trust-06：唤醒文本按 memberTrust 取两套固定说明 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 邀请指针不能替代加入 | packages/dsh-collab/test/session-provider.test.ts | wake-04：邀请指针不能读取空间 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 不满足准入条件的目标不投递 | packages/dsh-collab/test/session-provider.test.ts | wake-03：不满足准入条件的目标不投递 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 话题唤醒携带链起点 | packages/dsh-collab/test/session-provider.test.ts | wake-05：话题唤醒携带链起点 | 🔴 red |
| specs/dsh-collab/spec.md → 投递只传协作指针并使用下一回合语义 | 非整数 thread 不被转发 | packages/dsh-collab/test/session-provider.test.ts | wake-06：非整数 thread 不被转发 | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 被唤醒后一次调用即知下一步 | packages/dsh-collab/test/status.test.ts | status-shape-01：被唤醒后一次调用即知下一步 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | 成员文本不进入输出 | packages/dsh-collab/test/status.test.ts | status-shape-02：成员文本不进入输出 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | request 待办带条目 seq | packages/dsh-collab/test/status.test.ts | status-shape-03：request 待办带条目 seq | 🔴 red |
| specs/dsh-collab/spec.md → 状态入口的输出白名单 | request seq 只取自重放推导 | packages/dsh-collab/test/status.test.ts | status-shape-04：request seq 只取自重放推导 | 🔴 red |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | 生命周期前后工具定义字节一致 | packages/dsh-collab/test/controller-seams.test.mjs | surface-01：生命周期前后工具定义字节一致 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | schema 体积在预算内 | packages/dsh-collab/test/controller-seams.test.mjs | surface-02：schema 体积在预算内 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | 超预算夹具被测试拦住 | packages/dsh-collab/test/controller-seams.test.mjs | surface-03：超预算夹具被测试拦住 | 🟢 green (existing regression) |
| specs/dsh-collab/spec.md → 常驻工具面保持稳定且有体积上限 | 新增 ref 参数后仍在预算内 | packages/dsh-collab/test/controller-seams.test.mjs | surface-04：新增 ref 参数后仍在预算内 | 🔴 red |

## Coverage Notes

- **Kernel fixtures.**
  - New tests for refs and chain length (`refs.test.ts`, `chain.test.ts`) reuse `test/support/dispatch-world.ts`.
  - Every member in that fixture is reachable, and every member's binding supports wake.
  - Old-log scenarios seed the store directly with `breaker/reset{member}`, `wake` intents without `thread`, and `internal`-scope receipts.
- **Rejection oracles.** They depend on whether the cmdId already has a receipt.
  - When a validation or limit check rejects a cmdId that never committed, the test asserts three things: the log length is unchanged, no receipt exists for that cmdId, and no dispatch intent was written.
  - When an already-committed cmdId is replayed with a different payload (`COLLAB_CMD_CONFLICT`), the test asserts three different things: the log length is unchanged, the original receipt is byte-identical, and retrying with the original payload returns the original result. The original receipt must never be removed.
- **Shared derivation and parity.**
  - `chainCheck` folds a tentative record through `reduce`, so a command and a replay compute the chain the same way.
  - `chain-12` drives real service commands to the exact boundary, then closes and reopens the space and compares the derived maps. A fold of the same log twice is not accepted as evidence.
  - `chain-11` covers the moving boundary on a referenced item: a message keeps the length it got from the item at creation time, and a later reference sees the item's new length.
- **Concurrency.** `chain-13` controls the order commands enter the queue and uses two commands that are both valid, so the losing command must fail with `COLLAB_THREAD_LIMIT` and not with a stale revision or a permission error.
- **Removed breaker tests.** `breaker.test.ts` is deleted in the same batch that removes the breaker (see tasks group 2, one atomic batch). Its scenarios are superseded by `chain-07`, `chain-09` and `chain-10`. The old `auth-04` test is replaced by the new `auth-04`.
- **Real-header tests.** `controller-seams.test.mjs` needs the DSH component environment (`npm run test:components`). The tool-size budget is measured there, on the real request header.
