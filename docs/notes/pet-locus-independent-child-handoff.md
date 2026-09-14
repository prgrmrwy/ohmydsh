# Pet Locus 独立 child：工作上下文切换记录

本文记录 2026-03-23 的一次**范围收敛**：把「让 Pet Locus 可以真正用起来」从 B035 的完整协作平台中拆出来，作为独立 change 推进；B035 剩余部分整体暂停，不删除、不静默降级、不把已写模块当成已验收能力。

## 为什么切换

最初目标不是做协作平台，而是**正式开始使用 Pet Locus**。B035 的触发故障是：答疑群提问后子会话「只 done 没回复」——child 由 `provider: 'fork'` 创建，继承父会话全部历史，于是继续扮演 GUI 里的主 agent，把结论写成普通 assistant 文本，从未调用 `pet_locus_reply`。Delivery 因 turn 正常结束被 settled，飞书侧没有收到任何内容。

从该故障出发，方案链条是：

```text
不再 fork 父 transcript
→ child 失去背景，需要补偿
→ 公共事实（共享笔记）
→ 公共事实不足时需要问人
→ 协作者发现 + 定向异步询问
→ 跨轮 Delivery 续进、非 steering 队列、G1–G5 runtime 门槛
```

真正修复原始故障的只有第一步。后面几步把 change 扩成 57 项任务，反而挡住了「先用起来」。

所有者 2026-03-23 决定：本期只做独立 child 与可靠回复出口；共享事实**先通过「问父，让父问子」的现有原生路径替代**，不实现持久公共记录。

## 冻结点

- 提交：`a4540c4 fix(dsh-pet): align inquiry legacy expiry semantics`
- 上一提交：`f184a94 feat(dsh-pet): implement independent agent inquiries`
- 工作区 clean，无未提交改动

## B035 暂停时的真实状态

`openspec/changes/pet-locus-independent-agent-inquiries/` 保留原样，仅 1.1 与 8.4 已勾选（2/57）。

### 已有模块级实现（未启用）

| 区域 | 文件 | 状态 |
|---|---|---|
| caller 解析 | `host/collaboration/caller.ts`、`host-identity.ts` | 纯模块 + 单测；生产未开启 |
| 公共事实 | `host/collaboration/context.ts`、`context-store.ts` | 值模型与 CAS 存储完成；`ensure()` 无生产调用方 |
| 公共事实工具 | `host/collaboration/query.ts`、`write.ts`、`tools.ts` | 已实现；依赖 assembly 才能装配 |
| 协作者名单 | `host/collaboration/collaborators.ts` | 缺分页与显式 inquirable 状态 |
| 询问台账 | `host/inquiry/ledger.ts`、`ledger-store.ts` | v13 无期限模型；v12 兼容读取 |
| 调度 | `host/inquiry/scheduler.ts` | 纯内存状态机，无 Agent/Inbox/IO |
| 接受/答复 | `host/inquiry/ask.ts`、`answer.ts`、`tools.ts` | 已实现；answer 存储是拒绝 stub |
| 结果与续进 | `host/inquiry/outbox.ts`、`outbox-store.ts`、`continuation.ts` | 纯决策/存储，无生产调用方 |
| 效果围栏 | `host/inquiry/effect-fence.ts` | 纯模块，生产未 import |
| 重启对账 | `host/inquiry/reconcile.ts` | 已接入启动路径，仅分类诊断 |
| 装配 | `host/collaboration/assembly.ts` | 注册工具但无 dispatcher |
| owner 投影 | `wire.ts`、`locus/management.ts`、`client/settings.tsx` | 类型与可选 callback 就位，生产未注入 |

### 暂停时已知的 P0

1. **accepted 询问无生产消费者**：scheduler 仅被构造，没有 dispatcher、Inbox claim、segment runner；`index.ts` 只做启动对账。
2. **生产 answer 必然失败**：`assembly.ts` 注入拒绝型 `answers.put`，schema 无 answer body 表，但仍注册 answer 工具。
3. **无结果 hand-back / continuation worker**：`openInquiryContinuation()`、`markDelivered/refuse/retain` 无生产调用方；observer 只处理 Locus Delivery。
4. **G4 围栏未接入**：`effect-fence.ts` 无 tool-body 前的真实 Host seam，`close()` 无法撤销执行中的 body。
5. **v12→v13 迁移可能阻断启动**：v12 `inquiry_results` 可能持久化 `failure: "expired"`，当前 v13 parser 拒绝该值，而迁移只 restamp 版本不检查行；restamp 后 domain open 可能失败。

### 暂停时已知的 P1

- `continuation.ts` 的 9 键 exact-key parser 无法直接消费真实 `DeliveryRecord`（缺少 `senderOpenId` 等字段），且未校验顶层 `rootMessageId` 与 `feedbackTarget.rootMessageId` 一致
- `already-open` 在重验 requester/permission/anchor 之前即返回旧 segment id
- scheduler 目标缺 locus generation/membership 重验；取消只删除内存证据
- `ask.ts` 授权 fence 在 `store.accept` 之前结束，存在撤销竞态；无 caller 幂等键
- `answer.ts` 缺 body 时可能误报已记录；body 与 ledger 分裂写入
- `resolveInquiryOrigin` 无法推导 `inquiry-result`/嵌套 origin，未知 child 被标为 local+unknown
- `contextStore.ensure()` 无生产调用，首挂缺 revision-0 记录
- owner identity 硬编码 `undefined`；management 未传 `ownerProjection`；context-only parent 可能缺席 `ownerByParent`
- 独立 child 的 mode/model/preset/cwd/read 元数据未进 schema
- outbox identity 含 `createdAt`，重试重生成时间会误判 `RESULT_EXISTS`
- reconcile 的 result 入队与 ledger needs-review 分裂，崩溃窗口留下 executing + pending failure

### 验证证据的边界

- Pet 全量：131 文件通过、2312 passed、31 skipped
- 仓库 `npm test`：124 passed、1 skipped
- typecheck / build / `check:artifacts` / strict validate / `git diff --check` 均通过
- **但**：`DSH_PET_TEST_RUNTIME` 探针为诊断用途，不建立 Agent/Session/模型/飞书链路
- **且**：`DSH_PET_TEST_ATOMIC_DOMAIN=1` 下事务组失败（`TRANSACTION_UNAVAILABLE`），当前 runtime 无可用 transaction seam

命令级全绿不等于 runtime 验收；G1–G5 一项都未通过。

## 本期承接范围

新 change：`pet-locus-independent-child`。

只做三件事：

1. 新建/重建 locus child 不再 fork 父 transcript（`child.ts:303` 的 `DEFAULT_CHILD_PROVIDER = 'fork'` 是根因，三处创建路径共用）
2. 持久化 `contextMode`（`fork-prefix-v1` / `independent-v1` / `unknown`），旧 child 不被静默改造
3. 真实验收：答疑群提问后确实收到飞书回复

「可以问父」无需新建能力：`host/locus/context.ts:343` 已指导使用原生 `send_message` 询问 caller-bound main session，`:339` 已固定 `pet_locus_reply` 为唯一业务出口，`:345` 已禁止自动回传结论。

## 本期明确不做

- 公共事实的生产 lifecycle（`contextStore.ensure` 保持无调用方）
- inquiry 的 ask/answer/scheduler/continuation/outbox（保持 fail-closed）
- 协作者名单工具
- owner projection / owner route
- G3/G4/G5 runtime 门槛

这些代码留在仓库中不启用，作为后续 change 的基础。

## 恢复 B035 的前置条件

1. 独立 child 与回复出口已真实验收
2. runtime 具备可用 atomic transaction seam
3. runtime 具备隔离 queued-turn claim 接缝
4. v12→v13 迁移的 `expired` 兼容性已修复并有真实介质测试
5. 公共事实与 inquiry 在装配层解耦，使前者可独立发布

在此之前不得归档 B035，也不得因单测通过而勾选 G1–G5。
