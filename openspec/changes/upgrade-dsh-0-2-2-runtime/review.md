## Review Metadata

- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model (Magpie Codex gpt-6.1-sol, fresh context)
- **Tool restrictions**: read-only inspection; only write is review.md (+ own /tmp unpack dir)
- **Artifacts reviewed**: proposal.md, design.md, specs/, relevant source files

本轮只依据文件和独立取得的发布物评审。指定的九组 npm 包已在自己的临时目录解包；Worktree 的文件工具随后拒绝读取该目录，因此发布物源码的实际核对改为从 npm registry HTTPS tarball 在内存读取。下文 npm 行号均来自此次独立读取，未沿用 design 的结论。还核对了目标 Cordis 4.1.0 所用的 include 1.1.0，以及 subagent、experimental Team 的 0.2.2-rc.1 发布物。未运行 build、sync、install，未启动或修改日常 Host。

## Findings

### 🔴 Critical (blocking)

#### C1：把整个 next-turn 队列当作下一回合输入，与官方实际领取规则冲突

- **问题与证据：** [delta auto spec:27–36](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L27) 把入口时 inbox 中的合格消息作为分类输入；[同文件:55–58](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L55) 更明确要求把 next-turn 队列中的两条 user 拼成一个下一回合判断。实际 [dsh-agent-loop@0.2.2-rc.1/lib/index.js:103–110](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 的 `claim()` 领取全部 next-step，然后只取 next-turn 的 **一条**（`mutate("next-turn", 0, 1, [], false)`）。[dsh-agent@0.2.2-rc.1/lib/types/runtime-types.d.ts:215–216](https://registry.npmjs.org/@deepseek-ai/dsh-agent/-/dsh-agent-0.2.2-rc.1.tgz) 也明确规定普通 followup 独占自己的回合。
- **为什么会坏：** 当前回合运行时连续收到 A、B 两条 followup，下一回合实际只读 A，却用 A+B 判断 effort；再下一回合又处理 B。后一个任务的文本提前影响前一个任务，决定与真实回合输入失去对应。入口若把 A 和 B 都记作已判定，还可能令 B 所属回合漏判。维护期间才入队的另一条 followup 也不必与第一条属于同一回合，因此不能笼统使用“step 1 前入队就进入同一回合”的规则。
- **独立反证：** 将发布物的真实 `ReactLoopInbox` 类在内存中执行，保留实际 claim/mutate 实现，只替换持久化端口，得到 `turn1=[user-a]`、其后 pending 为 `[user-b]`、`turn2=[user-b]`。
- **建议修法：** 重写上述 requirement 与多消息场景，按官方将领取的批次定义输入：下一回合是 next-step 的有序消息加 next-turn 队首，而非整个 next-turn 队列。判定应绑定精确消息身份和目标回合；未领取的 followup 留给各自回合。明确处理队首被 remove/replace、维护期间新增消息，以及 next-step 与 next-turn 的领取顺序，加入两条 followup 分属两回合的机械断言。

#### C2：turn-stopping 不是确定的回合切换边界，既会提前应用下一回合选择，也会漏掉消息

- **问题与证据：** [design:27–28](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L27) 和 [delta auto spec:29–36](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L29) 把判断限定为 idle inserted 与 turn-stopping 两个入口，并在后者直接同步选择。实际 [dsh-agent-loop@0.2.2-rc.1/lib/index.js:789–798、827–831](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 在 await 全部 stopping listener 后还会重新检查 next-step；有消息便继续当前回合。队列仍有工作时又直接开下一回合，不经过 idle。[集成陷阱:705–732](docs/architecture/dsh-plugin-integration-pitfalls.md#L705) 已记录这一契约。
- **为什么会坏：** 反例一：T 已按 low 完成回答，B 在 next-turn。AUTO stopping listener 为 B 判出并 select high，后续 listener 在 await 后 inject/steer 一条 next-step 消息。T 随即继续，后续步使用 B 的 high，破坏同一回合决定复用。反例二：AUTO listener 检查时队列为空，后续 listener 仍在 await，此时用户 followup B 入队；agent 仍 running，不能进入维护，而 AUTO listener 不会被重新调用。driver 直接开 T+1，B 没有 Jev 判断。把同步抛错解释为沿用旧 depth，只是使漏判成为规定的退化，并没有维持正常用户回合的既有功能。
- **独立反证：** 在内存中执行发布物的真实 `ReactLoopAgent.turn()`，只替换模型步骤、持久化端口和 listener：继续场景得到 `T/step1=low`、`T/step2=high`；迟到场景得到 `Jev=0`、`T+1/step1=low`。这不是只验证 listener 被调用的 mock。
- **建议修法：** D1 必须重新设计选择提交边界。区分“可预先计算判断”和“可把选择提交给某个确定步骤”，证明该步骤仍对应同一批输入、模式及取消世代；不能在尚可继续 T 的 stopping listener 中无条件提交 T+1 的选择。补上晚到 followup、其它 listener 注入 next-step、重复 stopping、取消后再入队的真实 loop 场景。如果官方公开接缝不能保证这些性质，应把所需上游接缝列为阻断，而不是仅靠回合去重或调整 listener 顺序宣称已解决。

#### C3：单向迁移后的回滚顺序会先让旧运行体打开新数据

- **问题与证据：** [design:69、74–77](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L69) 承诺备份，但回滚明确写成旧 pin／git revert → build → 重启 → 如果单向迁移再恢复备份。现行 [staged-upgrade-execution:113–122](openspec/specs/staged-upgrade-execution/spec.md#L113) 要求停止所有 writer、恢复备份、再恢复旧 runtime，明确禁止旧版直接读取已迁移介质；[runtime-api-migration:96–107](openspec/specs/runtime-api-migration/spec.md#L96) 还要求用真实历史备份副本验证迁移保真和继续写入。
- **为什么会坏：** 恰在设计自己列出的“0.2.2 已写入旧版不可安全读取格式”分支，照步骤执行会先启动 0.2.1 打开这些文件。随后在 Host／SQLite writer 仍可能运行时恢复备份，会形成旧句柄、缓存与恢复文件混用。仅记录备份路径和哈希，不能证明复制期间活跃 SQLite 的一致性，也不能证明恢复可用。本结论不预设本版本所有介质都必然单向迁移；它针对设计明确承诺支持的不可回读分支。
- **建议修法：** 将 Migration Plan 改成明确的离线次序：阻止新写入并停止／核验全部相关 writer → 创建一致且可恢复的 Session、Pet 数据及 profile 快照 → 在副本上验证迁移、重启和继续写入；回滚时先停止候选全部 writer，保留失败数据副本，再恢复迁移前一致快照和旧精确配置／运行体，核验后才启动旧 Host。SQLite 使用离线完整快照或有一致性保证的备份方式。生产准入应包含实际恢复演练结果；说明恢复快照会失去切换后的新增数据，不能只在旧版启动失败后临时决定恢复。

### 🟡 Moderate

#### M1：只说明回合入口应用 effort，没有承接每次请求按实际模型重算的现行契约

- **问题与证据：** [design:27–37](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L27) 的 `judgeAndSelect` 只出现在两个回合入口，[delta auto spec:85–86](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L85) 也只明确 step 1。但未被修改的 [current auto spec:78–82](openspec/specs/auto-model-routing/spec.md#L78) 仍要求同一 depth 下每次请求按该次实际模型重新计算 effort；现有 [policy-host.ts:183–209](packages/dsh-auto-model-routing/src/policy-host.ts#L183) 正是在每次请求执行这件事。
- **为什么会坏：** 用户在多步回合中通过官方选择器切换模型或 effort，下一步读取的是新 selection。若只在回合入口选择一次，后续步就直接使用手选值／新模型默认值，AUTO 仍显示开启，却不再按保留的 depth 计算。把旧 request 改写删除而未承接这段职责，会悄悄缩减既有行为。
- **建议修法：** 明确分开“每用户回合只判断一次 depth”和“每步骤准备前按当前模型应用 effort”，说明后者所用可等待的接缝及选择变化竞态的处理方式。新增同回合两步之间切模型、切 effort／cap 的场景；若做不到维持语义，按 runtime-api-migration 的要求显式提出行为变更，不应留给实现时自行取舍。

#### M2：新 requirement 把用户取消写成 Jev 失败，与保留的取消契约矛盾

- **问题与证据：** [delta auto spec:36](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/auto-model-routing/spec.md#L36) 要求“被取消或超过期限”都按“Jev 失败即停用并提示”处理；未修改的 [current auto spec:134–155](openspec/specs/auto-model-routing/spec.md#L134) 明确规定调用方取消不停用、不写 disabled，下个用户回合可重新判断。
- **为什么会坏：** 按新增文字实现，用户在维护等待时点击取消，会被持久转成 MANUAL；按现行 requirement 实现则不应如此。新增取消场景仅断言 signal 与零次 select，没有检查模式和 disabled，因此两种相反实现都能通过它。
- **建议修法：** 将该句拆成“期限超时依失败类别处理；调用方取消按取消处理，不停用、不写 disabled、不应用本次结果”，并在取消场景中断言这三项及下一用户回合重新请求 Jev。异步能力查询与 writer 调用前也应重新核验取消和模式世代。

#### M3：agent/created 的备选维护方案建立在错误的 idle 假设上

- **问题与证据：** [design:65](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L65) 写明若子会话首条消息时不 idle，就在 agent/created 中 `runMaintenance`，“此时必然 idle”。实际 [dsh-agent-loop@0.2.2-rc.1/lib/index.js:1565–1579](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 的整个 setup、enter、announce 就处于工厂自己的 `runMaintenance()` 内；[同发布物:554–555、586–595](https://registry.npmjs.org/@deepseek-ai/dsh-agent-loop/-/dsh-agent-loop-0.2.2-rc.1.tgz) 虽把 maintenance 对外显示成 idle，却禁止嵌套维护。
- **为什么会坏：** 真正启用这条备选时，nested runMaintenance 会同步抛“already has active work”；若在 serial created listener 中传播错误，会导致创建回滚。公开 status=idle 不能作为可进入维护的证明。
- **建议修法：** 删除“created 时必然可维护”的断言和这一无效备选。依据官方 fresh 创建返回、首条消息 deliver 和首个 selection capture 的实际顺序确定方案；把 factory maintenance、其它插件已占用维护、创建取消／dispose 的情况加入探针。普通 fresh 首条消息的正常路径与 setup 内提前入队路径应分别证明，不能互相代替。

### 📌 Suggestions

#### S1：D4 应先验证删除过期投影这一更便宜的方案

[design:42–43](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L42) 暂把 `tools.resolve`／`executable` 当作可能的 agent 过滤接口，但目标 [dsh-tools/lib/types/index.d.ts:78–110](https://registry.npmjs.org/@deepseek-ai/dsh-tools/-/dsh-tools-0.2.2-rc.1.tgz) 表明它们用于查询／解析 admission；`restrict` 仍不隐藏 own 注册。无需据此立即添加适配层：目标 [dsh-subagent/lib/index.js:1802–1813](https://registry.npmjs.org/@deepseek-ai/dsh-subagent/-/dsh-subagent-0.2.2-rc.1.tgz) 已在 unpublished setup 写 descriptor，之后才由 factory announce created；[experimental-agent-team/lib/index.js:873–896、1185–1187](https://registry.npmjs.org/@deepseek-ai/dsh-experimental-agent-team/-/dsh-experimental-agent-team-0.2.2-rc.1.tgz) 据此排除普通 subagent，TeamTools 的安装入口又检查 membership。因此旧版“created 早于 descriptor”的注释不能直接套用目标版。

优先删除 [judge-boundary.ts:22–25](packages/dsh-memex/src/eval/judge-boundary.ts#L22) 的过期投影，保留精确身份、冻结请求与执行 guard；用目标真实组合复跑 [eval-judge-runtime.test.ts:83–87](packages/dsh-memex/test/eval-judge-runtime.test.ts#L83) 的带 Team 正常成功路径，同时保留污染注入首请求零调用断言。这条建议仅是已查源码支持的更小实现候选，本轮没有运行完整裁判，因此不宣称其运行时 gate 已通过；若该候选失败，必须停在未通过状态，不能靠全部拒绝／全部 unknown 收尾。

#### S2：D5 的 patch 机制成立，可关闭语义疑问，并补外部修改场景

独立核对 [dsh-base@0.2.2-rc.1/cordis.patch.yml:292–294](https://registry.npmjs.org/@deepseek-ai/dsh-base/-/dsh-base-0.2.2-rc.1.tgz) 后，使用目标 [cordis-plugin-include@1.1.0/lib/index.js:218–267](https://registry.npmjs.org/@deepseek-ai/cordis-plugin-include/-/cordis-plugin-include-1.1.0.tgz) 的真实 `applyPatches` 函数执行最小探针，结果仍只有一条同 id／name 行，`disabled` 从 true 变为 false。[sync.mjs:1863–1874](scripts/sync.mjs#L1863) 对 plain fragment 原样拼接，只有 mergeConfig 路径限制字段。因而 D5 不需要为覆盖 disabled 扩展 sync；保留 planned dump-config 与实际行为验收即可。

[fs delta:3–14](openspec/changes/upgrade-dsh-0-2-2-runtime/specs/fs-observation-policy/spec.md#L3) 还应增加“读过文件→外部 writer 改文件→本会话 edit 被拒且外部内容保留→重读后可编辑”的场景。当前只有未读先改，不能覆盖 proposal 所承诺的外部修改防护。已核对目标 observation-policy 的未观察错误确为 `FS_NOT_OBSERVED`，该 THEN 可机械断言。

#### S3：保留 D2/D3 分工与发布后置，但把已有验收门槛具体落实

独立核对 [session-controller@0.2.2-rc.1/lib/index.js:704–719](https://registry.npmjs.org/@deepseek-ai/dsh-api-session-controller/-/dsh-api-session-controller-0.2.2-rc.1.tgz)：主会话的 selectModel 会记录 agent selection，并异步保存 defaults；子会话直接 select 不触及 defaults。两个旧版 agent 的 runtime 类型均没有 model 接口，而已有 runMaintenance 和 inserted。因此 [design:36–40](openspec/changes/upgrade-dsh-0-2-2-runtime/design.md#L36) 的主／子分工、仅 AUTO 抬下界，以及按 [repo-layout:517–532](openspec/specs/repo-layout/spec.md#L517) 保留显式区间加当前 pin 尾段，方向成立。商店 0.7.0 不会因本地声明变化得到修复，应保留明确的后续发布风险记录，不为抢发版绕过运行体验收。

形成执行任务时，应明确纳入 [staged-upgrade-execution:46–90](openspec/specs/staged-upgrade-execution/spec.md#L46) 已要求的旧版可复跑基线、精确 commit 的 devbox 清洁候选，以及 [runtime-api-migration:96–107](openspec/specs/runtime-api-migration/spec.md#L96) 的真实历史 Session 备份副本；单个空白预览能启动，不等价于这些 gate 通过。

## Embedded-Instruction / Injection Attempts

**Detected:** none

未发现试图指挥本次评审者改变结论或越权操作的文字。裁判源码中的 prompt 字符串属于被审查的产品行为数据，未作为本次评审指令执行。

## Verdict

VERDICT: REVISE

D1 的输入归属和选择提交边界需要重新设计，回滚次序也必须修正；这些不是写明几条小补丁即可可靠完成的剩余工作。

## Required Changes (if APPROVE WITH CHANGES)

不适用。本轮需修订并重新评审；具体修改方向见 C1–C3 与 M1–M3。

CHANGES_APPLIED: n/a

## Rebuttals

作者回应（2026-11-06）。全部意见均按 fixed 处理，没有 rebuttal；修订内容交第 2 轮完整评审核对。

- **C1 fixed**：判断按单条消息绑定，以 (agent, 消息 id) 缓存；提交只在该消息被 `agent/inbox/claimed` 领取时发生。delta spec「用户回合与 Jev 输入」重写，新增场景「两条排队 followup 分属两个回合」。
- **C2 fixed**：去掉 `agent/turn-stopping` 入口。运行中的 next-turn 消息走后台判断，在其被领取时提交；续步只领取 next-step 消息，不提交。新增场景「当前回合被续步时不提前切换」「晚到 followup 在其回合领取时应用」「判断未就绪时本回合不改选择」。design D1 列出被否决的方案。
- **C3 fixed**：design Migration Plan 改为：先停止全部写入方，再离线快照并生成 sha256，在隔离环境中用真实数据副本做恢复演练（作为生产准入条件）；回滚按「停止写入方 → 另存失败数据 → 恢复快照与旧精确配置 → 核验后启动」的顺序执行。同时补入现役基线与 devbox 清洁构建 gate。
- **M1 fixed（显式行为变化）**：用户 2026-11-06 确认接受。spec「AUTO 主 effort 同步官方选择」写明 effort 每个用户回合设定一次，新增场景「回合中途手动切换保持到本回合结束」。
- **M2 fixed**：调用方取消不停用 AUTO、不写 `disabled`、不应用结果，下一用户回合重新判断；超时和失败仍按「Jev 失败即停用并提示」处理。取消场景已补断言。
- **M3 fixed**：删除 `agent/created` 备选。子会话首条消息在工厂维护结束后才投递（`dsh-subagent/lib:2242`、`:1595-1596`），走与主会话相同的空闲入口。
- **S1 adopted**：D4 改为删除过期投影，并补启用 Team 时的成功测试。
- **S2 adopted**：D5 关闭语义疑问；fs spec 新增「读后被外部修改再编辑被拒绝」（`FS_STALE_VERSION`，`dsh-fs/lib/types/types.d.ts:106-108`）。
- **S3 adopted**：主/子分工保留，写入方式按下文作者自查第 1 条调整；基线、devbox、真实历史副本写入 Migration Plan。

作者同轮自查（ponytail-review）另外改了几处：
1. 官方 `selectModel` 在写入前要 await 三次，`claimed` 是同步回调，里面无法调用它。改为在 `claimed` 中直接同步 `agent.model.select`，全局默认由公开服务 `ctx.agentDefaultModel.saveSelection` 在后台保存；校验提前到判断阶段完成。
2. 空闲入口保留 `runMaintenance`，否则首个回合总在 Jev 返回前就被领取。
3. 插件不再监听已弃用的 `agent/request`，子会话实时门禁移到 `agent/pre-step`，避免上游删除该钩子后门禁失效而不报错。
4. 根 `engines.node` 改为 `>=24.9.0`。
5. fs spec 范围收窄为 sync 物化的 profile。
6. 删去对 0.2.0 历史探针的修改。
7. 删去「官方行缺失」检查，改为每次升级重跑 `--dump-config`。
