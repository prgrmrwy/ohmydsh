## 0. 基线

- [x] 0.1 在任何修改之前运行 kernel 与 dsh-collab 全部测试（含 `test:components`）、typecheck 与根 `npm test`，记录基线（含既有失败清单）
- [x] 0.2 确认 test-plan 中标为 🟢 的回归测试在基线上为绿
- [x] 0.3 约定：每组先写的测试须在该组实现前为红；若某断言已被更早的组满足，允许起始即绿并在 test-plan 记一句原因，不得为它伪造失败

## 1. 协作约定 v3 与打包（一个批次，含插件产物）

- [x] 1.1 Write failing tests: `convention-01：service creation records the bundled convention and authorised reads return exact bytes`; `convention-04：v1 and v2 spaces keep reading their recorded version`; `convention-03：已发布的 v1 与 v2 文本不可变`; `convention-05：v3 写明新规则且不含已移除机制`；以及 build-artifact/sync-artifact 断言 `lib/v3.md` 存在且与源字节一致
- [x] 1.2 Implement: 新增 `v3.md`（v2 修订副本：删去熔断、升级、人类决定段落；新增四条原则、ref 与话题、上限与超限处理、自记进度、静默共识、空间路由、问自己的用户）；版本表默认 v3；`tsdown.config.ts` 复制 v1/v2/v3；产物测试中改写默认约定的源码替换夹具改为针对 v3；v1/v2 字节不动
- [x] 1.3 Refactor; full suite stays green（含 dsh-collab 产物测试）

## 2. 内核：ref、话题、三触发唤醒，移除熔断/决策/升级（一个原子批次）

- [x] 2.1 Write failing tests: `ref-01：引用先前消息`; `ref-02：引用条目的创建 seq`; `ref-04：特殊 itemId 的创建 seq 可查`; `ref-05：消息引用不存在或不可引用的 seq`; `ref-06：条目引用非法 seq`; `ref-08：悬空引用的日志加载失败`; `topic-01：同一话题第 21 条唤醒消息被拒绝`; `topic-02：旧日志中的唤醒消息计入其话题`; `topic-03：不写 ref 的新消息开启新话题`; `topic-04：引用条目的消息归属条目话题`; `topic-05：不唤醒的消息不受限也不计数`; `topic-06：不可达收件人的消息不计数`; `topic-07：结束通知不受话题上限限制`; `topic-08：跨 request 的结束通知不受话题上限约束`; `topic-09：并发提交不越过上限`; `topic-10：命令时判定与重新加载一致`; `topic-11：旧的成员级熔断不再阻断`; `legacy-01：含决策与熔断事件的旧日志可加载`; `legacy-02：新内核不写已移除事件`; `auth-04：已移除的 internal purpose 被拒绝`; `auth-06：公开命令与授权表一致`; `auth-07：没有按字符串分发的入口`; `auth-12：internal 不能执行成员命令`; `auth-15：host-index 不能执行任何写命令`; `members-04：不能新增人类成员`; `members-08：旧日志中的人类成员按普通成员重放`; `lifecycle-05：无人接手关闭`; `lifecycle-06：主动关闭后只读`; `lifecycle-07：创建时记录用途`; `lifecycle-08：非法用途被拒`; `lifecycle-09：Leader 变化不唤醒`; `items-05：旧日志中的 escalated 条目只读`; `items-06：旧日志中的 decided 条目只读`; `items-07：非法条目字段`; `items-08：旧快照的条目可正常修改`; `items-09：修改与达成共识不唤醒`; `requests-01：承接方正常推进且只在终态通知作者`; `requests-04：拒绝也通知作者`; `requests-05：自己给自己的 request 不唤醒`; `requests-06：旧日志中锁定的 request 不能推进`; `idempotency-07：成员与旧 internal 收据互不冲突`; `idempotency-08：ref 是幂等载荷的一部分`; `store-01：重启后状态一致`; `store-06：多事件命令不会只落一半`; `wake-01：需回复消息叫醒收件人`; `wake-03：不叫醒自己`; `wake-04：邀请叫醒被邀请者但不授予读取权限`; `dispatch-05：慢投递在结束前不写结果`; `binding-02：不支持唤醒的绑定不记账`; `projection-01 中文场景：当前 charter、待 ack、request、升级、决定与投递状态`; `projection-05：恶意用途不能产生额外结构`; `projection-06：锁定的 request 只作为历史出现`; `projection-07：投影不含已移除机制`; `reduce-01：公开推导与内核状态一致`
- [x] 2.2 Implement as one batch:
  - `sendMessage`/`createItem` 接受 `ref`（校验顺序：既有校验 → ref → 话题上限）；`createSpace` 接受 `purpose`
  - `reduce` 维护 `topicOf`/`itemSeq`/`topicWakes`（计数按同一提交的 needsReply 消息 + 对其收件人的 wake 判定；itemSeq 自有属性写入；悬空 ref 抛错）
  - 话题上限检查：在串行事务内折叠暂定记录，超限 `COLLAB_THREAD_LIMIT`
  - 唤醒表改为三触发；`delivery.thread` 与 `pointer.thread` 取同一值；Leader 变化不唤醒
  - 删除 `requestDecision`/`confirmDecision`/`resetBreaker`、`requestConfirmation` SPI、`breaker-reset` purpose、`human-provider` 授权规则、`BREAKER_LIMIT`/`ESCALATE_AFTER` 门控；新成员只能是 agent（收据查找之后检查）
  - 字段校验拆分：调用方提供的 `deciders` 拒绝；旧快照的惰性字段不参与；旧 `escalated`/`decided` 条目拒绝修改、ack 与推进（收据查找之后）
  - 投影：用途、未结 request 只含 draft/agreed、历史条目小节，去掉 paused/升级/决定/等待确认通道
  - 同批删除 `breaker.test.ts`、`decisions.test.ts`、`escalation.test.ts`、`auth-11` 及 confirm 相关用例，改写引用已删 API 的既有测试、类型夹具与 support 文件
- [x] 2.3 Refactor; full suite stays green

## 3. dsh-collab 适配

- [x] 3.1 Write failing tests: `tool-06：内部与人类能力不出现在工具面`; `tool-07：ref 与 purpose 原样传给内核`; `tool-08：升级前的创建重试仍命中收据`; `tool-10：超出话题上限原样返回`; `trust-06：唤醒文本按 memberTrust 取两套固定说明`; `trust-07：关闭成员信任保持原说明`; `wake-05：话题唤醒携带话题根`; `wake-06：非整数 thread 不被转发`; `wake-07：唤醒文本不再提及决策工具`; `status-shape-03：request 待办带条目 seq`; `status-shape-04：用途只作为数据输出`; `status-pending-06：与内核状态一致`; `status-pending-07：旧日志中锁定的 request 不列为待办`; `status-pending-08：request seq 只取自重放推导`; `surface-04：新增参数后仍在预算内`; `trust-config-01：缺省开启成员信任`
- [x] 3.2 Implement: 移除 `collab_request_decision`（11 个工具）；`collab_send_message`/`collab_create_item` 加可选整数 `ref`、`collab_space` create 加可选 `purpose`，出现时原样传；`deciders` 改为可选且不写入描述、原样传；`collab_send_message` 描述加 ref 说明；provider 删除 `requestConfirmation`、仅转发安全整数 `thread`、唤醒文本改为"问本机用户"；`collab_status` 去掉 `escalated`、加 `purpose`（去控制字符、截断 200）与 `requests[].seq`、request 待办只含 draft/agreed
- [x] 3.3 Refactor; full suite stays green；`test:components` 中真实 header 体积 ≤ 4200

## 4. 文档与配置

- [x] 4.1 Run: 更新 dsh-collab README（中英）与 `dsh.yaml` note（去掉"每成员6次熔断""约定v2""requestDecision"，写三触发唤醒、话题上限 20、`COLLAB_THREAD_LIMIT`、`ref`、`purpose`、11 个工具）；仓库文档治理测试通过
- [x] 4.2 Run: 归档时把 collab-kernel spec Purpose 中"人类决策证据、投递与熔断"改为"投递与话题上限"，dsh-collab spec Purpose 中"不可信的人类确认"表述按新模型修订（记入归档清单）

## 5. 验证

- [x] 5.1 Run kernel test + typecheck；confirm passes
- [x] 5.2 Run dsh-collab test + typecheck + `test:components`；confirm passes
- [x] 5.3 Run 根 `npm test`、`npm run check:artifacts`；与 0.1 基线比较无新增失败
- [x] 5.4 Run `openspec validate collab-ref-threads --strict`；test-plan 所有行为 🟢（N/A 行对应检查已执行）
- [x] 5.5 Run 真实 Host 验收（`dsh build` + 重启后）：旧空间可打开且原暂停成员恢复；同一话题第 21 条需回复消息收到 `COLLAB_THREAD_LIMIT`；不写 ref 从新话题开始；条目修改、ack、Leader 转交不唤醒；request done 唤醒作者；成员信任下宿主权限不放宽

## 实施记录

- 0.1 基线（2026-10-23，worktree lean 依赖）：collab-kernel 38 files / 214 tests 通过、typecheck 0；dsh-collab vitest 6 files / 105 tests 通过、typecheck 0。`test:components` 与 build/sync 产物测试在 lean 依赖下缺 `tsdown`（基线即失败），在验证阶段于复制主 checkout `node_modules` 的仓内副本中运行。
- 1.1/1.2（conv-v3）：红灯 5 failed / 1 passed（默认版本仍为 2、版本表缺 3、v3 读取 UNKNOWN）；绿灯 Lead 复核 `npx vitest run test/convention.test.ts test/convention-integration.test.ts` 6/6；v1/v2 sha 不变。1.3 待产物测试在完整依赖副本中运行。
- 2.1–2.3（kernel-core）：红灯均为断言或类型不符（详见团队汇报：缺 ref/itemSeq/topicWakes、deciders 仍必填、旧熔断压制唤醒、决策 API 仍存在等）；Lead 复核绿灯 `npm --workspace packages/collab-kernel test` 38 files / 224 passed、typecheck 0；src 中已删 API 仅残留于冻结的 v1/v2 约定正文。dsh-collab 此时 9 个测试失败，属 G3 待适配范围。
- 3.1–3.3（plugin-adapt）：红灯 27 failed / 91 passed（ref/purpose 未知字段、deciders 仍必填、pending 仍有 escalated、缺 seq/purpose、thread 未转发、唤醒文本含 requestDecision、仍 12 工具）；起始即绿 tool-08/wake-06/trust-06/trust-07/trust-config-01（原因见 test-plan）；Lead 复核 vitest 6 files / 118 passed。
- 1.3/3.3/5.x（Lead，完整依赖仓内副本 `.acc/fullcopy`，复制主 checkout `node_modules` 与 `spike/collab-components` 组件夹具，collab-kernel 先构建）：dsh-collab typecheck 0、`npm test`（vitest 118 + build/sync 产物 2+4）全过、`test:components` 18/18（真实 header 工具体积 3806 ≤ 4200）。组件套件中 3 处断言修正见 test-plan Coverage Notes。
- 4.1：README（中英，dsh-collab 与 collab-kernel）与 `dsh.yaml` note 已更新（note 压到 ≤600 码点）。为通过仓库 markdown 链接检查，`history/` 与 `review*.md` 中评审者写的仓库根相对链接改为纯文本（内容不变）。
- 5.3：worktree 根 `npm test` 447 tests / 437 pass / 8 fail，8 个失败（sync/openspec-upgrade/auto-model-routing 类）在干净基线提交上同样失败（lean 依赖环境），无新增失败。
- 5.5（Lead，2026-10-23，真实 Host PID 94237，`dsh build` 后由用户重启）：验收会话 A `session-22bb0723-…`、B `session-45cfcaed-…`，空间 `ref-acc-1`（约定 v3、purpose 已记录）。台账核验：邀请唤醒 B 并自动加入；c1 修改、B ack 达成 agreed、r1 创建、Leader 转交都没有 `dispatch/intended`；坏 ref 返回 `COLLAB_BAD_REF` 且无提交；r1 `accepted` 不唤醒，`done` 唤醒作者 a（thread=7）；话题 13 中根消息加 19 条 ref 成功，第 21 条需回复消息返回 `COLLAB_THREAD_LIMIT` 且无提交；不写 ref 的新消息开启话题 53；B 共收到 22 次唤醒，指针带 thread，唤醒文本为新的"问本机用户"版本。旧空间 `trust-acc-1`（已关闭）由原成员读取总览与约定 v2 成功，写入按关闭空间规则被拒；非成员读取为 `COLLAB_SPACE_UNAVAILABLE`。本机旧空间没有被熔断的成员，"暂停成员恢复"由 `topic-11` 覆盖。成员信任不放宽宿主权限：本变更未改动该路径，沿用 dsh-collab-member-trust 的真实 Host 验收结论（test-plan N/A 行）。
- 4.2：归档后已修订 collab-kernel 与 dsh-collab current spec 的 Purpose 段落（去掉人类决策证据、熔断与"不可信的人类确认"，改为话题上限、三种唤醒与"问本机用户"）。
