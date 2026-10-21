## Test Plan

PRECHECK：review.md 第 8 轮 `VERDICT: APPROVE`，无要求修改。

测试名约定：vitest 的 `it('<Test Name>：<Scenario 名>', …)`，Test Name 列为唯一前缀；apply 时逐行翻绿。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/collab-kernel/spec.md → 协作内核不依赖任何宿主 | 依赖图不含宿主包 | packages/collab-kernel/test/boundary.test.ts | boundary-01 | 🟢 green |
| specs/collab-kernel/spec.md → 协作内核不依赖任何宿主 | 引入宿主依赖时报出违规 | packages/collab-kernel/test/boundary.test.ts | boundary-02 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 动作记为 principal 反查到的成员 | packages/collab-kernel/test/auth.test.ts | auth-01 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 首次创建与创建重放 | packages/collab-kernel/test/auth.test.ts | auth-02 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 重复创建同一协作空间 | packages/collab-kernel/test/auth.test.ts | auth-03 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 命令不做成员反查 | packages/collab-kernel/test/auth.test.ts | auth-04 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 不存在的协作空间先于成员反查报错 | packages/collab-kernel/test/auth.test.ts | auth-05 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 公开命令与授权表一致 | packages/collab-kernel/test/auth.test.ts | auth-06 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 没有按字符串分发的入口 | packages/collab-kernel/test/auth.test.ts | auth-07 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 非 Leader 邀请被拒 | packages/collab-kernel/test/auth.test.ts | auth-08 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | 他人代为加入被拒 | packages/collab-kernel/test/auth.test.ts | auth-09 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | provider 代表其他 channel 被拒 | packages/collab-kernel/test/auth.test.ts | auth-10 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | agent 调用 confirmDecision 被拒 | packages/collab-kernel/test/auth.test.ts | auth-11 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | internal 不能执行成员命令 | packages/collab-kernel/test/auth.test.ts | auth-12 | 🟢 green |
| specs/collab-kernel/spec.md → 封闭的命令集合与授权 | gone 成员不能读写 | packages/collab-kernel/test/auth.test.ts | auth-13 | 🟢 green |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 唯一认领后加入 | packages/collab-kernel/test/members.test.ts | members-01 | 🟢 green |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 无人认领 | packages/collab-kernel/test/members.test.ts | members-02 | 🟢 green |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 多个认领 | packages/collab-kernel/test/members.test.ts | members-03 | 🟢 green |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | provider 按 kind 拒绝认领 | packages/collab-kernel/test/members.test.ts | members-04 | 🟢 green |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 同一地址不能成为两个成员 | packages/collab-kernel/test/members.test.ts | members-05 | 🟢 green |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | agent 创建者不能声明为人类 | packages/collab-kernel/test/members.test.ts | members-06 | 🟢 green |
| specs/collab-kernel/spec.md → 成员模型与地址唯一 | 非法成员名 | packages/collab-kernel/test/members.test.ts | members-07 | 🟢 green |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 创建者成为 Leader | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-01 | 🟢 green |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 直接转交 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-02 | 🟢 green |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 不能转交给非 active 成员 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-03 | 🟢 green |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | Leader 离开后自动接手 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-04 | 🟢 green |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 无人可接手时关闭 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-05 | 🟢 green |
| specs/collab-kernel/spec.md → 协作空间的创建、Leader 转交与关闭 | 主动关闭后仍可读取 | packages/collab-kernel/test/lifecycle.test.ts | lifecycle-06 | 🟢 green |
| specs/collab-kernel/spec.md → 条目状态转换表 | 全员 ack 后 agreed | packages/collab-kernel/test/items.test.ts | items-01 | 🟢 green |
| specs/collab-kernel/spec.md → 条目状态转换表 | 修改使旧 ack 失效 | packages/collab-kernel/test/items.test.ts | items-02 | 🟢 green |
| specs/collab-kernel/spec.md → 条目状态转换表 | 过期 revision 修改被拒 | packages/collab-kernel/test/items.test.ts | items-03 | 🟢 green |
| specs/collab-kernel/spec.md → 条目状态转换表 | 过期 revision 的 ack 被拒 | packages/collab-kernel/test/items.test.ts | items-04 | 🟢 green |
| specs/collab-kernel/spec.md → 条目状态转换表 | escalated 不能经修改或 ack 离开 | packages/collab-kernel/test/items.test.ts | items-05 | 🟢 green |
| specs/collab-kernel/spec.md → 条目状态转换表 | decided 是终态 | packages/collab-kernel/test/items.test.ts | items-06 | 🟢 green |
| specs/collab-kernel/spec.md → 条目状态转换表 | 非法条目字段 | packages/collab-kernel/test/items.test.ts | items-07 | 🟢 green |
| specs/collab-kernel/spec.md → 消息与状态文本 | 正常发送消息 | packages/collab-kernel/test/messages.test.ts | messages-01 | 🟢 green |
| specs/collab-kernel/spec.md → 消息与状态文本 | 收件人不是 active 成员 | packages/collab-kernel/test/messages.test.ts | messages-02 | 🟢 green |
| specs/collab-kernel/spec.md → 消息与状态文本 | 正文超限 | packages/collab-kernel/test/messages.test.ts | messages-03 | 🟢 green |
| specs/collab-kernel/spec.md → 消息与状态文本 | needsReply 不做隐式转换 | packages/collab-kernel/test/messages.test.ts | messages-04 | 🟢 green |
| specs/collab-kernel/spec.md → 消息与状态文本 | 清空与超长状态 | packages/collab-kernel/test/messages.test.ts | messages-05 | 🟢 green |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 承接方正常推进 | packages/collab-kernel/test/requests.test.ts | requests-01 | 🟢 green |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 非承接方推进被拒 | packages/collab-kernel/test/requests.test.ts | requests-02 | 🟢 green |
| specs/collab-kernel/spec.md → request 条目的承接流程 | 非法跳转被拒 | packages/collab-kernel/test/requests.test.ts | requests-03 | 🟢 green |
| specs/collab-kernel/spec.md → agent 往返超限自动升级为待人决定 | 第 4 次 agent 修改触发升级 | packages/collab-kernel/test/escalation.test.ts | escalation-01 | 🟢 green |
| specs/collab-kernel/spec.md → agent 往返超限自动升级为待人决定 | 人类修改不改变计数 | packages/collab-kernel/test/escalation.test.ts | escalation-02 | 🟢 green |
| specs/collab-kernel/spec.md → agent 往返超限自动升级为待人决定 | agreed 后计数归零 | packages/collab-kernel/test/escalation.test.ts | escalation-03 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 合格确认写入决定 | packages/collab-kernel/test/decisions.test.ts | decisions-01 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 新请求作废旧请求 | packages/collab-kernel/test/decisions.test.ts | decisions-02 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 决定后旧请求不能再确认 | packages/collab-kernel/test/decisions.test.ts | decisions-03 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 非决定人确认被拒 | packages/collab-kernel/test/decisions.test.ts | decisions-04 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 已离开的决定人不能确认 | packages/collab-kernel/test/decisions.test.ts | decisions-05 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 投递对象与确认人必须一致 | packages/collab-kernel/test/decisions.test.ts | decisions-06 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 条目已变更后确认被拒 | packages/collab-kernel/test/decisions.test.ts | decisions-07 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 投递失败时不能确认 | packages/collab-kernel/test/decisions.test.ts | decisions-08 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 同一点击以新 cmdId 重放 | packages/collab-kernel/test/decisions.test.ts | decisions-09 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 同一点击不同内容冲突 | packages/collab-kernel/test/decisions.test.ts | decisions-10 | 🟢 green |
| specs/collab-kernel/spec.md → 人类决定只能由带证据的确认产生 | 不同 provider 的相同点击编号互不影响 | packages/collab-kernel/test/decisions.test.ts | decisions-11 | 🟢 green |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 重放返回原结果 | packages/collab-kernel/test/idempotency.test.ts | idempotency-01 | 🟢 green |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 状态已变化的命令仍可重放 | packages/collab-kernel/test/idempotency.test.ts | idempotency-02 | 🟢 green |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 关闭后的历史重放 | packages/collab-kernel/test/idempotency.test.ts | idempotency-03 | 🟢 green |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 同 cmdId 不同载荷 | packages/collab-kernel/test/idempotency.test.ts | idempotency-04 | 🟢 green |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 重启后幂等仍成立 | packages/collab-kernel/test/idempotency.test.ts | idempotency-05 | 🟢 green |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 失败命令可以重试 | packages/collab-kernel/test/idempotency.test.ts | idempotency-06 | 🟢 green |
| specs/collab-kernel/spec.md → 命令按 cmdId 幂等 | 成员与 internal 的收据互不冲突 | packages/collab-kernel/test/idempotency.test.ts | idempotency-07 | 🟢 green |
| specs/collab-kernel/spec.md → 事件日志是唯一真源，读取是纯操作 | 增量读取 | packages/collab-kernel/test/log.test.ts | log-01 | 🟢 green |
| specs/collab-kernel/spec.md → 事件日志是唯一真源，读取是纯操作 | 超前与非法 seq | packages/collab-kernel/test/log.test.ts | log-02 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 重启后状态一致 | packages/collab-kernel/test/store.test.ts | store-01 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 行校验和有固定向量 | packages/collab-kernel/test/store.test.ts | store-02 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 末尾残片被截断 | packages/collab-kernel/test/store.test.ts | store-03 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 完整行损坏拒绝加载 | packages/collab-kernel/test/store.test.ts | store-04 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 短写不报告成功 | packages/collab-kernel/test/store.test.ts | store-05 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 多事件命令不会只落一半 | packages/collab-kernel/test/store.test.ts | store-06 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | fsync 失败后结果交给重试判定 | packages/collab-kernel/test/store.test.ts | store-07 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | failed 后的 close 阻止旧队列继续提交 | packages/collab-kernel/test/store.test.ts | store-08 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 已被锁定时拒绝打开 | packages/collab-kernel/test/store.test.ts | store-09 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 残留锁不被自动接管 | packages/collab-kernel/test/store.test.ts | store-10 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 按实例 id 解除残留锁 | packages/collab-kernel/test/store.test.ts | store-11 | 🟢 green |
| specs/collab-kernel/spec.md → 存储按命令原子提交，并由排他锁保证单写入方 | 实例 id 不符不解除 | packages/collab-kernel/test/store.test.ts | store-12 | 🟢 green |
| specs/collab-kernel/spec.md → 状态只经命令产生 | 不存在的协作空间被拒 | packages/collab-kernel/test/surface.test.ts | surface-01 | 🟢 green |
| specs/collab-kernel/spec.md → 状态只经命令产生 | 公开类型不含事件写入 | packages/collab-kernel/test/surface.test-d.ts | surface-02 | 🟢 green |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 需回复消息叫醒收件人 | packages/collab-kernel/test/wake.test.ts | wake-01 | 🟢 green |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 状态更新不叫醒 | packages/collab-kernel/test/wake.test.ts | wake-02 | 🟢 green |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 不叫醒自己 | packages/collab-kernel/test/wake.test.ts | wake-03 | 🟢 green |
| specs/collab-kernel/spec.md → 唤醒只投结构化指针，按事件类型决定接收方 | 邀请叫醒被邀请者 | packages/collab-kernel/test/wake.test.ts | wake-04 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 意图与命令同提交 | packages/collab-kernel/test/dispatch.test.ts | dispatch-01 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 正常返回记为成功 | packages/collab-kernel/test/dispatch.test.ts | dispatch-02 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | provider 抛错记为失败 | packages/collab-kernel/test/dispatch.test.ts | dispatch-03 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 确认缺 messageRef 记为失败 | packages/collab-kernel/test/dispatch.test.ts | dispatch-04 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 慢投递在结束前不写结果 | packages/collab-kernel/test/dispatch.test.ts | dispatch-05 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 宿主不能写入投递结果 | packages/collab-kernel/test/dispatch.test-d.ts | dispatch-06 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 重启后未完成投递不重发 | packages/collab-kernel/test/dispatch.test.ts | dispatch-07 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 投递完成提交可持久化与重放且无收据 | packages/collab-kernel/test/dispatch-persistence.test.ts | dispatch-08 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | failed 后不写投递完成提交 | packages/collab-kernel/test/dispatch.test.ts | dispatch-09 | 🟢 green |
| specs/collab-kernel/spec.md → 投递意图在事务内记账 | 投递完成提交 fsync 失败后按日志恢复 | packages/collab-kernel/test/dispatch-persistence.test.ts | dispatch-10 | 🟢 green |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 不可达成员不记账 | packages/collab-kernel/test/presence.test.ts | binding-01 | 🟢 green |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 无可确认绑定 | packages/collab-kernel/test/presence.test.ts | binding-02 | 🟢 green |
| specs/collab-kernel/spec.md → 选择绑定与在线状态 | 每位决定人一条确认投递 | packages/collab-kernel/test/presence.test.ts | binding-03 | 🟢 green |
| specs/collab-kernel/spec.md → 按成员计数的熔断 | 达到上限后暂停 | packages/collab-kernel/test/breaker.test.ts | breaker-01 | 🟢 green |
| specs/collab-kernel/spec.md → 按成员计数的熔断 | 并发提交不超发 | packages/collab-kernel/test/breaker.test.ts | breaker-02 | 🟢 green |
| specs/collab-kernel/spec.md → 按成员计数的熔断 | 人类决定解除暂停 | packages/collab-kernel/test/breaker.test.ts | breaker-03 | 🟢 green |
| specs/collab-kernel/spec.md → 按成员计数的熔断 | 确认投递不受熔断限制 | packages/collab-kernel/test/breaker.test.ts | breaker-04 | 🟢 green |
| specs/collab-kernel/spec.md → 按成员计数的熔断 | agent principal 不能清零 | packages/collab-kernel/test/breaker.test.ts | breaker-05 | 🟢 green |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 投影列出待 ack | packages/collab-kernel/test/projection.test.ts | projection-01 | 🟢 green |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 投影不含消息正文 | packages/collab-kernel/test/projection.test.ts | projection-02 | 🟢 green |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 恶意标题不能产生额外结构 | packages/collab-kernel/test/projection.test.ts | projection-03 | 🟢 green |
| specs/collab-kernel/spec.md → 状态投影只呈现当前值，且以纯文本安全输出 | 转义后可见文本不变 | packages/collab-kernel/test/projection.test.ts | projection-04 | 🟢 green |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 总览带约定版本 | packages/collab-kernel/test/convention-integration.test.ts | convention-01 | 🟢 green |
| specs/collab-kernel/spec.md → 协作约定随协作空间提供 | 未知版本 | packages/collab-kernel/test/convention.test.ts | convention-02 | 🟢 green |

## Coverage Notes

- 共 108 个场景，全部映射到可执行的 vitest 用例，没有 `N/A — non-executable` 行。本表由脚本从 spec 的 `#### Scenario:` 生成，数量与 spec 一致。
- **共享夹具** `test/support/`：`FakeProvider`（可编程认领、能力、返回/抛错/延迟，记录调用）、`MemStore`、`faultyFs`（短写、写出部分后抛错、fsync 抛错）、`world`（快速搭建协作空间和成员，提供 `ctx/read`）。presence 通过 FakeProvider.observedPresence 与受控 Promise 注入；不额外维护未使用的 fixedPresence。
- **类型层测试**（`auth` 中"没有按字符串分发的入口"、`surface-02`、`dispatch` 中"宿主不能写入投递结果"）：用 `expectTypeOf` 配合 `vitest --typecheck`，放在同名 `*.test-d.ts` 文件中。
- **依赖边界**：`scanImports(dir)` 仅在 `test/support/`，违规夹具放在 `test/fixtures/bad-import/`；扫描器不得进入 runtime 源码或公开 exports。
- **auth-06**：用开发依赖 TypeScript 读取真实 `CollabService` 公开可调用成员，排除四个纯读及逐项核实的非业务生命周期方法，与授权表键比较；同一检查必须在新增 `unsafeWrite` 的类型夹具上失败。不导出产品命令清单，不新增运行时分发器。
- **R8-S1 额外回归 `dispatch-close-late`**：可控 provider Promise 挂起，X 正常 close、Y open 后再 resolve X；断言旧回调不追加 completed、不重投，Y 的 pending 状态不变。它验证既有 close 边界，不改变规范，也不新增场景数。
- **投影 AST**：devDependency 引入 `mdast-util-from-markdown`，断言节点类型和归一化后的可见文本。
- **并发与慢投递**：并发用 `Promise.all`；慢投递用 vitest 假定时器推进时间，不真实等待。
- **熔断常量**：breaker 边界以 `BREAKER_LIMIT` 驱动循环；独立规范/纯表夹具也保留 v1 的固定数值作为 oracle，不因常量意外变更同步掩盖规格漂移。
- **额外回归（不改变108场景数）**：wake-table 全事件与纯函数断言，presence-sampling 入队前一次采样，service-admission/space-lifecycle/service-lifecycle-extra 覆盖关闭与打开/创建/commit竞态，command-snapshot 覆盖载荷稳定性，projection-escaping/deliveries 覆盖精确可见文本与live/recovery区分。FileStore 字节级非法UTF8与锁替代保护见 file-store.test.ts。
