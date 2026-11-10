说明：每组按「红-绿-重构」三步走，组内列出该组覆盖的 test-plan 场景；每个场景的具名测试都要先看到失败（失败原因正确）再实现。继承（carried forward）场景只需确认已有测试覆盖语义并补 `spec Scenario` 标题。全量测试只在每组重构步与第 9 组统一跑。

## 1. 控制面错误映射与诊断（D5、D7）

- [x] 1.1 Write failing test：`locus-control.test.ts` 的「不可用的主会话不再显示重试」「未知异常只记原因码」「未知异常不泄露内容」（断言回执文案、日志字段，以及日志/回执不含 `<fixture-token>`、非法 code、cause/stack）
- [x] 1.2 Implement：`control.ts` `safeControlError` 增加 `LOCUS_MAIN_UNAVAILABLE`、`PARENT_NOT_FOUND`、`PROVISIONING_FAILED`、`DEFAULT_WORKSPACE_UNAVAILABLE`、`CAPABILITY_UNAVAILABLE` 映射；dispatcher 加可选 `log`，兜底只记已定义原因码或 `unrecognized`；`index.ts` 传入 `petLog`
- [x] 1.3 Refactor；`packages/dsh-pet` 全量测试保持绿

## 2. `/bind` 迁移前置与回执（D6）

- [x] 2.1 Write failing test：`locus-on-demand-provisioning.test.ts` 的「主会话已归档时绑定新群」「话题绑定同样迁移」「迁移已提交但入口建立失败」；`locus-migrate-whole-w.test.ts` 的「有 current 投递时拒绝」（fake 与 real 后端，`Topology.open({unusableMains})`）
- [x] 2.2 Implement：`controller.ts` `provisionChatLocked` 在显式 W 的 active M 不可用时先 `migrateWholeW`，current 阻塞抛 `LOCUS_BUSY`；迁移结果带到 `bindReceipt`，迁移后入口失败带“已迁移”标记给 `safeControlError`；修订 `ensureLocusMain` 报错文案
- [x] 2.3 Refactor；全量测试保持绿

## 3. `/bind` 回执披露共享范围（D3）

- [x] 3.1 Write failing test：`locus-control.test.ts` 的「绑定回执说明共享范围」
- [x] 3.2 Implement：`control.ts` `bindReceipt` 追加共享范围与 `/unbind` 撤销说明
- [x] 3.3 Refactor；全量测试保持绿

## 4. 询问消息与询问引用（D1、D3、D8）

- [x] 4.1 实施前核对：Delivery 记录中触发消息 id 字段（IM 与文档评论 `docMessageId`）可从 caller 解析的 current 读到；不可行则停下上报
- [x] 4.2 Write failing test：`locus-ask-first.test.ts` 的「子会话向父询问并在同一 current 上继续」「询问附带已确认结论」「协作空间不可读时仍投递询问」「询问消息带答复义务」「已有 locus 主会话收到新流程」「同一工作会话下的入口共享结论」「解绑后不再引用原工作会话」
- [x] 4.3 Implement：`locus-tools.ts` `askParent` 写入询问引用（current 触发消息 id 或 `none`）、`askRef` 用法、找答案顺序、答复义务、一行状态规则，并附带 agreed charter（限长、不可读时注明）
- [x] 4.4 Refactor；全量测试保持绿

## 5. `locus_reply_child` 的 `askRef` 核对（D8）

- [x] 5.1 Write failing test：`locus-ask-first.test.ts` 的「Delivery 已换代后的答复被拒」「新询问之后旧询问的答复仍被拒」「已转问与最终答复都能送达」「无 current 时的询问在 E 出现后被拒」「current 结束后旧答复被拒」「缺少询问引用」「解绑重绑后旧答复被拒」「Host 重启后仍可答复当前询问」「询问已投递但始终没有答复」「父答复在 Delivery 过期后才到达」，外加 round 6 S1 四条参数化用例（none→none、同 D 多次问答、文档评论 msgId、缺参后补参重试）；拒绝一律断言 `sendMessage` 调用 0 次
- [x] 5.2 Implement：`tools.ts` 给 `locus_reply_child` 增加必填 `askRef`（错误文案指向询问正文中的引用）；`locus-tools.ts` `replyChild` 送达前比对持久 current 的触发消息 id；在核对处加 `shortcut:` 注释写明“送达后、处理前换代不拦截”
- [x] 5.3 Refactor；全量测试保持绿

## 6. `locus_work_history` 工具（D4、D5）

- [x] 6.1 从真实工作会话导出脱敏事件 fixture（只留事件类型、source.kind、stopReason、占位文本），人工核对不含原文后入库
- [x] 6.2 Write failing test：`locus-work-history.test.ts` 的「读最近 3 轮」「轮内多段助手文本只取最终一段」「进行中轮次只给人工输入」「关键词搜索」「关键词无命中」「不在内存时状态未知」「冷读失败」「记录中的凭据被脱敏」「超长输出截断」「只能读自己的工作会话」「记录中的指令不改变目标与权限」
- [x] 6.3 Implement：`locus-tools.ts` 提取与 `redactCredentials`（先脱敏后截断）；两值状态 helper（不改子会话现有 helper 语义）；`tools.ts` 注册并白名单校验 `query`；`index.ts` 装配 live/冷读依赖
- [x] 6.4 Refactor；全量测试保持绿

## 7. 主会话找答案顺序的规则文本（D1）

- [x] 7.1 Write failing test：`locus-ask-first.test.ts` 的「工作会话忙时只读记录不打扰」「工作会话状态未知时按忙处理」「工作会话空闲时直接问」「最近记录已有答案时不再提问」「主会话可见回复不复述正文」（断言询问消息与 briefing 中的规则文本；模型遵守情况留给 9.3）
- [x] 7.2 Implement：`askParent` 消息体与 `dsh-port.ts` `composeLocusCoordinatorBriefing` 同步写入顺序、状态规则、`locus_work_history` 与 `askRef` 用法
- [x] 7.3 Refactor；全量测试保持绿

## 8. 子会话规则文本（D1、D2）

- [x] 8.1 Write failing test：`ledger-prompt.test.ts` 的「信息交换先问主会话」「主会话无记录后自行查找」「询问失败后自行查找」「默认业务口径」「追问实现细节时补充」；`locus-delivery-prompt.test.ts` 断言首投与续投都含新规则
- [x] 8.2 Implement：`ledger/prompt.ts` 信息交换条款与 `intentTriageGuidanceCoversRequiredPoints` 必含短语；`locus/context.ts` 续投压缩规则与首投“按需读取”段同步
- [x] 8.3 Refactor；全量测试保持绿

## 9. 继承场景、验证与收尾

- [x] 9.1 逐行核对 test-plan 中 carried forward 的 23 个场景：确认已有测试覆盖语义并补 `spec Scenario` 标题，缺失则新写；全部转 🟢
- [x] 9.2 `packages/dsh-pet` build、typecheck、test；仓库 `npm test`、`npm run check:artifacts`；`openspec validate locus-ask-work-first-and-concise --strict`
- [ ] 9.3 预览验收（需用户授权的测试群）：信息类问题先问主会话；工作会话非空闲时不被打扰；群内回复为业务口径；主会话 GUI 只一行；M 归档后新群 `/bind` 成功；迟到答复被拒
- [ ] 9.4 更新 `docs/architecture/dsh-plugin-integration-pitfalls.md` 第 9 节补本次实例；按 Anvil verify 生成 `verify.md`；合入、部署、重启和归档另经用户批准
