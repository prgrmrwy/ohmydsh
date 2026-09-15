## Context

B035 最初为解决答疑群 child 继承父历史、误把自己当 GUI 主 agent 而提出，随后扩展为公共事实、协作者发现、异步询问、结果续进与 G1–G5。所有者决定本 change 只承接 Pet Locus 可用所需的核心能力：独立 child、原生问父以及可靠回复原飞书消息。

独立 child 已本地实现并部署：默认 provider 为 `spawn`，创建前要求 `inheritsParentContext === false`；真实 child 的 `isSeeded=false`、`inheritedEventCount=0`。同轮 `agent-message` 被错误当作路由参与者的问题也已修复并回归。

2026-09-14 的重启后真实验收进一步证明，同轮修复不足以覆盖原生 `send_message` 的契约：child 在 Delivery turn 中问父，`send_message` 只确认投递；该 turn 随后结束。父回答以 `agent-message/relay` 唤醒同一 child 的下一个 turn，child 正确调用回复工具，却因原 Delivery 已随 turn 结算而被拒绝为 stale。精确日志序列为：

```text
turn 2: Feishu Delivery om_x100...b6 → child send_message → turn/end
turn 3: parent agent-message → child pet_locus_reply → stale rejection
```

DSH inbox 还将飞书 followup 放入 `next-turn`、父消息 steer 放入 `next-step`；开始新 turn 时会先 claim 全部 `next-step`，再 claim 一条 `next-turn`。因此若 Pet 把后续飞书请求提前投递，父对 A 的回答可与 B 同批进入模型，单靠 session FIFO 不能证明业务归属。

本设计采用更简单的产品取舍：同一 locus 只投递一个 current Delivery，当前项完成或超时后才投递下一项；少数超时/发送未知请求允许用户重新 `@bot`，不为它引入完整 inquiry continuation 平台。

## Goals / Non-Goals

**Goals:**

- 新建与显式重建的 child 零父 transcript、零默认父摘要，独立性不可证明时拒绝创建。
- 一个 locus 固定复用一个 child session，并严格串行处理飞书 Delivery。
- child 可以跨多个模型 turn 使用原生 `send_message` 获取父上下文，原请求不因 `turn/end` 提前完成。
- 群和话题都精确回复各自触发消息；路由目标始终由 Host 持有。
- 提供单一完成工具和简单等待租约；任何 Delivery 自接收起最多占用 24 小时。
- 超时或不可确认的出站不永久阻塞 locus，且不自动重放不确定发送。

**Non-Goals:**

- 公共事实持久层、协作者名单、answer store、inquiry result outbox、continuation segment、owner projection 与 G3/G4/G5。
- 原生 `send_message` 的 request/reply pair；本期接受极低概率的迟到父消息影响后续模型语义，但不允许其改绑 Host 路由。
- `/new`、`/skip` 或管理面人工清理命令；只保留未来逃生设计。
- 因超时自动重建 child session、增加 locus generation 或清空 child 历史。
- 上下文模式字段、旧 fork child 自动升级或历史兼容迁移。
- 外部发送 exactly-once；本期采用不盲重发的 at-most-once 取舍。

## Decisions

### D1. 独立 child 默认使用 `spawn`，创建前 fail closed 核验

`DEFAULT_CHILD_PROVIDER` 使用零父上下文 provider，普通创建、idle 创建和显式重建共用该默认值。默认 provider 必须证明 `inheritsParentContext === false`；无法证明时以稳定原因拒绝，不回退 fork。显式 provider 覆盖保持既有契约。

不新增上下文模式字段：它只增加可观测性，不影响独立性是否真实生效；旧 child 不会被本 change 自动重建，其历史保持不变。

### D2. Delivery 是 locus 级串行工作项，不是单个模型 turn

每个活跃 locus 在任意时刻至多有一个 `current Delivery`。所有合格飞书消息先按平台 `messageId` 幂等接受并持久化；只有不存在 current 时，才把最早的未过期 queued Delivery 投递到固定 child session。其余项留在 Pet backlog，不提前进入 DSH inbox。

```text
Locus(child session 固定)
  current: A
  backlog: B, C

A finish/expire → B 成为 current 并首次投递
```

`turn/end` 只表示一次 Agent run/segment 结束，不结算 Delivery，不释放 current，也不推进 backlog。父回复、Host 注入上下文与其他普通 agent 上下文可以唤醒同一 child 继续 A；Host 不需要理解 child 是否正在问父。

备选方案“继续同时投递多个 Delivery，再用 turn/execution/continuation segment 关联”需要 durable answer store、outbox、isolated claim seam 与跨轮 proof，远超本期核心目标；拒绝采用。

### D3. 完成统一为 caller-bound `pet_locus_finish`

Agent 面只提供一个完成入口：

```ts
pet_locus_finish({
  outcome: 'reply' | 'no-reply',
  text?: string,
  reason?: string,
})
```

- `reply` 必须包含非空 `text`，不得包含 `reason` 之外的路由信息；
- `no-reply` 不得包含 `text`，必须包含非空 `reason` 供诊断；
- schema 不接受 `deliveryId`、`chatId`、`messageId`、`threadId` 或任何 target selector。

Host 从实际执行 session 解析唯一 active locus 与唯一 current Delivery。工具调用是 child 的完成请求；只有 Host 完成 caller/current/state 校验并提交相应结果后，Delivery 才终结。普通 assistant 文本、`send_message`、`turn/end` 都不是完成证明。

`pet_locus_reply` 不保留兼容别名，避免模型面对两个相似出口，也避免两条路径分别结算 Delivery。

### D4. 群与话题均绑定触发 `messageId`

长期 Locus 入口为：

- 群：`chatId`
- 话题：`chatId + threadId`（平台有该事实时）

每条 Delivery 另保存该次触发消息的 `messageId`；普通消息 ID 不是长期 Locus 身份。

- 群级响应使用飞书按消息回复，引用触发 `messageId`；
- 话题级响应同样引用该 Delivery 的触发 `messageId`，并使用平台的 thread reply 语义保证回复留在原话题；
- `threadId/rootMessageId` 是 Host 从入站事件保存和校验的事实，不由模型提供。

严格 Lark adapter 必须验证进程、响应信封与返回消息标识；话题路径必须实测 `reply_in_thread` 行为，不能只因已保存 `threadId` 就宣称写入正确位置。

### D5. `pet_locus_wait` 暴露相对等待，Host 维护绝对期限

Agent 使用：

```ts
pet_locus_wait({
  waitMinutes: number,
  reason?: string,
})
```

语义是“从调用时刻起，预计还需要等待多少分钟”。它不完成 Delivery、不关联询问、不选择目标。Host 计算：

```text
defaultDeadline   = acceptedAt + 1h
hardDeadline      = acceptedAt + 24h
requestedDeadline = now + waitMinutes
effectiveDeadline = min(max(currentDeadline, requestedDeadline), hardDeadline)
```

规则：

- `waitMinutes` 为正整数，单次最多 1440；
- 可以调用任意次数，只延长、不缩短；
- 无论调用次数多少，都不能越过同一消息 `acceptedAt + 24h`；
- 返回 Host 实际采用的 deadline、剩余分钟和是否被硬上限截断；
- caller/current/state 校验与 finish 使用同一边界，且工具不接受路由 selector。

采用相对分钟是为了让模型自然表达“还要等多久”；绝对上限由 Host 独立控制，不让模型计算消息接收时间。

### D6. 超时推进但始终复用同一个 child session

期限到达时，Host 以原子状态竞争把 current 从可完成态变为 `expired`；只有 expiry 或 finish 之一能够成功。随后：

1. 撤销该 Delivery 的 finish/reply 能力；
2. 尽力 interrupt 仍在运行的当前 Agent turn；
3. 跳过 backlog 中已经超过各自 `acceptedAt + 24h` 的消息；
4. 在同一个 Locus、同一个 child session 上投递下一条未过期 Delivery。

超时不重建 session、不增加 generation、不清除历史。这样与 OpenClaw/Hermes 类 channel 的常见边界一致：按 session 串行、超时/取消当前 run 后释放队列，会话连续性由显式 reset/new 才改变。

已知取舍：若 A 问父后超时，父对 A 的迟到消息可能在 B 期间进入同一 child；Host 路由仍只会使用 current B 的触发消息，但文字可能影响模型理解。所有者接受该低概率语义风险，以换取保留 Locus 长期上下文和较小实现面。未来可在 runtime 支持不可伪造 metadata 时为原生 `send_message` 自动建立 pair；本期不以文本、时间或“最近询问”猜关联。

### D7. 出站使用 at-most-once 终结语义

`pet_locus_finish(outcome='reply')` 先以 CAS 固定当前 Delivery 并进入 `finishing`，再调用严格飞书按消息回复：

- 平台明确成功 → `completed/replied`；
- 平台明确失败 → `failed`；
- 请求可能已发出但未取得可靠确认，或 Host 重启发现遗留 `finishing` → `unknown-terminal`。

三种结果都成为终态并推进队列；`unknown-terminal` 不自动重发。这样可能少答一条，但不会因为猜测成功状态而重复发送，也不会永久阻塞。用户可重新 `@bot` 发起新 Delivery。

`no-reply` 不调用飞书正文发送，直接以 CAS 提交 `completed/no-reply` 并推进。

### D8. 来源安全门围绕 current capability，而非 sticky turn proof

取消 `currentDelivery` 对原始 `executionId + turnId` 的永久依赖，但不把 current 变成任意 child turn 都可消费的全局能力。Host 工具调用必须证明：

- caller 是该 Locus 当前 active child；
- locus/generation/permission 仍有效；
- 恰有一个 current Delivery 且处于可 wait/finish 状态；
- 当前执行来源是该 Delivery 的原始投递，或 current 存续期间由 `agent-message` 唤醒的后续上下文 turn。

GUI/user 输入、来源缺失/未知、无 current 的 standalone `agent-message`、第二个已投递 Delivery及旧/terminal Delivery都不得获得 finish/wait 能力。普通 `agent-message` 仍不建立、修改、选择或撤销 Host 回复目标。

turn observer 仍可用于证明来源和诊断，但不再以 `turn/end` 终结业务请求。必须用真实 runtime 事件覆盖原始 Delivery turn、跨 turn 父回复、Host 注入、GUI steer 及队列交错，不能只靠纯函数替身。

### D9. 启动恢复先收敛队列，再开放 intake

Host 启动时先恢复持久 Delivery 状态：

- queued/current 超过各自 `acceptedAt + 24h` → `expired`；
- 遗留 `finishing` → `unknown-terminal`，不得重放外部发送；
- current 未过期 → 保留该 current 和同一 child session，重新装配截止调度；
- 无 current → 跳过过期 backlog 后投递最早未过期项；
- 无法证明 current、child 或 generation 一致 → 暂停该 Locus intake 并诊断，不猜目标或新建替代 child。

恢复和正常完成后的“推进下一条”共用一个幂等 dispatcher，避免双重投递。deadline scheduler 可以是内存计时器，但权威 deadline 必须持久化；重启通过扫描重建计时器。

### D10. `/new` 与 send-message pair 只保留逃生设计

本期不注册 `/new`。未来若实现，它是较重的 Delivery 清理逃生通道而不是 session 重建：保留同一个 child session，清理已超时或明确卡住的 current/backlog 后继续调度。命令名称、哪些未超时项可由用户强制取消、以及 backlog 清理范围均不在本 change 中预先定死，届时可采用 `/skip` 或 `/clear` 等更准确名称另行设计。

本期也不拦截原生 `send_message` 创建 pair。未来增强必须依赖 Host/runtime 提供不可伪造的 opaque metadata 或受信调用接缝；不得用 sender、正文、时间或 FIFO 猜测 answer 关联。

## Risks / Trade-offs

- [Agent 忘记 finish] → 默认 1 小时、硬上限 24 小时后自动 expire 并推进，不永久堵塞。
- [Agent 无限声明 wait] → 可重复声明，但每条消息的绝对 deadline 永远不超过 `acceptedAt + 24h`。
- [迟到父消息污染后续内容] → 路由仍由 current Delivery 固定；接受低概率语义风险，pair 延后为独立增强。
- [发送确认丢失] → 记为 `unknown-terminal` 且不重发，以可能漏答换取不重复和不阻塞。
- [超时 interrupt 不立即停止旧 run] → expiry CAS 已撤销旧 Delivery 能力；后续 finish 必须重新核验 current/state，旧 run 不得完成新项。
- [同 session 长期历史包含过期请求] → 每个新 Delivery prompt 明确当前消息和已关闭边界；只在未来显式清理命令中考虑更重处理，不自动重建 session。
- [持久化/计时器不一致] → deadline 以持久记录为权威，启动扫描重建内存调度；无法证明时 fail closed。
- [话题回复落到主时间线] → strict adapter 增加 thread reply 真实集成验证，不以字段存在代替发送行为证明。

## Migration Plan

1. 先以 additive schema 迁移扩展 Delivery 状态/deadline/outbound 事实；未知版本拒绝启动 intake。
2. 实现串行 current/backlog dispatcher、统一 finish/wait 工具和 expiry scheduler，并完成纯状态机、持久化、runtime 事件与 crash-window 测试。
3. 构建 Pet，执行完整 package/repository/OpenSpec 验证；连续两次 `dsh build` 验证部署幂等。
4. 经所有者确认后重启现有 Host；启动恢复先处理旧 pending rows。无法安全映射到新 current 模型的旧进行中记录终结为诊断失败，不自动发送或重放。
5. 在真实群与真实话题分别验收：串行多消息、跨 turn 问父、wait 延长、超时推进与触发消息引用回复。
6. 回滚时停止 intake 后恢复旧插件版本；新增表/字段保持 additive，不删除历史数据。旧版本若不能理解新 domain version 必须拒绝而非部分运行。

## Open Questions

无阻塞实施的问题。`/new`/`skip` 的名称与清理范围、原生 `send_message` pair/correlation 均明确延后，需有真实需求或 runtime 可信 metadata seam 后另开 change。
