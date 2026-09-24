## 1. 移除入群时刻的建树

规划阶段已核实（design.md D1）：`botLifecycleInitializer` 是 `PetChannelServiceDeps` 的可选字段，不传即 `BotLifecycleIntake` 不被构造，订阅链路自然停用；接口、`BotLifecycleIntake` 类与事件解析均保留不动；生产代码与测试均无依赖"入群即有 locus"的位置。以下任务据此直接执行，不再需要现状确认步骤。

- [x] 1.1 在 `src/index.ts` 中，`PetChannelServiceDeps` 的构造处不再传入 `botLifecycleInitializer`（同时移除其 `ensureAuthorizedChat` 回调体对 `locusProvisioningController.ensureGroup` 的调用），保留 `bot-lifecycle.ts` 的接口、`BotLifecycleIntake` 类与事件解析不动
- [x] 1.2 核对 `service.ts` 中 `locusDiagnostic ?? ... ?? botLifecycleDiagnostic` 链路与「该群保持待建立，首次 allowlist @ 可补齐」这条既有诊断语：确认它现在覆盖的是全部入群场景而非仅"操作者不在 allowlist"这一支，语义仍准确则不改文案，仅确认触发条件。
      **结论**：`botLifecycleInitializer` 未传入时 `lifecycleIntake`/`lifecycleSubscription` 均为 `undefined`（`service.ts:134-140`），bot-added 事件订阅永不启动，`lifecycleDiagnostic`/`durableLifecycle`（"缺少 allowlist 操作者证明"这条，针对的是单次事件的瞬时失败，不是稳态）永不触发，诊断链无条件落到 `botLifecycleDiagnostic`。旧文案描述的是"证明缺失"这一子情形，不再准确；已在 `index.ts` 改为「Bot-added does not initialize a locus; the first allowlist @ will.」，无条件设置，不依赖 `locusProvisioningController` 是否存在

## 2. 保证首个 @ 建树路径完整

- [x] 2.1 验证 `resolveLocus` → `ensureForDelivery` 在群入口（`threadId === undefined`）下确实走到 `ensureGroup`，且退役检查、可用性校验与 provisioning 补偿全部生效；不修改这条路径，只证明它在移除提前触发后被真实使用。
      **结论**：`test/locus-on-demand-provisioning.test.ts` 用真实 `LocusController`（provisioning）+ 真实 `LocusChannelController`（admission）+ 共享同一 `DurableLocusRepository` 端到端验证；`ensureForDelivery` 确实转发到 `ensureGroup`，退役检查/可用性校验/`beginProvisioning`/`recordResource` 全部真实生效（非替身）
- [x] 2.2 验证首条消息在同一次 `handleAdmission` 内完成"建树 + 投递"，不出现建树成功但消息丢失，也不出现半成品 locus 被发布。
      **结论**：`the first qualifying @ builds main, child and an active locus inside one admission, then delivers it` 用例证明：单次 `handle()` 调用后，main/child/active locus 均已建立且该消息已进入被建立的 child 的 inbox（`queued[0].childSessionId === locus.childSessionId`），不是先建树成功再等下一轮投递
- [x] 2.3 **执行方式改为验证真实行为，而非原文假设的"按既有补偿回收"**。实施中发现原文措辞有误：`failProvisioning` 只把操作标记为 `phase: 'failed'`，而 `findBlockingProvisioningOperation` 把 `failed` 仍计入阻塞集合；全仓库唯一将 `failed`/`needs-recovery` 转为 `compensated`（从而解除阻塞）的代码路径是 `reconcileStartup`，且只在 Host 启动时运行一次，不在运行期间自动补偿。这是**既有 provisioning 补偿机制的特征，非本 change 引入**（旧模型下群/话题各自的建树失败同样命中同一阻塞）。已转入 BACKLOG B040 留待独立设计（所有者提出的方向：`failed` 超时后不再计入阻塞，允许下次 @ 重新按首次检测）。
      **本 change 范围内已验证的真实行为**：`a build failure inside the first admission publishes no partial locus and leaves no group marker` 证明失败时不发布半成品、无 group marker、队列为空、该次投递以非 `accepted` 结果可见拒绝；`a failed build permanently blocks the same endpoint within the process (BACKLOG B040)` 如实固定当前行为——同进程内重试同一 endpoint 不会恢复，需要 Host 重启

## 3. `/bind` 首次绑定一次建对

**结论**：3.1/3.2 描述的行为**在生产代码里本就已经正确**，不需要改动。`ensureGroup` 在 `existing === undefined`（endpoint 从未建过）时直接走 `provisionGroupLocked(endpoint, chatName, explicitParent)`；`explicitParent !== undefined` 时 `mainSource` 直接记为 `'explicit'` 且从不创建 `main`（`createMainSession` 只在 `parent === undefined` 分支被调用）；`replaceAutomaticGroupParentLocked`/警告文案只存在于 `existing !== undefined` 分支。生产代码里 `/bind` 走的正是同一个 `ensureGroup`（`index.ts` 的 `bind.bind`），无需新增代码路径。

- [x] 3.1 实现或验证：尚无 locus 的入口收到 allowlist `/bind <prefix>` 时直接以该主会话建立 locus，`mainSource` 记为显式来源。**已用端到端测试验证**（`test/locus-on-demand-provisioning.test.ts` 的 `a fresh endpoint bound before any @ is built once with the explicit main, no auto main, no warning`），确认生产代码已满足，未改动 `controller.ts`
- [x] 3.2 确认该路径不经过 `replaceAutomaticGroupParent`、不产生自动 main、不发送上下文变更警告。**结论同上**：同一测试断言 `bound.group.mainSource === 'explicit'` 且 `'warningText' in bound === false`
- [x] 3.3 确认既有 `mainSource: 'auto'` 的 locus 收到 `/bind` 时，改绑路径与上下文变更警告保持原样不变；本 change 不追溯改写既有记录。**已用回归测试验证**（`an existing automatic locus still replaces with a warning when explicitly bound (regression)`）：真实首个 @ 建立 `mainSource: 'auto'` 的 locus 后再 `/bind` 到不同主会话，确认走 `replaceAutomaticGroupParentLocked`（新 `generation`、`replacesLocusId` 指向旧 locus）且携带非空 `warningText`

## 4. 测试

- [x] 4.1 新增：bot 加入群后未收到任何 @ 时，不产生 session 与 locus 记录，管理面投影不出现该入口（`test/locus-on-demand-provisioning.test.ts` 的 `bot-added has zero repository effect`）
- [x] 4.2 新增：尚无 locus 的群收到首条合格 @ 消息后，建立 main/child/active locus 并完成该次投递（`the first qualifying @ builds main, child and an active locus inside one admission, then delivers it`）
- [x] 4.3 新增：群与话题各自的首条合格消息得到结构等价的归属（`describe('group and topic entries build on demand with structurally equivalent timing')`）。两个用例：话题的首条合格 @ 在同一次 admission 内同时建立群根与话题子会话，且投递同样发生在这次 admission 内，与纯群路径结构一致；同一群下先话题后群体两条首条消息各自建立独立子会话，共享同一群主会话（`parentSessionId` 相同、`childSessionId` 不同），证明两级不会坍缩成一个 child，也不需要各自的 bot-added 触发
- [x] 4.4 新增：尚无 locus 的入口收到 `/bind` 时一次建对——显式来源、无自动 main、无上下文变更警告（同 3.1/3.2 的测试用例）
- [x] 4.5 新增：既有自动来源 locus 的 `/bind` 改绑行为与警告不变（回归，防止 3.1 的改动越界）（同 3.3 的测试用例；结果证明 3.1 未改动生产代码，此回归测试仍有价值，作为该行为的永久锚点）
- [x] 4.6 新增：首次建树失败时不发布半成品、该次投递以诊断拒绝（`a build failure inside the first admission publishes no partial locus and leaves no group marker`）。"资源被回收"改为如实断言当前行为：**运行期间不回收，需重启**（`a failed build permanently blocks the same endpoint within the process (BACKLOG B040)`），已同步修正 2.3/design.md
- [x] 4.7 已验证：Pet 全量测试 `npx vitest run` 结果为 4 failed / 129 passed / 2 skipped、11 failed / 2351 passed / 31 skipped（tests 计数），与仅用未改动的 `index.ts`（`git show HEAD:...` 内容）重跑同一批文件得到的结果逐字节一致（`tool-scope.test.ts`/`collaboration-assembly.test.ts` 两个文件、5 个测试失败，其余全过）；确认这 11 个失败是既有基线（1.2 阶段已确认其性质为 `dsh-scope`/`ToolRuntime` 可见性问题），本 change 未引入、未消除任何测试的通过/失败状态

## 5. 验证与验收

- [x] 5.1 `npm run typecheck --workspace=dsh-pet` 通过（`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit` 均无输出）。`cd packages/dsh-pet && npx vitest run`：4 failed / 129 passed / 2 skipped（135 文件），11 failed / 2351 passed / 31 skipped（2393 测试）。11 个失败逐一核实为既有基线缺陷（详见 4.7 的严格对比方法），本 change 未引入新失败、未消除既有失败——新增的 9 个测试（`locus-on-demand-provisioning.test.ts`）全部通过
- [x] 5.2 `npm test`：125 tests，124 pass，0 fail，1 skipped。`npm run check:artifacts`：`[artifacts] tracked paths comply with repository policy`。`git diff --check`：clean。`openspec validate pet-locus-on-demand-tree --strict`：`Change 'pet-locus-on-demand-tree' is valid`
- [x] 5.3 所有者已 `dsh build` 并重启现有 3080 Host。日志确认：`[dsh-pet] ready — routes registered`，channel 订阅正常连接；全局 grep `bot-added`/`lifecycle` 在 `dsh.log` 中零命中，确认该订阅链路确实未被构造（与设计一致，不是遗漏排查）
- [x] 5.4 真实验收通过。所有者用 user 身份新建群「验收-B036-拉bot零副作用」（`oc_2983702a8515d3176ae5a62c6be39bc1`，仅所有者一人，不含 bot），记录基线：`u_dsh_pet_loci`/`locus_indexes`/`locus_operations` 三表中该 chatId 均为 0 条，系统总 loci 数为 4。拉 bot 入群后重新核对：三表仍为 0 条，总数仍为 4，`dsh.log` 新增内容与该群无关（仅两条无关的 `turn-ended`）。**入群零副作用得证**
- [x] 5.5 真实验收通过。同群内所有者发送「@小小芒果 你好」，机器人正常回复（`reply_to` 精确指向该消息，附 `DONE` 表情反馈）。数据库确认该次 admission 内建立完整 locus：`{"parentSessionId":"session-b2f11bae-...","childSessionId":"session-dfb4c72e-...","source":"auto","state":"active"}`，`createdAt` 与 `updatedAt` 相差约 12.7 秒，为建树到首轮回复完成的端到端耗时，与话题入口现有体验量级一致。**验收过程中发现一个独立的 GUI 时序问题**（见下方说明，不阻塞本条，已转 BACKLOG）
- [x] 5.6 真实验收通过。另建群「验收-B036-bind一次建对」（`oc_646eb4b031519fde4c47c41592d348ce`，同样不含 bot），拉入 bot 后所有者直接发送 `/bind b2f11b`（引用 5.5 建立的活跃主会话）。回执：「群「验收-B036-bind一次建对」已绑定主会话「Locus 主会话 · oc_2983702a8515d3176ae5a62c6be39bc1」（b2f11b）；已创建新的只读子会话。」**无任何「S0→S1」上下文变更警告文案**。数据库确认新记录 `{"source":"explicit","parentSessionId":"session-b2f11bae-...","generation":1}`，系统总 loci 数由 5 精确增至 6（无多余 auto 记录混入），证实为首代直建而非替换。
      验收过程中一次误报已排查澄清：先用另一会话 id 前缀 `4629eb` 测试收到「没有匹配到唯一的会话」，解压该 session 的压缩事件日志（`session.jsonl.zstd`）确认其末尾事件为 `session/end-seed`（已结束），`/bind` 拒绝一个已结束的会话是正确行为，不是本 change 或既有代码的缺陷，是测试目标选取错误
- [x] 5.7 已回填。`docs/notes/pet-locus-on-demand-tree-handoff.md` 记录三步真实验收的完整证据链（含数据库 dump、日志比对、误报排查过程）；`BACKLOG.md` B036 状态更新为已完成并附证据摘要；新增 B041 记录验收中发现的 GUI 时序问题（自动建 main 挂载到已有 workspace 后，侧栏短暂显示未分组，刷新后自愈）
