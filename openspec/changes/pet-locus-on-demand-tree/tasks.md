## 1. 移除入群时刻的建树

规划阶段已核实（design.md D1）：`botLifecycleInitializer` 是 `PetChannelServiceDeps` 的可选字段，不传即 `BotLifecycleIntake` 不被构造，订阅链路自然停用；接口、`BotLifecycleIntake` 类与事件解析均保留不动；生产代码与测试均无依赖"入群即有 locus"的位置。以下任务据此直接执行，不再需要现状确认步骤。

- [ ] 1.1 在 `src/index.ts` 中，`PetChannelServiceDeps` 的构造处不再传入 `botLifecycleInitializer`（同时移除其 `ensureAuthorizedChat` 回调体对 `locusProvisioningController.ensureGroup` 的调用），保留 `bot-lifecycle.ts` 的接口、`BotLifecycleIntake` 类与事件解析不动
- [ ] 1.2 核对 `service.ts` 中 `locusDiagnostic ?? ... ?? botLifecycleDiagnostic` 链路与「该群保持待建立，首次 allowlist @ 可补齐」这条既有诊断语：确认它现在覆盖的是全部入群场景而非仅"操作者不在 allowlist"这一支，语义仍准确则不改文案，仅确认触发条件

## 2. 保证首个 @ 建树路径完整

- [ ] 2.1 验证 `resolveLocus` → `ensureForDelivery` 在群入口（`threadId === undefined`）下确实走到 `ensureGroup`，且退役检查、可用性校验与 provisioning 补偿全部生效；不修改这条路径，只证明它在移除提前触发后被真实使用
- [ ] 2.2 验证首条消息在同一次 `handleAdmission` 内完成"建树 + 投递"，不出现建树成功但消息丢失，也不出现半成品 locus 被发布
- [ ] 2.3 验证建树失败时不发布半成品、按既有补偿回收已创建资源，且该次投递以可见诊断拒绝而非静默丢弃

## 3. `/bind` 首次绑定一次建对

- [ ] 3.1 实现或验证：尚无 locus 的入口收到 allowlist `/bind <prefix>` 时直接以该主会话建立 locus，`mainSource` 记为显式来源
- [ ] 3.2 确认该路径不经过 `replaceAutomaticGroupParent`、不产生自动 main、不发送上下文变更警告
- [ ] 3.3 确认既有 `mainSource: 'auto'` 的 locus 收到 `/bind` 时，改绑路径与上下文变更警告保持原样不变；本 change 不追溯改写既有记录

## 4. 测试

- [ ] 4.1 新增：bot 加入群后未收到任何 @ 时，不产生 session 与 locus 记录，管理面投影不出现该入口
- [ ] 4.2 新增：尚无 locus 的群收到首条合格 @ 消息后，建立 main/child/active locus 并完成该次投递
- [ ] 4.3 新增：群与话题各自的首条合格消息得到结构等价的归属，不存在一方预先建立的差异
- [ ] 4.4 新增：尚无 locus 的入口收到 `/bind` 时一次建对——显式来源、无自动 main、无上下文变更警告
- [ ] 4.5 新增：既有自动来源 locus 的 `/bind` 改绑行为与警告不变（回归，防止 3.1 的改动越界）
- [ ] 4.6 新增：首次建树失败时不发布半成品、资源被回收、该次投递以诊断拒绝
- [ ] 4.7 更新或移除因"入群即建树"假设而失效的既有测试；逐个说明是断言过期还是场景本身不再成立，不以调整断言掩盖行为变化

## 5. 验证与验收

- [ ] 5.1 运行 `npm run typecheck --workspace=dsh-pet` 与 Pet 全量测试，记录实际命令与结果；将失败逐条判定为本 change 引入还是既有基线缺陷
- [ ] 5.2 运行仓库 `npm test`、`npm run check:artifacts`、`git diff --check` 与 `openspec validate pet-locus-on-demand-tree --strict`
- [ ] 5.3 经所有者确认后 `dsh build` 并重启现有 3080 Host，不启动替代 server
- [ ] 5.4 真实验收：把 bot 拉进一个新群，确认 GUI 侧栏与管理面均未出现新会话，数据库无新 locus 记录
- [ ] 5.5 真实验收：在该群发首条 @ 消息，确认建树并正常回复；记录首条消息的端到端耗时，与话题入口现有体验对照
- [ ] 5.6 真实验收：另起一个新群，拉入 bot 后直接 `/bind <prefix>`，确认一次建对——显式来源、无自动 main、无上下文变更警告
- [ ] 5.7 回填 handoff/BACKLOG：更新 B036 状态，记录实测证据与本次未处置项（入群时刻记录、管理面 UI、bot 移出可达性）
