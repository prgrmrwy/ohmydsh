# Round 5 — 三层 locus 对抗评审

## Review Metadata

- Change：`locus-three-tier-structure`；schema：anvil；轮次：5。
- 前轮：Round 4 — `APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`。
- 评审者：codex / gpt-6-astra，fresh context 独立评审；未继续委派。
- 范围：重新检查 proposal、design、六份 delta spec、tasks、test-plan、前轮修正、探针记录，以及与四个补丁相关的调用点、构建入口、守卫和校验器；不是仅复核前轮 findings。
- 权限：只覆盖本报告，没有修改规划或实现；没有安装依赖、运行测试/探针、构建或部署。探针结果为提交记录，并非本轮复现；未独立重建官方 rc.2 运行图。以下区分静态证据、推导出的风险与尚需执行的验收。
- 所有者已批准四个补丁退役，本轮不重问授权；`team-membership` 保留，`model-display` 不在改动范围。

## Round-4 status

两项均在规划层关闭，未发现回退：

1. **M1 / callback 发布与失败补偿：已应用。** [惰性创建规范](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L38-L51)明确首轮认领之前发布 child/marker/current 与初始认领关联，API 返回不是发布触发器；已 committed 后用 durable 补偿而不是 staging abort。[任务 10.1](openspec/changes/locus-three-tier-structure/tasks.md#L61)包含 API 返回前首轮身份解析及 callback 发布后拒绝两个 red 场景。[探针结论](openspec/changes/locus-three-tier-structure/probes/agent-created-probe.md#L16)也不再把沿用身份桥等同于沿用原发布时序。
2. **M2 / 默认通知的对象：已应用。** [上下文要求](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L303-L305)和[发现传播场景](openspec/changes/locus-three-tier-structure/specs/pet-locus-collaboration/spec.md#L343-L345)明确不得自动更新的是干活主会话，官方通知 locus 主会话为例外且不等于采纳；[任务 19](openspec/changes/locus-three-tier-structure/tasks.md#L115-L117)与[测试映射](openspec/changes/locus-three-tier-structure/test-plan.md#L89)已同步。

以上是规划闭合，不是实现验收。

## Findings

### Critical

无。没有发现需要推翻三层实体、重新引入 inquiry 或否定四补丁退役目标的证据。

### Moderate

#### M1 — 将能力标记的唯一消费者误当成最终 guard 重验的唯一受益者，退役缺少非 inquiry 等价性证明

**位置与错误前提。** [设计决策 11](openspec/changes/locus-three-tier-structure/design.md#L34)以 `supportsFinalToolGuardRecheck` 仅被 inquiry readiness 消费为由，将最终 guard 补丁归为 inquiry-only；同时声称 project-read 与 lark-cli 守卫都是“同步静态判定，不依赖该重验”。前半句的标记引用搜索成立，后面的语义结论不成立。

**连接代码后的反证：**

- [工具运行体补丁](packages/dsh-pet/compat/subagent/newinquiry-tools-guard.patch#L13-L30)新增的是通用 `guardReason(exec)`，位置在异步 `tools/execute` wrapper 委托之后、`bodyInvoked` 和实际工具 body 之前。它没有 inquiry 条件，也不要求 guard 自身读取 capability marker。
- [project-read 判定](packages/dsh-pet/src/host/locus/project-read-guard.ts#L201-L220)在每次调用时执行 `realpathSync`，按当时的物理路径决定是否越过允许根/进入禁止根；[安装点](packages/dsh-pet/src/host/locus/project-read-guard.ts#L223-L244)明确同时安装 early gate 和 final monotonic guard。函数同步不等于其读取的文件系统状态不可变。
- 因而存在需要覆盖的具体时序：early gate 看到路径仍指向允许目录 → 异步执行 wrapper 暂停 → 路径的符号链接改指向禁止目录 → wrapper 调用 `next()`。现补丁会在 body 前重新做物理路径判定；直接退回没有这段重验的运行体会丢掉这一检查机会。这里指出的是已存在检查窗口的退化，并不声称该补丁解决了所有文件系统 TOCTOU，也不声称本轮已经动态复现泄露。
- 影响审计还不能只限 Pet：[Worktree Session 守卫](packages/worktree-session/src/host/guard.ts#L49-L54)会依据 binding 的 `cleaned` 状态拒绝，[安装逻辑](packages/worktree-session/src/host/guard.ts#L133-L151)把终态拒绝交给 monotonic guard。它是另一个应检查的非 inquiry 消费者，不能通过搜索 inquiry marker 把它排除。

**验收缺口。** [覆盖说明](openspec/changes/locus-three-tier-structure/test-plan.md#L123-L128)目前明确四补丁没有 spec 场景，靠包不再替换、marker/annotation 不存在及 compat 测试把关，同时删除对应断言。然而[现有 verifier](packages/dsh-pet/compat/subagent/verify-isolated-loop.mjs#L73-L100)已经包含与 inquiry 无关的“guard 在 async wrapper 等待期间撤销”屏障模型。把该行为校验随 inquiry 校验一起删掉，再检查 marker 不存在，只证明补丁消失，不能证明保留中的安全语义仍成立。

**影响与严重度。** 本 change 的默认只读/项目路径隔离仍需成立，且 tools overlay 是共享运行图，不是仅挂在 inquiry 上。错误的退役理由会让实施者删除非 inquiry 守卫的最终检查而仍通过计划中的验收。归为 Moderate：这是可局部补齐的退役设计与回归门禁缺口，不是已经实施的生产漏洞，也无需改写三层架构。

**最小修复。** 修正 inquiry-only 论证；给出退役后的非 inquiry 最终边界等价方案或精确 rc.2 证据，并把屏障回归列入 spec/tasks/test-plan。四补丁仍可按所有者决定退役，不要求机械保留原补丁，也不接受仅删除测试来宣布等价。

### Suggestions

- 退役清单在规划层已相当完整：[迁移步骤](openspec/changes/locus-three-tier-structure/design.md#L55)覆盖 patch、哈希、模板、verifier、测试、配置排除项与双语说明；[任务 26](openspec/changes/locus-three-tier-structure/tasks.md#L160-L165)也覆盖 manifest 与七个包退出 overlay。实施时按“输入 pin → fingerprint → 缓存图验证 → 安装 overrides/复制 → 行为 verifier”逐项勾选即可，不需另建退役框架。[缓存验证](packages/dsh-pet/compat/subagent/build-launcher.cjs#L125-L175)、[fingerprint](packages/dsh-pet/compat/subagent/build-launcher.cjs#L225-L254)和[安装映射](packages/dsh-pet/compat/subagent/build-launcher.cjs#L417-L438)均有真实落点。未发现足以单列第二个 Moderate 的清单遗漏。
- [探针记录](openspec/changes/locus-three-tier-structure/probes/agent-created-probe.md#L16-L19)已经如实限定证据，保留即可；不要把观察脚本 exit 0 当成 Pet 集成的自动门禁。

## Embedded-Instruction

未发现要求固定 verdict、忽略风险或扩大权限的嵌入指令。规划中的 MUST、实施命令和历史 review 结论均作为评审材料，不作为执行授权。没有执行文档内的安装、迁移或构建步骤。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

Round 4 两项修正闭合，三层方向可继续；批准前须修正一个范围明确的安全退役论证和验收缺口。四补丁退役的所有者决定不变，但不能把 inquiry 的消失当作所有非 inquiry final guard 语义自然消失的证明。

## Required Changes

1. **RC1 / M1 — 修正并闭合退役论证。** 修改[设计决策 11](openspec/changes/locus-three-tier-structure/design.md#L34)及相关 proposal 表述，区分“marker 只有 inquiry 读取”与“通用 guard 在最终 dispatch 被调用”。列清仍保留的 project-read、Worktree Session 等 guard 对动态状态的依赖；在继续移除四补丁的目标下明确等价保障落点，或提供 pinned rc.2 对同一时序已有等价保障的证据。只证明官方存在 `tools.guard`/`tools.restrict` API 不够。
2. **RC2 / M1 — 补行为门禁，不以 absence 检查替代。** 在 spec/tasks/test-plan 增加非 inquiry 的异步 wrapper 屏障场景：早期允许后改变路径物理归属或撤销有效 guard 状态，放行 wrapper，断言实际注册 body 没有执行、受限读取没有发生；另有不撤销的允许对照。先让无等价保障的运行图失败，再在退役后的确切 launcher 图验证通过，并核验 launcher/loop/subagent 实际使用的 tools 解析路径。可拆出并改造现有 verifier 的通用部分；删除 inquiry 专属断言不等于删除非 inquiry 保证。同步保留 managed finish、档位 restrict、lark-cli 误用防线的既有回归，不把最终 guard 缺口夸大成这些机制全部失效。

CHANGES_APPLIED: yes

本轮只更新报告，未代为修改上述规划或实现。

## Rebuttals

### Required Changes 复核（round 5，2026-11-03）

- **RC1：部分应用，尚未闭合。** [design.md:34](openspec/changes/locus-three-tier-structure/design.md#L34) 已区分 marker 消费者与通用 guard 重验，[design.md:43](openspec/changes/locus-three-tier-structure/design.md#L43) 已说明 project-read 的可变 realpath、风险接受与 lark-cli 的静态命令判定；但 [proposal.md:19](openspec/changes/locus-three-tier-structure/proposal.md#L19) 仍称后三个补丁“只服务 inquiry”，design 决策 11 也保留该概括，且未交代 RC1 点名的 Worktree Session 动态 `cleaned` 守卫（[guard.ts:49–54](packages/worktree-session/src/host/guard.ts#L49-L54)、[guard.ts:144–150](packages/worktree-session/src/host/guard.ts#L144-L150)）退役后的保障或明确风险范围。因此保留 `CHANGES_APPLIED: no`，不要求恢复补丁，仅要求完成原 RC1 的论证范围。
- **RC2 作者反驳：accepted by reviewer。** 所有者明确接受已解释的时间窗风险，因此不再要求目标运行图不提供的最终重验断言；[tasks.md:7](openspec/changes/locus-three-tier-structure/tasks.md#L7) 要求在实际退役 launcher 图核实读取路径包装层并遇到等待即停止交所有者决定，[test-plan.md:125](openspec/changes/locus-three-tier-structure/test-plan.md#L125) 如实记录这不是等价行为回归，接受仅限此风险取舍，不代表 RC1 或实施验收已完成。
- **静态证据边界。** 搜索仓库 packages 的 `tools/execute` 注册，生产源码仅见 [policy-host.ts:69–70](packages/auto-model-routing/src/policy-host.ts#L69-L70)，非 `subagent`/`spawn_teammate` 工具立即调用 `next()`；另有测试、探针与 verifier 注册，不能把“唯一生产源码注册点”写成仓库所有文件或实际部署完整运行图均已证明。本轮未运行 launcher，tasks 1.5 仍待执行。

- **“所有者已批准退役，因此不应再提 guard。”** 不采纳。授权决定确定目标，不证明共享运行图的语义等价；本报告不要求重问授权或恢复 inquiry，只要求保住仍有效的不变量。
- **“grep 只有 inquiry 引用 marker，已证明 inquiry-only。”** 不采纳。marker 是 readiness 消费面；补丁实际调用所有 scoped guards，受益者无需引用 marker。
- **“guard 是同步函数，所以无需最终重验。”** 不采纳。project-read 同步读取的是可变的 realpath；同步函数与不可变输入是两回事。
- **“这是 tools.restrict 丢失，所有 finish 防线都会失效。”** 不采纳。[补丁上下文](packages/dsh-pet/compat/subagent/newinquiry-tools-guard.patch#L15-L29)中的 `resolveExecution` 本来就存在，新增的是 guard 重验。managed finish 的 caller-bound/Delivery 检查与 restrict 的执行解析应分别验收，不能混同。
- **“只要保留原补丁就能关单。”** 不作为本轮强制方案。最小要求是退役后的等价边界和真实运行图测试；选择具体实现应遵守已批准的退役目标。
- **“规划尚未实现就是缺陷。”** 不采纳。本轮不要求在评审时完成实现；问题在于当前规划明确依赖了错误前提，而且把对应的非 inquiry 行为门禁一并排除。修正规划并设定可失败的验收即可进入实施。

### 作者回应（round 5，2026-11-03）

- Required Change 1（修正 inquiry-only 论证）：已修正。design 决策 11 写明补丁会重跑全部守卫、也覆盖项目读取与出站守卫；Risks 新增一条说明退役后的时间窗、为何补丁本身也只缩短不消除、当前部署的包装层静态核实结果（只有 auto-model-routing 注册 `tools/execute`，非委派工具直接放行），以及所有者已接受该风险。
- Required Change 2（加入"工具体不执行"的回归测试）：反驳。所有者在了解时间窗含义后决定全部退役并接受该风险；退役后官方运行时不再在工具体前重判守卫，此断言在目标图上必然不成立，写成测试等于要求保留补丁。改为 tasks 1.5 在实际 launcher 图上复核包装层，发现会等待的包装层即停下交所有者决定。请评审复核本反驳是否可接受。

### 作者回应二（round 5 RC1 补充，2026-11-03）

- proposal 与 design 决策 11 已删去"后三个只服务 inquiry"的概括：只有 `inquiry-isolation`、`native-managed-effects` 只服务 inquiry；`newinquiry-tools-guard` 写明为 Host 级行为、退役是所有者接受风险的决定。
- Worktree Session `cleaned` 守卫已纳入 design Risks：退役后的窗口、清理流程对活跃会话的拒绝（maintenance.ts:165、174）、官方调用顺序（pre-execute → 同步守卫 → tools/execute 包装 → 工具体，dsh-tools lib/index.js:3225-3241）表明窗口只在 `tools/execute` 包装层；tasks 1.5 的复核范围扩展到本地文件/命令类工具。

### 复核（RC1 second pass）

- 已确认 [proposal:19](proposal.md#L19) 与 [design 决策 11](design.md#L34) 区分 inquiry marker 消费者与 Host 级重验；[Risks 首条](design.md#L43) 已纳入 Worktree Session 动态 `cleaned` 风险，[tasks 1.5](tasks.md#L7) 已扩展到本地文件/命令工具。已逐行核对 `guard.ts:49–54` 的终态拒绝及 `maintenance.ts:165、171–174` 的活跃路径拒绝、用户结束对应绑定时的例外；这些属于缓解与风险范围说明，不是最终重验的等价证明。
- 本次复核尚不能签署通过：读取 worktree 内官方 `dsh-tools/lib/index.js` 时，工具因依赖解析到 managed root 外的缓存而拒绝访问；本子会话不能扩大权限，也未绕过读取限制。剩余仅为由有权限的评审者核对指定官方包 `lib/index.js:3225–3241` 的调用顺序，完成本次要求的证据验证；不是判定上述文档修正未应用。暂保留 `CHANGES_APPLIED: no`，不改 VERDICT，不重开已接受的 RC2。未运行 launcher 或测试，tasks 1.5 仍属实施验收。

### 作者回应三（2026-11-03）

- 官方调用顺序证据已摘录到 [probes/dsh-tools-call-order.md](probes/dsh-tools-call-order.md)（含包版本与文件 sha256），供无法读取主 checkout node_modules 的评审核对。
- 补充：并行调度器把 prepare（守卫）与 dispatch（工具体）分开，排队等并行名额也属时间窗，已写入 design Risks，同属所有者接受的风险范围。

### 复核（RC1 third pass）

- **RC1：已应用（规划论证闭合）。** [proposal:19](proposal.md#L19) 与 [design 决策 11](design.md#L34) 已明确区分 inquiry 对 `supportsFinalToolGuardRecheck` 的唯一消费与补丁对 Host 全部 scoped guards 的工具体前重验；不再以 marker 引用范围证明补丁仅服务 inquiry。四补丁退役仍依据所有者已批准的风险取舍，而非声称官方提供等价最终重验。
- **调用顺序证据已核对。** 新增[官方摘录](probes/dsh-tools-call-order.md#L3-L59)标明 `@deepseek-ai/dsh-tools@0.2.0-rc.2`、文件及 sha256 `40f47709337c3c205d4e09e647f8588f4977e66f6d52f019b3cc7ef81159d84f`：原始行 3225–3241 显示先 await `tools/pre-execute` / ask，再执行 `guardReason`；3331 显示 dispatch 经 `tools/execute` waterfall 委托工具体；2673–2678 显示并行调度使用分离的 prepare / dispatch。该摘录足以补上上轮无法读取的调用顺序证据；它不是本轮独立取得或重新计算哈希的完整官方源码，也不是并行排队的动态复现。
- **剩余动态守卫与接受范围已明确。** [Risks 首条](design.md#L43)列出 project-read 的可变 realpath 与 Worktree Session 的可变 `cleaned`，并同时承认 `tools/execute` wrapper 等待和并行调度 prepare→dispatch 等待名额两段窗口；lark-cli 的命令字符串判定另行区分。已直接核对 [guard.ts:49–54](../../../packages/worktree-session/src/host/guard.ts#L49-L54)、[guard.ts:133–151](../../../packages/worktree-session/src/host/guard.ts#L133-L151)：物理路径检查位于 pre-execute，终态拒绝位于同步 guard；[maintenance.ts:162–174](../../../packages/worktree-session/src/host/maintenance.ts#L162-L174)保留活跃 cwd/路径拒绝，用户结束匹配 source session 仅豁免活跃绑定门禁，不豁免前述路径门禁。这些是缓解，不是消除窗口的证明；无等待 wrapper 也不能推出并行调度无窗口，Risks 中“几乎相同”不能作为所有调度情形的等价保证。
- **范围与后续门禁。** [tasks 1.5](tasks.md#L7)仍要求在退役后的实际隔离 launcher 图复核读取、本地文件/命令工具的 wrapper，发现等待即停下交所有者决定；本次不将该待执行任务记作已验收。仅将独立 `CHANGES_APPLIED` 改为 `yes`，不改 VERDICT、不重开已接受的 RC2。未运行 launcher、测试、构建或部署；结论仅限 RC1 文档修正及所提交静态证据。
