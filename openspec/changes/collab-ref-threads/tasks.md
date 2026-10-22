## 0. 基线

- [ ] 0.1 在任何修改之前运行 kernel 与 dsh-collab 全部测试（含 `test:components`）、typecheck 与根 `npm test`，记录基线（含既有失败清单）
- [ ] 0.2 确认 test-plan 中标为 🟢 的回归测试在基线上为绿
- [ ] 0.3 约定：每组先写的测试须在该组实现前为红；若某断言已被更早的组满足，允许起始即绿并在 test-plan 记一句原因，不得为它伪造失败

## 1. 协作约定 v3 与打包（一个批次，含插件产物）

- [ ] 1.1 Write failing tests: `convention-01：service creation records the bundled convention and authorised reads return exact bytes`; `convention-04：v1 and v2 spaces keep reading their recorded version`; `convention-03：已发布的 v1 与 v2 文本不可变`; `convention-05：v3 写明新规则且不含已移除机制`；以及 build-artifact/sync-artifact 断言 `lib/v3.md` 存在且与源字节一致
- [ ] 1.2 Implement: 新增 `v3.md`（v2 修订副本：删去熔断、升级、人类决定段落；新增四条原则、ref 与话题、上限与超限处理、自记进度、静默共识、空间路由、问自己的用户）；版本表默认 v3；`tsdown.config.ts` 复制 v1/v2/v3；产物测试中改写默认约定的源码替换夹具改为针对 v3；v1/v2 字节不动
- [ ] 1.3 Refactor; full suite stays green（含 dsh-collab 产物测试）

## 2. 内核：ref、话题、三触发唤醒，移除熔断/决策/升级（一个原子批次）

- [ ] 2.1 Write failing tests: `ref-01：引用先前消息`; `ref-02：引用条目的创建 seq`; `ref-04：特殊 itemId 的创建 seq 可查`; `ref-05：消息引用不存在或不可引用的 seq`; `ref-06：条目引用非法 seq`; `ref-08：悬空引用的日志加载失败`; `topic-01：同一话题第 21 条唤醒消息被拒绝`; `topic-02：旧日志中的唤醒消息计入其话题`; `topic-03：不写 ref 的新消息开启新话题`; `topic-04：引用条目的消息归属条目话题`; `topic-05：不唤醒的消息不受限也不计数`; `topic-06：不可达收件人的消息不计数`; `topic-07：结束通知不受话题上限限制`; `topic-08：跨 request 的结束通知不受话题上限约束`; `topic-09：并发提交不越过上限`; `topic-10：命令时判定与重新加载一致`; `topic-11：旧的成员级熔断不再阻断`; `legacy-01：含决策与熔断事件的旧日志可加载`; `legacy-02：新内核不写已移除事件`; `auth-04：已移除的 internal purpose 被拒绝`; `auth-06：公开命令与授权表一致`; `auth-07：没有按字符串分发的入口`; `auth-12：internal 不能执行成员命令`; `auth-15：host-index 不能执行任何写命令`; `members-04：不能新增人类成员`; `members-08：旧日志中的人类成员按普通成员重放`; `lifecycle-05：无人接手关闭`; `lifecycle-06：主动关闭后只读`; `lifecycle-07：创建时记录用途`; `lifecycle-08：非法用途被拒`; `lifecycle-09：Leader 变化不唤醒`; `items-05：旧日志中的 escalated 条目只读`; `items-06：旧日志中的 decided 条目只读`; `items-07：非法条目字段`; `items-08：旧快照的条目可正常修改`; `items-09：修改与达成共识不唤醒`; `requests-01：承接方正常推进且只在终态通知作者`; `requests-04：拒绝也通知作者`; `requests-05：自己给自己的 request 不唤醒`; `requests-06：旧日志中锁定的 request 不能推进`; `idempotency-07：成员与旧 internal 收据互不冲突`; `idempotency-08：ref 是幂等载荷的一部分`; `store-01：重启后状态一致`; `store-06：多事件命令不会只落一半`; `wake-01：需回复消息叫醒收件人`; `wake-03：不叫醒自己`; `wake-04：邀请叫醒被邀请者但不授予读取权限`; `dispatch-05：慢投递在结束前不写结果`; `binding-02：不支持唤醒的绑定不记账`; `projection-01 中文场景：当前 charter、待 ack、request、升级、决定与投递状态`; `projection-05：恶意用途不能产生额外结构`; `projection-06：锁定的 request 只作为历史出现`; `projection-07：投影不含已移除机制`; `reduce-01：公开推导与内核状态一致`
- [ ] 2.2 Implement as one batch:
  - `sendMessage`/`createItem` 接受 `ref`（校验顺序：既有校验 → ref → 话题上限）；`createSpace` 接受 `purpose`
  - `reduce` 维护 `topicOf`/`itemSeq`/`topicWakes`（计数按同一提交的 needsReply 消息 + 对其收件人的 wake 判定；itemSeq 自有属性写入；悬空 ref 抛错）
  - 话题上限检查：在串行事务内折叠暂定记录，超限 `COLLAB_THREAD_LIMIT`
  - 唤醒表改为三触发；`delivery.thread` 与 `pointer.thread` 取同一值；Leader 变化不唤醒
  - 删除 `requestDecision`/`confirmDecision`/`resetBreaker`、`requestConfirmation` SPI、`breaker-reset` purpose、`human-provider` 授权规则、`BREAKER_LIMIT`/`ESCALATE_AFTER` 门控；新成员只能是 agent（收据查找之后检查）
  - 字段校验拆分：调用方提供的 `deciders` 拒绝；旧快照的惰性字段不参与；旧 `escalated`/`decided` 条目拒绝修改、ack 与推进（收据查找之后）
  - 投影：用途、未结 request 只含 draft/agreed、历史条目小节，去掉 paused/升级/决定/等待确认通道
  - 同批删除 `breaker.test.ts`、`decisions.test.ts`、`escalation.test.ts`、`auth-11` 及 confirm 相关用例，改写引用已删 API 的既有测试、类型夹具与 support 文件
- [ ] 2.3 Refactor; full suite stays green

## 3. dsh-collab 适配

- [ ] 3.1 Write failing tests: `tool-06：内部与人类能力不出现在工具面`; `tool-07：ref 与 purpose 原样传给内核`; `tool-08：升级前的创建重试仍命中收据`; `tool-10：超出话题上限原样返回`; `trust-06：唤醒文本按 memberTrust 取两套固定说明`; `trust-07：关闭成员信任保持原说明`; `wake-05：话题唤醒携带话题根`; `wake-06：非整数 thread 不被转发`; `wake-07：唤醒文本不再提及决策工具`; `status-shape-03：request 待办带条目 seq`; `status-shape-04：用途只作为数据输出`; `status-pending-06：与内核状态一致`; `status-pending-07：旧日志中锁定的 request 不列为待办`; `status-pending-08：request seq 只取自重放推导`; `surface-04：新增参数后仍在预算内`; `trust-config-01：缺省开启成员信任`
- [ ] 3.2 Implement: 移除 `collab_request_decision`（11 个工具）；`collab_send_message`/`collab_create_item` 加可选整数 `ref`、`collab_space` create 加可选 `purpose`，出现时原样传；`deciders` 改为可选且不写入描述、原样传；`collab_send_message` 描述加 ref 说明；provider 删除 `requestConfirmation`、仅转发安全整数 `thread`、唤醒文本改为"问本机用户"；`collab_status` 去掉 `escalated`、加 `purpose`（去控制字符、截断 200）与 `requests[].seq`、request 待办只含 draft/agreed
- [ ] 3.3 Refactor; full suite stays green；`test:components` 中真实 header 体积 ≤ 4200

## 4. 文档与配置

- [ ] 4.1 Run: 更新 dsh-collab README（中英）与 `dsh.yaml` note（去掉"每成员6次熔断""约定v2""requestDecision"，写三触发唤醒、话题上限 20、`COLLAB_THREAD_LIMIT`、`ref`、`purpose`、11 个工具）；仓库文档治理测试通过
- [ ] 4.2 Run: 归档时把 collab-kernel spec Purpose 中"人类决策证据、投递与熔断"改为"投递与话题上限"，dsh-collab spec Purpose 中"不可信的人类确认"表述按新模型修订（记入归档清单）

## 5. 验证

- [ ] 5.1 Run kernel test + typecheck；confirm passes
- [ ] 5.2 Run dsh-collab test + typecheck + `test:components`；confirm passes
- [ ] 5.3 Run 根 `npm test`、`npm run check:artifacts`；与 0.1 基线比较无新增失败
- [ ] 5.4 Run `openspec validate collab-ref-threads --strict`；test-plan 所有行为 🟢（N/A 行对应检查已执行）
- [ ] 5.5 Run 真实 Host 验收（`dsh build` + 重启后）：旧空间可打开且原暂停成员恢复；同一话题第 21 条需回复消息收到 `COLLAB_THREAD_LIMIT`；不写 ref 从新话题开始；条目修改、ack、Leader 转交不唤醒；request done 唤醒作者；成员信任下宿主权限不放宽
