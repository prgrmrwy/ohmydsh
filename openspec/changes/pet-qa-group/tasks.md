# pet-qa-group Tasks

## 1. Spike：宿主 fork continuable child 链路（已完成，实现前提）

- [x] 1.1 验证宿主直接 `startContinuable({provider:'fork'})` 建 child、种子截到
      最后完成 turn/end、硬依赖清单（agents+agentLoop/sessions/sessionPersistence/
      fork provider）——全部通过，见 `spike/qa-subagent/FINDINGS.md` Q1
- [x] 1.2 验证 `queueHostSubagentPrompt`（`dsh-subagent/internal`）把消息排成
      child 独立 turn 且上下文完整——通过，见 FINDINGS Q2
- [x] 1.3 验证 parent dispose 后 `agents.resume` 拉活再喂 child、跨进程 coldResume
      （半夜路径）——通过，见 FINDINGS Q3
- [x] 1.4 验证 `listChildren` 返回 GUI 收纳条目（需 sessionQuery）——通过，见
      FINDINGS Q4
- [x] 1.5 验证 parent in-flight turn 时种子截断行为——通过，见 FINDINGS Q5
- [x] 1.6 实测坑清单（接受≠完成、flush、事件形状、turn 号延续、coldResume 的
      provider 注册时序）回填 design.md D9——已回填

## 2. 持久层：sqlite v4 → v5

- [x] 2.1 `src/host/spec.ts`：`chat_bindings` 增 `kind`（缺省 workspace）、
      `qaChildSessionId` / `qaParentSessionId` / `qaInvalidatedAt`；`tasks` 增
      qa-child 形态所需 sourceKind `qa-chat`；domain 版本升至 5
- [x] 2.2 `src/host/migrate.ts`：v4 → v5 ADDITIVE（不清表）；测试：v4 存量数据
      升级后完整可读且存量绑定行读作 `kind: workspace`，二次升级幂等
- [x] 2.3 `src/host/repository.ts`：qa 绑定 CRUD、按 chat_id 取 qa 绑定、失效
      标记；`invocation_channel` 复用不改；测试覆盖

## 3. 宿主依赖接入

- [x] 3.1 以可选依赖姿态接入 `subagents`（含 internal 子路径导入）、
      `sessionPersistence`、`sessionQuery`；缺失时探测为不可用并给出诊断，
      MUST NOT 阻断 Pet 其余能力加载（沿用 shellEnv 教训：`ctx.get`/`ctx.inject`
      回调，register 不进 effect）
- [x] 3.2 Q&A 动作可用性探测：fork provider 在场 + sessionPersistence + channel
      已绑定且 `botReady()` + 来源为未归档 session；测试覆盖各缺失分支的禁用
      原因
- [x] 3.3 Pet stopping 路径对相关会话 `sessions.flush`（design D9.2）；测试或
      真机验证记录

## 4. 建群事务（Q&A 动作 Host 端）

- [x] 4.1 `LarkClient` 增 `createChat`（`im +chat-create --as bot --users <本人>`），
      单点封装并测试（含失败形状）
- [x] 4.2 事务编排：fork child（预分配 childId）→ 建群 → 写 qa 绑定行；任一步
      失败整体回收（child 经 drain 释放 + Task 归档；群残留时错误信息含群名）；
      测试覆盖三个失败点的回收与「三步完成前该群按非 qa 路径处理」
- [x] 4.3 qa Task 建立：sourceKind `qa-chat`、executorSessionId 指向 child、
      label「答疑群 · <群名>」；归档 qa Task = 绑定失效且不销毁 child；测试覆盖
- [x] 4.4 管理面端点：POST qa 动作（loopback + same-origin、严格字段校验，沿用
      既有路由约束）；来源快照按既有 capture 流程验证 session 存在

## 5. 入站 qa 分支

- [x] 5.1 admission 按绑定行 kind 分流：qa 群豁免 sender allowlist，其余防线
      原样；测试：非 allowlist 群成员通过、同一人在非 qa chat 不放行、未 @bot
      不触发
- [x] 5.2 路由：qa 绑定直达 child，不参与 default 回退、不自动写回；失效绑定
      按 D6 处理；测试覆盖
- [x] 5.3 投递：渲染 qa prompt（提问者身份 + 只回本群 + 修改先确认）→ 写
      `invocation_channel` 行 → 打 OnIt → `queueHostSubagentPrompt` 入队；
      parent 非驻留时先 `agents.resume`；测试：投递接受不标记完成
- [x] 5.4 冷恢复路径：DSH 重启后首条 qa 消息触发 resume + coldResume；provider
      不可用时 fail closed + 指向性诊断；测试模拟 NOT_RESUMABLE 与 provider
      缺失分支

## 6. 终态观测与反馈

- [x] 6.1 订阅 `subagent/end`（scope-filtered 到相关 parent）驱动表情：删 OnIt
      → DONE/失败；按到达序匹配最早未 settled 的 `invocation_channel` 行，乱序
      时 fail-soft 放弃并记 Diagnostics；测试覆盖成功/失败/乱序
- [x] 6.2 源会话失效：resume 失败或归档时标记 `qaInvalidatedAt`、群内 bot 发
      有限次失效提示后静默；测试：提示次数上限、失效后消息不触发工作
- [x] 6.3 Diagnostics：qa 绑定状态、child 活性、待处理消息数单列

## 7. 客户端

- [x] 7.1 轮盘 Q&A 内置动作条目：仅会话来源可用、禁用态带原因、点击调管理面
      端点；与 Skill 能力共同计入容量；测试（wheel 单测沿用既有模式）
- [x] 7.2 动作入口明示「以最近完成的一轮为准」与建群后果（拉人即授信）
- [x] 7.3 设置页 qa 绑定展示：kind 标识、源会话、失效状态、归档入口；不提供
      改绑 workspace 操作
- [x] 7.4 面板 qa Task 呈现：形态标识、指向 child 会话的入口

## 8. 验证与收尾

- [x] 8.1 `cd packages/dsh-pet && npm run typecheck && npm test`（全量含新旧用例）
      —— host tsc 干净；vitest 796 passed，仅 2 项失败与 3 个文件加载失败为
      worktree 缺依赖导致的既有基线问题（改动前同样失败）
- [x] 8.2 仓库级 `npm test`（96 pass / 0 fail）、`npm run check:artifacts`
      （合规）、`node scripts/sync.mjs` 二次运行无新增漂移（3 项失败与基线一致，
      均为本 worktree 未装依赖所致）
- [x] 8.3 真机端到端（六条 Requirement 全部取得真机证据）：
      ① 建群三步事务通过，群名取源会话标题；② fork 种子带上父会话完成 turn，
      child 可复述完整实现过程；③ **D9.7 通过** —— child 工具面完整
      （bash/fs/search/subagent/job/ws…），未复现一期「声称 standard 实际 5 个
      工具」的装配坑，机制为 `applyChildComposition` 首行的
      `agentPresets.composeFrom`；④ 投递成 child 独立 turn，prompt 含提问者身份／
      chat_id／trigger id／只回本群与改动先确认条款；⑤ 表情 OnIt→DONE 由
      `subagent/end` 驱动，先删 OnIt 再打终态、无堆叠；⑥ **准入豁免真机成立**
      —— 非 allowlist 的 `ou_1050bd76…`（由所有者拉入）@bot 后产生投递记录
      `qa-66d430eb-…`，而 `allowOpenIds` 全程未变，证明放行来自 `kind=qa` 绑定
      行且不外溢。出站回复 `reply_to` 正确、`sender_type=app`、系统未代发。
      额外收获：库中两条二期1 存量绑定行 `kind` 缺失仍正常读取，真机确证
      v4→v5 默认值迁移对存量无破坏（覆盖 2.2 的意图）。
      **遗留**：GUI 私聊不出站一项待界面确认；发现 child cwd 缺陷见 8.9。
- [ ] 8.4 真机重启演练：DSH 重启后群消息触发 coldResume 且上下文完整
- [ ] 8.5 真机失效演练：归档源会话后群消息收到一次失效提示，后续静默
- [ ] 8.6 记录 `+chat-create` 的群主/解散行为（design Open Question，仅记录）
- [x] 8.7 更新 `dsh.yaml` dsh-pet 条目 note 与 `packages/dsh-pet/README.md`；
      `spike/` 已加入 `.gitignore`（结论已进 design.md D9，脚本与原始输出不入
      版本控制）
- [x] 8.8 `openspec validate pet-qa-group --strict` 通过；复核 diff 无范围蔓延
      （不触碰非 qa 入站链路、send-cr/ws skill、provider 凭据路径）

## 9. 真机验收发现的缺陷

- [x] 9.1 **child 落在错误的工作目录**。真机 child header：
      `cwd=/Users/prgrmrwy/opensource/ohmydsh`（主 checkout），而父会话实际工作在
      `.worktrees/pet-2`。
      根因（实测澄清）：**fork 没有出错**——父会话 header 的 `cwd` 本来就是仓库根，
      child 忠实继承了它。Worktree Session 是**有意**把 `header.cwd` 留在仓库根、
      把受管执行根另存于绑定状态（见 `worktree-adapter.ts` 开头的不变量：Pet MUST
      NOT 从 `cwd` 推断执行根）。父会话靠「绑定 + 每次显式 workdir」自我约束，而
      child **没有继承那层绑定**，于是它 cwd 的字面值（= 主 checkout）就成了它真实
      的工作目录。一句话：父受管，子裸奔。
      后果三条，第三条最严重：① child 看不到 skill 目录（`skill-filesystem` 按
      `findProjectRoot(cwd)` 扫，落到主 checkout 的 `.agents/skills/`）；② `ws`
      面对的是主 checkout 而非任务分支；③ **child 若执行写操作会写进主 checkout**
      ——正是 AGENTS.md 明令禁止当作工作区编辑的位置。目前未爆是因为群友只问了
      只读问题。
      修法（已实施）：`startContinuable` 不接受 cwd 覆盖（meta 由
      `childSessionMeta(parent)` 决定），且父会话自身的 worktree 规则本就是
      runtime context 而非强制沙箱——故采用同一机制，不为 child 发明更弱的保证：
      建群时经既有 Worktree Session 契约解析执行根（**绝不从 cwd 推断**），写入
      seed prompt 并持久化到绑定行（`qaExecutionRoot`/`qaBranch`/
      `qaRepositoryRoot`）；每条群消息的 prompt 重述一次（只说一遍的约束会随对话
      增长淡出注意力，而这条决定改动落在任务分支还是主 checkout）；源会话未绑定
      worktree 时不虚构约束。schema 仅加三个可选字段，仍为加性。
      新增 5 个回归测试（执行根进 seed、持久化到绑定行、每条消息重述、未绑定时
      不虚构）。
      **真机复验通过**：新建群绑定行三字段齐全（execRoot=`…/.worktrees/pet-2`、
      branch=`ws/pet-2`、repoRoot=仓库根），与修复前那条（三字段全缺）恰成对照；
      seed 与提问 prompt 均含「### 你的工作目录」小节。
      ⚠ **措辞必须准确**：修的是「child 是否知道该去哪干活」，**不是 cwd 被纠正**。
      child 实测对照：不传 workdir 时 `pwd` = 主 checkout 且分支为 `main`；显式传
      workdir 才落在 `.worktrees/pet-2` / `ws/pet-2`。残留风险（某轮遗漏 workdir
      即静默落在主 checkout，只读无害、写操作污染主 checkout）已作为独立
      Requirement 写入 `specs/pet-qa-group/spec.md`，不以「已修复」掩盖。
