## 1. 准备与运行时探针

- [x] 1.1 `ws promote` 并安装依赖，运行 dsh-pet、dsh-collab、collab-kernel 现有全部测试确认基线为绿（2026-11-03：collab-kernel 292、dsh-collab 181 全过；dsh-pet build 后 3504 过、8 跳过、2 失败——`test/locus-lark-port.test.ts` 的两个用例在主干基线即失败，与本 change 无关，记为已知基线）
- [x] 1.2 rc.2 探针：冷恢复经过 `agent/created`（`source:'resume'`）且监听器失败使恢复失败；首条 prompt 创建时 `agent/created` 先于首轮认领、失败则首轮不执行；`startContinuable` 在首轮认领后才返回，故关联必须在 `agent/created` 内发布。见 [probes/agent-created-probe.md](probes/agent-created-probe.md)（官方未打补丁包、纯运行时隔离、假模型）
- [x] 1.3 新增 `locus-base` preset（白名单、中性命名、不含委派）并在 `dsh.yaml` 声明；先写失败测试断言展开后不含委派工具
- [x] 1.4 编写官方 subagent / `sessionQuery` 替身与 dsh-collab `owns` 夹具
- [x] 1.5 （2026-11-03 完整隔离 profile 实测见 probes/full-profile-wrappers.md：官方 checkpoint 包装层在守卫后等待会话落盘；所有者已接受该时间窗）在退役 4 个补丁后的隔离预览 launcher 图上复核：列出实际注册的 `tools/execute` 包装层，确认读取类与本地文件/命令类工具（含 Worktree Session 约束的工具）路径上没有在调用工具体前等待的包装层；结论写入 design Risks。若发现会等待的包装层，停下交所有者决定（接受时间窗或改由 Pet 在内层补重判）

## 2. collab-kernel：接入方代人处置其托管成员的 request

- [x] 2.1 Write failing tests in `packages/collab-kernel/test/dispose-owned-request.test.ts`：「处置接入方拥有的普通会话登记的 request」（确认因功能缺失而失败）
- [x] 2.2 Implement「接入方代人处置其托管成员的 request」使 2.1 通过（规范见 specs/collab-kernel/spec.md，做法见 design.md）
- [x] 2.3 定位并保持既有场景测试不变：「代人受理不唤醒」；「不经受理直接完成」；「不能处置非托管成员的 request」；「作者退役后仍可处置」；「未授权空间不可区分」
- [x] 2.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 3. dsh-collab：接入方以其拥有的普通会话身份执行封闭命令

- [x] 3.1 Write failing tests in `packages/dsh-collab/test/integration-act-as.test.ts`：「以拥有的会话建空间、邀请并代写」；「未拥有、子会话或已归档时拒绝」；「提交前失去拥有关系」；「封闭操作集合」；「未提供 owns 的接入方」（确认因功能缺失而失败）
- [x] 3.2 Implement「接入方以其拥有的普通会话身份执行封闭命令」使 3.1 通过（规范见 specs/dsh-collab/spec.md，做法见 design.md）
- [x] 3.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 4. dsh-pet：子代结算按官方默认通知 locus 主会话

- [x] 4.1 Write failing tests in `packages/dsh-pet/test/locus-settlement-notify.test.ts`：「结算通知只到 locus 主会话」；「多个入口结算不打断干活主会话」（确认因功能缺失而失败）
- [x] 4.2 Implement「子代结算按官方默认通知 locus 主会话」使 4.1 通过（规范见 specs/dsh-pet/spec.md，做法见 design.md）
- [x] 4.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 5. dsh-pet：Locus child 创建使用官方 subagent 契约表达其不变量

- [x] 5.1 Write failing tests in `packages/dsh-pet/test/locus-child-contract.test.ts`：「父在 child 存活期间更改组合」（确认因功能缺失而失败）
- [x] 5.2 Implement「Locus child 创建使用官方 subagent 契约表达其不变量」使 5.1 通过（规范见 specs/dsh-pet/spec.md，做法见 design.md）
- [x] 5.3 定位并保持既有场景测试不变：「预留身份后创建 child」；「冷恢复后工具面限制仍然有效」；「child 实际工具面超出允许范围」
- [x] 5.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 6. dsh-pet：Pet executor preset 按运行体的 preset 承载方式声明

- [x] 6.1 Write failing tests in `packages/dsh-pet/test/locus-preset.test.ts`：「运行体只接受声明式 preset 时冷恢复 locus child」；「preset 缺失」；「locus-base 不含委派」（确认因功能缺失而失败）
- [x] 6.2 Implement「Pet executor preset 按运行体的 preset 承载方式声明」使 6.1 通过（规范见 specs/dsh-pet/spec.md，做法见 design.md）
- [x] 6.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 7. dsh-pet：子代激活受运行体名额约束时 fail closed

- [x] 7.1 Write failing tests in `packages/dsh-pet/test/locus-capacity.test.ts`：「只读访问不长期占用名额」（确认因功能缺失而失败）
- [x] 7.2 Implement「子代激活受运行体名额约束时 fail closed」使 7.1 通过（规范见 specs/dsh-pet/spec.md，做法见 design.md）
- [x] 7.3 定位并保持既有场景测试不变：「名额已满时创建 locus child」
- [x] 7.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 8. pet-locus-collaboration：Locus 三层实体

- [x] 8.1 Write failing tests in `packages/dsh-pet/test/locus-three-tier-entity.test.ts`：「同一干活主会话服务多个入口」；「locus 主会话工具面锁死」；「干活主会话不得是子会话」（确认因功能缺失而失败）
- [x] 8.2 Implement「Locus 三层实体」使 8.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 8.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 9. pet-locus-collaboration：入口建立统一为一条路径

- [x] 9.1 Write failing tests in `packages/dsh-pet/test/locus-establish.test.ts`：「auto 建立」；「绑定到已有干活主会话复用 locus 主会话」；「建立失败不留半成品」（确认因功能缺失而失败）
- [x] 9.2 Implement「入口建立统一为一条路径」使 9.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 9.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 10. pet-locus-collaboration：子会话在首条消息到达时创建

- [x] 10.1 Write failing tests：基础场景在 `packages/dsh-pet/test/locus-lazy-child.test.ts`；首图降级与故障交接在 `packages/dsh-pet/test/locus-first-image-fallback.test.ts`，组合真实 lazy creator、publication、LocusRepository、channel controller 与保留失败持久 ID 的官方契约替身（不得仅各自 mock 或源代码断言）；Host 屏障在 `packages/dsh-pet/test/locus-host-wiring.test.ts`：「首条消息即首个 prompt」；「创建失败不推进代际」；「名额不足时保留原请求」；「provider 不能证明独立上下文」；「API 返回前首轮已能解析身份」；「回调内发布后创建被拒时回滚」；「首条图片不支持时安全降为文本」；「首图降级交接使用新快照」；「首图补偿失败保留恢复债务」；「首图降级跨崩溃最多一次文本」；「已接受或认领的图片拒绝不重放」；真实 Host loader 集成的「首工具等待持久绑定」「首轮持久绑定失败拒绝执行」（确认因功能缺失而失败）
- [x] 10.2 Implement「子会话在首条消息到达时创建」使 10.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）；首图例外按 design 的旧 child 补偿→原子 current/reservation/backlog/WAL 交接→持久文本标记→重取快照与新 execution 的顺序实现，补偿/提交不确定不重放
- [x] 10.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 11. pet-locus-collaboration：换绑与归档按层处理

- [x] 11.1 Write failing tests in `packages/dsh-pet/test/locus-rebind-archive.test.ts`：「干活主会话归档」；「子会话不可用只换该入口一代」；「名额不足的冷恢复保留原代际」；「locus 主会话不可用时整体迁移」（确认因功能缺失而失败）
- [x] 11.2 Implement「换绑与归档按层处理」使 11.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 11.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 12. pet-locus-collaboration：旧模型入口按退休规则处理

- [x] 12.1 Write failing tests in `packages/dsh-pet/test/locus-legacy-retire.test.ts`：「升级只加表」；「旧入口首个授权 at」；「旧入口非授权 at」（确认因功能缺失而失败）
- [x] 12.2 Implement「旧模型入口按退休规则处理」使 12.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 12.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 13. pet-locus-collaboration：provisioning 失败超时后不再阻塞

- [x] 13.1 Write failing tests in `packages/dsh-pet/test/locus-provisioning-timeout.test.ts`：「超时后重试」；「超时前仍阻塞」；「补偿失败继续阻塞」（确认因功能缺失而失败）
- [x] 13.2 Implement「provisioning 失败超时后不再阻塞」使 13.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 13.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 14. pet-locus-collaboration：子会话读共识与 locus 主会话工具

- [x] 14.1 Write failing tests in `packages/dsh-pet/test/locus-context-tools.test.ts`：「按入口过滤」；「话题可见所在群条目」；「子会话向父询问并在同一 current 上继续」；「旧代子会话不能询问」；「回复非现行代子会话被拒」（确认因功能缺失而失败）
- [x] 14.2 Implement「子会话读共识与 locus 主会话工具」使 14.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 14.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 15. pet-locus-collaboration：启动恢复证据经官方冷读获取

- [x] 15.1 Write failing tests in `packages/dsh-pet/test/locus-startup-cold-read.test.ts`：「合成中断不算证据」；「冷读服务不可用」；「不可区分中断保持等待」；「真实中断立即结算推进」；「live 中断不剔除」（确认因功能缺失而失败）
- [x] 15.2 Implement「启动恢复证据经官方冷读获取」使 15.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 15.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 16. pet-locus-collaboration：非驻留子会话的权限变更以待应用协议提交

- [x] 16.1 Write failing tests in `packages/dsh-pet/test/locus-pending-permission.test.ts`：「非驻留时授予 shell 并在唤醒时生效」；「唤醒时核验失败不留授权」；「非驻留撤回 shell 核验失败恢复原值」；「原值也无法核验时不发布」；「常驻空闲时当场生效」（确认因功能缺失而失败）
- [x] 16.2 Implement「非驻留子会话的权限变更以待应用协议提交」使 16.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 16.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 17. pet-locus-collaboration：Locus 业务出站只能经受管 finish

- [x] 17.1 Write failing tests in `packages/dsh-pet/test/locus-composition.test.ts`：「收紧层未安装时不发布」；「隔离能力无法证明时不发布」；「safe-v1 行继续服务」；「主会话 preset 不影响子会话工具面」；「冷恢复不回落到父组合」；「升级前的 legacy child 不可恢复服务」（确认因功能缺失而失败）
- [x] 17.2 Implement「Locus 业务出站只能经受管 finish」使 17.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 17.3 定位并保持既有场景测试不变：「受管 finish 正常发送」；「shell 旁路不可达」；「shell 档误用 lark-cli 发送被拦截」；「shell 档读取当前群不被拦截」；「shell 档的出站保证如实表述」；「子委派不能洗白权限」
- [x] 17.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 18. pet-locus-collaboration：全部飞书工作统一为子会话常规交互

- [x] 18.1 新增官方 Host queue/user 行为回归「业务结算后下一条仍为独立轮次」（包含父 sendMessage 仅续 A 对照），并定位保留既有场景测试：「普通资料发布」；「决策往返」；「多人连续提问」；「父回复与下一条飞书消息不会合批」；「超时不重建会话」
- [x] 18.2 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 19. pet-locus-collaboration：上下文按实际子会话绑定并允许按需问主会话

- [x] 19.1 Write failing tests in `packages/dsh-pet/test/locus-child-context.test.ts`：「旧 fork child 不受影响」；「子会话发现不自动成为主会话认知」（确认因功能缺失而失败）
- [x] 19.2 Implement「上下文按实际子会话绑定并允许按需问主会话」使 19.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 19.3 定位并保持既有场景测试不变：「长父历史不能冒充子身份」；「业务完成只经统一工具提交」；「无法证明独立能力时拒绝创建」；「历史不含最新目录」；「主会话无法回答」；「跨 turn 父回复继续 current Delivery」；「单独的 agent 消息不能获得飞书能力」；「GUI 流量仍不能消费 current」；「新话题上下文」；「用户主动查阅受实际能力约束」；「冷恢复保留独立历史」
- [x] 19.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 20. pet-locus-collaboration：Locus 工具档位由所有者显式授予且不重建子会话

- [x] 20.1 Write failing tests in `packages/dsh-pet/test/locus-tool-tier-mutation.test.ts`：「授予 shell 档」；「撤回 shell 档」；「核验失败回到 safe」；「safe-v1 入口请求 shell」；「冷恢复保持档位」（确认因功能缺失而失败）
- [x] 20.2 Implement「Locus 工具档位由所有者显式授予且不重建子会话」使 20.1 通过（规范见 specs/pet-locus-collaboration/spec.md，做法见 design.md）
- [x] 20.3 定位并保持既有场景测试不变：「忙时拒绝」；「shell 档拒绝普通成员」；「切换前排队的普通成员请求」；「重建不继承 shell」；「非 allowlist 档位命令」
- [x] 20.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 21. pet-locus-intent-triage：协作空间由干活主会话与 locus 主会话两个普通成员组成

- [x] 21.1 Write failing tests in `packages/dsh-pet/test/collab-space-members.test.ts`：「建空间并邀请干活主会话」；「子会话没有协作工具」；「干活主会话不可邀请时不建入口」（确认因功能缺失而失败）
- [x] 21.2 Implement「协作空间由干活主会话与 locus 主会话两个普通成员组成」使 21.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [x] 21.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 22. pet-locus-intent-triage：待办由 Host 以 locus 主会话身份代写

- [x] 22.1 Write failing tests in `packages/dsh-pet/test/collab-todo-actas.test.ts`：「代写条目的作者与附加数据」；「工具不接受目标参数」；「无唯一 current 时拒绝」；「更换 locus 主会话后待办仍在」（确认因功能缺失而失败）
- [x] 22.2 Implement「待办由 Host 以 locus 主会话身份代写」使 22.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [x] 22.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 23. pet-locus-intent-triage：所有者处置待办经 manager 代为记账

- [x] 23.1 Write failing tests in `packages/dsh-pet/test/collab-todo-dispose.test.ts`：「所有者直接了结」；「干活主会话自行完成」（确认因功能缺失而失败）
- [x] 23.2 Implement「所有者处置待办经 manager 代为记账」使 23.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [x] 23.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 24. pet-locus-intent-triage：待办登记后的回复如实且登记失败反馈可执行

- [x] 24.1 Write failing tests in `packages/dsh-pet/test/ledger-track-feedback.test.ts`：「登记后回复与待办状态一致」；「未确认路径不作为事实」；「登记失败给出操作特定指引」；「待办进度不可读与没有待办可区分」（确认因功能缺失而失败）
- [x] 24.2 Implement「待办登记后的回复如实且登记失败反馈可执行」使 24.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [x] 24.3 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 25. pet-locus-intent-triage：待办生命周期与 Delivery 结算解耦

- [x] 25.1 Write failing tests in `packages/dsh-pet/test/collab-todo-lifecycle.test.ts`：「子会话不能推进待办状态」；「主会话做完后自行标记完成」（确认因功能缺失而失败）
- [x] 25.2 Implement「待办生命周期与 Delivery 结算解耦」使 25.1 通过（规范见 specs/pet-locus-intent-triage/spec.md，做法见 design.md）
- [x] 25.3 定位并保持既有场景测试不变：「登记后队列继续前进」；「回复完成不等于事情做完」；「待办状态变化不外发」；「不经受理直接了结」
- [x] 25.4 Refactor；三个包全部测试与 typecheck 保持绿，test-plan 对应行翻 🟢

## 26. 退役与迁移

- [x] 26.1 Write failing tests：工具面断言不含 `pet_inquire`、`pet_inquiry_answer`、`pet_collaboration_context*`、`pet_collaborators`、`pet_locus_request_execution`、`pet_locus_parent_lookup` 与子会话 `collab_*`
- [x] 26.2 删除 inquiry 子系统写路径、代理成员/戳/投影、collaboration 工具与 `collaboration_contexts` 写入；inquiry 表保留只读，管理面标"已退役"
- [x] 26.3 Write failing check：compat 构建产物不再替换 `dsh-subagent`、`dsh-agent-loop`、`dsh-tools` 与 4 个原生工具 owner 包，`ctx.tools.supportsFinalToolGuardRecheck` 不存在且 Pet 不读取它，Pet 工具定义上没有 `dsh.tool.managed-effect` 标记
- [x] 26.4 移除 4 个补丁（`settlement-notice`、`inquiry-isolation`、`newinquiry-tools-guard`、`native-managed-effects`）与其构建/运行图校验（`build.mjs`、`build-launcher.cjs` 哈希与组合哈希、`native-tools.package.template.json`、`package.template.json`（dsh-subagent）、`agent-loop.package.template.json`、`newtools.package.template.json`、`verify-native-managed-effects.mjs`、`test-native-managed-effects.cjs`、`test-native-owner-verifier.cjs`、`test-packaging.cjs`/`verify-isolated-loop.mjs` 中对应断言）；删除 `src/host/inquiry/managed-effects.ts`、`src/host/tools.ts` 的 `managedEffects` 接缝及 `test/inquiry-*`、`vitest.inquiry-managed-effects.config.ts`、`vitest.config.ts` 中的排除项；保留 `team-membership`、`model-display`；compat 构建与包测试通过，26.3 转绿
- [x] 26.5 更新 compat README（中英）与 `dsh.yaml` dsh-pet 说明（overlay 只剩 team-membership 与 model-display 两组）
- [x] 26.6 `PET_DOMAIN_VERSION` 升 18、`migrate-state-version.mjs` 只加 `locus_mains` 表；迁移测试断言其它表逐字节不变
- [x] 26.7 新增 ADR-0009（逐条回答 ADR-0007 待决事项与前置），ADR-0006、ADR-0007 加注记；BACKLOG 更新 B040、B042

## 28. 真机验收修正：工作区分离（2026-11-04 所有者确认）

- [x] 28.1 先写失败测试：主会话归 DSH Pet、项目工作区不变、旧 M 经既有迁移替换；Pet cwd 下仍只读来源项目且拒绝私有根和 symlink escape（旧代码 6 failed / 13 passed，失败原因均为工作区同一性假设）
- [x] 28.2 同步三层实体与 project-read guard 规范、设计和 ADR，复审工作区分离方案（主控定向复审见 review.md；所有者明确选择 DSH Pet 归属并保留项目读取）
- [x] 28.3 在创建、入口持久关联、Host 装配和 prompt 中分离运行工作区与项目根；验证实际 Host 路径（新增 Host 创建/重建作用域的读守卫对照通过，主会话命名按所有者要求使用 `[locus] <干活主会话名>`）
- [x] 28.4 全量相关回归、build/typecheck 和严格规范校验，记录证据（Pet 2933 passed / 4 skipped；根仓 703 passed / 3 skipped；build/typecheck、54 specs、strict change、artifact check 通过；最终命名调整后 100 项定向回归通过，详见 workspace-separation.md）

## 29. 真机验收修正：恢复来源后的入站主会话检查

- [x] 29.1 使用真实 admission resolver、resolution、controller 与持久仓储复现：两者均归档后仅恢复干活会话，旧代码拒绝；组合失效对照中旧代码仍复用不可用 M（2 failed / 22 passed）
- [x] 29.2 修正入站衔接：已有入口派发前也检查 M；仅已知 `locus-unusable` 可进入同一来源的替换流程；未知读错误、来源仍归档和明确停止继续拒绝，保持 active M 复用（106 项定向回归通过）
- [x] 29.3 全量 Pet build/typecheck/test、严格规范与产物检查及实现审查（2936 passed / 4 skipped；build/typecheck、strict、artifacts 通过；相对 `86e7955a` 的全部修复 diff 审查 PASS；真机项仍保留在 27.3，不提前记为通过）

## 30. 真机验收修正：子会话工作区登记

- [x] 30.1 从现场日志定位 child cwd 在 Pet、attach 仍取来源 workspaceId 的错误；双工作区 Host 夹具按 cwd 校验登记，观察 1 failed / 4 passed
- [x] 30.2 新建 child 登记到 Pet；已存在 child 在通过组合核验的 resume 路径幂等补登记（冷恢复断言先观察 1 failed / 4 passed）；保留 child/代际/来源项目
- [x] 30.3 最终 Pet build/typecheck、全量 2936 passed / 4 skipped；主控审查 PASS，分项现场证据和待测矩阵记录在 live-acceptance.md；27.3/27.4 保持未完成

## 31. 真机验收修正：非驻留切档回执与拒绝提示

- [x] 31.1 现场确认工具申请已存为 shell/safe、child 非驻留；真实 Host 适配回归复现 pending 丢失，拒绝提示回归复现私有目录缺少不可放行说明（合法 owner 夹具下 2 failed / 18 passed）
- [x] 31.2 Host 适配透传已有 pending 标记，保留 effective、不启动 child；拒绝提示改为核对来源项目并明确私有状态根不能通过确认路径放行，保留机器错误码与前置守卫
- [x] 31.3 build/typecheck、72 项定向与全量 2937 passed / 4 skipped、实现审查及严格规范/产物校验；已受控部署 main 968a1ff4，两次构建第二次无变更，11:46:08 ready，已核实待应用记录和父子身份跨重启保持；实际 shell 与 27.3/27.4 仍未完成

## 32. E/F 批测与话题生效通知修正

- [x] 32.1 一轮取证核验 E/F 八项：话题独立标记、未知参数、无效 token、原 child 内同 profile bot CLI、撤回待应用回执、safe 工具面、拒绝新文案和 finish；保留额外发现的生效通知缺口，真实签名篡改未覆盖
- [x] 32.2 完整 Host 夹具复现话题通知走群端口被拒（1 failed / 8 passed）；复用精确当前投递的可信回复目标，缺失或错配拒绝，不扩大到群；保持提交结果不因通知失败回滚
- [ ] 32.3 45 项定向、build/typecheck、全量 2940 passed / 4 skipped；完成审查、严格规范/产物校验和受控合入构建；修复加载与生效通知真机复验合并到下一批中断重启，27.3/27.4 仍未完成

## 27. 收尾

- [x] 27.1 `npm test`、`npm run check:artifacts`、各包 build/typecheck/test；`node scripts/sync.mjs` 连续两次第二次无变更
- [x] 27.2 `openspec validate locus-three-tier-structure --strict`；test-plan 全部 🟢
- [ ] 27.3 真机验收：auto 新群、`/bind`、首条消息惰性创建、名额不足重试、干活主会话归档回执、locus 主会话替换迁移、非驻留改档位；记录 locus 主会话常驻数量与内存（ADR-0007 待决事项 4），写入 verify.md
- [ ] 27.4 补验已归档 change 中受本 change 影响、当时未完成的真机项（在新结构上验收，结果一并写入 verify.md）：
  - `2026-11-03-pet-locus-shell-tier` 1.2：`shell` 档子会话（沙箱由本 change 在 `agent/created` 设置）内 `lark-cli --as bot im +chat-messages-list --chat-id <当前群>` 能否工作；另验授予 `shell` 后 Host 重启、子会话冷恢复档位保持（本 change 改了冷恢复组合来源）
  - `2026-11-03-pet-locus-feishu-read-and-delivery-fixes` 7.5 剩余项：话题入口读取、未知参数拒绝、伪造游标拒绝、守卫拒绝文案（子会话改为惰性创建、父改为 locus 主会话）
  - `2026-11-03-pet-locus-interrupted-delivery-recovery` 5.2：Host 在子会话 turn 执行中重启后，该 Delivery 结算为 `failed/turn-interrupted`、下一条立即派发并回复（本 change 把证据来源改为 `sessionQuery.observeSession` 冷读）
