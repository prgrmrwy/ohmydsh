# Test Plan: pet-locus-purge-previous-model

Precheck：[review.md](review.md) `VERDICT: APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`（第 3 轮，复核记录见其末尾）。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 长父历史不能冒充子身份 | packages/dsh-pet/test/independent-runtime-probe.test.ts | official spawn preparation returns no seed and never reads parent history | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 业务完成只经统一工具提交 | packages/dsh-pet/test/locus-reply-tool.test.ts | registers finish and wait, with no legacy reply alias or routing selector | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 无法证明独立能力时拒绝创建 | packages/dsh-pet/test/locus-lazy-child.test.ts | provider 不能证明独立上下文 | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 历史不含最新目录 | packages/dsh-pet/test/locus-context.test.ts | does not guess an unconfirmed anchor or permission | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 主会话无法回答 | packages/dsh-pet/test/locus-context.test.ts | spec Scenario "主会话无法回答" | 🟢 green — new characterization (carried forward gap) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 跨 turn 父回复继续 current Delivery | packages/dsh-pet/test/locus-reply-tool.test.ts | sends through the original Delivery after a parent agent-message reply | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 单独的 agent 消息不能获得飞书能力 | packages/dsh-pet/test/locus-turn-observer.test.ts | does not create authority from an agent-message without a Delivery | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | GUI 流量仍不能消费 current | packages/dsh-pet/test/locus-reply-tool.test.ts | refuses to send after the same child turn claims a Delivery and a steer | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 新话题上下文 | packages/dsh-pet/test/locus-context.test.ts | does not flatten history or invent a parent summary | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 子会话发现不自动成为主会话认知 | packages/dsh-pet/test/locus-child-context.test.ts | 子会话发现不自动成为主会话认知 | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 用户主动查阅受实际能力约束 | packages/dsh-pet/test/locus-context.test.ts | spec Scenario "用户主动查阅受实际能力约束" | 🟢 green — new characterization (carried forward gap) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 冷恢复保留独立历史 | packages/dsh-pet/test/locus-child-preset-runtime.test.ts | spec Scenario "冷恢复保留独立历史" | 🟢 green — new characterization (carried forward gap) |
| specs/pet-locus-collaboration/spec.md → 上下文按实际子会话绑定并允许按需问主会话 | 旧 fork child 不受影响 | packages/dsh-pet/test/locus-child-context.test.ts | 旧 fork child 不受影响 | 🟢 green (rewritten THEN) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 受管 finish 正常发送 | packages/dsh-pet/test/locus-reply-tool.test.ts | accepts reply and sends to the exact current Delivery message | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 旁路不可达 | packages/dsh-pet/test/locus-safe-runtime.test.ts | makes every ambient execution/delegation route unreachable while retaining a scoped finish | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 档误用 lark-cli 发送被拦截 | packages/dsh-pet/test/locus-lark-cli-egress-guard.test.ts | blocks common direct Lark write: %s | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 档读取当前群不被拦截 | packages/dsh-pet/test/locus-lark-cli-egress-guard.test.ts | allows common read command: %s | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | shell 档的出站保证如实表述 | packages/dsh-pet/test/locus-context.test.ts | renders shell-tier capabilities and accurately describes the mistake-prevention guard | 🟢 green (existing, carried forward); fixture → tier3 |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 子委派不能洗白权限 | packages/dsh-pet/test/locus-composition.test.ts | names tools outside the selected tier and every delegation route | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 收紧层未安装时不发布 | packages/dsh-pet/test/locus-composition.test.ts | 收紧层未安装时不发布 | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 隔离能力无法证明时不发布 | packages/dsh-pet/test/locus-composition.test.ts | 隔离能力无法证明时不发布 | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | safe-v1 行继续服务 | packages/dsh-pet/test/locus-persistence-v19.test.ts | spec Scenario "safe-v1 行继续服务" | 🟢 green (rewritten THEN; replaces locus-composition.test.ts test of same name) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 主会话 preset 不影响子会话工具面 | packages/dsh-pet/test/locus-composition.test.ts | 主会话 preset 不影响子会话工具面 | 🟢 green (rewritten THEN: locus-child preset) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 冷恢复不回落到父组合 | packages/dsh-pet/test/locus-composition.test.ts | 冷恢复不回落到父组合 | 🟢 green (rewritten THEN: locus-child preset) |
| specs/pet-locus-collaboration/spec.md → Locus 业务出站只能经受管 finish | 升级前的 legacy child 不可恢复服务 | packages/dsh-pet/test/locus-persistence-v19.test.ts | spec Scenario "升级前的 legacy child 不可恢复服务" | 🟢 green (rewritten THEN; replaces locus-composition.test.ts test of same name) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 授予 shell 档 | packages/dsh-pet/test/locus-tool-tier-mutation.test.ts | 授予 shell 档 | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 撤回 shell 档 | packages/dsh-pet/test/locus-tool-tier-mutation.test.ts | 撤回 shell 档 | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 忙时拒绝 | packages/dsh-pet/test/locus-control.test.ts | rejects a busy tool-tier change with a deterministic wait receipt | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 核验失败回到 safe | packages/dsh-pet/test/locus-tool-tier-mutation.test.ts | 核验失败回到 safe | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | safe-v1 入口请求 shell | packages/dsh-pet/test/locus-control.test.ts | spec Scenario "safe-v1 入口请求 shell" | 🟢 green (rewritten THEN; replaces locus-tool-tier-mutation.test.ts test of same name) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | shell 档拒绝普通成员 | packages/dsh-pet/test/locus-controller-races.test.ts | owner-only refusal emits deterministic receipt without accepting a Delivery | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 切换前排队的普通成员请求 | packages/dsh-pet/test/locus-controller-races.test.ts | fails a non-allowlisted shell-tier backlog row before current claim or child queueing | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 冷恢复保持档位 | packages/dsh-pet/test/locus-tool-tier-mutation.test.ts | 冷恢复保持档位 | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 重建不继承 shell | packages/dsh-pet/test/locus-controller.test.ts | spec Scenario "重建不继承 shell" | 🟢 green — new characterization (carried forward gap) |
| specs/pet-locus-collaboration/spec.md → Locus 工具档位由所有者显式授予且不重建子会话 | 非 allowlist 档位命令 | packages/dsh-pet/test/locus-admission.test.ts | does not let a non-allowlisted sender run tool-tier control commands | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 群级引用触发消息 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "群级引用触发消息": the reply target is the current Delivery's own trigger, never a backlog message | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 话题回复留在原话题 | packages/dsh-pet/test/channel-lark.test.ts | spec Scenario "话题回复留在原话题": uses explicit thread reply semantics for a topic Delivery | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 文档评论回复回到触发评论 | packages/dsh-pet/test/locus-doc-finish.test.ts | spec Scenario "文档评论回复回到触发评论": an anchored entry replies under c2 and records completed/replied | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 文档回复目标与入口不符 | packages/dsh-pet/test/locus-doc-finish.test.ts | spec Scenario "文档回复目标与入口不符": no send, never finishing | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 升级需离线迁移并先备份 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "升级需离线迁移并先备份": v15 → current takes a snapshot first and purges the v15 locus rows | 🟢 green (rewritten THEN: target 19, v15 locus rows purged) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 未迁移时当前版本拒绝打开 | packages/dsh-pet/test/migration-guidance.test.ts | spec Scenario "未迁移时 v16 拒绝打开": a v15 medium under a v16 Host gets the offline-migration guidance | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | v15 拒绝打开新版本库 | packages/dsh-pet/test/pet-storage-backend.test.ts | a v15 descriptor refuses a medium stamped 16 with version-mismatch and changes nothing | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | turn 结束不完成请求 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "turn 结束不完成请求": A stays current after its turn ends and B is not delivered | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 相对等待受绝对上限约束 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "相对等待受绝对上限约束": uses the fixed acceptance deadline and hard 24-hour cap for repeated waits | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 超时自动开放下一条 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "超时自动开放下一条": an expired A releases B onto the same child | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 完成与超时竞争 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "完成与超时竞争": the losing finish neither sends nor touches the next Delivery | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 迟到 finish 不消费下一条 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "迟到 finish 不消费下一条": after A expires and B is current, a late finish for A cannot reserve or end B | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 发送确认未知不重放 | packages/dsh-pet/test/locus-settlement-integration.test.ts | spec Scenario "发送确认未知不重放": unknown-terminal advances the queue and is never re-queued | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | Host 重启恢复未过期 current | packages/dsh-pet/test/locus-persistence.test.ts | spec Scenario "Host 重启恢复未过期 current": keeps an unproven current Delivery waiting instead of settling it early | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | Host 重启处理遗留 finishing | packages/dsh-pet/test/locus-persistence.test.ts | spec Scenario "Host 重启处理遗留 finishing": a restart converges finishing to unknown-terminal, frees the queue, never resends | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 私聊与群消息交错 | packages/dsh-pet/test/locus-reply-tool.test.ts | spec Scenario "私聊与群消息交错": a GUI turn gets no current capability, sends nothing and leaves the Feishu Delivery to its owner | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 旧代际迟到结算 | packages/dsh-pet/test/locus-delivery.test.ts | spec Scenario "旧代际迟到结算": does not let a late old-generation settlement consume a replacement delivery | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 投递与结算关联独立于会话运行状态 | 宿主重启无法证明关联 | packages/dsh-pet/test/locus-persistence.test.ts | spec Scenario "宿主重启无法证明关联": keeps queued work busy as explicit manual debt when termination is unavailable | 🟢 green (existing, carried forward) |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | dry-run 列出将删除的行且不写入 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "dry-run 列出将删除的行且不写入" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 确认后清除旧模型数据 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "确认后清除旧模型数据" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 删除中间代际造成断档时拒绝 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "删除中间代际造成断档时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 未创建 child 的历史行可以没有 marker | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "未创建 child 的历史行可以没有 marker" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 切换通知按 locusId 精确删除 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "切换通知按 locusId 精确删除" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 预检通过后出现非终态投递时锁内拒绝 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "预检通过后出现非终态投递时锁内拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 预检后版本已变化 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "预检后版本已变化" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 存在非终态投递时拒绝 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "存在非终态投递时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 存在未完成的操作时拒绝 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "存在未完成的操作时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 保留行不满足 v19 条件时拒绝 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "保留行不满足 v19 条件时拒绝" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 未确认时不写入 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "未确认时不写入" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 已是目标版本时无操作 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "已是目标版本时无操作" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 从更早版本迁移时全部 locus 行都是旧模型 | packages/dsh-pet/test/migrate-cli.test.ts | spec Scenario "从更早版本迁移时全部 locus 行都是旧模型" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 已安装的命令在仓库外可用 | packages/dsh-pet/test/migrate-cli-installed.test.ts | spec Scenario "已安装的命令在仓库外可用" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 迁移后的库能打开并完成启动对账 | packages/dsh-pet/test/locus-persistence-v19.test.ts | spec Scenario "迁移后的库能打开并完成启动对账" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 删除历史前代后保留行仍可服务与重建 | packages/dsh-pet/test/locus-persistence-v19.test.ts | spec Scenario "删除历史前代后保留行仍可服务与重建" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 启动早期的冷恢复不读到悬空索引 | packages/dsh-pet/test/locus-persistence-v19.test.ts | spec Scenario "启动早期的冷恢复不读到悬空索引" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 旧模型 locus 数据经离线迁移清除 | 非 locus 表不受影响且仍可读取 | packages/dsh-pet/test/locus-persistence-v19.test.ts | spec Scenario "非 locus 表不受影响且仍可读取" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层只承载三层模型的 locus 行 | 合规数据正常就绪 | packages/dsh-pet/test/locus-persistence-v19.test.ts | spec Scenario "合规数据正常就绪" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层只承载三层模型的 locus 行 | 非 tier3 marker 使 Domain 打开失败 | packages/dsh-pet/test/locus-persistence-v19.test.ts | spec Scenario "非 tier3 marker 使 Domain 打开失败" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层只承载三层模型的 locus 行 | 无配对的行使启动对账失败 | packages/dsh-pet/test/locus-persistence-v19.test.ts | spec Scenario "无配对的行使启动对账失败" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层只承载三层模型的 locus 行 | 从未建立 locus 主会话的会话首次打开 Q&A | packages/dsh-pet/test/locus-controller-persistence-adapter.test.ts | spec Scenario "从未建立 locus 主会话的会话首次打开 Q&A" | 🟢 green |
| specs/pet-locus-collaboration/spec.md → 持久层只承载三层模型的 locus 行 | chat_bindings 退休标记仍然生效 | packages/dsh-pet/test/locus-admission.test.ts | spec Scenario "chat_bindings 退休标记仍然生效" | 🟢 green |

## Coverage Notes

- 共 76 行，与 delta 中 76 个场景一一对应。
- `⚪ existing (carried forward)`：场景原样随 MODIFIED 带入，行为不变，映射到已有测试（标题匹配或行为匹配，由只读调研逐条核对）。apply 阶段运行它们并确认为绿，不改断言；若其 fixture 使用 `safe-v1`/`safe-v2` 或 `active` 缺 marker，只把 fixture 改为合法 `tier3`（design D7.10），不改测试目的。
- `🔴 red — new characterization`：带入的旧场景此前没有断言其 THEN 的测试（主会话无法回答、用户主动查阅受实际能力约束、冷恢复保留独立历史、重建不继承 shell）。补测试；若实现已满足，测试首次运行即为绿，按'先确认它能因断言失败'的方式写（临时反转断言或在旧行为上验证），verify 中记录。
- 改写 THEN 的旧测试：`locus-composition.test.ts` 的「safe-v1 行继续服务」「升级前的 legacy child 不可恢复服务」与 `locus-tool-tier-mutation.test.ts` 的「safe-v1 入口请求 shell」原断言运行期退休行为；按新 THEN 在新位置重写，旧测试删除。
- 删除的测试：`locus-legacy-retire.test.ts` 全部（对应 REMOVED「旧模型入口按退休规则处理」）；其它只断言两层模型退休/重建的测试在 apply 中逐条列出并写入 verify.md。L1（`chat_bindings`）相关测试保留。
- 版本号固定在旧值的既有测试（`migration-guidance.test.ts`、`pet-storage-backend.test.ts`、`intent-triage-domain-contract.test.ts` 的版本断言）按 `PET_DOMAIN_VERSION = 19` 更新数值，不改测试目的。
- 额外测试（不占 plan 行）：`TERMINAL_STATUSES` 与脚本终态集合一致；`validateLocusSetForStorage` 单元测试；`zod` 位于 `dependencies`。
