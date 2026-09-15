## 1. 确认现状与依赖面

- [ ] 1.1 确认 `BotLifecycleInitializer`（`src/host/channel/bot-lifecycle.ts`）除 `ensureAuthorizedChat` 外是否还有其它成员、实现或调用方；记录结论，作为 D1 中"是否一并移除接口"的判据
- [ ] 1.2 搜索并列出所有依赖"入群即存在 locus"的位置（生产代码、测试、管理面投影），逐个判定是需要改、需要删，还是本就不受影响
- [ ] 1.3 确认 `im.chat.member.bot.added_v1` 的订阅与分发链路在移除 provisioning 调用后是否还有存在价值；若订阅本身也无消费者，记录但不在本 change 处置（属 B029 范围）

## 2. 移除入群时刻的建树

- [ ] 2.1 移除 `src/index.ts` 中 `botLifecycleInitializer.ensureAuthorizedChat` 对 `locusProvisioningController.ensureGroup` 的调用；按 1.1 结论决定是移除整个 initializer 装配还是仅移除该调用
- [ ] 2.2 按 1.1 结论处理 `bot-lifecycle.ts`：接口再无实现内容时一并移除接口与其类型导出，否则保留并更新其契约注释使之与实际行为一致
- [ ] 2.3 核对移除后 `locusProvisioningController === undefined` 分支的诊断语「first allowlist @ will initialize the locus」是否仍准确；该句现已成为常态描述而非降级说明，据此调整措辞与其出现条件

## 3. 保证首个 @ 建树路径完整

- [ ] 3.1 验证 `resolveLocus` → `ensureForDelivery` 在群入口（`threadId === undefined`）下确实走到 `ensureGroup`，且退役检查、可用性校验与 provisioning 补偿全部生效；不修改这条路径，只证明它在移除提前触发后被真实使用
- [ ] 3.2 验证首条消息在同一次 `handleAdmission` 内完成"建树 + 投递"，不出现建树成功但消息丢失，也不出现半成品 locus 被发布
- [ ] 3.3 验证建树失败时不发布半成品、按既有补偿回收已创建资源，且该次投递以可见诊断拒绝而非静默丢弃

## 4. `/bind` 首次绑定一次建对

- [ ] 4.1 实现或验证：尚无 locus 的入口收到 allowlist `/bind <prefix>` 时直接以该主会话建立 locus，`mainSource` 记为显式来源
- [ ] 4.2 确认该路径不经过 `replaceAutomaticGroupParent`、不产生自动 main、不发送上下文变更警告
- [ ] 4.3 确认既有 `mainSource: 'auto'` 的 locus 收到 `/bind` 时，改绑路径与上下文变更警告保持原样不变；本 change 不追溯改写既有记录

## 5. 测试

- [ ] 5.1 新增：bot 加入群后未收到任何 @ 时，不产生 session 与 locus 记录，管理面投影不出现该入口
- [ ] 5.2 新增：尚无 locus 的群收到首条合格 @ 消息后，建立 main/child/active locus 并完成该次投递
- [ ] 5.3 新增：群与话题各自的首条合格消息得到结构等价的归属，不存在一方预先建立的差异
- [ ] 5.4 新增：尚无 locus 的入口收到 `/bind` 时一次建对——显式来源、无自动 main、无上下文变更警告
- [ ] 5.5 新增：既有自动来源 locus 的 `/bind` 改绑行为与警告不变（回归，防止 4.1 的改动越界）
- [ ] 5.6 新增：首次建树失败时不发布半成品、资源被回收、该次投递以诊断拒绝
- [ ] 5.7 更新或移除因"入群即建树"假设而失效的既有测试；逐个说明是断言过期还是场景本身不再成立，不以调整断言掩盖行为变化

## 6. 验证与验收

- [ ] 6.1 运行 `npm run typecheck --workspace=dsh-pet` 与 Pet 全量测试，记录实际命令与结果；将失败逐条判定为本 change 引入还是既有基线缺陷
- [ ] 6.2 运行仓库 `npm test`、`npm run check:artifacts`、`git diff --check` 与 `openspec validate pet-locus-on-demand-tree --strict`
- [ ] 6.3 经所有者确认后 `dsh build` 并重启现有 3080 Host，不启动替代 server
- [ ] 6.4 真实验收：把 bot 拉进一个新群，确认 GUI 侧栏与管理面均未出现新会话，数据库无新 locus 记录
- [ ] 6.5 真实验收：在该群发首条 @ 消息，确认建树并正常回复；记录首条消息的端到端耗时，与话题入口现有体验对照
- [ ] 6.6 真实验收：另起一个新群，拉入 bot 后直接 `/bind <prefix>`，确认一次建对——显式来源、无自动 main、无上下文变更警告
- [ ] 6.7 回填 handoff/BACKLOG：更新 B036 状态，记录实测证据与本次未处置项（入群时刻记录、管理面 UI、bot 移出可达性）
