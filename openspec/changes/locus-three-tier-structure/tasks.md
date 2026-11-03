## 1. 准备与运行时探针

- [ ] 1.1 `ws promote` 并安装依赖，运行 dsh-pet、dsh-collab、collab-kernel 现有全部测试确认基线为绿
- [ ] 1.2 rc.2 探针：冷恢复是否经过 `agent/created`；`startContinuable` 带首条 prompt 时预留身份 → `agent/created` → Host 发布关联 → 首个工具调用的顺序；`agent/created` 抛错时首轮业务请求未执行。结论写入 design；任一不成立即停止实施并返回设计评审
- [ ] 1.3 新增 `locus-base` preset（白名单、中性命名、不含委派）并在 `dsh.yaml` 声明；先写失败测试断言展开后不含委派工具
- [ ] 1.4 编写官方 subagent / `sessionQuery` 替身与 dsh-collab `owns` 夹具

## 2. collab-kernel：接入方代人处置其托管成员的 request

- [ ] 2.1 Write failing tests in `packages/collab-kernel/test/dispose-owned-request.test.ts`：「处置接入方拥有的普通会话登记的 request」（确认因功能缺失而失败）
- [ ] 2.2 Implement「接入方代人处置其托管成员的 request」使 2.1 通过（规范见 specs/collab-kernel/spec.md，做法见 design.md）
- [ ] 2.3 定位并保持既有场景测试不变：「代人受理不唤醒」；「不经受理直接完成」；「不能处置非托管成员的 request」；「作者退役后仍可处置」；「未授权空间不可区分」
- [ ] 2.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 3. dsh-collab：接入方以其拥有的普通会话身份执行封闭命令

- [ ] 3.1 Write failing tests in `packages/dsh-collab/test/integration-act-as.test.ts`：「以拥有的会话建空间、邀请并代写」；「未拥有、子会话或已归档时拒绝」；「提交前失去拥有关系」；「封闭操作集合」；「未提供 owns 的接入方」（确认因功能缺失而失败）
- [ ] 3.2 Implement「接入方以其拥有的普通会话身份执行封闭命令」使 3.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [ ] 3.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 4. dsh-pet：子代结算按官方默认通知 locus 主会话

- [ ] 4.1 Write failing tests in `packages/dsh-pet/test/locus-settlement-notify.test.ts`：「结算通知只到 locus 主会话」；「多个入口结算不打断干活主会话」（确认因功能缺失而失败）
- [ ] 4.2 Implement「子代结算按官方默认通知 locus 主会话」使 4.1 通过（规范见 specs/dsh-pet/spec.md，做法见 design.md）
- [ ] 4.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 5. dsh-pet：Locus child 创建使用官方 subagent 契约表达其不变量

- [ ] 5.1 Write failing tests in `packages/dsh-pet/test/locus-child-contract.test.ts`：「父在 child 存活期间更改组合」（确认因功能缺失而失败）
- [ ] 5.2 Implement「Locus child 创建使用官方 subagent 契约表达其不变量」使 5.1 通过（规范见 specs/dsh-pet/spec.md，做法见 design.md）
- [ ] 5.3 定位并保持既有场景测试不变：「预留身份后创建 child」；「冷恢复后工具面限制仍然有效」；「child 实际工具面超出允许范围」
- [ ] 5.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 6. dsh-pet：Pet executor preset 按运行体的 preset 承载方式声明

- [ ] 6.1 Write failing tests in `packages/dsh-pet/test/locus-preset.test.ts`：「运行体只接受声明式 preset 时冷恢复 locus child」；「preset 缺失」；「locus-base 不含委派」（确认因功能缺失而失败）
- [ ] 6.2 Implement「Pet executor preset 按运行体的 preset 承载方式声明」使 6.1 通过（规范见 specs/dsh-pet/spec.md，做法见 design.md）
- [ ] 6.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 7. dsh-pet：子代激活受运行体名额约束时 fail closed

- [ ] 7.1 Write failing tests in `packages/dsh-pet/test/locus-capacity.test.ts`：「只读访问不长期占用名额」（确认因功能缺失而失败）
- [ ] 7.2 Implement「子代激活受运行体名额约束时 fail closed」使 7.1 通过（规范见 specs/dsh-pet/spec.md，做法见 design.md）
- [ ] 7.3 定位并保持既有场景测试不变：「名额已满时创建 locus child」
- [ ] 7.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 8. pet-locus-collaboration：Locus 三层实体

- [ ] 8.1 Write failing tests in `packages/dsh-pet/test/locus-three-tier-entity.test.ts`：「同一干活主会话服务多个入口」；「locus 主会话工具面锁死」；「干活主会话不得是子会话」（确认因功能缺失而失败）
- [ ] 8.2 Implement「Locus 三层实体」使 8.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 8.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 9. pet-locus-collaboration：入口建立统一为一条路径

- [ ] 9.1 Write failing tests in `packages/dsh-pet/test/locus-establish.test.ts`：「auto 建立」；「绑定到已有干活主会话复用 locus 主会话」；「建立失败不留半成品」（确认因功能缺失而失败）
- [ ] 9.2 Implement「入口建立统一为一条路径」使 9.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 9.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 10. pet-locus-collaboration：子会话在首条消息到达时创建

- [ ] 10.1 Write failing tests in `packages/dsh-pet/test/locus-lazy-child.test.ts`：「首条消息即首个 prompt」；「创建失败不推进代际」；「名额不足时保留原请求」；「provider 不能证明独立上下文」（确认因功能缺失而失败）
- [ ] 10.2 Implement「子会话在首条消息到达时创建」使 10.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 10.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 11. pet-locus-collaboration：换绑与归档按层处理

- [ ] 11.1 Write failing tests in `packages/dsh-pet/test/locus-rebind-archive.test.ts`：「干活主会话归档」；「子会话不可用只换该入口一代」；「名额不足的冷恢复保留原代际」；「locus 主会话不可用时整体迁移」（确认因功能缺失而失败）
- [ ] 11.2 Implement「换绑与归档按层处理」使 11.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 11.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 12. pet-locus-collaboration：旧模型入口按退休规则处理

- [ ] 12.1 Write failing tests in `packages/dsh-pet/test/locus-legacy-retire.test.ts`：「升级只加表」；「旧入口首个授权 at」；「旧入口非授权 at」（确认因功能缺失而失败）
- [ ] 12.2 Implement「旧模型入口按退休规则处理」使 12.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 12.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 13. pet-locus-collaboration：provisioning 失败超时后不再阻塞

- [ ] 13.1 Write failing tests in `packages/dsh-pet/test/locus-provisioning-timeout.test.ts`：「超时后重试」；「超时前仍阻塞」；「补偿失败继续阻塞」（确认因功能缺失而失败）
- [ ] 13.2 Implement「provisioning 失败超时后不再阻塞」使 13.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 13.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 14. pet-locus-collaboration：子会话读共识与 locus 主会话工具

- [ ] 14.1 Write failing tests in `packages/dsh-pet/test/locus-context-tools.test.ts`：「按入口过滤」；「话题可见所在群条目」；「子会话向父询问并在同一 current 上继续」；「旧代子会话不能询问」；「回复非现行代子会话被拒」（确认因功能缺失而失败）
- [ ] 14.2 Implement「子会话读共识与 locus 主会话工具」使 14.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 14.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 15. pet-locus-collaboration：启动恢复证据经官方冷读获取

- [ ] 15.1 Write failing tests in `packages/dsh-pet/test/locus-startup-cold-read.test.ts`：「合成中断不算证据」；「冷读服务不可用」（确认因功能缺失而失败）
- [ ] 15.2 Implement「启动恢复证据经官方冷读获取」使 15.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 15.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 16. pet-locus-collaboration：非驻留子会话的权限变更以待应用协议提交

- [ ] 16.1 Write failing tests in `packages/dsh-pet/test/locus-pending-permission.test.ts`：「非驻留时授予 shell 并在唤醒时生效」；「唤醒时核验失败不留授权」；「非驻留撤回 shell 核验失败恢复原值」；「原值也无法核验时不发布」；「常驻空闲时当场生效」（确认因功能缺失而失败）
- [ ] 16.2 Implement「非驻留子会话的权限变更以待应用协议提交」使 16.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 16.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 17. pet-locus-collaboration：Locus 业务出站只能经受管 finish

- [ ] 17.1 Write failing tests in `packages/dsh-pet/test/locus-composition.test.ts`：「收紧层未安装时不发布」；「隔离能力无法证明时不发布」；「safe-v1 行继续服务」；「主会话 preset 不影响子会话工具面」；「冷恢复不回落到父组合」；「升级前的 legacy child 不可恢复服务」（确认因功能缺失而失败）
- [ ] 17.2 Implement「Locus 业务出站只能经受管 finish」使 17.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 17.3 定位并保持既有场景测试不变：「受管 finish 正常发送」；「shell 旁路不可达」；「shell 档误用 lark-cli 发送被拦截」；「shell 档读取当前群不被拦截」；「shell 档的出站保证如实表述」；「子委派不能洗白权限」
- [ ] 17.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 18. pet-locus-collaboration：全部飞书工作统一为子会话常规交互

- [ ] 18.1 定位并保持既有场景测试不变：「普通资料发布」；「决策往返」；「多人连续提问」；「父回复与下一条飞书消息不会合批」；「超时不重建会话」
- [ ] 18.2 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 19. pet-locus-collaboration：上下文按实际子会话绑定并允许按需问主会话

- [ ] 19.1 Write failing tests in `packages/dsh-pet/test/locus-child-context.test.ts`：「旧 fork child 不受影响」（确认因功能缺失而失败）
- [ ] 19.2 Implement「上下文按实际子会话绑定并允许按需问主会话」使 19.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 19.3 定位并保持既有场景测试不变：「长父历史不能冒充子身份」；「业务完成只经统一工具提交」；「无法证明独立能力时拒绝创建」；「历史不含最新目录」；「主会话无法回答」；「跨 turn 父回复继续 current Delivery」；「单独的 agent 消息不能获得飞书能力」；「GUI 流量仍不能消费 current」；「新话题上下文」；「子会话发现不自动成为主会话认知」；「用户主动查阅受实际能力约束」；「冷恢复保留独立历史」
- [ ] 19.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 20. pet-locus-collaboration：Locus 工具档位由所有者显式授予且不重建子会话

- [ ] 20.1 Write failing tests in `packages/dsh-pet/test/locus-tool-tier-mutation.test.ts`：「授予 shell 档」；「撤回 shell 档」；「核验失败回到 safe」；「safe-v1 入口请求 shell」；「冷恢复保持档位」（确认因功能缺失而失败）
- [ ] 20.2 Implement「Locus 工具档位由所有者显式授予且不重建子会话」使 20.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [ ] 20.3 定位并保持既有场景测试不变：「忙时拒绝」；「shell 档拒绝普通成员」；「切换前排队的普通成员请求」；「重建不继承 shell」；「非 allowlist 档位命令」
- [ ] 20.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 21. pet-locus-intent-triage：协作空间由干活主会话与 locus 主会话两个普通成员组成

- [ ] 21.1 Write failing tests in `packages/dsh-pet/test/collab-space-members.test.ts`：「建空间并邀请干活主会话」；「子会话没有协作工具」；「干活主会话不可邀请时不建入口」（确认因功能缺失而失败）
- [ ] 21.2 Implement「协作空间由干活主会话与 locus 主会话两个普通成员组成」使 21.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [ ] 21.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 22. pet-locus-intent-triage：待办由 Host 以 locus 主会话身份代写

- [ ] 22.1 Write failing tests in `packages/dsh-pet/test/collab-todo-actas.test.ts`：「代写条目的作者与附加数据」；「工具不接受目标参数」；「无唯一 current 时拒绝」；「更换 locus 主会话后待办仍在」（确认因功能缺失而失败）
- [ ] 22.2 Implement「待办由 Host 以 locus 主会话身份代写」使 22.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [ ] 22.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 23. pet-locus-intent-triage：所有者处置待办经 manager 代为记账

- [ ] 23.1 Write failing tests in `packages/dsh-pet/test/collab-todo-dispose.test.ts`：「所有者直接了结」；「干活主会话自行完成」（确认因功能缺失而失败）
- [ ] 23.2 Implement「所有者处置待办经 manager 代为记账」使 23.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [ ] 23.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 24. pet-locus-intent-triage：待办登记后的回复如实且登记失败反馈可执行

- [ ] 24.1 Write failing tests in `packages/dsh-pet/test/ledger-track-feedback.test.ts`：「登记后回复与待办状态一致」；「未确认路径不作为事实」；「登记失败给出操作特定指引」；「待办进度不可读与没有待办可区分」（确认因功能缺失而失败）
- [ ] 24.2 Implement「待办登记后的回复如实且登记失败反馈可执行」使 24.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [ ] 24.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 25. pet-locus-intent-triage：待办生命周期与 Delivery 结算解耦

- [ ] 25.1 Write failing tests in `packages/dsh-pet/test/collab-todo-lifecycle.test.ts`：「子会话不能推进待办状态」；「主会话做完后自行标记完成」（确认因功能缺失而失败）
- [ ] 25.2 Implement「待办生命周期与 Delivery 结算解耦」使 25.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [ ] 25.3 定位并保持既有场景测试不变：「登记后队列继续前进」；「回复完成不等于事情做完」；「待办状态变化不外发」；「不经受理直接了结」
- [ ] 25.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 26. 退役与迁移

- [ ] 26.1 Write failing tests：工具面断言不含 `pet_inquire`、`pet_inquiry_answer`、`pet_collaboration_context*`、`pet_collaborators`、`pet_locus_request_execution`、`pet_locus_parent_lookup` 与子会话 `collab_*`
- [ ] 26.2 删除 inquiry 子系统写路径、代理成员/戳/投影、collaboration 工具与 `collaboration_contexts` 写入；inquiry 表保留只读，管理面标"已退役"
- [ ] 26.3 移除 `settlement-notice.patch` 与 `inquiry-isolation.patch` 及其构建/校验引用；保留 `newinquiry-tools-guard.patch`；更新 compat README 与 `dsh.yaml` 说明；compat 构建与包测试通过
- [ ] 26.4 `PET_DOMAIN_VERSION` 升 18、`migrate-state-version.mjs` 只加 `locus_mains` 表；迁移测试断言其它表逐字节不变
- [ ] 26.5 新增 ADR-0009（逐条回答 ADR-0007 待决事项与前置），ADR-0006、ADR-0007 加注记；BACKLOG 更新 B040、B042

## 27. 收尾

- [ ] 27.1 `npm test`、`npm run check:artifacts`、各包 build/typecheck/test；`node scripts/sync.mjs` 连续两次第二次无变更
- [ ] 27.2 `openspec validate locus-three-tier-structure --strict`；test-plan 全部 🟢
- [ ] 27.3 真机验收：auto 新群、`/bind`、首条消息惰性创建、名额不足重试、干活主会话归档回执、locus 主会话替换迁移、非驻留改档位；记录 locus 主会话常驻数量与内存（ADR-0007 待决事项 4），写入 verify.md
