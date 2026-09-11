# Pet 飞书关联模型 v2 — 交付分解

先读 `design.md` 的完整目标架构。以下工作仍全部未实施。
**第 0 组是开工门槛**：旧清单中“workspace-write 解除硬边界”“依赖默认只读”、
“必须从历史认定目录”“全局删除 worktree adapter”“缺 thread 安全回退群本体”
并非已经验证的方案，不得照单执行。门槛闭合后同步 proposal、delta specs 和对应任务。

## 0. 架构评审与集成契约（先于生产实现）

- [ ] 0.1 闭合 G1：实测默认/fork/冷恢复的 read 策略与 cwd、sw 兄弟目录、临时目录写入矩阵；确认 write 映射，更新权限 delta 与 5.1/5.4/9.5，不静默采用更宽模式
- [ ] 0.2 闭合 G2：核验原始话题事件与解析链，区分无 thread 与无法确定 thread；修订路由 delta 与 4.3
- [ ] 0.3 闭合 G3：验证初始化后问父、锚点确认和写回、首轮/冷恢复 context 注入时序；修订目录 delta 与第 6/7 组
- [ ] 0.4 闭合 G4：验证初始化、GUI 私聊、飞书 turn 交错时的 settlement 关联；验证原生父结算通知是否可抑制，不将 Pet 不主动汇总等同于宿主无通知
- [ ] 0.5 闭合 G5：确认 GUI 默认 Q&A 指定入口的复用规则，不能把最近使用任意 issue 群当作已确认行为；同步 Q&A delta、3.6、8.5
- [ ] 0.6 闭合 G6：确认群级豁免下 workspace fallback 的实际默认权限与 -s 适用范围，以及权限切换对在途 shell/turn 的处理
- [ ] 0.7 对齐完整 delta：核对 MODIFIED 标题与全部原场景、旧 /bind 兼容、退出来源限制、忙时拒绝、失效不 fallback、历史与当前指针分离；移除与新架构矛盾的旧措辞

架构责任映射：A2/A9 → 第 1/2 组；A4/A5/A6 → 第 3/4 组；A8 → 第 5 组；
A7 → 第 6/7 组；A10 → 第 8 组；A11 与故障矩阵 → 第 9/10 组。

## 1. 数据模型与迁移

- [ ] 1.1 在 `host/spec.ts` 定义 `chat_routes` 表 schema（chatId 主键；chatType / workspaceId / boundBy / boundAt / chatName）
- [ ] 1.2 在 `host/spec.ts` 定义 `agent_bindings` 表 schema（locusKey 主键；chatId / threadId? / provenance / childSessionId? / parentSessionId? / activeTaskId? / mode / modeGrantedBy? / modeGrantedAt? / executionRoot? / branch? / repositoryRoot? / origin / invalidatedAt? / invalidatedReason? / lastUsedAt?），用 `superRefine` 强制 fork-child 形态必须有 child 与 parent
- [ ] 1.3 移除 `petChatBinding` 及 `qaPriorWorkspaceId` / `qaExecutionRoot` / `qaBranch` / `qaRepositoryRoot` 等字段定义，`PET_DOMAIN_VERSION` 5 → 6
- [ ] 1.4 在 `wire.ts` 定义 `locusKeyOf(chatId, threadId?)` 与其解析函数，沿用 `\u0000` 分隔约定；新增 `locus:` scope key 变体
- [ ] 1.5 在 `migrate.ts` 实现 v5 → v6 迁移：在 `storageDomain.open` **之前**直接对 DB 执行；`kind: workspace` 行迁入 `chat_routes`，`kind: qa` 行迁入 `agent_bindings`（mode 一律 `read`），`qaPriorWorkspaceId` 存在时额外写回 `chat_routes`
- [ ] 1.6 在同一次迁移内换算 Task scopeKey：`qa:<sessionId>` → `locus:<chatId>`，确保 `findActiveTaskByScope` 与 `findTaskByExecutor` 不冲突
- [ ] 1.7 迁移幂等性测试：v6 库重复运行不产生变化；v5 库迁移后可正常 open；缺表/空库不报错
- [ ] 1.8 迁移数据保真测试：workspace 行、qa 行、带 `qaPriorWorkspaceId` 的 qa 行、已失效 qa 行各自迁移正确

## 2. 仓储层

- [ ] 2.1 `repository.ts` 新增 chat route 读写（list / get / put / delete），替换原 `putChatBinding` 中 workspace 分支
- [ ] 2.2 `repository.ts` 新增 agent binding 读写：按 locusKey 精确查、按 chatId 列出全部位点、按 childSessionId 反查、按 parentSessionId 列出（供管理面聚合）
- [ ] 2.3 实现档位读写：`setLocusMode(locusKey, mode, grantedBy)` 持久化档位与授权者、时间
- [ ] 2.4 实现执行根落库：`setLocusExecutionRoot(locusKey, facts)`，仅在校验通过后调用
- [ ] 2.5 将 `findOldestPendingChannelForChat` 改为按 locus/child 查找，修正多话题下的结算错配
- [ ] 2.6 仓储层单测覆盖：同 chatId 多位点、位点键含/不含 threadId、按 parent 聚合

## 3. 位点占用与绑定流程

- [ ] 3.1 `qa/occupancy.ts` 将 `qaScopeKeyOf(sessionId)` 改为 `locusScopeKey(locusKey)`，`chatOccupancy` 改为 `locusOccupancy`
- [ ] 3.2 删除 `sessionOccupancy` 及 `bind.ts` 中的 `session-occupied` 拒绝分支，打开 fan-out
- [ ] 3.3 `isQaChatLive` 改为两个函数：`isLocusLive(locusKey)`（投递与命令判定用）与 `chatHasLiveLocus(chatId)`（allowlist 豁免用，群级）
- [ ] 3.4 `bind.ts` 移除 `qaPriorWorkspaceId` 读写；`unbindGroup` 改为删除 agent binding 行，不再还原 workspace 路由
- [ ] 3.5 `resolve-session.ts` 明确排除带 `parentSession` 的会话并补测试，固化深度两层封顶
- [ ] 3.6 `action.ts` Q&A 复用改为按源会话查其全部位点：命中则返回最近使用的一个并列出其余，标明复用
- [ ] 3.7 绑定/解绑/占用相关单测更新，新增「同源会话绑定多个位点」「同群两话题绑不同会话」用例

## 4. 入站路由与话题

- [ ] 4.1 `channel/event.ts` 解析并透出 `thread_id`（已在类型中声明，补实际读取）
- [ ] 4.2 `channel/route.ts` 改为位点路由：先查 agent binding，未命中回退 chat route 再回退 default workspace 并写回；未绑定话题走 chat 的 workspace 路由
- [ ] 4.3 `thread_id` 缺失时 fail closed 退化为群本体位点；MUST NOT 依据 chat_type 判定话题群
- [ ] 4.4 `channel/pipeline.ts` 的 scope key 由 `chat:<chatId>` 改为 `locus:<locusKey>`，使同群不同话题各持独立 Task
- [ ] 4.5 allowlist 豁免判据改为群级（该 chat 存在任一 live 位点即豁免），并保持命令不受豁免
- [ ] 4.6 路由与准入单测：同群两话题独立路由、未绑定话题回退、豁免覆盖未绑定话题、豁免不外溢、已释放 chat 不再豁免

## 5. 权限档位

- [ ] 5.1 探测宿主 `dsh-sandbox-policy` 的 `setSandboxMode`（可选依赖，缺席时档位功能不可用而非 Pet 加载失败）
- [ ] 5.2 `qa/command.ts` 增加 `-s/--scope read|write` 命令解析，与 `-b/--bind` 分离；沿用既有 mention 剥离逻辑
- [ ] 5.3 实现授权流程：仅 allowlist 可触发（非 allowlist 静默丢弃）；未绑定位点立即机械回执；成功后写档位 + 记录授权者与时间 + 位点内回执
- [ ] 5.4 提权时调用 `setSandboxMode(childSession, 'workspace-write')`，降权调用 `'read-only'`；新建位点不主动写事件，依赖宿主 fail-safe 默认
- [ ] 5.5 执行根未认定或校验失败时拒绝进入 `write` 档，给出可诊断说明
- [ ] 5.6 重新绑定时不继承既往档位（新 fork 的 child 为 read）
- [ ] 5.7 权限单测：默认只读、提权降权、非 allowlist 静默丢弃、未绑定位点回执、重绑不继承

## 6. 执行根锚定

- [ ] 6.1 `qa/prompt.ts` seed 任务书加入「从继承历史认定父会话工作目录并首轮回报」的指令
- [ ] 6.2 实现首轮回报的接收与校验（路径存在、是 git worktree），通过后落库到位点
- [ ] 6.3 校验失败或无法认定时，向所有者暴露确认入口；确认前不落库且禁止 `write` 档
- [ ] 6.4 每轮投递的目录声明改为精简一行（具体路径 + 引导调用 context 工具），完整说明保留在 seed
- [ ] 6.5 删除 `host/worktree-status.ts`、`host/worktree-adapter.ts` 及 `index.ts` 中 `resolveSourceWorktree` / `loadWorktreeStatus` 装配
- [ ] 6.6 源会话无受管目录时不产生任何目录约束段落（保持既有行为）
- [ ] 6.7 执行根相关单测：认定成功落库、校验失败不落库且禁写、每轮重述、无 worktree 场景

## 7. 上下文工具

- [ ] 7.1 `capture.ts` 的 `resolveTrustedContext` 按 `Task.sourceKind` 分流：fork-child 走位点，其余保持 Invocation + Snapshot
- [ ] 7.2 `context-tool.ts` 返回体增加 `scope` 字段与位点分支字段（源会话、执行根、档位、位点标识）
- [ ] 7.3 位点已失效或 child 不服务任何位点时 fail closed 并给出可诊断错误
- [ ] 7.4 `index.ts` 将 `isForkChildTaskForm` 守卫从 `installPetScope` 外层下移到内部：fork-child 只装 context 工具，不 mount preset、不装 allowlist provider
- [ ] 7.5 工具可见性测试：fork-child 工具面含 context 工具且 Skill 目录仍继承自源会话；普通会话不含该工具
- [ ] 7.6 回归测试覆盖原 `NO_CURRENT_INVOCATION` 事故：fork child 调用不再报该错

## 8. 管理面

- [ ] 8.1 `routes.ts` 的 route 投影改为输出位点列表（含 threadId、provenance、mode、执行根）
- [ ] 8.2 新增按源会话聚合的查询：其全部位点、各自人数与档位、累计暴露人数
- [ ] 8.3 `client/settings.tsx` 位点列表展示话题维度与档位，可写位点可辨识
- [ ] 8.4 设置页展示按源会话聚合的暴露面视图
- [ ] 8.5 Q&A 复用结果展示跳转入口（复用已有 `larkChatLink()`），多位点时列出其余
- [ ] 8.6 路由分组（`routeGroupOf`）适配位点模型与新的 provenance 字段

## 9. 验收与收尾

- [ ] 9.1 运行 `packages/dsh-pet` 的 build / typecheck / test 全绿
- [ ] 9.2 运行 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs`（并验证连续第二次无变化）
- [ ] 9.3 真机验收：同一源会话绑定两个群，各自独立应答且互不串扰
- [ ] 9.4 真机验收：话题群内两个话题绑不同会话，各自路由正确；未绑定话题回退 workspace
- [ ] 9.5 真机验收：`read` 档下 child 写入被沙箱拒绝；`-s write` 后可写；`-s read` 后再次被拒
- [ ] 9.6 真机验收：存量答疑群经迁移后继续可用，档位为 read
- [ ] 9.7 回填 `docs/notes/pet-locus-spike-findings.md`：话题群 `thread_id` 的真机确认结果
- [ ] 9.8 更新 `BACKLOG.md` [B022] 状态为已完成并注明由本 change 承接
- [ ] 9.9 仅在用户另行明确授权后清理 spike 测试群及相关绑定；验证旧 Task/child 没有在途工作，不将本规划视为清理授权

## 10. 架构横切验收

- [ ] 10.1 验证同 locus 并发绑定只有一个成功、同源不同 locus 可独立绑定、GUI 重复点击不重复建群
- [ ] 10.2 验证 fallback Task 到显式 QA 绑定的服务代际切换：忙时行为确定，不留下两个活跃服务归属
- [ ] 10.3 验证 Delivery 携带 Task/绑定代际，旧 child 晚到结算不匹配新绑定；初始化与 GUI 私聊不产生飞书反馈
- [ ] 10.4 注入 fork、建群、落库、发布各阶段失败，核对补偿、残留提示与重启恢复，不能报告部分成功为可服务
- [ ] 10.5 验证权限变更部分失败与重启后的实际策略对账；不以数据库 mode 代替宿主生效证明
- [ ] 10.6 验证共享工作根的多个 child 在管理面可辨识，并明确会话隔离不提供文件隔离
- [ ] 10.7 验证迁移覆盖 workspace scope、QA scope、Delivery 关联与旧执行根；演练一致备份及停消费回滚
- [ ] 10.8 完整跑通 design A11 场景与 A9 故障矩阵，建立消息到执行的诊断链；最后再次进行 artifacts 语义一致性审查
