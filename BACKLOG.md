# Backlog · 功能待办池

随时想到的功能都记在这里。条目按状态分组,状态流转:`想法 → 讨论中 → 已设计 → 实施中 → 已完成 / 已放弃`(任意状态可加「(暂停)」标记)。优先级在条目内用 P0 / P1 / P2 标注。

## 条目格式

```markdown
### [ID] 一句话标题
- **状态**: 想法 / 讨论中 / 已设计 / 实施中 / 已完成 / 已放弃
- **优先级**: P0 / P1 / P2(可选)
- **背景 / 动机**: 为什么要做
- **要点**: 方案要点、约束、开放问题
- **更新**: YYYY-MM-DD 一句话进展
```

---

## 讨论中

### [B045] Locus 群回复采用结论先行的渐进披露
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: 复盘中的 P1-5 与 P2-1 实质是同一问题：群内答复需要足够上下文以便接续协作，但把完整分析、历史和旁支一次性铺开会淹没结论、增加阅读成本。
- **要点**:
  - 默认第一句给出一句话结论或当前状态，然后只附完成判断所必需的证据、上下文与下一步。
  - 更多细节按需展开，或放在话题/后续回复中；不采用会截断关键事实的固定字符上限。
  - 精简只改变表达层级，不得省略风险、失败状态、授权边界或需要用户决策的事项。
  - 应同时覆盖信息交换答复、工作受理回执、澄清问题与失败诊断，避免不同 prompt 各自形成互相冲突的长度规则。
- **更新**: 2026-09-18 将复盘中的 P1-5 与 P2-1 合并；当前 P0 change `pet-locus-delivery-safety-hardening` 仅记录相邻工作，不实施回复体例改动。

### [B037] Locus 独立 child 的按需检索须受 caller-bound 协作范围约束
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: 2026-09-14 空库实机验收中，独立 child 收到「你知道我们之前聊过什么吗？比如 B035、locus 迁移这些」后，虽正确证明了自己没有 fork 父历史，却在一个 turn 内执行 37 steps / 40 次工具调用（其中 31 次 bash）、输出 69,335 tokens、耗时约 17 分钟、成本约 $1.51；主动加载 `lark-im-live`，检索当前群、多个无关群、旧话题、全局飞书消息及所有者与 bot 的私聊。
- **实测关键事实**:
  - child 的 `request/header` 明确提供了 `send_message`、`pet_inquire`、`pet_collaborators`；它通过 `pet_context` 得到 caller-bound main `session-4629eb39`，并通过 `pet_collaborators` 看见该 parent，但实际 `send_message=0`、`pet_inquire=0`。
  - `identity.isSeeded=false`、`inheritedEventCount=0`，且 child 不知道 B035；这正向证明 `pet-locus-independent-child` 的 spawn 独立上下文生效。问题不在隔离，而在独立后如何补齐上下文。
  - 当前 prompt 只说「需要的资料请通过当前已授权的读取能力按需读取原始内容」，只在 execution root/resources/constraints 未确认时建议问父；未定义「先父/兄弟/当前 workspace，禁止无关群/私聊/全局 IM，范围内无结果即停止」的搜索顺序与硬边界。
- **要点**:
  - 默认顺序应是 caller-bound parent → 当前 locus 可达 siblings（若有且权限允许）→ 当前 session 对应 workspace/repository；范围内无结果就如实返回并向所有者索要线索。
  - 不得主动读取无关飞书群、与所有者的私聊、全局消息历史或其它 workspace；即便底层 skill/工具在权限层面可用，也不代表本次 locus 请求授权了跨域检索。
  - 需要判断约束应只靠 prompt，还是要增加工具级 scope：仅靠 prompt 可能被 `lark-im-live` 等 skill 的自主搜索指引覆盖；工具级限制更可靠，但要避免破坏用户明确要求跨群检索的合法场景。
  - 验收需使用会诱发历史补齐的真实问题，不能只用刻意自包含的问题把越界风险隐藏掉；同时普通链路测试应优先用自包含、可判定问题，避免无关成本噪声。
- **更新**: 2026-09-14 实机验收确认；完整调用证据在 session `session-7b41abe2-f878-4d5c-9cf0-a6b548219c1a` 的多帧 zstd 日志中，不提交 raw session evidence。

### [B036] 拉 bot / 建群不应有任何 locus 副作用，整棵树按首个 @ 构建
- **状态**: 已完成
- **优先级**: P2
- **背景 / 动机**: 2026-09-14 从空库端到端验证时实测：创建默认 Q&A 群的瞬间就产生了一个**空的** child session（`session-9f6ae48b`，801 字节，解压后仅 1 条 `session` 事件），此时群里还没有任何人 @ 过 bot。所有者预期是「子会话跟着 @ 创建或复用」，建群阶段不应存在子会话。
- **现状与根因**: 这是当前两阶段 provisioning 的设计，不是回归缺陷。`src/index.ts` 的 `idleChildProvisioning.create()` 在建群时调用 `adapter.createIdleChild()`（`host/locus/child.ts`），该路径刻意不投递初始 prompt——注释写明「No artificial initialization prompt is allowed: the first prompt will be the first real Delivery」——但确实提前占用了一个 child 身份。控制器随后 `commitProvisioning` 发布 active locus，首次真实 Delivery 再经 inbox 投递给这个已存在的 child。
- **影响面比首次观察更广（拉 bot 进存量群同样命中）**: `im.chat.member.bot.added_v1` → `botLifecycleInitializer.ensureAuthorizedChat()`（`src/index.ts:2413`）→ `locusProvisioningController.ensureGroup({ chatId })`，与答疑群共用同一条 provisioning 链，因此**把 bot 拉进任何存量群也会立刻产生 blank 子会话**。注意 `BotLifecycleInitializer` 的接口契约写的是「Ensure only the chat-level structure. Must not create a Delivery or queue work.」——当前实现确实没建 Delivery、没排队工作，但建了 child，与「only the chat-level structure」的意图存在张力。
- **两条入口的 main 来源不同，需分别验证**:
  - 答疑群（Pet 面板发起）：带 `parentSessionId`，复用**当前会话**作 main——已实测正确（11.8 MB 真实历史，非空）。
  - 拉 bot 进群：`ensureGroup({ chatId })` 不带 `parentSessionId`，走 `controller.ts:975-981` 的 `mainSource = 'auto'` 分支**自动新建 main**，随后无条件 `createChildSession`。已于 2026-09-14 实测（见下方更新）：自动 main 非 blank、有实际 turn；但按 2026-09-15 确认的语义，它根本不应在此刻被创建。
- **所有者确认的目标语义（2026-09-15）**: 比「不预建 child」更彻底——**拉 bot 进群应当零副作用：不建 child、不建 main、不发布 locus**，只在需要时记录授权事实。整棵 locus 树完全由**首个 @** 按需构建。推论：
  - **Q&A 群与普通群在 @ 之后没有区别**。答疑群的特殊性只在「由 Pet 面板主动建群并指定 main 归属」这一发起动作上；一旦进入 @ 驱动的正常流程，两者的 locus 树结构、child 创建/复用规则、话题各自持有 child 的行为完全一致，不应存在两套路径。
  - **`at` 与 `at + bind` 得到的 locus 树也没有区别**。bind 不是另一种建树方式，只是**指定/改写 main 归属**；树的形态由 @ 决定。
  - **main session 可通过 bind 重新绑定**。因此建群阶段「顺手自动建一个 main」既不必要也不可取：它在所有者尚未表达意图时就固化了归属，而正确做法是让归属可由 bind 显式决定与改写。
- **可行性：按需初始化的路径已经存在，本条主要是「去掉多余的提前触发」**: `admission.ts` 已有 `needsInitialization` 语义，且 `index.ts:2723` 在 provisioning 不可用时的 diagnostic 明写「first allowlist @ will initialize the locus」——即首个 @ 自行初始化本就是受支持的分支。所以方向不是新建能力，而是让 `im.chat.member.bot.added_v1` 不再调用 `ensureGroup`，把建树统一收敛到 @ 路径。这也与 `BotLifecycleInitializer` 自身的接口契约（`bot-lifecycle.ts:25`「Ensure only the chat-level structure. Must not create a Delivery or queue work.」）更一致——当前实现虽未建 Delivery，却建了 child 与 main，已超出「chat-level structure」。
- **要点**:
  - 目标时机：拉 bot / 建群不产生任何 session 与 locus；首个 @ 到达时一次性建立所需节点，后续 @ 复用；群内每个话题各自持有自己的 child。
  - 两阶段 provisioning 的存在理由要先查清：当初分离「先建 child、再发布 locus」很可能是为了让发布失败时有可回滚的资源句柄（`rollback`/`compensateChild`），改成按需创建需要重新设计失败补偿，不能只把创建调用后移。
  - 同时影响 `locus_deliveries` 的首投递路径与 `locus-prepublication` 预留逻辑（`reservation.childSessionId` 目前在发布前就要求存在）。
  - 需同时确认：Pet 面板「创建默认 Q&A 群」在不预建 main/child 后，面板 UI 还需要展示什么、`getDefaultQaLocus` 的语义是否要改为「尚未建立」。
  - 空 child 是否出现在侧边栏待确认；若不可见则纯属资源占用，优先级可维持 P2。
- **不在范围**: 与 `pet-locus-independent-child`（只改新 child 的 provider 选择，使其不再 fork 父历史）正交，该 change 不承接本条。
- **更新**: 2026-09-14 空库端到端验证中发现并确认。同批顺带验证了历史上的 blank main 问题——该问题此前已修复但一直未实测，本次两条 main 来源**均未复现，确认修复生效**：答疑群入口复用当前会话（11.8 MB 真实历史）；拉 bot 进新群走 `source=auto` 自动新建 main（`session-4629eb39`），所有者在侧边栏确认其含介绍与 standby 要求、有实际 turn。因此当前 locus provisioning 的唯一已知缺陷就是本条描述的无条件预建空 child，两条路径均稳定复现。
- **更新**: 2026-09-15 `pet-locus-independent-child` 真实验收期间，所有者重申并扩大了目标语义：不只是「不预建 child」，而是**拉 bot 不应有任何处理**，main 与 locus 同样不应在此刻创建；同时明确 Q&A 与普通 @、`at` 与 `at + bind` 在树形态上无差别，main 归属应由 bind 显式决定并可改写。标题与要点已按此更新。注意本条与自动新建 main 的关系：上一条更新确认「自动新建的 main 非 blank、有实际 turn」，那是**修复生效**的证据；但按新语义，问题不在于该 main 是否为空，而在于**它根本不该在拉 bot 时被创建**。
- **更新**: 2026-09-15 **已完成并真实验收**（openspec change `pet-locus-on-demand-tree`，22/22 任务）。移除 `index.ts` 中 `im.chat.member.bot.added_v1` 对 provisioning 的调用；`botLifecycleInitializer` 是 `PetChannelServiceDeps` 的可选字段，不传即 `BotLifecycleIntake` 不被构造，订阅链路自然停用，接口与解析代码原样保留未删除。核实发现 `/bind` 在未建 locus 入口一次建对（`mainSource: 'explicit'`、无自动 main、无警告）这条行为**生产代码本就正确**，未改动 `controller.ts`，只补了端到端测试固定该行为。9 个新测试全部用真实 `LocusController`+真实 `LocusChannelController`+共享真实 repository，用未改动的 `index.ts`（HEAD 版本）重跑同批测试确认零回归。三步真实飞书验收全部通过（入群零副作用、首个 @ 建树+回复、`/bind` 一次建对），证据详见 `docs/notes/pet-locus-on-demand-tree-handoff.md`。验收中额外发现两处：一是既有 provisioning 补偿机制的真实缺陷（`failProvisioning` 后同一 endpoint 需重启 Host 才能重试，非本次引入），转入 B040；二是 GUI 侧栏对自动建 main 挂载已有 workspace 存在短暂展示时序问题，转入 B041。

### [B019] 设置面板底部 DSH 主机系统时钟（24 小时制 + 时区）
- **状态**: 实施中
- **优先级**: P2
- **背景 / 动机**: 多台设备（可能不同时区）经 SSH 隧道访问同一台运行 DSH 的主机时，浏览器本地时间 ≠ DSH 主机时间；设置页没有能一眼确认「当前 DSH 跑在哪台机器、现在几点」的位置。在设置面板底部加一个 **DSH 主机系统** 的时钟（24 小时制 + 时区），与浏览器所在设备无关。
- **要点**:
  - 落地形态:本地 Host+Web 包 `dsh-system-clock`(host 半区 + client bundle,同 session-title-copy 构建形态);
  - 数据链路(关键):时间真相源必须是 **host 进程**,不能用浏览器 `new Date()`。host 经通用 `connection.rpc` 通道 `/dsh-system-clock`(authority loopback,接线同订阅插件的 `/subscriptions-auth`)暴露只读 `now` 采样:主机 epoch / IANA 时区 / UTC 偏移 / hostname;headless 无 connection 时静默不注册;
  - 实时机制:client 一次采样 + skew 引擎本地每秒 tick,`Intl.DateTimeFormat({ timeZone: 主机时区, hour12: false })` 渲染 → DST 天然正确;60s 周期 + `visibilitychange` 重采样校准,失败保留旧 skew 不中断;
  - 边界:设置官方 `settings.section`(id system-clock,order 300→导航最底部);采样不可达显示「主机时钟不可用」降级态,绝不静默回退浏览器时间(多机下最误导);只读、零配置、无外部网络外呼、不改官方 DOM/class;
  - hostname 属加量:用户「多台设备」场景,展示主机名用于区分机器。
- **更新**: 2026-09-01 新增;openspec change `settings-system-clock` 已 propose;实现 + 单测/typecheck/build 完成(21/21,host/client 双 smoke),隔离 home sync 幂等,openspec 已归档(`2026-09-01-settings-system-clock`,主 spec 生成),待合入 main + 物化 + 重启人工验收。

### [B018] 会话标题点击复制 session id
- **状态**: 已完成
- **优先级**: P2
- **背景 / 动机**: 开发/调试时常要当前 session id(引用驾驶舱、脚本、日志排查),官方对话区 header 标题是 disabled 按钮且 cursor: default,没有任何取 id 入口。让标题点击复制当前 session id + hover pointer,零成本高频收益。
- **要点**:
  - 落地形态:本地 Web client 包 `dsh-session-title-copy`(host 空入口 + client bundle,同 dsh-cockpit-bridge 形态;缺 host 入口会重演 v0.1.0 启动即崩事故);
  - id 真相源 = 官方 sessions list 的 `current`(与 cockpit-bridge 同 seam),无 host 能力、无网络请求;
  - 交互机制:移除标题 crumb `disabled` 恢复事件,按钮 capture 阶段 click `stopPropagation()` 阻断 React 委托的 `open(current)`;MutationObserver + sessions 订阅 rAF 防抖幂等 reconcile(rc.2 下「React 只为 props diff 写 DOM,disabled 属性被外部移除后不会被重写」,observer 兜底重建场景);
  - 边界:只改当前标题一个按钮;祖先面包屑「点击打开」不变;官方当前标题本就 disabled 死按钮,无官方能力被覆盖(若未来官方移除 disabled,locator 匹配不到 → 插件自动 no-op 让位);DOM 知识单文件 `title-locator.ts`;定位失败/剪贴板拒绝安全降级;不做常驻 copy icon(可发现性 = pointer + hover 底色 + tooltip + toast);
  - 设计过程与替代方案(overlay 遮挡、textContent 反查、copy icon 取舍)见 openspec change `2026-09-01-session-title-copy`(已归档)。
- **更新**:
  - 2026-09-01 新增;openspec change 完成 propose → 实现 → 单测(16/16)/typecheck/build → 仓库测试(81/81) → 隔离 DSH_HOME 与真实 `~/.dsh` sync 幂等;headless Chrome 对真实 GUI 端到端验证(标题接线、点击剪贴板 = 当前 session id、toast「会话 ID 已复制」);openspec 归档完成(主 spec 入 `openspec/specs/session-title-copy/`,manifest 条目已启用);待重启后人工复核,本条目回填为已完成。
  - 2026-09-02 实机反馈修订(v0.1.1):「点击标题复制」改为「标题右侧 6 位 ID 徽标」——标题恢复官方 disabled 原样,徽标显示去 `session-` 前缀前 6 位(如 `9af69b`),hover tooltip 完整 id,点击复制完整 id + toast;openspec change `2026-09-02-session-title-id-badge`(已归档,主 spec 更新);验证:typecheck/build/vitest 20/20、仓库 81/81、隔离 home sync 幂等(D003 绕过);已合入 main(`0b35c68`),待物化 + 重启人工验收。

### [B017] 迁出或删除 packages/dsh-federation(联邦路线已归档)
- **状态**: 实施中(本仓侧已完成,待 cockpit 侧提取资产)
- **优先级**: P1
- **背景 / 动机**: 多机 DSH 改采驾驶舱外壳(见 `docs/adr/ADR-0003-adopt-cockpit-over-semantic-federation.md`),语义联合 Host 路线已归档为「已探索但不采用」(`openspec/changes/archive/2026-08-27-federated-dsh-control-plane/`)。该 package 全程 `enabled: false`,**从未部署到真实 `~/.dsh`**,继续留在本仓只会造成路线困惑与无意义的维护面。
- **要点**:
  - **先提取资产,再处置本体**。需迁往 `dsh-cockpit` 复用的模块清单见 ADR-0003「资产处置」一节:注册表持久化(CAS/0600/fsync/no-follow/损坏不覆盖)、OpenSSH 隧道生命周期(仅 BatchMode 探测、argv/alias 注入防护、bind 冲突有界重试、stderr 脱敏)、终结性信号清理(清理后不得再 spawn、启动窗口不得留 `ppid=1` 孤儿、空转信号不得烧毁 latch)、状态分级与抖动退避、`probeUnary` 与官方事件 envelope 校验(只读部分)、删除节点确认门禁与不可逆摘要诊断。
  - 这些模块是被独立只读评估以反例证伪后才修好的(commit `5060459`),**不要凭印象重写**,应带着其回归测试一起迁移。
  - **不迁移**的部分(两个上游 compat patch、联合 ID、CommandRouter、写 ledger、generation 对账、中央 frame 转换、Node Shell/Hero Picker)随归档保留为历史证据。
  - 处置本体时需一并移除 `dsh.yaml` 中 `dsh-federation` 条目,并确认 `node scripts/sync.mjs` 连跑两次仍报 `no changes`(该 package 未部署,预期无部署面变化)。
  - 保留 `docs/notes/federated-dsh-operations.md` 还是随之归档,待迁移完成后判断。
- **更新**:
  - 2026-08-27 联邦工作已提交(`5060459`)并归档,ADR-0003 已接受。
  - 2026-08-27 **本仓侧移除已完成**:删除 `packages/dsh-federation`、28 个 `tests/federation-*.test.mjs`、`tests/helpers/`、5 个 rc.2 fetch/build/fixture 脚本、`dsh.yaml` 条目,并修正 `package.json` 的 `check:artifacts`(不再引用已删除的 fixture 检查)。验证:root 40/40、`check:artifacts` 通过、`git diff --check` 通过、`sync` 连跑两次仍 `no changes`、现有 Host(3080)未受影响。
  - **剩余**:在 `dsh-cockpit` 侧按 ADR-0003「资产处置」从 commit `5060459` 提取上述模块及其回归测试(已确认 8 个源文件与 6 个测试文件均可从该 commit 取回)。完成后本条目可转「已完成」。

### [B001] 多角色 agent 协作流水线(架构师 / anti 审查 / QA)
- **状态**: 讨论中(暂停)
- **背景 / 动机**: 希望 DSH 接任务后按阶段自主分配角色:需求设计 → 架构师;coding 完成 → anti 代码审查;最后 → QA 黑白盒验收。
- **要点**(2026-08 讨论结论):
  - 符合 DSH 设计理念:DSH 是组合式 + 委派式架构,角色 = **subagent**(persona + 工具范围 + 可选独立模型),不是多个 preset 手动切换。
  - 编排者 = 一个 **tech-lead preset**,自带 subagent / workflow / goal 工具,负责阶段流转与门禁。
  - 角色定义:起步内嵌在 tech-lead 提示词;进阶注册进 host composition 的 subagent registry 跨会话复用。
  - 阶段交接物 = workspace 文件(design.md、AC 清单、review 报告);subagent 不继承父对话,workspace 是共享记忆。
  - 工具选型:常规串行用 subagent 工具;大规模 fan-out(QA 多 AC 并行)用 workflow;跨轮长任务用 goal;Ralph 不适合。
  - QA 阶段可复用 `verifying-acceptance` skill(黑盒自测 + AC 证据)。
  - 参考实现标记(2026-08-14):社区插件 [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 已实现自然语言驱动的多角色团队(captain/members + 任务依赖 + 树形监控),做 B001 时优先评估复用,而非从零写。
- **开放问题**:
  1. 门禁强度:全程自主 vs 关键节点(设计定稿 / review 通过 / 验收通过)人工确认
  2. 是否需要独立 coder 角色,还是 tech-lead 自己写代码
  3. QA 以 AC 自动化证据为准,还是角色主观判断
  4. 是否给某些角色(如 anti)配不同模型
- **更新**: 2026-08-14 完成方案讨论,讨论进度已归档(要点 + 4 个开放问题);暂停跟进,待开放问题确认后进入设计。

### [B014] Worktree Session 隔离度分层与 build/runtime home 解耦
- **状态**: 讨论中
- **优先级**: P1
- **背景 / 动机**: Worktree Session 当前把任务专属 `DSH_HOME` 写入 worktree `.env.local`，可正确防止候选 build/sync 污染真实 `~/.dsh`；但同一个 `bin/dsh` 同时承担 build、preview、start、restart，用户从 task worktree 执行 restart 时会把整个 Host 切到空白隔离 home，表现为插件、Workspace/Session、provider 配置和凭据全部“消失”并要求重新输入 API Key。原数据未丢失，但当前边界非常容易误用。
- **五层隔离模型**:
  1. **源码隔离**：每个任务使用独立 branch/worktree，Agent 本地工具只访问 managed root；默认必须。
  2. **依赖隔离**：默认 lean、同 fingerprint 共享 cache；依赖变更前 promote，之后使用 worktree-local mutable dependencies。
  3. **部署隔离**：task `DSH_HOME=<git-common-dir>/ws/dsh-home/<operationId>` 只用于 `dsh build`、bundle composition、隔离安装与独立 preview，不读取真实用户配置。
  4. **真实配置验收**：显式 opt-in 使用 `DSH_HOME=$HOME/.dsh` 部署/加载候选 bundle，以真实 Workspace/Session/provider 验收；属于影响日常 profile 的部署动作，必须可识别、可回滚。
  5. **日常运行**：实现合入 main 后，由 main launcher 对真实 `~/.dsh` build/restart；不得依赖 task worktree 路径。
- **设计原则**:
  - 完全隔离本身符合预期，不应通过共享凭据/Session 来削弱第 3 层；应解决 build home 与 runtime home 粗粒度耦合及 launcher UX。
  - `DSH_HOME` 是进程级总根，当前同时承载 bundle/profile、Workspace/Session、provider 凭据、storage、skills 和日志，不能再把它描述成单纯“构建输出目录”。
  - 隔离 preview 与真实 profile acceptance 必须是两种显式模式；不得把 task launcher 的 restart 当作真实 GUI 无副作用重启。
- **优化候选**:
  - 拆分 `DSH_BUILD_HOME` / `DSH_RUNTIME_HOME`，或由命令显式选择目标 home，而不是在 task `.env.local` 中无条件覆盖进程级 `DSH_HOME`。
  - 命令边界建议：`dsh build --isolated`、`dsh preview --isolated --port <port>`、`dsh deploy --profile web`、`dsh restart`；其中 restart 只重启既有真实 profile。
  - launcher 每次启动打印绝对 `DSH_HOME` / profile；检测到 `.git/ws/dsh-home/` 时显示醒目的“隔离预览环境”，start/restart 默认拒绝或要求明确确认。
  - Worktree Session 运行上下文应明确：worktree 的 `bin/dsh build` 默认是隔离构建，不代表当前日常 GUI 已更新；真实部署需独立授权步骤。
- **验收标准**:
  - task build 不写真实 `~/.dsh`，两个并行任务仍拥有不同部署根；
  - task preview 不读取或复制真实凭据/Session，且使用独立端口并显著标识隔离环境；
  - 日常 restart 不会因 cwd/worktree `.env.local` 改变 runtime home；
  - 真实 profile deploy 前后可展示目标、差异与回滚路径，restart 后保留原 Workspace/Session/provider；
  - 自动化验收能分别声明 isolated preview 与 real-profile acceptance，且不会混用。
- **关联记录**: `openspec/changes/restore-cleaned-session-as-ordinary/WORKTREE-ISOLATION-NOTE.md`（2026-08-21 误用复盘与详细现象）。
- **更新**: 2026-08-21 记录五层隔离模型；确认“完全隔离”适合作为开发 build/preview，但现有 `DSH_HOME` + 通用 launcher 造成运行边界不清，后续需专项 OpenSpec 优化。


---

## 想法

### [B045] 记忆设置页的便利动作（打开库目录、卡片明细）
- **状态**: 想法
- **优先级**: P2
- **背景 / 动机**: change `dsh-memex-settings-ui` 落地的「记忆」页只做对应关系（工作区 / 库路径 / 远端）的展示与编辑，并已给出每库的卡片数与归档数。实际用起来后，可能想要更直接的便利动作：在文件管理器中打开某个库目录、查看卡片明细列表、或从页面直接跳到 `memex serve` 的对应库。
- **要点**:
  - 任何"打开目录/启动 serve"都属于**进程与外设**动作，必须新增 Host 端点（当前 `/dsh-memex` 只有取事实的端点 + 远端动作），需要先想清楚授权面：这些端点同样受 connection 层的回环 + 认证边界约束，但"打开 Finder"这类动作在远程 GUI（SSH 隧道访问）场景下是无意义的，需要按 `remote.$host` 决定是否显示。
  - 卡片明细会引入分页/性能问题（当前只做有上界的递归计数），若要做应走内核 CLI 的 `search --list`，不要自建索引。
  - 与「卡片浏览用 `memex serve`」的既有边界保持一致：页面不重复实现浏览能力，只提供入口。
- **更新**: 2026-09-20 从 change `dsh-memex-settings-ui` 的 design Open Questions 转为条目（本期不做，等实际使用反馈）。

### [B042] 父会话归档后，入口 @ 应有明确回执，而不是静默或静默复活
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: 所有者的预期是：在一个来源父会话**已归档**的 locus 所属群里 @ bot，Host 应识别出「这条关联的来源已经结束」，并直接在群里回一条明确消息（形如「父会话已归档，请联系所有者判断处理」），而不是让这条消息落进一份来源已经结束的工作。这不是新需求——`openspec/specs/pet-locus-collaboration/spec.md` 的场景「来源失效」已写明「WHEN 主会话归档、删除或无法恢复 THEN 关联入口有限次提示失效，不自动创建新主会话继续回答」。本条是该场景的实现落点，属**未实现**而非新增能力。
- **现状（读源码确认，真机行为未验证）**: 入站路径**没有任何一步检查父会话是否归档**：
  - `src/host/channel/pipeline.ts:180-198` → `locusController.handle(event)`。准入门（`src/host/locus/admission.ts`）是纯函数，只做 bot 发送者 / mention / 去重 / 水位 / allowlist 判定，只看 endpoint 与授权事实。
  - `src/host/channel/locus-controller.ts:919+` 的 `handleAdmission`：`resolveLocus(endpoint)` 取当前代记录 → `deps.child.ensureChild(locus)` → 建 Delivery → 投给 child。全程只认 locus 记录，不解析 `parentSessionId` 的会话状态。
  - 整条链上唯一接触父会话的是 `src/host/locus/child.ts:415` 的 `resolveLocusParent`：先 `port.get(parent)`，不在常驻则 `port.resume({ resumeSessionId })`，两者都不行才返回 `parent-unavailable`。**它没有 archived 判定，反而会主动 resume。**
- **因此当前只可能落到两种结果，两种都错**:
  - **resume 成功** → 子会话照常被 adopt、Delivery 被接受，**照常干活并回复**：等于悄悄把一个已归档的父会话重新拉起来继续服务，与「归档即结束」的预期、以及场景「不自动换来源继续回答」的精神都相反。
  - **resume 失败** → `ensureChild` 抛错 → `refuse('child-unavailable')`（`src/host/channel/locus-controller.ts:1656`）→ **只写诊断日志，不回复任何内容**：用户 @ 了 bot，界面上没有任何反应，无法区分「没听见」与「坏了」。
  - 哪一种是当前真机行为**未验证**——验证需要往真实飞书群发消息，未获授权不做。
- **已有的近似先例（可复用形状）**: `src/host/channel/pipeline.ts:200-214` 对 `legacy-endpoint` / `retired-endpoint` 已经有一条「有界 Host 诊断回复」：仅当发送者在 allowlist 内时回一条说明并要求所有者显式重建，失败保持 fail-soft。归档回执应沿用同一形状，但必须补上它现在没有的两点：**有限次**与**可停**。
- **要点**:
  - **判定放在哪一层要定**：建议在 `handleAdmission` 的 `ensureChild` 之前解析一次父会话状态，比散落在 child 适配器里更可测；同时必须决定 `resolveLocusParent` 是否也加 archived 判定——否则两条路径会给出不一致的结论。
  - **必须显式防「静默复活」**：即便最终决定「归档不影响工作」（工作跑在子会话里，父会话只在父子补问时才需要），也不能靠 `resume` 顺手把归档会话拉起来。这必须是一个写进规范的显式决定，不能是当前的默认副作用。
  - **回执收件人是开放问题**：locus 的所有者（B035 的 owner 概念尚未完整落库）／channel allowlist 成员／建群人或群主。提到具体人需要 open_id，Host 只对已知的 allowlist 成员持有（`allowOpenIds` + `knownNames`）。
  - **「有限次」需要机制**：spec 说「有限次提示失效后停止响应」，需要一个 per-locus（或 per-endpoint/代际）的通知计数或水位，且必须在 Host 重启后仍然成立。注意现有 legacy/retired 那条诊断回复**每次都回、没有节流**，不要照抄。
  - **不能泄露**：群内回执 MUST NOT 出现完整 session ID、其它群 ID 或其它 locus 列表（spec:187）。「父会话已归档」这句话本身可以说，标识符不行。
  - **与 B029 的关系**：B029 是**入口侧**不可达（bot 被移出/群解散，消息根本送不到）；本条是**来源侧**已结束（消息送得到，但没有可信的工作归属）。两条都需要「诚实状态 + 明确回执」，可共用回执形状与节流机制，但触发条件与恢复路径不同，不要合并。
- **更新**: 2026-09-15 所有者提出预期并询问是否已实现；读源码确认入站路径无归档判定、且 `resolveLocusParent` 会主动 resume 父会话，登记为待实现。落地时补一次真机验证（在归档父会话所属群 @ 一次，确认当前是「静默」还是「复活」），再决定回执文案与收件人。
### [B041] GUI 侧栏对自动建 main 挂载已有 workspace 存在展示时序问题
- **状态**: 想法
- **优先级**: P2
- **背景 / 动机**: 2026-09-15 真实验收 `pet-locus-on-demand-tree` 时所有者反馈：拉 bot 进新群、首个 @ 触发自动建 main（`mainSource: 'auto'`）后，新会话在 GUI 侧栏短暂显示为「未分组」，刷新页面后才正确归入所属 workspace 分组。
- **已确认数据层面从一开始就是对的**：`createMainSession`（`host/locus/dsh-port.ts`）内 `await workspace.attachSession(sessionId)` 已正确执行——直接读取 `~/.dsh/storages/workspace.json` 确认目标 workspace 的 `sessionIds` 列表里从一开始就含有新建的 session id。问题在 GUI 侧栏读取/渲染这份数据的时序，不在数据本身。
- **不是本 change 引入的新逻辑**：`createMainSession` 这条自动建 main 的路径在旧模型下同样存在（旧模型下由 `im.chat.member.bot.added_v1` → `ensureGroup` 触发），只是旧模型触发时机是「拉 bot 那一刻」——所有者通常不会紧盯侧栏；`pet-locus-on-demand-tree` 把触发时机改到「首个 @ 到达那一刻」，所有者大概率正看着页面，因此更容易注意到这个一直存在的时序问题。
- **要点**:
  - 需要先定位 GUI 侧是靠什么信号刷新 workspace 分组视图——是否存在一次实时推送/事件通知，`attachSession` 是否触发了对应的广播；还是纯前端轮询/缓存导致的滞后。
  - 影响面不止 locus：任何「代码路径写完 workspace.json 后没有显式触发侧栏刷新」的场景都可能复现，值得先确认这是否是一个更通用的 workspace 变更通知缺口，而不是 locus 专属问题。
  - 复现步骤已在 `docs/notes/pet-locus-on-demand-tree-handoff.md` 记录：新建群 → bot 首个 @ 触发自动建 main → 观察侧栏 → 手动刷新对比。
- **更新**: 2026-09-15 从 `pet-locus-on-demand-tree` 真实验收中发现，转入本条独立处理。

### [B040] Locus provisioning 失败补偿只在 Host 重启时跑，运行中永久阻塞同一 endpoint
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: 2026-09-15 实施 `pet-locus-on-demand-tree` 时端到端测试暴露：`createChildSession` 等外部创建失败后，`failProvisioning` 把该 provisioning 操作标记为 `phase: 'failed'`，但 `findBlockingProvisioningOperation`（`persistence.ts:3124`）判定"阻塞"只排除 `committed`/`compensated` 两种 phase——`failed` 依然阻塞。而全仓库唯一把 `phase` 从 `failed`/`needs-recovery` 转成 `compensated` 的代码路径是 `reconcileStartup`（`persistence.ts:2735`），且需要 `options.compensators`（chat/childSession/mainSession 三个回调）。生产环境确实接了这三个 compensator（`index.ts:2153` 的 `startupCompensators`），但 `reconcileStartup` 只在 Host 启动时调用一次。**结论：同一 endpoint 一旦建树失败一次，运行期间永久阻塞，必须重启 Host 才能恢复**，不是重试几次、等一会儿就能好。
- **不是本 change 引入**：这是 provisioning 补偿机制的既有特征，同一套 `beginProvisioning`/`failProvisioning`/`findBlockingProvisioningOperation` 在旧模型下同样适用——群走 `bot-added → ensureGroup`、话题一直走 `ensureForDelivery → ensureTopic`，失败后都会命中同一个永久阻塞。`pet-locus-on-demand-tree` 只是把群的建树时机从入群挪到首个 @，触发路径变了，阻塞机制本身没变也没变严重。
- **所有者提出的方向**：失败的 provisioning 操作应该有超时丢弃语义——`failed` 超过一定时长后不再计入 `findBlockingProvisioningOperation` 的阻塞集合，下一次 @ 到达时正常按"无 locus"重新走一遍首次创建检测与建立，不需要等 Host 重启。
- **要点（留给后续设计，本条不预先定死）**:
  - `petLocusOperation` schema 已有 `createdAt`/`updatedAt`（`spec.ts:923-924`），超时判据的字段现成，不需要新增持久结构。
  - 需要先回答：超时之后是"允许直接跳过阻塞检测覆盖建新的"，还是"仍需要跑一遍资源清理（关联的 main/child 若已创建部分要不要收）"——这决定了是纯放宽阻塞判定，还是要在运行期间也接入 compensator 调用，而非只在启动时。
  - 需要确认 `failed` 操作遗留的 `resourceRefs` 里如果已经创建了部分资源（比如 main 建成但 child 建失败），超时丢弃是否会让这些半成品资源变成孤儿——现状下 `reconcileStartup` 会清理，运行期跳过阻塞判定但不清理就可能不会。
  - 影响面不止群/话题建树，`replaceAutomaticGroupParent`（改绑）、`createOrOpenDefaultQa`（默认 Q&A）等所有走 `beginProvisioning` 的路径都共享同一套阻塞判定，方案需要对全部 provisioning kind 一致。
- **更新**: 2026-09-15 从 `pet-locus-on-demand-tree` 实施阶段的端到端测试中发现并确认根因；所有者提出超时丢弃方向，转入本条留待独立设计与实施。

### [B039] 清理旧 QA 模型的死代码
- **状态**: 想法
- **优先级**: P2
- **背景 / 动机**: 2026-09-15 应用 `pet-unified-locus-collaboration` 的 `pet-qa-group` REMOVED delta 时确认：旧 QA 模型的 10 条需求已全部被 `pet-locus-collaboration` 接替，主 spec 目录已删除。但**实现仍留在仓库里且已是死代码**——`src/host/qa/`（9 个文件）未被 `src/index.ts` 装配，唯一引用它的 `src/host/channel/pipeline.ts` 自身也没有任何生产调用方，合计约 2336 行。
- **要点**:
  - 删除范围待确认：`src/host/qa/` 全部 9 个文件、`src/host/channel/pipeline.ts`，以及对应的 9 个测试文件（`qa-*.test.ts`、`channel-pipeline.test.ts`）。
  - 删除前需逐个确认无其它引用，特别是 `locus/controller.ts` 中的 `qa-created` / `kind: 'qa'` 等标识——那些是 **locus 自己的** 来源枚举，不属于旧 QA 模型，不能一并删掉。
  - 规范侧已完成，本条纯粹是实现清理；不影响任何在跑的行为。
- **更新**: 2026-09-15 从 `pet-qa-group` 规范退役中分离出来。规范与实现分开处置，避免把「删规范」和「删代码」混成一次高风险改动。

### [B038] Locus Delivery 崩溃窗口的 fault-injection 测试矩阵
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: `pet-locus-independent-child` 的 tasks 8.3 要求「为 accept/current dispatch/bind、finish CAS/飞书调用/结果落账、expiry/interrupt/next dispatch 各崩溃窗口增加 fault-injection 测试」，实施时**未完成**，归档时如实标记为未实现并转入本条。当前只有 provisioning 相关的两个注入用例（`locus-persistence.test.ts` 的 `leaves no partial state on the medium when a mutation fails`、`leaves neither the switch nor its notice when the commit fails`），Delivery 的 finish/dispatch 路径没有等价覆盖。
- **为什么值得做**: 这三条路径都是「多步写入 + 外部副作用」，进程在步与步之间挂掉是真实会发生的。其中 **finish CAS → 飞书发送 → 结果落账** 最危险：CAS 成功但发送前崩、或发送成功但落账前崩，重启后若判断错误，用户要么收到**重复回复**，要么明明已发出却被记成失败。2026-09-15 的真实验收已经证明，这类「跨越边界的不一致」正是单测最容易漏掉、而真实链路必然命中的一类问题。
- **现状不是毫无防护**: 实现侧已做保守设计并有逻辑层单测覆盖——`finishing` 是发送前的持久栅栏，重启时一律收敛为 `unknown-terminal` 且**绝不自动重发**（宁可漏发不重发）；所有状态迁移用 `expectedRevision` 做 CAS，重放不生效；启动恢复要求精确身份匹配，证不出来就挂起该 locus 并记 `startupRecoveryDebt`。本条要补的是更强的一层：**在真实的中途写失败下**验证这些不变量仍成立，而非仅在理想路径下成立。
- **要点**:
  - 复用现成机制：`test/harness.ts` 已支持 `failOnWriteNumber`（第 N 次写入必定失败）与 `failWrites`，不需要新建基础设施。
  - 三条路径的崩溃点：(a) accept → claim current → bind 之间任意一步；(b) finish CAS → 发送 → 落账；(c) expiry CAS → 推进下一条。
  - 每条的核心断言：重启后**不重复投递**同一 Delivery、**不重复发送**飞书正文、**不漏掉**可安全投递的 backlog、队列**不永久卡死**。
  - 注意 interrupt 部分无法覆盖：expiry 路径目前对仍在运行的 Agent turn 不做任何中断尝试（无可用 runtime 接缝），这是 design.md 已记录的风险取舍，不是本条能补的测试空白。
  - **同时承接 tasks 8.4 的剩余项**：重启后不重复投递 current 的专项回归。`claimCurrentDeliveryMutation` 的 occupancy 检查在逻辑上防止了它，但缺少「重启 → 再次 dispatch」的端到端断言；属于同一类崩溃/重启窗口，与上述三条路径一并覆盖。8.4 的另一半（scheduler 到期与并发 finish 不重复推进）已在归档前完成，见 `locus-expiry-scheduler.test.ts`。
  - 工作量估计半天左右（finish/dispatch 路径各 5–8 个注入用例）。
- **更新**: 2026-09-15 从 `pet-locus-independent-child` tasks 8.3 转入。同批还发现并已修复另一处真实测试空白（Delivery 到期定时器完全无测试覆盖，已抽取为 `host/locus/expiry-scheduler.ts` 并补 9 例 + 三次变异验证），说明「有相关测试」不等于「关键路径被覆盖」，定时器/回调/崩溃窗口这类需要外部触发的接缝尤其容易漏掉。

### [B023] 自研插件独立性体检：可单独发布、无插件间依赖
- **状态**: 想法
- **背景 / 动机**: 逐项确认自研插件能否脱离 ohmydsh 仓库和其他插件单独发布、安装与运行，避免只能在当前整套定制组合中使用。
- **要点**:
  - 盘点全部自研插件，检查构建、打包、安装和运行链路；发布物应自包含，不依赖仓库外相对路径、其他插件源码/产物、根目录脚本或本机隐式配置。
  - 检查显式依赖与隐式耦合：package dependencies/peerDependencies、Cordis inject、跨插件服务调用、共享状态、加载顺序，以及由其他插件提供的 UI 挂载点；区分 DSH 官方宿主 API 与自研/第三方插件依赖，目标是无插件间硬依赖。
  - 在干净 DSH 环境中仅安装单个自研插件，验证安装、启动、核心功能和卸载；可选联动缺失时不得影响插件独立使用。
  - 产出逐插件结论表（能否独立发布 / 插件间依赖 / 阻塞项 / 解耦建议），发现问题后再立 OpenSpec change，不在本条记录阶段直接改造或发布。
- **更新**: 2026-09-11 新增，待开展体检。

### [B024] TraeX Bridge 模型的品牌图标展示
- **状态**: 想法
- **优先级**: P2
- **背景 / 动机**: 当前侧边栏会话行会按当前模型 provider 展示品牌 logo；启用 `dsh-traex-bridge` 并选择 TraeX Bridge / `traex` 模型时，也应有可识别的 TraeX 图标，而非通用首字母 fallback。
- **要点**:
  - 优先扩展本地 `sidebar-session-provider-icon` 的 provider→asset 映射，并使用官方/获授权的 TraeX 品牌 SVG 资源，不手绘或冒用未授权素材。
  - 保持 TraeX Bridge 默认关闭（`DSH_TRAEX_BRIDGE`）时的现有降级行为；图标资源缺失、provider 字段变化或未知模型时继续安全回退到首字母。
  - 实施前确认 TraeX Bridge 实际上报的 provider/model 标识，并在启用该 bridge 的环境中做会话列表切换验收。
- **更新**: 2026-09-11 新增，待确认品牌资源与运行时标识后实施。

### [B025] 优化 Settings 中的配置 Tab
- **状态**: 想法
- **优先级**: P2
- **背景 / 动机**: Settings 中用于承载各类配置的 Tab 随内置能力和插件增多，信息密度、分组层级与操作一致性需要进一步优化，降低查找配置、理解状态和完成修改的成本。
- **要点**:
  - 先盘点当前 Settings 的内置 section、插件 section 及 section 内部 Tab，确认用户所指「配置 Tab」的具体范围；以真实页面和注册顺序为准，不仅根据包名推断。
  - 调研主要体验问题：配置项是否过密或层级过深、相关项是否分散、标签命名是否清晰、当前 Tab/未保存状态是否醒目，以及窄屏和长内容下的导航体验。
  - 优化方向候选：按配置领域重新分组、统一 Tab 导航与表单布局、补充搜索/筛选或锚点、突出修改状态与保存反馈；具体取舍在调研后确定，不预设需要重写官方 Settings。
  - 优先使用官方 `settings.section` 与现有组件扩展点；若需要调整官方配置 Tab，先确认是否存在稳定 API，避免依赖易碎的 DOM/class 覆盖，并确保第三方插件 section 可继续独立注册。
  - 验收至少覆盖中英文、桌面与窄屏、键盘操作、长表单滚动、切换 Tab 时未保存修改的处理，以及新增/移除插件后导航仍可理解。
- **更新**: 2026-09-11 新增，待结合当前 Settings 实页梳理问题并明确优化范围。

### [B026] Pet Locus 管理提升可辨识性与概念说明
- **状态**: 已设计
- **优先级**: P2
- **背景 / 动机**: 人工验收中发现 Locus 管理卡片集中展示 chat、Locus、主会话、子会话等原始 ID，难以判断每个对象实际对应什么；“第几代”也缺少用户可理解的含义说明。
- **要点**:
  - 群、话题、主会话与子会话优先展示可辨识的名称或内容摘要，原始 ID 作为次要信息保留，不能以不稳定名称替代真实标识。
  - 对可导航对象使用文字链或明确的跳转控件，可打开对应飞书群/话题或 DSH 主会话/子会话；目标不存在、归档或不可达时保持 fail closed 并解释原因。
  - 为“第 N 代”补充紧邻说明：何时产生新一代、它与解除/归档/停止/显式重建及历史保留的关系，以及当前代和历史代的区别。
  - 优化后仍保留 owner-only、Host 真相源和 ID 可复制/核对能力，不能根据浏览器输入猜测名称、身份或关联。
- **更新**:
  - 2026-09-11 在统一 Locus 人工验收中记录；验收完成后统一评估和实施，当前不改主线。
  - 2026-09-13 T8 中再次暴露：验收对话里只能用 `omt_19c1d586810f1bba` 这类 thread id 指代话题，所有者无法在飞书界面上对应到具体哪个话题——必须反查 Delivery 表的首条消息才能确认。管理面与回执应至少提供「群名 · 话题（首条消息摘要或话题名）」这样的人类可对照标识，否则涉及多话题的任何操作（归档、重建、切换来源）都存在指错对象的风险。
  - 2026-09-13 T4-C3「发现关联」取得具体证据：按子会话 ID 反查，结果卡片只显示「子会话 ID」与「所属 locus」两行纯机器标识，**没有 endpoint**（chatId/threadId），因此所有者无法判断查到的究竟是群级、话题 A 还是话题 B 的 child——必须去查数据库才能确认。发现结果卡片至少应展示该 locus 的入口（群名/话题）与代际、状态，让「查到了什么」自明；这与本条「优先展示可辨识名称、原始 ID 降为次要信息」是同一诉求，实施时一并覆盖发现查询的三种结果形态。
  - 2026-09-13 **`pet-unified-locus-collaboration` 任务 10.8 收敛评估结论：确认未实现，本期不做，状态维持「想法」**。复核方式为直接读源码而非采信条目自述：`packages/dsh-pet/src/client/settings.tsx` 中不存在任何代际概念说明文案，也没有「名称优先、原始 ID 降为次要」的呈现实现，卡片仍以原始 ID 为主信息。判为**非阻塞 UX**——不影响协作模型正确性与安全边界，按 10.8「不在修复期间扩散非阻塞视觉优化」的约束不在该 change 内实现。仍建议与 B030 合并设计。
  - 2026-09-15 **收编进「Locus 管理面重做」专项（与 B030 同一份设计、同一个 change），状态转「已设计」。逐条判定：**
    - 要点 1（名称优先、原始 ID 降为次要，不以不稳定名称替代真实标识）→ **收编**。做法是短码体例 `L·2f85 / S·9062 / oc·a27b / omt·19cd / W·d5d2`：由真 ID 确定性派生（各类型一条明确规则）、点击复制完整 ID、**永不作为请求入参**。名称与短码必须**成对**出现——实测同一父会话下会出现两个「答疑 · DSH」，名称单独不构成身份。
    - **顺带定位到本诉求至今失效的根因（比"投影漏字段"更深，2026-09-15 查实）**：**群名在系统里根本不存在**，不是被丢在某一层。
      - 入站事件不带群名：`channel/event.ts` 的 `LarkInboundEvent` 只有 `chat_type`，没有 chat name 字段，所以创建时 `childLabel(endpoint, request.chatName, …)` 拿到的永远是 `undefined` —— 这正是子会话标题里出现裸 `oc_…` 的原因（`controller.ts:1497` 的 `chatName?.trim() || endpoint.chatId`）。
      - group 记录不投影群名：`controller-persistence-adapter.ts:277` 的 `projectGroupRecord()` 从不设置 `chatName`（该字段只在类型 `LocusGroupRecord` 上声明）。
      - 持久层里没有：实测 `~/.dsh/plugins/dsh-pet/state.sqlite`，`u_dsh_pet_loci` 与 `u_dsh_pet_locus_indexes` 中含 `chatName` 的行数均为 **0**，`u_dsh_pet_chat_bindings` 是**空表**（unified locus 不走 legacy binding），也没有独立的 group 表。
      - `management.ts:367` 的 `endpointView()` 只投影 `chatId`/`threadId` 也是事实，但它只是**最后一层**——上游没有任何地方能提供名字。
      - **结论**：要显示真群名，必须新增能力（飞书查询 + 持久化位置 + 写入/刷新时机 + 暴露到 view），**不是补一行投影**。同一结论适用于 `chatType`（群 vs 私聊的区分同样未持久化）。
      - **决定（2026-09-15，所有者）：本轮不做。** 本次迭代限定为**纯面板调整，不新增任何 Host / wire 能力**。因此面板不做群名同步，「刷新群名」按钮与相关状态一并从设计中撤除；面板也不在打开时打飞书接口。
      - **连带取舍（已在设计中登记）**：兜底名**不写「群」** —— `chatType` 未持久化，写了就是猜。规则 = 有 `threadId` 写 `话题 · 19cd`，否则写 `入口 · a27b`；哪天把 `chatType` 存下来，这里自动变成 `群 · a27b`。这条与「不以不稳定名称替代真实标识」一致：宁可显式说明是兜底显示，也不猜一个看起来更像人话的名字。
      - **为将来保留的规则**：若日后引入群名同步，**必须同时**解决同名问题（实测同一父会话下会出现两个「答疑 · DSH」），因此「名称与短码成对出现、名称单独不构成身份」这条现在就先写进设计，避免加名字时退化。
    - 要点 2（可导航控件 + 目标不可达时 fail closed 并解释）→ **收编**。每行右侧固定 `会话 ↗ / 飞书 ↗`（按入口读法另有 `父会话 ↗`），归档时按钮不可点并给出原因。**话题跳转订正**：此前设计稿写「飞书没有稳定的话题深链」是错的——仓库内已有证据 `docs/notes/pet-locus-spike-findings.md:38`（生产先例 `dev-infra-server/service/ux-issue-group-dispatch.ts:127-144` 用 `result.data.thread_id` 拼 `applink.feishu.cn/client/thread/open`）。按该 spike 的 fail-closed 要求：拿不到 `threadId` 即退化为 chat 级链接，不得猜测。
    - 要点 3（「第 N 代」紧邻说明）→ **收编**。行内 `第 N 代` + `历史 N 代` 折叠；紧邻文案说明：新代由**显式重建**或**切换来源**产生（`controller.ts:811/1152/1286`），模型 turn 结束、超时推进**不**产生新代（spec:163），且新一代**默认回到只读、不继承旧代写权限**。
    - 要点 4（owner-only、Host 真相源、ID 可复制）→ **收编为不变量**：名称全部来自 Host 投影，短码只在显示层派生，浏览器不猜测名称/身份/关联。
    - 更新 2026-09-13 T8 的**回执侧**诉求（「验收对话里只能用 `omt_…` 指代话题」，要求管理面**与回执**都提供人类可对照标识）→ **超出本次 scope，按无效需求处理**。本 change 只动 settings 面板；回执文案在 channel 层（`channel/feedback.ts`、`locus/switch-notice.ts`）。如仍需，单开一条。
    - 更新 2026-09-13 T8 的**话题名 / 首条消息摘要** → **超出本次 scope，按无效需求处理**。实测无数据来源：lark 端口只有 `chatName(chatId)`（`channel/lark.ts:143`），没有话题标题接口；首条消息摘要需要新增飞书读取能力。当前只能显示 `话题 · 19cd` + 所属群名。
    - 更新 2026-09-13 T4-C3（发现结果卡必须自证「查到了什么」）→ **收编**，设计稿 I 区：结果卡固定三行 = 入口（角色 + 名称 + 群级/话题/继承关系）→ 代际与状态 → 父会话/会话，最后才是跳转；空结果如实说「没有匹配的关联」，不退回裸 ID 列表。
    - 落地载体：`openspec/changes/archive/2026-09-15-pet-locus-management-redesign/`（已于 2026-09-15 归档）（proposal / design / specs delta / tasks）。评审用的可视稿是临时产物、不入库，其结论已收敛进该 change 的 design.md 与本条目。

    - 2026-09-15 **已实施**（openspec change `pet-locus-management-redesign`）：呈现层重写完成，`packages/dsh-pet/src/client/locus-view.ts`（纯函数）+ `settings.tsx` 的 Locus 区 + 样式；证据见该 change 的 tasks。
### [B027] Pet Delivery 失败向原飞书入口返回安全诊断
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: 人工验收中模型在调用前被网络模型守卫拒绝，飞书侧只有失败表情“泣不成声”，用户无法知道是模型不可用、权限、超时还是系统故障，也不知道是否应该重试。
- **要点**:
  - Delivery 失败后向原始、caller-bound 的群/话题/单聊返回一次安全、低敏、可行动的错误说明；目标必须来自 Host 当前 Delivery 绑定，不能接受模型指定。
  - 区分可公开类别，例如模型当前不可用、权限不足、执行超时、内部失败；不得回传 token、路径、prompt、堆栈、provider 凭据或可枚举内部标识。
  - 与失败表情保持一致且幂等，同一 Delivery 不重复发错误；明确是否可重试以及需要所有者执行的恢复动作。
  - 需要重新审视“业务文字仅由子会话发送”的现有规范：失败回执属于 Host 控制面例外，应显式定义边界，不能演变为 Host 代发业务答案。
- **更新**:
  - 2026-09-11 在群级 mention 验收中记录；当前只记录，不修改验收主线。
  - 2026-09-12 T3 验收中取得真实证据：断网导致子会话中断后，Delivery 停在 `failed`（不重放、不代发，行为正确），但飞书侧只有失败表情，用户无法判断是网络中断、模型不可用还是系统故障，也不知道该重试还是重建。这正是本条要解决的场景。
  - 2026-09-13 **正式承接 `pet-unified-locus-collaboration` 任务 10.5**（「定义并实现 Delivery 失败的安全 Host 控制面回执」）及 10.6 中对应的测试子项。该任务已在前置 change 中标记 NOT APPLICABLE 并移交本条，依据两处规范：`openspec/changes/pet-locus-independent-agent-inquiries/proposal.md:36`「B027 负责通用安全失败回执，本 change 定义未回复/询问失败的事实和诊断接缝，不扩展 Host 代发业务正文」，以及 `openspec/changes/pet-locus-independent-agent-inquiries/specs/pet-locus-collaboration/spec.md:71`「通用失败文字回执由独立 B027 承接，本要求不授权 Host 代发业务正文」。
  - **当前真实状态：未实现（状态仍为「想法」）**。前置 change 已交付的是相邻但不同的东西——失败表情 fail-soft、Delivery `failed` 不重放、运行结算与正文发送成功相分离；缺的正是本条：飞书侧只有表情、没有可读诊断。移交**不缩小**本条范围，第四个要点（重新审视「业务文字仅由子会话发送」并把失败回执定义为 Host 控制面例外）仍是本条实施前必须先解决的规范问题，且后继 change 的 spec 第 71 行已预先约束该例外不得演变为 Host 代发业务答案。

### [B028] Locus 子会话显式模型策略与可审计降级
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: Locus 子会话创建时继承到 Claude 模型后，本机出口被网络模型守卫阻止；子会话又没有模型切换入口，导致同一持久 Locus 无法人工恢复。现行规范禁止恢复时静默切换模型或来源，因此需要显式策略而非隐藏 fallback。
- **要点**:
  - 评估为 Locus 配置首选模型与有序降级列表，或允许所有者在管理面显式切换当前子会话模型；默认行为、适用范围和持久方式必须清楚可见。
  - 只有可判定的模型不可用错误才允许考虑降级；工具失败、业务错误、权限拒绝等不得误触发换模型。避免同一请求跨模型重复执行或重复发送回复。
  - 切换/降级必须记录原模型、原因、目标模型、Delivery 与时间，并在 GUI 和必要的飞书失败/恢复回执中可见；禁止“成功了但用户不知道模型已变”。
  - 明确上下文连续性、模型能力差异、费用、数据出口与安全策略边界；网络守卫的 fail-closed 决策不得被 fallback 绕过，只能选择当前政策明确允许的模型。
  - 与“恢复使用原主/子会话、不静默切换模型或来源”的统一 Locus 规范协调；实施前应建立独立 OpenSpec change。
- **更新**:
  - 2026-09-11 在 Claude egress 被拒且子会话不可切模型后记录；当前只记录，不修改验收主线。
  - 2026-09-13 **正式承接 `pet-unified-locus-collaboration` 任务 10.1 / 10.2 / 10.3**（模型选择接缝调查、模型不可用的可判定分类与降级边界规范、Locus 子会话模型恢复实现）及 10.6 中对应的测试子项。三条已在前置 change 中标记 NOT APPLICABLE 并移交本条，依据 `openspec/changes/pet-locus-independent-agent-inquiries/proposal.md:36`「B028 的显式模型切换/降级不在本期，新独立 child 须显式保留经核验的创建模型策略，不能因换 provider 静默换模型」——该行确立 B027/B028 对 B035 出范围，前置的统一模型 change 同样不承接。
  - **当前真实状态：未实现（状态仍为「想法」）**。需要与移交范围划清的三点：（a）「恢复不得静默切换模型或来源」是**禁止**条款，前置 change 中已实现且仍然有效，它不要求存在切换能力，因此本条未落地不构成规范违反；（b）B028 未落地期间的现行行为是 fail closed——模型不可用即 Delivery 停在 `failed`，不换模型、不重试、不重放（2026-09-12 T3 断网实测，见 B027）；（c）前置 change 已独立实现并验收的两项不变量**不随移交流失**，本条实施时必须继续保持：已失败/已结算 Delivery 不被重放，以及同一 child 上下文连续（T2-C3 重测复用同一 child `session-c9af096f` 且 turn 递增）。
  - 实施前仍须建立独立 OpenSpec change（原要点末条），本条尚未建立。注意与 `pet-locus-independent-agent-inquiries` 的边界：后者要求新独立 child 显式保留经核验的创建模型策略，本条若引入降级列表，不得使该策略被静默改写。

### [B035] Locus 子会话 fork 全部父历史，削弱 locus 同构并导致回复出口失效
- **状态**: 实施中（独立 child、父子 `agent-message` 上下文、每 locus 单 current Delivery 串行队列、统一 `pet_locus_finish`/`pet_locus_wait`、启动恢复均已在 `pet-locus-independent-child` 本地实现并回归验证——`pet_locus_reply` 已整体移除，无兼容别名；真实部署/飞书群与话题验收待完成，见该 change `tasks.md` 10.3–10.7）
- **优先级**: P0
- **背景 / 动机**: 所有者在答疑群提问后，子会话「只 done 没回复」。排查确认：该 child 由轮盘「答疑群」创建，parent 恰是所有者与 agent 正在进行验收的活跃会话，`provider: 'fork'` 使其**继承了全部 77 轮历史**。于是它在 turn 74 接着那段历史继续扮演「正在做验收的 agent」——连跑 5 次 bash 复制 state.sqlite、查 locus、调 lark-cli，最后把结论写成 assistant 文本 `## T4-C1 ✅ 通过`，**唯独没有调用 `pet_locus_reply`**。Delivery 因 turn 正常结束而 settled，飞书侧却一个字都没收到。它不是不懂规则，是**以为自己仍在 GUI 里与所有者对话**。
- **这不只是 prompt 强度问题**: 投递前言明写「业务正文必须调用 `pet_locus_reply` 发送」，但该指令位于 77 轮继承历史的末尾，压不住前面积累的强行为模式。继承历史越长，回复出口越容易失效；而 Q&A 群恰恰最容易踩到——它 fork 的正是一个人类正在使用的活跃会话。
- **更根本的是与 locus 同构的冲突**（所有者指出）:
  - locus 本应是「主会话（工作现场）× 飞书入口（协作现场）」的连接，子会话是这个连接的**服务者**；fork 却把它变成主会话的**克隆**，于是子会话以为自己就是那个在 GUI 里干活的人。
  - 规范同时写了两条机制：「子会话 SHALL 继承主会话可用的已完成前缀」与「初始化任务书 SHALL 允许按需询问主会话当前工作根与约束」（同在 spec 第 227 行），且「问父」已在投递前言接线（`send_message` 指引）。但既然已 fork 全部历史，子会话**没有需要问的时刻**——整个验收期间「问父」一次都未触发，该路径实际从未被真实验证。
  - 与另一条规范存在张力：「主会话 MUST NOT 因其父节点身份宣称已统合所有协作现场的最新认知」。fork 恰恰让子会话继承了父的全部认知，且是**冻结在创建时刻的快照**——既不实时，又多到足以让模型自认知情。
- **早期可选方向（历史讨论，以下方已确认方案为准）**:
  - 改用 `spawn` provider（已安装 `dsh-subagent-spawn-in-process`，零父上下文），上下文诉求一律走「问父」。代价：丢失真实价值——T5 切换到 S1 后，child 继承该需求会话历史使其一上来就懂背景；且「问父」可靠性未经验证（父会话可能正忙、不在线、回答不结构化）。
  - 继承**已完成的工作成果**（结论、约束、锚点）而非逐轮对话过程。
  - 仍 fork，但在投递前言中**显式切断身份**：明确「继承的历史属于主会话，那不是你；你现在服务的是这个飞书入口，唯一业务出口是 pet_locus_reply」。
  - 按父会话性质区分（人类活跃会话 vs 稳定工作会话）——问题可能不在 fork 本身，而在被 fork 的对象。
  - 兜底可判定防线：turn 结束时若存在 Delivery 绑定却未调用 `pet_locus_reply`，由 Host 发一条提示回执。这是**可判定事实**而非依赖模型自觉，但需先划清与 B027「业务正文仅由子会话发送」的边界。
- **要点**: 这是对 locus 核心模型的调整，不是修 bug，**应单独立 OpenSpec change 认真设计**，不要在验收收尾时顺手改掉。任何方案都必须保住：子会话不得冒充主会话身份、不得自动把结论回传主会话、飞书业务正文的唯一出口仍是 `pet_locus_reply`。
- **已确认方案**: 新 child 独立历史，不复制父 transcript 或默认摘要；Host 按实际 caller 与持久 Locus 索引提供「同一主会话 + 当前有效 Locus children」目录，父发现子、子发现父与兄弟。圈内定向异步询问无需逐次人工批准，目标忙时排队、不 steer、不经父模型转述；仅分享适用工作上下文，不开放完整历史或形成代执行授权。答复精确关联原请求再续进，不串飞书出站。旧 fork child 保留历史与模式，所有者可空闲时显式重建为新代/新 child/read。
- **同源协作上下文（补充确认）**: 公共工作事实、协作者列表和定向询问是一套主子共用的逻辑能力，不是文件夹或新内容 store。公共说明/资料引用/共同约束按主会话只维护一份，由 owner 明确确认共享范围后版本化保存；agent 按需读取，不广播、不自动从父历史/局部锚点/问答答案提取或采纳。挂载不复制，末个 child 退出保留公共事实，改绑不搬运旧圈内容。局部上下文、实际权限和回复目标仍独立。
- **承接 change**: `openspec/changes/pet-locus-independent-agent-inquiries/`；依赖 `pet-unified-locus-collaboration` 基线及先后规范归档顺序。独立创建/冷恢复、scoped 装配、非 steering 横向队列、询问副作用限制与跨轮持久关联列为 G1–G5 能力核验门槛，不把提案完成当成已实现。
- **更新**: 2026-09-13 在 T8 后由所有者发现并指出「是不是不应该 fork……要不现在这样看起来还是没有 locus 同构的那种效果」；后续探索确认上述方案并建立独立 OpenSpec 提案，早期方案与证据链保留。

### [B034] Pet 面板与操作回执重叠
- **状态**: 已设计
- **优先级**: P2
- **背景 / 动机**: 创建默认 Q&A 成功后，绿色回执「已创建默认答疑入口。」压在 Pet tasks 面板下沿，两块内容视觉重叠，回执与面板文字相互遮挡。
- **根因**: 二者各自独立绝对定位，互不感知高度——`.dshpet-panel` 为 `bottom:78px`，`.dshpet-panel-receipt` 为 `bottom:48px`（`styles.ts`）。该差值假定了一个固定的面板高度；面板实际高度随内容变化（`max-height:60vh` 且可滚动），内容较少时面板下沿高于 48px，回执便与之重叠。
- **要点**:
  - 让回执与面板**在同一流中排布**，而不是用两个硬编码的 `bottom` 猜测彼此位置。例如把回执作为面板的兄弟节点放进同一个定位容器，由 flex 列布局自然堆叠；或让回执相对面板下沿定位而非相对视口。
  - 面板不存在时（仅轮盘态）回执仍需有合理落点——当前轮盘态走的是 `.dshpet-wheel-note.dshpet-wheel-receipt`，属另一条路径，调整时不要破坏它。
  - 面板可滚动且 `max-height:60vh`，方案必须对「面板很矮」和「面板到达上限」两端都成立，不能只调数值把问题挪到另一个高度区间。
  - 回执有 6s 淡出动画（`dshpet-receipt-fade`），布局变更不应导致淡出期间发生跳动或占位塌陷。
- **更新**:
  - 2026-09-13 在 T4 验收创建默认 Q&A 成功后发现（截图为证）。
  - 2026-09-13 **`pet-unified-locus-collaboration` 任务 10.8 收敛评估结论：确认未实现，本期不做，状态维持「已设计」**。根因未动，源码实证：`packages/dsh-pet/src/client/styles.ts:185` 仍为 `.dshpet-panel{position:absolute;bottom:78px;...;max-height:60vh;overflow:auto}`，`:189` 仍为 `.dshpet-panel-receipt{position:absolute;bottom:48px;...}`——两个绝对定位元素各自硬编码 `bottom`、互不感知高度，正是要点中指出的「用两个硬编码的 bottom 猜测彼此位置」。判为**非阻塞视觉问题**，按 10.8 的约束不在该 change 内实现。实施时仍须满足要点的四项边界（同流排布、轮盘态回执落点不破坏、面板极矮与到达 60vh 两端都成立、6s 淡出期间不跳动）。

### [B033] 设置页不应提供按主会话创建默认 Q&A 的入口
- **状态**: 已设计
- **优先级**: P1
- **背景 / 动机**: 设置页「默认 Q&A」区块在尚无任何 Q&A 时，会把**所有已知主会话**各渲染成一个「创建/打开默认 Q&A（<裸 session id>）」按钮。验收中出现两个只有 session id 不同的并排按钮，所有者无法判断该点哪个——而点击是**不可逆的外部副作用**（真实创建飞书群并指定群主）。所有者明确：创建入口只应存在于 Pet 轮盘的「答疑群」，设置页不应按主会话提供创建。
- **要点**:
  - **移除** `defaultQa.length === 0 && parentIds.length > 0` 那组按钮（`settings.tsx`），以及已有条目卡片上的「创建/打开默认 Q&A（此主会话）」按钮。
  - 设置页该区块改为**只读展示 + 导航**：列出各主会话的默认 Q&A 入口、状态、代际与权限，可跳转到对应群/会话；没有时明确说明「尚未创建，请在目标会话中通过 Pet 轮盘的『答疑群』创建」，而不是就地给一个创建按钮。
  - 唯一创建路径保留轮盘内置能力 `qa-group`（已实现且 probe 条件已满足）。它以**当前会话**为 parent，上下文自明，不需要所有者从裸 id 列表里挑，误操作面显著更小；来源不是会话时已正确 blocked（「需要当前会话作为来源」）。
  - 这不改变领域模型：`isDefaultQa` 仍只是 locus 上的布尔标记，与群级/话题 locus 共用同一套记录与卡片渲染；调整的只是**创建动作的入口位置**，不是 Q&A 的语义。
  - 与 B030（管理面按入口聚合）同区域，建议一并设计：设置页统一收敛为「展示 + 导航 + 生命周期动作（解绑/归档/重建）」，而**新建外部资源**一律不放在设置页。
- **更新**:
  - 2026-09-13 在 T4 验收中由所有者指出；创建路径以轮盘为唯一入口，设置页改为只读展示。
  - 2026-09-13 **`pet-unified-locus-collaboration` 任务 10.8 收敛评估结论：确认未实现，本期不做，状态维持「已设计」**。缺口仍完整停在原位，源码实证：`packages/dsh-pet/src/client/settings.tsx:1168` 的 `defaultQa.length === 0 && parentIds.length > 0` 分支依然按裸 session id 渲染创建按钮（按钮文案见 `:1178`「创建/打开默认 Q&A（{parentSessionId}）」），条目卡片上的「创建/打开默认 Q&A（此主会话）」按钮亦仍在（`:1160–1162`）——即要点中要求**移除**的两组按钮一个都没动。
  - 需要如实标注的风险等级：本条与其它三条 UX 条目不同，点击这些按钮是**不可逆的外部副作用**（真实创建飞书群并指定群主），而并排按钮之间只有 session id 之差。因此它虽同样未阻塞协作模型，误操作代价显著高于 B026/B030/B034，建议在四条 UX 条目中优先实施（其优先级 P1 已反映这一点）。
  - 2026-09-15 **收编进「Locus 管理面重做」专项（与 B026/B030 同一份设计、同一个 change）。要点全部收编，无超 scope 项：**
    - 要点 1（**移除** `defaultQa.length === 0 && parentIds.length > 0` 那组创建按钮）→ **收编**。设计里「默认 Q&A」不再是独立分区，整组按钮随分区一起消失。
    - 要点 1（**移除** 条目卡上的「创建/打开默认 Q&A（此主会话）」按钮）→ **收编**。默认 Q&A 降为 locus 行上的一个**徽标**（`默认 Q&A`，节点加蓝环，颜色 + 文字两个通道），不再单独列举、也不再提供创建。
    - 要点 2（该区块改为**只读展示 + 导航**）→ **收编**。展示 = 行内徽标 + 会话头；导航 = 行内 `会话 ↗ / 飞书 ↗`。所有者 2026-09-15 评审确认「已经不是单独列举了，只是打了个 tag，没问题」。
    - 要点 2（空态给出去处）→ **收编**，设计 H 区：`默认 Q&A 尚未创建 —— 请在目标会话里用 Pet 轮盘的「答疑群」创建；设置页只做展示与导航，不提供创建入口。`（取自实测数据：`session-4629eb39` 的 `byParent.defaultQa` 为空。）
    - 要点 3（唯一创建路径保留轮盘 `qa-group`）→ **满足**，本 change 不触碰轮盘。
    - 要点 4（`isDefaultQa` 语义不变）→ **满足**：仍只是 locus 上的布尔标记，与群级/话题 locus 共用同一套记录与行渲染。
    - 要点 5（与 B030 一并设计；设置页收敛为「展示 + 导航 + 生命周期动作」，**新建外部资源**一律不放在设置页）→ **满足**：绑定 endpoint 表单也一并移除（所有者 2026-09-15 确认），设置页不再有任何「新建外部资源」入口。生命周期动作（解绑/归档/停止/重建/权限/确认执行根）保留在每行「操作」折叠区。
    - **与本次范围约束的关系**：以上全部是**移除 UI 入口**，不是新增能力，因此符合「本轮只有面板调整、不新增 Host / wire 能力」的约束。

    - 2026-09-15 **已实施**（openspec change `pet-locus-management-redesign`）：呈现层重写完成，`packages/dsh-pet/src/client/locus-view.ts`（纯函数）+ `settings.tsx` 的 Locus 区 + 样式；证据见该 change 的 tasks。
### [B032] Locus 子会话在 GUI 侧不可用：标题被样板覆盖且打开方式错误
- **状态**: 已完成
- **优先级**: P1
- **背景 / 动机**: T7-C3 验收时从管理面点「打开子会话」失败，暴露两个独立缺陷，共同导致所有者无法从 GUI 侧查看 Locus 子会话。
- **缺陷一：标题被 prompt 样板覆盖（Pet 侧，确定是 bug）**
  - 实测子会话 `session-c9af096f` 的唯一 `session/title` 事件为 `"## 当前 unified locus 投递（caller-"`，`source: fallback`——DSH 的兜底标题生成器取了首条用户消息开头，而首条消息正是那段约 1950 字符的 caller-bound 投递头。
  - `subagent/descriptor` 里其实带着正确 label（`Locus 子会话 · <chat> · <主会话标题>`），但 Pet 创建 child 后**没有显式 rename**，把标题让给了 fallback。主会话创建路径有 rename（`Locus 主会话 · <chat>`），子会话漏了，属对称性缺失。
  - 后果：侧栏与管理面都认不出这是哪个 Locus 的子会话；所有者按「Locus 子会话 · xxx」去找会以为它不存在。
  - 与 B031 同源：投递头越长，兜底标题取到的样板越多。即使修了标题，B031 仍应独立收敛。
- **缺陷二：打开方式不符合官方 subagent 契约（Pet 侧，非 DSH bug）**
  - 报错 `session/agent-busy: subagent Sessions require their durable parent address` 与 `session "..." is owned by subagent routing`，均来自官方 `dsh-api-session-controller`，是**刻意的所有权保护**：`validateAddress` 对 `header.origin === 'subagent'` 的会话拒绝普通 session 地址。
  - Pet 的 `openSession()`（`packages/dsh-pet/src/client/index.tsx`）调用 `ctx.sessions.open(sessionId)`，对主会话正确，对子会话必然被拒。
  - 官方提供了正确入口 `ctx.sessions.openSubagent(address)`，`SubagentAddress = { parentSessionId, childSessionId, mode: 'one-shot' | 'continuable' }`。Pet 侧三项事实齐备：locus 记录有 parent/child，descriptor 记录 `mode: continuable`。
  - 修复方向：管理面「打开子会话」改走 `openSubagent`，并按目标是主会话还是子会话分流；`mode` 必须取自持久事实而非猜测。目标不可达时保持 fail closed 并解释原因，不得静默降级为 `open()` 再报底层错。
- **要点**:
  - 两处都应补测试：标题需断言创建后存在 Pet 显式 rename 且不等于投递头前缀；打开路径需断言 subagent 目标使用 `openSubagent` 且携带正确 parent/child/mode。
  - 与 B026 / B030（管理面可辨识性与聚合）相关：标题修好后，管理面与侧栏才可能按名称辨识，聚合展示也才有意义。
- **更新**:
  - 2026-09-13 在 T7-C3 验收中发现并定位。
  - 2026-09-13 两处均已修复：创建 child 后显式 `ctx.sessionTitle.rename(session, input.label)`（best-effort，命名失败只记日志、不回滚已创建的 child）；管理面打开路径引入 `PetSessionTarget` 判别联合，子会话走 `ctx.sessions.openSubagent({ parentSessionId, childSessionId, mode: 'continuable' })`，parent 缺失时拒绝而非回退裸 id。已补回归（移除 subagent 分支后用例失败）与命名接线断言；Pet 1647 项测试通过，已部署。标题修复只对**新建** child 生效，存量 child 标题不变。
  - 2026-09-13 **`pet-unified-locus-collaboration` 任务 10.8 收敛评估：已独立复核源码，确认「已完成」属实**（不采信条目自述）。缺陷一实证：`packages/dsh-pet/src/index.ts:1224` 在 idle child 创建后显式调用 `ctx.sessionTitle.rename(childSession, input.label)`，`:1213–1222` 的注释完整记录了「descriptor 不等于 Session 标题、放任 fallback 会取到投递头」的原委以及为何 best-effort 不回滚。缺陷二实证：`packages/dsh-pet/src/client/index.tsx:360` 调用 `ctx.sessions.openSubagent({...})`，`:348` 注释记录官方 Host 拒绝裸 session 地址的所有权契约。遗留项复述：标题修复只对新建 child 生效，**存量三个 child 标题不变**——这一点未变，若日后仍需辨识存量 child，属 B026/B030 呈现层解决，不再回改本条。

### [B031] Locus 投递 prompt 头过长且逐条重复
- **状态**: 已完成
- **优先级**: P2
- **背景 / 动机**: 每条飞书投递都带一段固定的 caller-bound 路由说明作为 prompt 头。实测话题 A 的两条投递各约 1950 字符 / 58 行，**其中 55 行逐字重复**，每条真正新增的只有 3 行（message id ×2、用户正文 ×1）。用户正文往往只有十几个字，却被包在一段几十倍体量的样板里，每轮重发一次。这既浪费上下文预算与 token 成本，也让子会话每轮都要重新扫一遍不变的内容。
- **要点**:
  - 现行规范已要求「后续投递只带必要请求事实和查询引导，MUST NOT 每次重复全部目录说明」（见 pet-locus-collaboration「上下文按实际子会话绑定」）。当前实现与该约束存在差距，应先确认是实现未收敛还是规范表述需细化。
  - 可评估的方向：首轮发完整路由说明，后续轮只发差量（本次 message id、正文、必要的变化事实）；不变的 locus/endpoint/权限事实改为按需经 `pet_context` 查询，而不是每轮预先注入。
  - **不可牺牲的边界**：caller-bound 路由事实必须仍由 Host 解析并可被子会话取得，不能因为精简而让模型改从请求正文推断目标——这正是 `pet_locus_reply` 拒绝接受模型指定目标的原因。精简的是「重复注入」，不是「事实来源」。
  - 需要覆盖：子会话冷恢复后首轮是否仍能取得完整事实、代际切换后头部是否必须重发、以及历史轮次的可追溯性不因差量化而丢失。
  - 量化验收：以真实会话日志统计每轮投递字符数与重复率，改动前后对比，而不是凭观感判断「变短了」。
- **更新**:
  - 2026-09-12 在 T3 验收中实测记录（话题 A 两条投递 58 行中 55 行重复）。
  - 2026-09-13 已实现：确认属实现未收敛到既有规范（spec「后续投递只带必要请求事实和查询引导，MUST NOT 每次重复全部目录说明」），非新需求，故自主修复。路由前言改为**每个 child 只发一次**；后续投递只带真正变化的部分（请求正文、reply 关联、本轮 Delivery 绑定的回复目标），并指向 `pet_context` 复核持久事实。位置判定取自**持久 Delivery 历史**而非运行时计数器——计数器会在 Host 重启后归零并在会话中途重发前言。安全面未削弱：回复目标仍逐条 Host 绑定，省略的事实仍可从 Host 取回而非由模型推断。实测后续投递长度不足首条一半。
  - 2026-09-13 **`pet-unified-locus-collaboration` 任务 10.8 收敛评估：已独立复核源码，确认「已完成」属实**（不采信条目自述）。实证：`packages/dsh-pet/src/host/locus/context.ts:245` 的实现注释确立「routing preamble is sent ONCE per child」并说明 locus child 是持续会话而非一次性调用；`:258` 的投递位置参数以 `subsequent` 省略该一次性前言；`:352` 为已收到前言的 child 单独渲染后续投递。与 B032 的同源关系已解除依赖：B032 的标题缺陷已独立修复，本条的前言精简不再是标题可辨识性的前提。

### [B029] Bot 被移出或群被解散时标记入口不可达（不自动解绑）
- **状态**: 已设计
- **优先级**: P1
- **背景 / 动机**: 当前只订阅了 `im.chat.member.bot.added_v1`，没有对应的移除或群解散事件。把 bot 移出群，或所有者直接解散群后，该群的 locus 仍停留在 `active`、管理面继续展示为有效关联，但消息实际已无法送达——这是**伪报可用**，与刚修复的「伪报不可用」（10.4）属同一类缺陷、方向相反。入群能自动建立关联，离群/解散完全无感知，生命周期不对称。
- **设计决定（2026-09-12 与所有者确认）**: **不自动解绑，改为标记入口不可达**。所有者确认真实场景中移出 bot 主要是**误操作**，而非「协作结束」的信号。据此：
  - 自动解绑会把一次误操作升级为不可逆损失：主会话关联、代际、已确认锚点与权限档位全部断开，重新加入后需走显式重建，代价远大于收益。
  - 事件只证明「bot 不在群里」，**不证明操作者身份、更不证明所有者意图**。据弱信号做不可逆收敛，违背本规范一贯原则（`pet_locus_reply` 拒绝模型指定目标、blank 不推断身份、锚点存在不等于授权）。
  - 但维持 `active` 同样不可接受——状态必须诚实。
- **要点**:
  - 同时订阅 bot 被移出群（`im.chat.member.bot.deleted_v1`）与群被解散（`im.chat.disbanded_v1`）事件；后者在当前 `lark-cli event list --domain im` 中明确存在，bot auth，scope 为 `im:chat:read`。实际事件字段与投递行为**必须用真实事件实测**，不能照文档推断，见 `docs/notes/dsh-plugin-integration-pitfalls.md` 第 4 节。
  - 收到任一事件后：保留 locus 记录与全部历史，**仅标记「入口不可达」并记录时间及原因**（`bot-removed` / `chat-dissolved`）；管理面明示具体原因与「消息无法送达」，并就近提供解绑/归档入口，由所有者决定是否收敛。
  - bot 重新加入时清除不可达标记并恢复服务。群结构仍为 `active`，因此 `ensureGroupLocked` 走复用分支，天然幂等、不新增 locus/代际/child（已在 T2-C1 验证过该幂等性）。
  - 不可达标记 MUST NOT 与显式「停止标记」混淆：后者是所有者主动退出、普通 at 不得复活；前者是可自动恢复的可达性事实。两者语义与恢复路径都不同。
  - 忙时处理：有执行中或排队 Delivery 时如何呈现（不可达 + 在途工作待处理），不得丢失在途工作或错配结算；不可达期间新消息本就不会到达，无需额外拦截。
  - 幂等与乱序：重复投递、移除/重加交替、事件早于或晚于消息到达，都必须收敛到同一结果。
- **实测证据（2026-09-12，复杂状态下移除→重加→@ 三步）**: 起始状态为 1 条历史代际 + 群级当前代 + 2 个话题（共 4 条 locus）。
  - 移除 bot：`u_dsh_pet_loci` / `u_dsh_pet_locus_indexes` 计数完全未变，operations 无任何 bot 生命周期记录——**Host 连一条日志都没有**，确认完全无感知。期间四条 locus 全部停留 `active`，管理面持续显示有效而消息实际送不到，伪报可用已实测复现。
  - 加回 bot：仍为 4 条 locus，无新增代际、无新增 child，`ensureGroupLocked` 走复用分支。**幂等性在复杂状态下成立**（T2-C1 此前只在干净状态验过）。
  - 重加后 @：正常投递到原 child `session-c9af096f`，Delivery settled，该 child 在同一 session 内 turn 3 继续递增（turn 1/2 在移除之前），`pet_locus_reply` 累计 3 次调用 0 次被拒。**成员关系变动未损坏运行时绑定与 Delivery 关联**。
  - 上述两点共同支撑「标记不可达」优于「自动解绑」：恢复路径已证明安全（复用幂等），且无需重建 child（运行时绑定未受影响），因此清除标记即可恢复服务，代价与风险都显著低于解绑重建。
- **更新**:
  - 2026-09-14 空库验收中解散默认答疑群 `oc_a27b5de...` 后再次实测：飞书 `im chats get` 返回 `chat_status=dissolved`、`bot_count=0`、`user_count=0`，但对应 `qa-created` locus 仍为 `active`，Host 没有任何 `disbanded_v1` 日志；确认群解散是独立于 bot removal 的第二种不可达来源，纳入本条统一处理。
  - 2026-09-12 在真实群验收中发现（只订阅 added、无对应移除事件）。
  - 2026-09-12 与所有者确认真实场景为误操作，据此定为「标记不可达」而非自动解绑；方案已设计，待实施。
  - 2026-09-12 完成移除→重加→@ 实测，取得上述证据；当前行为基线已确立，实施后应保持复用幂等与绑定连续性不变。

### [B030] Locus 管理面需要按入口聚合，而非平铺全部代际
- **状态**: 已设计
- **优先级**: P1
- **背景 / 动机**: 管理面把每条 locus 记录平铺成一张等高大卡，活跃与已停止/已退役混在一起。真实使用中「入口数 × 代际数」增长很快：一个群做过一次重建、再开两个话题，就已经是 4+ 张卡，需要大量滚动才能找到当前在用的那条。用户的直接反馈是「子会话数量看起来不对」——实际上数量是对的（历史代际按规范必须保留），是**呈现没有聚合**让人无法判断哪些仍然有效。这不是纯视觉问题：看不懂就无法据此做解绑/重建/权限决策。
- **要点**:
  - **补充「为何没有删除」的说明**：所有者在验收中提出「管理面没有删除绑定关系的功能，是设计如此还是遗漏」。这是刻意设计——规范要求归档/解绑只停止服务并保留主/子会话历史与飞书资源，并明确「用户接受破坏性升级 MUST NOT 被解释为授权删除旧会话、群或历史」，因为消息→代际→child→轮次的诊断链必须可追溯。但停止/解绑/归档三个动作语义相近且都不清场，历史记录持续堆积，用户会自然去找「删除」。这是**表达问题而非缺功能**：正确解法是聚合与折叠（本条目），不是加删除入口——后者与上述不变量直接冲突。界面应让「为什么留着、留了什么、怎么不碍事」一眼可懂。
  - **以入口（群 / 话题）为第一层聚合单位**，而不是以 locus 记录为单位：一个入口一张卡，卡内展示其当前活跃代际，历史代际折叠为「历史 N 代」。当前模型下「一个入口至多一个活跃 locus」，因此这个聚合与领域模型天然对齐。
  - 群与其话题应体现层级关系（话题挂在所属群下），而不是与群平级铺开；这样「同一主会话服务多个现场」才看得出来。
  - 活跃优先：已停止 / 已退役 / 失效默认折叠并显示数量摘要；折叠不等于隐藏事实，展开后代际号、主/子会话、停止原因与时间仍可完整核对。
  - 卡片信息分层：主/子会话 ID 等原始标识降为次要信息（可复制），首屏优先展示可辨识的名称、状态与权限。
  - 与 B026（可辨识性与「第 N 代」概念说明）**合并设计**，避免两次改动同一区域；分区与层级必须来自 Host 返回的真实状态与 endpoint 结构，不在前端按 ID 或时间猜测。
  - 保持 owner-only 与 Host 真相源语义不变，不引入前端本地状态覆盖 Host 结论。
- **更新**:
  - 2026-09-12 在真实群 T3 验收中记录：3 条 locus（群级 gen1 已停止、群级 gen2 活跃、话题 A 活跃）已导致「数量不对」的误判；建议与 B026 合并设计。
  - 2026-09-13 **`pet-unified-locus-collaboration` 任务 10.8 收敛评估结论：确认未实现，本期不做，状态维持「想法」**。复核方式为直接读源码：`packages/dsh-pet/src/client/settings.tsx` 中搜不到任何按 endpoint 聚合、历史代际折叠或群/话题层级嵌套的实现，仍是每条 locus 记录一张等高平铺卡。判为**非阻塞 UX**，按 10.8 的约束不在该 change 内实现。与 B026 的合并设计建议不变。
  - 2026-09-15 **收编进「Locus 管理面重做」专项（与 B026 同一份设计、同一个 change），状态转「已设计」。逐条判定全部收编，无超 scope 项：**
    - 要点 1（「为何没有删除」的说明）→ **收编**。已落进设计稿 C 区操作行下的紧邻说明：解绑/归档/停止都只停止服务、保留主/子会话历史与飞书资源（消息 → 代际 → 会话 → 轮次的诊断链必须可追溯），所以历史只被聚合和折叠、不被清掉；要让旧入口不碍事就用筛选或折进「历史 N 代」。**结论与条目原文一致：不加删除入口。**
    - 要点 2（入口为第一层聚合单位、历史代际折叠）→ **收编**。行 = 一个 endpoint = 一个 locus 家族：当前代做主行，历史代折叠为「历史 N 代」（含各代状态、时间、会话可打开）。实测依据：`view().loci` 返回**全部代次**（`management.ts:607,669` 遍历 `records()`），旧界面把每一代渲染成一张 ~500px 卡。
    - 要点 3（群 / 话题层级嵌套）→ **收编**。用 `parentLocusId`（话题指向群级 locus）：实测数据里 `oc_5913` 同时存在群级 `auto` 与话题 `inherited` 两条，旧 UI **从未渲染这个字段**（只在 rebuild 请求里被读）。
    - 要点 4（活跃优先；已停止/已退役/失效默认折叠 + 数量摘要；折叠不等于隐藏事实）→ **收编**。落在筛选浮层第二组「入口状态」（活跃 / 已停止·已失效 / 已退役），计数直接来自快照、为 0 的项保留但置灰。**注**：所有者在 2026-09-15 评审时曾说这组「可以砍」；因本条明确要求，设计上保留，待最终确认。
    - 要点 5（信息分层：主/子会话 ID 降为次要、首屏优先名称/状态/权限）→ **收编**。所有原始 ID 收进每行「标识符」折叠区并可一键复制；首屏只有名称、状态、权限、会话。
    - 要点 6（与 B026 合并设计，不在前端按 ID 或时间猜测）→ **满足**：B026 与 B030 现由同一份设计承载，分区与层级全部取自 Host 返回的 `endpoint` / `state` / `parentLocusId`。
    - 要点 7（保持 owner-only 与 Host 真相源，不引入前端本地状态覆盖 Host 结论）→ **收编为不变量**；Host 拒绝动作后不做乐观更新（沿用现有 `runAction` 语义）。
    - **本 change 在两条目之外的增量**（所有者 2026-09-15 逐轮确认）：短码体例、关系轨（父会话—locus—会话 的可见关系）、按工作/按入口双读法、父会话状态筛选（默认只看可用，归档的折成底部一行出口）、群名主动刷新入口、**移除面板里的绑定表单**（关联只能由飞书消息建立，手输 id 无人会用）。
    - 落地载体：`openspec/changes/archive/2026-09-15-pet-locus-management-redesign/`（已于 2026-09-15 归档）（proposal / design / specs delta / tasks）。评审用的可视稿是临时产物、不入库，其结论已收敛进该 change 的 design.md 与本条目。

    - 2026-09-15 **已实施**（openspec change `pet-locus-management-redesign`）：呈现层重写完成，`packages/dsh-pet/src/client/locus-view.ts`（纯函数）+ `settings.tsx` 的 Locus 区 + 样式；证据见该 change 的 tasks。
### [B002] 飞书助手:任务中 @ 助手,在飞书群发消息
- **状态**: 想法
- **背景 / 动机**: 理想情况是能在任务中 @ 助手,然后在飞书群里发消息,把 DSH 任务与飞书 IM 打通。
- **要点**:
  - 至少先做单向:任务节点/结果 → 飞书群消息推送;
  - 理想双向:飞书群里 @ 助手 → 触发或查询 DSH 任务;
  - 可复用现有 `lark-im`(收发消息)、`lark-event`(事件订阅)能力;需定义交互入口与鉴权(群→会话映射)。
- **更新**: 2026-08-14 新增


### [B008] 会话(任务)看板视图
- **状态**: 想法
- **背景 / 动机**: 支持会话(任务)以看板形式呈现,可在 todo / doing / reviewing / done / canceled / blocked 几个状态间切换,多任务并行时一眼看清整体进度。
- **要点**:
  - 形态:会话/任务列表的看板视图,列 = 状态,支持拖动或按钮切换;
  - 数据模型:状态字段挂在会话/任务上,与现有 session / goal / todo 机制衔接(参考 `dsh-tool-goal` 的 blocked、`dsh-tool-todo`);
  - 联动:reviewing 可与 B001 的 anti 审查阶段衔接;blocked 与 goal 阻塞语义呼应;canceled 对应会话终止;
  - 落点预估:client UI 插件(看板渲染 + 交互)+ host 侧状态持久化/API;
  - 待设计:状态与会话生命周期事件的映射、看板入口位置、与现有 sidebar/会话列表共存方式。
- **更新**: 2026-08-14 新增

### [B011] 输入框 @ 唤起 subagent 选择并指派任务 + subagent 管理面板
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: B004 落地后 subagent 会变多(claude-code / codex / 多机实例),希望用户能在输入框直接 `@` 唤起 subagent 选择器、显式指派任务给某个 subagent,而不是只能靠主 agent 自主决定委派;同时需要一个管理面板统一查看/配置这些 subagent。
- **要点**:
  - 前置条件:先验证 B004 单机 subagent 好用(openspec 4.4),「好用」再决定本条优先级;
  - 入口形态:复用 `dsh-client-ui-input-trigger` 的 trigger 机制(现有 `/` slash-menu 即由它注册,支持 lexicon 候选 + `ReferenceInsert` / `ConsumeTokenRequest` 等契约),新增 `@` trigger 大概率不动会话主链路;UI 参考 `dsh-client-ui-model-selection` 的两级菜单;
  - 数据源:subagent 注册表 = host 侧 subagent registry / tool 清单(`subagent-claude-code` 每实例一条 tool 行,天然可按 providerName / toolName 列出);也可混入当前会话树里的活跃 subagent(类似 `list_agents` 的 children 视图);
  - 指派语义(待设计):选中后把输入内容作为委派请求直接发给该 subagent(用户显式选目标,等价于主 agent 调 subagent 工具但由人指定),还是生成一条指令让主 agent 转发;结果如何回流展示;
  - 管理面板:subagent 列表(名称 / provider / 模型 / 机器 / 状态 / 任务数),配置(增删、默认模型、persona 提示词),任务历史;落点 = client UI(设置页 Tab 或侧栏面板)+ host 侧配置持久化;
  - 与 B001 关系:B001 是 agent 自主编排(tech-lead 派活),本条是用户手动指派,互补;面板可复用一个 subagent registry 设计,避免两处各建一套;
  - 与 B008 可联动:面板里 subagent 的任务状态可进会话看板。
- **更新**: 2026-08-19 新增;2026-08-24 B004 归档后前置更新:subagent-codex 一次性委派已移除(订阅 provider 为主形态),显式委派走内置 subagent/fork 工具,「subagent 变多」前提不再成立,本条动机与数据源描述待重定(可并入 dsh-sidechain 的 /side 子代理面板评估)。

### [B012] 类似 Codex 的 session 内容关键字搜索
- **状态**: 想法
- **背景 / 动机**: session 多起来后，仅靠标题和时间难以找回历史上下文；希望像 Codex 一样按关键字检索 session 的消息内容，快速定位相关会话和原文。
- **要点**:
  - 搜索范围:支持跨全部 session 搜索，后续可增加当前 workspace / 当前 session 等范围筛选；
  - 结果展示:显示命中的 session 标题、时间、消息片段并高亮关键字，点击后跳转到对应 session 的命中位置；
  - 基础筛选:可按时间、workspace、角色(user / assistant / tool)过滤，并明确是否包含已归档 session；
  - 实现关注:优先调研现有 session 持久化与查询 API；数据量大时考虑全文索引、增量更新，以及本地会话内容的隐私边界；
  - 待确认:首版仅做普通关键字匹配，还是同时支持短语、大小写、正则或语义搜索。
- **更新**: 2026-08-20 新增


---


### [B016] 成本分级:子代理按任务类型挂不同模型/档位
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: DSH 是组合式 + 委派式架构,子代理默认继承父会话模型(fork 继承父模型,spawn 用部署默认 `agent-default-model`),fan-out(QA 并行、检索、摘要、格式化)因此全用旗舰模型。实测账单(2026-08-24 cost-meter):codex 单日 2921 calls ¥445、claude-opus-5 205 calls ¥163,而 opencode-go deepseek-v4-flash 整天 ¥0.28——同量级任务用便宜档可省一个数量级。官方 subagent capability seam 已支持 persona / toolFilter / outputSchema / depthLimit,唯独 per-call model 覆盖不在官方 tool 层([官方 Agent Note 2026-06-21-subagent-capability-seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md))。
- **要点**:
  - 社区已有实现参考:[dsh-routed-subagent](https://github.com/bpc-oss/dsh-routed-subagent)(bpc-oss:one-shot subagent 挂任意 preset + per-call model/provider 覆盖 + 模型可用性预检),推进时优先评估复用而非从零写(与 B001 同口径)。
  - 设计问题:
    1. 模型选择规则:按子任务类型(检索/摘要→flash 档,代码生成→旗舰)/上下文体积/预算上限,还是显式 per-call 参数;
    2. fork(继承父) vs 显式覆盖 的优先级语义;
    3. 与 B011 subagent 管理面板的协同(面板上可视化每个子代理的模型与成本);
    4. 省钱效果的可验证性:cost-meter 已按 byProviderModel 拆分记账,可直接对比分级前后成本。
  - 与 B001 开放问题 4(anti 角色配不同模型)是同一问题的两个切片,可合并设计。
- **更新**: 2026-08-24 新增,源自 claude/codex 订阅成本复盘(上游 #17/#24 缓存缺陷修复后,成本分级是下一个杠杆)。

### [B021] 等效 Claude 的 simplify skill 与 insight skill(代码并行清理 / 会话使用分析)
- **状态**: 想法
- **优先级**: P2
- **背景 / 动机**: Claude Code 官方能力:bundled skill `/simplify`(并行 4 个 review agent 审查「最近改动」并直接应用清理修复:复用已有 helper / 简化 / 效率 / 抽象层级;明示不查正确性,正确性归 `/code-review`)与 `/insights`(生成 HTML 报告分析本机近期会话:在哪些项目工作、怎么用、哪里出错、可尝试功能;官方是内置命令而非 skill)。这两类「说一声就做完的分析/清理」能力 DSH 目前没有对位,希望补上等效物。
- **要点**:
  - 落地形态:本地 skill(skills/<name>/SKILL.md + dsh.yaml `type: skill` 条目,同 ws / add-dsh-plugin / dsh-tunnel 形态);simplify 可纯 prompt 编排(DSH 已有 subagent 并行 fan-out,与 B001 同族);insight 需要读会话存储,可能要 host/plugin 配合;
  - simplify 等效:对目标范围(如 git 最近改动)并行 spawn 多个 review 子代理,汇总 findings 后应用修复;可评估顺带对位 `/code-review`(正确性 review),或首版只做 simplify,把「不查正确性」写进边界;
  - insight 等效:读本机 DSH 会话历史(默认 json 存储;storage-domain 可路由 sqlite,见 dsh-pet note),统计项目/模型/失败点/用法,渲染自包含 HTML 报告放工作区文件(可配合 open-in-vscode 打开);
  - 依赖与协同:会话历史读取与 B012(会话内容关键字搜索)共用「会话持久化与查询 API」调研;review 子代理可用 B016 成本分级挂便宜档;隐私边界:本地生成、不出网、不落库;
  - 官方参考:commands 参考(https://code.claude.com/docs/en/commands 的 `/simplify`、`/insights` 条目)与 bundled skills 说明(https://code.claude.com/docs/en/skills)。
- **开放问题**:
  1. simplify 默认目标 = 最近提交 / uncommitted diff / 显式 path?修复直接应用(官方行为)还是先展示 diff 待确认;
  2. review 面照搬官方 4 维还是精简(如 abstraction 并入 simplification);
  3. insight 是否等 B012 的存储调研先落地、直接复用其读取/索引层;
  4. 与已完成的 B010/cost-meter 统计面板的关系:insight 只做会话行为分析,不重复费用展示。
- **更新**: 2026-09-04 新增,源自 Claude Code bundled skill `/simplify` 与内置命令 `/insights`(官方 commands 文档)。

---

## 缺陷备忘

### [D001] core 缺陷:sandbox_permissions 静态广告导致 "not strictly wider" 报错
- **状态**: 已绕过(上游 open)
- **现象**: 会话处于 danger-full-access 模式时,任何携带 `sandbox_permissions` 参数的工具调用(bash/write/edit)都报 `sandbox escalation to "X" is not strictly wider than this call's current "X" mode`,且报错不提示修正方法,agent 会反复踩坑(2026-08-19 commit push 时连踩 10+ 次)。
- **根因**: DSH core 的工具 schema 静态广告 `sandbox_permissions` 枚举,不随会话当前模式变化;拒绝逻辑也不自我纠正。
- **绕过**: 工具调用默认不带 `sandbox_permissions` 参数;仅在被真实拒绝(`[sandbox: file access denied ...]`)时带最窄的足够权限重试一次;遇到 "not strictly wider" 报错直接移除参数重试。细节与铁律见 skill `dsh-sandbox-notes`。
- **部署侧缓解(2026-08-19)**: 自研插件 `subscriptions-sandbox-shim`(manifest 条目,packages/subscriptions-sandbox-shim)在适配器边界为订阅 provider(codex/grok)自动剥离升级字段(schema 出站 + arguments 入站),GPT 会话不再触发该报错;仅适用 danger-full-access + approval: never 部署,受限部署必须禁用。设计见 openspec change `subscriptions-sandbox-shim`。
- **移除条件**: 上游修复(deepseek-harness 静态 schema 感知会话模式 / 拒绝文案自纠)或 DSH 升级消除缺陷后,删除 manifest 条目 + sync + restart。

### [D002] core/subscriptions 交界缺陷:subagent settlement notice 产生孤立 Responses function_call
- **状态**: 已定位并在 shim 0.1.1 绕过(待上游修复)
- **现象**: Codex 会话运行一段时间后稳定报 HTTP 400 `No tool output found for function call call_...`;同一坏会话后续请求重复失败,切 DeepSeek 可继续。
- **根因**: 中断 continuable subagent 时,DSH `AssistantOutputFold` 选取子会话最后一条非空 assistant content(可含尚未收口的 `tool-call`),`notifySettlement` 又把整段 content 作为父会话的 user message 注入;`dsh-plugin-subscriptions` 的 Responses 翻译器不校验 block 所在角色,把 user message 内的 copied `tool-call` 也序列化成父请求 `function_call`,但父会话没有对应 `function_call_output`,Codex 后端遂返回 400。
- **实证**: 主会话 `session-77e49055-...` 的 seq 10591 含 user-role `call_00_PmW7x...`,紧接 seq 10592 即相同 call id 的 400;源 call/result 实际成对存在于子会话 `e34d5d2b-...` seq 50330/50332,证明是跨会话复制污染而非工具执行漏结果。
- **部署侧缓解(2026-08-19)**: `subscriptions-sandbox-shim` 0.1.1 在 codex/grok adapter 请求边界按角色和 call id 清理孤立 tool-call/tool-result;正常 assistant call + user result 配对保持不变,非目标 provider 零影响。
- **上游修复建议**: core settlement notice 只传播 text/image(至少剥离 tool-call/tool-result);subscriptions `toResponsesInput` 仅允许 assistant→function_call、user tool-result→function_call_output,并做最终配对校验。

### [D003] sync 对本地包内容变化的增量重装未反映到 profile node_modules(观察,根因待查)
- **状态**: 待排查
- **现象**: 修改 `packages/worktree-session` 源码并 rebuild 后,`node scripts/sync.mjs` 检测到 `content changed` 并执行 `dsh plugin --profile web add file:...`(exit 0),但 `~/.dsh/profiles/web/node_modules/dsh-worktree-session` 仍为旧内容(无 `lib/host/project.js`,operation.js 无 packageManager 字段);sync 的 state hash 却已更新,后续 sync 判定 up-to-date,部署与实际源码不一致。
- **绕过(2026-08-28)**: 在 profile 目录手动 `rm -rf node_modules/dsh-worktree-session && pnpm add file:<路径>` 后内容正确;此后 sync 幂等(`no changes`)。
- **待查方向**: `dsh plugin add` → profile 内 pnpm add 对 `file:` + lockfile `resolution: {type: directory}` 的目录依赖,在 node_modules 已存在同 spec 时是否跳过实际拷贝/链接;以及 sync 应在重装前先移除旧目录或对 `type: directory` 依赖强制刷新。影响面:任何 local package 的源码改动经 sync 部署都可能"假成功"。
- **更新**: 2026-08-28 记录(worktree-session pnpm 支持实现部署时发现;当前部署已手动校正)。

### [D004] sync 无法修复 compat `file:` 依赖指向已删除 checkout 的部署
- **状态**: 待修复(本次由 change `dsh-memex-settings-ui` 的部署步骤暴露)
- **现象**: 存在部署漂移需要 sync 修复时(`incomplete deployment dsh-memex: missing lib/client.js, reinstalling`),修复路径执行 `dsh plugin --profile web add ...`,pnpm 立刻失败:`ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND`(`/Users/…/.worktrees/change-openspec-changes-dsh-memex-scoped-memory/packages/dsh-pet/compat/subagent/storage-artifacts/storage-domain` 不存在),报 `failed to repair incomplete deployment of dsh-memex`。
- **根因**: profile `package.json` 中 4 个 `@deepseek-ai/dsh-storage*` 的 `file:` 依赖是**绝对路径**,取值 = 执行 sync 的 checkout 根 + `dsh.yaml` 中 dsh-pet 的 `compatDependencies.path`。上一次从 worktree `.worktrees/change-openspec-changes-dsh-memex-scoped-memory` 物化时把该 worktree 路径写进了 profile;worktree 随后被清理,而 sync 判定 `dsh-pet@0.1.0 up-to-date` 后不再重写这些路径 → profile 留下指向不存在目录的依赖,此后**任何** pnpm add/install 都失败,local package 的部署与修复一起被冻结(运行中的实例看起来正常,已加载模块不受影响)。
- **影响面**: 任何「从 worktree 物化过、worktree 已被清理」的部署都会踩到。
- **绕过(如需立刻恢复)**: 从主 checkout 重新执行一次 dsh-pet 的 add(即 sync 本来会跑的那条命令),把 4 个 `file:` 路径改写成当前 checkout 的绝对路径;或 `dsh reset` 后重跑 sync(更重)。
- **修复方向**: sync 比较 local package 是否 up-to-date 时,应把 compatDependencies 解析出的**当前**绝对路径一并纳入比较(路径漂移即需重装,而不是 content hash 相同就跳过);或让 compat 依赖不绑定 checkout(相对 profile 的稳定形式)。
- **更新**: 2026-09-20 记录(主 checkout 的 storage-artifacts 完好,仅 profile 记录陈旧)。

### [D005] 硬链接部署让 manifest 改动对运行体立刻生效,声明与产物不同步即启动即崩
- **状态**: 待评估(2026-09-20 change `dsh-memex-settings-ui` 实机踩到,已恢复)
- **现象**: 在仓库里给已部署的 local package 的 `package.json` 加上 `dsh.client`,而对应的 `lib/client.js` 尚未部署(sync 被 D004 的 pnpm 失败挡住)时,下一次启动直接失败:`plugin tree failed to load … client bundles not found … package: dsh-memex, path: ~/.dsh/profiles/web/node_modules/dsh-memex/lib/client.js`。整个 profile 起不来(不是降级),需要用主干重新 build 才恢复。
- **根因**: profile 以 pnpm `file:` 依赖安装 local package,**部署副本与仓库源是硬链接**(同一 inode,`stat -f %l` links≥3)→ 编辑仓库 `package.json` 等于直接改线上 manifest;而 loader 在启动期读 `dsh.client` 并要求入口文件存在。
- **为什么 sync 的既有校验救不了**: `missingDeployedFiles()` 能检出"声明了却没有产物",但它在**下一次 sync** 才运行,而 manifest 的变化对运行体是**立刻**的 —— 顺序上无解。
- **候选修复(待评估优先级)**:
  1. **流程规则**(零成本,已写入 `docs/notes/dsh-plugin-integration-pitfalls.md`):新增启动期要求时,声明与满足它的文件必须在同一次 `dsh build` 里落地;sync 无法完成部署时先把声明撤回。
  2. **部署解耦**: profile 改用 `package-import-method=copy`(或等价方式),让部署副本成为独立副本 —— 仓库编辑不再影响运行体,半截状态不可见。代价:磁盘与部署耗时上升,需复核 sync 的"部署副本一致性"校验是否仍成立。
  3. **构建前置**: `dsh build` 在启动/重启前校验"每个声明了 `dsh.client` 的包,其入口产物已存在于部署副本",不满足则拒绝重启并提示(把崩溃提前成明确报错)。
- **更新**: 2026-09-20 记录(恢复方式:主干 `dsh build` 补齐产物后重启)。

---

## 待立项

### [U005] profile `.npmrc` 应由 sync 物化(全新 DSH_HOME 必然装不全)
- **状态**: 待立项(2026-09-05 用全新 DSH_HOME 实测复现)
- **优先级**: P2(不影响现役部署;影响换机器/重建 `~/.dsh`/新建隔离 home)
- **实测复现**: 全新 `DSH_HOME` 跑 `node scripts/sync.mjs`,**4 个 remote 包安装失败**
  (`dsh-better-sidebar` / `dsh-sidebar-qa` / `dsh-cockpit-bridge` / `dsh-setting-restart`),
  全部是 `ERR_PNPM_FETCH_404 GET https://bnpm.byted.org/<pkg>` —— profile 的 pnpm
  继承了用户级 `~/.npmrc` 的内网 registry,而这些是公共包。
- **根因**: profile 目录的 `.npmrc` **不受 sync 管理、不在版本控制**,属手工文件。
  仓库根 `.npmrc` 早已声明「统一 npmjs + 需要特殊源的包可追加 scope 级覆盖」,
  但该策略从未下沉到 profile 层。
- **正确内容(已手工写入现役 `~/.dsh/profiles/web/.npmrc`)**:
  ```
  registry=https://registry.npmjs.org/
  @byted:registry=https://bnpm.byted.org
  ```
  两行缺一不可:只写第一行会让内网包 `@byted/dsh-traex-bridge` 404
  (2026-09-05 实际踩过:6.1 物化时为修公共包 404 一刀切指向公共源,
  反而打断了 `dsh build`);只依赖 `~/.npmrc` 则公共包 404。
- **建议**: manifest 增加 registry 覆盖声明,由 sync 与 `cordis.patch.yml` 同待遇物化
  (带 generated 标记头),使新建 home 开箱即可装全。
- **临时规避**: 新建/重建 DSH_HOME 后手工写入上述两行再跑 sync。
- **更新**: 2026-09-05 记录。


### [U004] dsh-cockpit 认证生命周期缺陷(token 轮换断连 + 已配置状态不可见)
- **状态**: 待立项(2026-09-05 主 checkout 升级到 0.1.2 后用户实测发现)
- **优先级**: **P1**(第 1 条为高频断连)
- **归属**: `dsh-cockpit` 仓库(本仓库的运行体迁移已完整,这些是驾驶舱侧缺陷)
- **问题**:
  1. **DSH 重启即断连且不能自愈(P1)**:`0.1.2` 的 launch token **每进程新生成**,而 cockpit 持久化的是 token 而非 cookie(`registry.ts` 的 `dshLaunchToken`),且 `createDeviceProtocol` 在**每次连接/重连**时都用它重新 exchange(`device-lifecycle.ts:499`)。DSH 一重启:token 作废 → 连接断 → 重连拿旧 token 换 → **401** → `DSH_UNAVAILABLE`,退避重试多少次都是同一个作废 token。**已实测**:重启前 token 换 cookie 返回 401,当前 token 返回 303。
     - 补充事实:签名密钥持久化在 DSH 凭据库(`credentialKey("client-connection","browser-session")`),故**已签发的 cookie 跨重启仍有效**(实测 200)——cockpit 用不上这个性质,只因为它每次重连都从 token 重来。
  2. **已配置 token 不可见(P2)**:`draftFor()` 每次把编辑框置空,而公开面(`publicRecord` 已剥离 token)**连「是否已配置」的布尔标志都没有**。用户打开编辑看到空框,无法区分「从没配过」与「配过但不回显」——看起来像没保存成功。留空不提交该字段是有意设计(避免编辑显示名时误清 token),但缺少状态提示。
  3. **无清除入口(P3)**:后端支持 `clearDshLaunchToken`,前端没有任何 UI 入口,配错了无法清除。
- **建议方案**: 1 与 2 连着做 —— cookie 持久化进 0600 设备存储(重连先用 cookie,401 再回退 token),认证状态随之成为可展示事实(有无有效 cookie / 何时过期),顺势解决 2;3 补一个清除按钮。
  - ⚠ 该方案会改动 cockpit 现有的明文承诺「cookie 仅在连接代内存中持有,绝不落盘」,须走正式 spec 修订并重新论证信任面(注:它本就持久化着能换取 cookie 的 token,信任面未实质扩大)。
  - ❌ 不采用「cockpit 读 `~/.dsh` 取最新 token」:破坏其「绝不读 `~/.dsh`、日志或 provider credential」的边界承诺。
- **临时规避**: DSH 重启后到驾驶舱设备编辑里重新粘贴当前启动 URL(`grep -o 'http://127.0.0.1:3080/?token=[A-Za-z0-9_-]*' ~/.dsh/dsh.log | tail -1`)。
- **更新**: 2026-09-05 记录。


### [U003] `@tangzai/dsh-ui-archive-manager` 适配 DSH 0.1.2 后重新启用
- **状态**: **待上游发布**(2026-09-05 因 0.1.2 不兼容而临时禁用;⚠ **上游已修好,只差发版**)
- **优先级**: P2
- **背景**: 该插件的 client bundle `require("@deepseek-ai/dsh-client-runtime/client")`,而该包在 DSH 0.1.2 线被上游移除。后果不是它自己失效,而是 **materialize 时抛错并中止整个 client module loader**,所有插件的浏览器半区一起不可用(由 dsh-cockpit 仓库 change `adapt-dsh-012-typert-gateway` 验收时实测发现)。
- **处置**: `dsh.yaml` 中 `enabled: false`(禁用≠删除)。归档会话的查看/恢复功能暂缺——官方仍只有 `archiveSession` 无 unarchive(上游 Discussion #2613 的原始缺口依然存在)。
- **上游修复现状(2026-09-05 clone 核实)**: `Neumannzc/dsh-archive-manager` 的 `main` 分支 tip commit `06ea996`「兼容最新版本」(9月4日)**已完成适配**,且 `plugin/package.json` 版本已 bump 到 `0.1.2-rc.1`:
  - 根因只有一行 —— client bundle `require("@deepseek-ai/dsh-client-runtime/client")` 仅为取 `defineStore` 一个函数;0.1.2 把它搬到 `@deepseek-ai/dsh-client-store`,**签名逐字节相同**;
  - 上游改动即 `import { defineStore, type StoreHandle } from '@deepseek-ai/dsh-client-store'`,并把 inject 换成 store / session-controller / workspace-controller 等实际承接包;
  - **host 半区零改动,信任面未扩大**(仍是既有的 unarchive 幂等补丁 + webServer 路由信任防护)。
- **阻塞点**: 该修复**未发布**到 npm(registry 仍只有 0.1.0 / 0.1.1),也未打 tag / release,故无可 pin 的发布物。
- **重新启用条件(方案 A:等上游发布)**: upstream 把 `0.1.2-rc.1` 发到 npm 后,改 `dsh.yaml` 的 spec/version 并 `enabled: true`,按 `add-dsh-plugin` 流程复核发布物,再跑「loader 可执行」审计(见 change `dsh-0-1-2-host-api-migration` 的 baseline B1-补)。
- **已否决的方案 B(从 git commit 自建安装)**: 上游仓库不含构建产物(`files: ["lib"…]` 但 git 无 `lib/`),需自行 `pnpm install && pnpm build` 再打包 —— 那会从「pin 一个发布物」变成「vendor 并自建」,与本仓库「remote 定制只存精确版本 pin、不 vendor 远端源码」的核心原则冲突。如确需提前启用,应作为一次显式记录的例外单独立项,而非顺手为之。
- **数据安全**: 禁用不影响已归档会话本身(数据在 DSH 自有 session 存储),仅暂时失去查看/取消归档的 UI 入口(官方至今只有 `archiveSession` 无 unarchive —— 这正是该插件存在的理由)。
- **更新**: 2026-09-05 记录。主 checkout 已于同日升级到 `0.1.2-rc.1`(启动清单 19 项),该插件在日常部署中亦为禁用状态;上游发版后按上述条件恢复即可。


---

## 待评估插件

### [P001] dsh-ego-browser:让 agent 自行完成 Web 端验收
- **状态**: 暂缓 —— **重评估条件部分满足(2026-09-05)**:运行体已到 `0.1.2` 线,但另两项前置仍未满足(见下),故维持暂缓
- **优先级**: P2
- **背景 / 动机**: 本仓库每次插件升级的 Web 端验收(设置页时钟、侧边栏面板、划选提问等)都必须由用户手动重启并肉眼确认,agent 无法自证。`dsh-ego-browser`(https://github.com/Fisfzy/dsh-ego-browser,MIT,npm `dsh-ego-browser@0.8.0`)提供 30+ 个 `ego_*` 工具(`ego_navigate` / `ego_snapshot` / `ego_click` / `ego_read_element` / `ego_screenshot` 等),内置 ego-lite 运行时驱动 Chromium,理论上可让 agent 自己打开 `127.0.0.1:3080` 完成这类验收,把"必须人工看"的验收项转为可自动化。
- **暂缓理由(2026-09-04 审查 npm 0.8.0 发布物)**:
  1. **peer 为精确 pin 且不满足任何目标运行体**:`@deepseek-ai/dsh-client-runtime` 等声明为 `0.1.0-rc.8`(精确写法,非范围),对现役 `0.1.1-rc.2` 与阶段四目标 `0.1.2-rc.1` 均不满足;本仓库 spec `repo-layout` 亦明确禁止运行体 peer 用精确 pin(升级后可能解析出第二份同名包,造成同一模块双实例);
  2. **依赖 0.1.2 线已移除的包**:其 `dsh.client.inject` 含 `@deepseek-ai/dsh-client-runtime` —— 正是 change `staged-dsh-and-plugin-upgrade` 的 spike 确认在 `0.1.2` 线被上游移除的包。用它来验证"移除该包之后系统是否正常",等于用待验证对象验证其自身;
  3. **引入时机会破坏故障二分**:它会 spawn Chromium、下载托管 FFmpeg 到 `~/.dsh/cache/ego-browser/`、vendored 整个浏览器运行时(1.2MB / 44 文件)。在运行体迁移期间引入,故障源会从"升级"变成"升级 + 新插件",与本 change 分阶段的初衷冲突。
- **重评估条件**: 阶段四完成(运行体到 `0.1.2` 线)后,且上游已跟进 `0.1.2`(`dsh-client-runtime` 消失后其 inject 必须改)、peer 改为范围写法。届时按 `add-dsh-plugin` 流程走**独立 change**,重点审查信任面 —— 它是本仓库迄今信任面最重的候选(spawn 浏览器 + 下载并执行二进制 + CDP 完全控制 + 可读取任意页面内容),需要比普通插件更严格的准入论证。
- **补充**: 平台不是障碍 —— README 显示其为全平台自适应(macOS 用 avfoundation),本机可用;最初"仅 Linux"的印象来自过时的搜索摘要,已按发布物纠正。
- **更新**: 2026-09-04 用户提出、agent 审查发布物后记录;结论是"想法成立但当前不可用",非否决。2026-09-05 运行体迁移完成后复核:三项重评估条件中「运行体到 0.1.2 线」已满足,但 `dsh-ego-browser@0.8.0` 仍精确 pin `@deepseek-ai/dsh-client-runtime@0.1.0-rc.8`,而该包在 0.1.2 线已被上游移除 —— 现在它不只是 peer 不满足,而是依赖了一个不存在的运行体包,**在当前运行体上必然无法装载**。需上游先跟进 0.1.2(改 inject + peer 改范围写法)才可重评估;本次未做新的发布物审查。

---

## 已完成
### [U002] dsh-cockpit 适配 DSH `0.1.2` 的 typert `/api` 网关
- **状态**: **已完成(2026-09-05)** —— dsh-cockpit 仓库 change `adapt-dsh-012-typert-gateway` 已实现并归档(commit d24c0ef);bridge 随之发布 0.3.0,本仓库 manifest 已跟进
- **优先级**: **P1 —— 阻塞主机升级落地**:主 checkout 一旦物化到 `0.1.2-rc.1`,驾驶舱即失去对本机的观测
- **现象**: 驾驶舱连接 `0.1.2-rc.1` 实例报 `DSH_UNAVAILABLE: rc.2 host.describe HTTP 401`
- **根因(已复现并逐项实测,对比 :3080 旧实例与 :3081 新实例)**: `/api` 通道由「非结构化 RPC 代理」换成「typert 网关」,三处同时变:
  1. **认证**: `0.1.1-rc.2` 的 `/api/*` 无需认证;`0.1.2` 需浏览器会话认证,未认证一律 401;
  2. **端点命名**: 点号 → 斜杠命名空间。`session.list` → `session/list`;`host.describe` 与 `workspace.list` 在新版**没有对应端点**(404);
  3. **载荷形状**: `payload` 必须是 `{args:{…}}` 且字段需匹配 descriptor(如 `session/list` 要求 `_request`)。
- **影响面**: 仅驾驶舱对设备的观测。`dsh-cockpit-bridge`(浏览器插件,走 postMessage + 驾驶舱自有协议)**不受影响**,已在隔离实例验证加载正常。DSH 本体与 8 个自研包全部正常。
- **cockpit 侧受影响代码**: `packages/cockpit-server/src/connectivity/rc2-client.ts` —— 依赖 `host.describe`(探活)、`session.list`、`workspace.list` 与 WebSocket `/api/events.<stream>`
- **待决方案(需独立 change)**:
  1. 适配 0.1.2 网关(改端点 + 载荷 + 补认证;`host.describe` 需换探活方式 —— host facts 改由网关 ready 帧的 `$host` 承载,不再是 RPC 方法);
  2. 双协议兼容(探测后走 rc.2 或 0.1.2 两套),适合多设备版本不一致的现实;
  3. 暂时接受驾驶舱对已升级设备不可用,推迟主机升级。
- **注意**: WebSocket 事件流(`/api/events.<stream>`)与 `workspace.list` 的新形态**尚未查证**,立项时需一并审计,不要假设只有 REST 三个端点受影响。
- **更新**: 2026-09-05 记录并同日在 dsh-cockpit 立项(44e17c4)、实现归档(d24c0ef)。最终形态:协议探测双栈并存 + waterfall 立即回 next(不阻塞主机审批)+ pending 观测迁移 bridge 0.3.0 + workspace 基线改读 follow 流 + launch token 换 cookie。**本仓库的跟进动作**:`dsh.yaml` 的 bridge pin 0.2.1→0.3.0(旧版 inject 死包在 0.1.2 上永不激活),以及连带发现并禁用 archive-manager(见 U003)。**操作提醒**:主 checkout 升级后,驾驶舱内本机设备需重新粘贴一次带 token 的启动 URL。

---

### [U001] DSH `0.1.2` host 半区 API 适配(运行体迁移前置)
- **状态**: **已关闭(2026-09-05)** —— 由 change `dsh-0-1-2-host-api-migration` 完成。运行体已升到 `0.1.2-rc.1`,5 个包 host 半区适配、7 包 client inject、8 包 peer 与两个后置插件(`better-sidebar@0.18.0` / `sidebar-qa@0.5.0`)同批合入。下列四个待解破坏点的结论:① `Session.events` → `snapshotEvents()` / `seq`;② `authority: 'loopback'` 的等价机制**存在** —— connection 层对每个 channel 统一施加 Host fence + 浏览器认证,本部署未配置 `trustedHosts` 故边界等价且更严,已用非回环 Host 实测 403 确认(含携带有效 cookie 仍 403);③ `registerContinuableSetup` → `agent/created` + `agent/disposed`;④ `SessionLogOffset(0)` 显式 brand;⑤ 3 例 `no agent factory registered` 是测试装置缺 `dsh-session-projection` 插件,非运行体行为变化。另有 5 处执行中新发现的破坏点已补记于该 change 的 design S-C2。
- **优先级**: P1(已完成)
- **背景**: change `staged-dsh-and-plugin-upgrade` 的阶段四原计划把 `dshVersion` 从 `0.1.1-rc.2` 升到 `0.1.2-rc.1`。实际执行到 6.5 时按 tasks 4.5 的阀门条款**停止并回退** —— spike 只审计了 client 半区,遗漏 host 半区;实测 8 个自研包中 **5 个无法构建**,破坏点均非「等价接线迁移」,超出该 change 的 Non-Goals 边界。
- **已产出的输入(可直接复用,不必重做)**:
  - **client 半区迁移方案已查清**:`dsh-client-runtime` 的 5 个服务面拆到 4 个包,服务名与 `ctx.<name>` 取用形态**不变** —— `sessions`→`dsh-api-session-controller`、`slots`→`dsh-client-ui-renderer`、`workspaces`→`dsh-api-workspace-controller`、`conversation`→`dsh-client-ui-conversation`;`ISessions` 保留 14 个成员,移除的 `currentProvideInfo`/`noteAgentPreset`/`provide` **本仓库无一使用**。详见该 change 的 design S1/S2;
  - **能力基线**:`baseline.md`(自动化 951 例 + 人工清单)已固定并验证过归因作用;
  - **后置插件准入**:`better-sidebar@0.18.0` 可放行;`sidebar-qa@0.5.0` 所需 7 个 `ctx.remote.session.*` 方法全部可得,但 `selectModel`/`modelCatalog` 由 `dsh-client-ui-model-selection` 提供(不在 session-controller 内),验收须确认该包加载,否则静默失效。详见 design S4。
- **待解决的 host 半区破坏(新 change 的 spike 必须回答)**:
  1. **`Session.events` 被移除**(影响 `dsh-pet`、`worktree-session`)—— 两包依赖它读会话事件流(取标题与水位、判定 blank session),替代读取方式未知;
  2. **`connection.rpc.handle` 第三参数被移除**(影响 `system-clock`、`home-network-model-guard`、`session-links`)—— 逐字节对比两版 `dsh-client-connection/lib/types/rpc.d.ts` 确认:`handle(channel, handler, options)` → `handle(channel, handler)`,且 `ConnectionRpcHandlerOptions` 类型在 `0.1.2` 已完全不存在。**⚠ 安全相关**:被删的 `options` 正是本仓库三包统一传入的 `{ authority: 'loopback' }`(把 RPC 通道限制在本机回环的显式声明)。在查清 `0.1.2` 的等价机制前**不得机械删参** —— 那等于静默放弃一道安全边界,违反仓库「安全路径 fail closed」原则;
  3. **`SubagentRuntime.registerContinuableSetup` 被移除**(影响 `worktree-session`)—— 承载 continuable subagent 建立策略,是 Worktree Session 核心路径;
  4. **`SessionLogOffset` 类型收紧**(影响 `session-links`)—— `number` 不再可直接传入。
  另有 `worktree-session` 3 例测试因 `no agent factory registered` 失败,需一并查明。
- **准入要求**: 新 change 的 spike 必须**同时覆盖 host 与 client 两个半区**,不得再以「客户端包只影响客户端」为由缩小审计面 —— 这正是本次失误的根因。
- **更新**: 2026-09-04 由 change `staged-dsh-and-plugin-upgrade` 阶段四停止时记录;2026-09-05 由 change `dsh-0-1-2-host-api-migration` 完成并关闭。

---

### [B015] 跨机器访问 DSH:局域网访问(secure context)
- **状态**: 已完成(SSH 隧道方案;HTTPS 直连形态未采用,见下)
- **优先级**: P1(2026-08-24 用户明确要推进:`dsh web` 支持 192.168 内网 IP 访问 + HTTPS)
- **终选方案(2026-08-24)**: **SSH 隧道**——`ssh -N -L 3080:127.0.0.1:3080 user@192.168.64.3`,浏览器开 `http://127.0.0.1:3080`。用户诉求「有没有类似 ssh 那种免登方案」直接命中:一条路同时解决三件事——公钥免登(`authorized_keys`,强于密码)、SSH 自带传输加密(强于自签 TLS 且无证书告警)、**浏览器侧回环即天然 secure context**(`randomUUID` 原生可用,无需 HTTPS/证书/polyfill,绕过本条最初的闸门);且 DSH 保持 `127.0.0.1` 绑定,局域网**零端口暴露 agent**,暴露面小于任何直连方案。使用说明与验证记录见 `docs/notes/lan-access-ssh-tunnel.md`;能力已抽成 `dsh-tunnel` skill(manifest 条目,含附带脚本,随 sync 部署到 `~/.dsh/skills/`,可自然语言触发)。
- **端到端验证(2026-08-24,本机临时密钥自连,测试后已撤销)**: 隧道建立成功;GUI 首页 HTTP 200(含 `__DSH_BOOT__`);`/api/respond` 响应与直连 3080 完全一致(官方信任围栏对回环 Host 天然放行);`/api/events.mux` WebSocket **101 Switching Protocols**;直连 `192.168.64.3:3080` 连接失败(符合预期)。
- **部署现状(2026-08-24 最终)**: 终选 **SSH 隧道**为唯一跨机器访问形态。`lan-gate` manifest 条目**已彻底删除**(非禁用),包已卸载;`web.lan` 保持 false 并在注释中标注「不使用明文局域网直连」及 `DSH_LAN` 同样不得设置;DSH 绑回 `127.0.0.1`,局域网零端口暴露;未安装任何代理/polyfill 插件。移除后核验 7 项无残留:profile patch 无 `0.0.0.0`、bundles/dependencies 无该包、node_modules 已删、`~/.dsh/lan-gate*.json` 已清理、`DSH_LAN` 未设置、无 `.env.local`。中途曾短暂启用直连并实测生效(启动行 `dsh web: http://127.0.0.1:3080 (LAN: http://192.168.64.3:3080)`,绑定 `*:3080`),用户确认只保留安全方案后彻底移除。隧道用法见 `docs/notes/lan-access-ssh-tunnel.md`。
- **直连形态为何被弃用**: 明文 HTTP,同网可嗅探密码与 cookie(lan-gate 自述 not a TLS terminator);且 `ui-archive-manager` 硬编码 `TRUSTED_HOSTS = []` 会挡掉 LAN 下的归档恢复路由。用户明确「不要不安全的」,故不保留该形态。
- **背景 / 动机**: 本机启动 DSH 后,希望在同局域网的另一台机器上使用。现有 `web.lan`(dsh.yaml `web.lan` / `DSH_LAN`)已能绑 `0.0.0.0` 并打印局域网地址,但访问走的是明文 **http://192.168.x.x:3080**,浏览器判为**非安全上下文**。真正的问题不是地址栏「不安全」标记,而是 secure-context-only API 直接不可用——DSH 的 RPC id 生成路径在用 `crypto.randomUUID()`(`dsh-client-connection/lib/client.js:6179` `RpcId(crypto.randomUUID())`,同包 `:242`、`dsh-client-ui-conversation/lib/client.js:63` 各一处),非 localhost 明文 HTTP 下 GUI 大概率整体不可用,而非「能用但有警告」。
- **上游态度**: `@deepseek-ai/dsh-host-webserver` 用 `node:http`,README 明确「No TLS, auth, or origin policy」,并把 TLS 归为 dev-facing v1 范围外、建议**前置真正的反向代理**;host 配置 schema 只接受 `127.0.0.1` / `0.0.0.0`。核心不会提供 HTTPS,方案必须在插件或代理层解。
- **社区选型(2026-08-24 调研,npm)**:
  - **polyfill 派**(仍明文 HTTP,补 randomUUID 使 GUI 可用,警告仍在):`dsh-lan-access` 0.1.3(MIT)、`@woyeshishen/dsh-lan-access` 1.0.4、`dsh-lan-bridge` 0.2.1、`@huxy/dsh-lan`。
  - **TLS 代理派(首选)**:`@wingsky-1/dsh-lan-proxy` 0.1.12(MIT,repo wingsky-1/dsh-plugin-hub)——`0.0.0.0` 上 HTTP(3081)+ **HTTPS(3443)** 并存,转发到回环 3080;重写 Host/Origin 以过 `/api` 浏览器信任围栏,只接受 IP 字面量或 localhost 的 Host 头(DNS 重绑定防护);证书自动自签名或走 `tlsCertFile`/`tlsKeyFile`;另含 events.mux/events.host 的 permessage-deflate(自述省 75~79% 流量)。⚠ 安装即在 3081/3443 开监听。
  - **门禁派**(正交,补上游缺失的 auth):`dsh-lan-gate` 0.1.2(MIT)、`dsh-lan-pass`、`dsh-lan-gateway` 0.2.1(**无 license 字段,慎用**)。
  - **隧道 / 远程派**(走公网 HTTPS 域名,证书天然可信):`dsh-remote-plugin` 0.6.13、`dsh-remote-desktop` 1.6.1、`@polaris-l/dsh-mobile-remote` 2.4.1、`@xgone/dsh-remote`(登录门禁 + TOTP + 签名 cookie)。
- **倾向方案**: `@wingsky-1/dsh-lan-proxy` + **mkcert 自签 CA**(证书经 `tlsCertFile`/`tlsKeyFile` 注入)。理由:拿到真正的 secure context(randomUUID 等 API 原生可用,不靠 polyfill 绕过),另一台机器装一次 root CA 后**地址栏零警告**;不装 CA 时用其自签名证书也能跑,仅首次需手动放行。
- **前置条件(两条,立项即须处理)**:
  1. **暴露面**:局域网开放的是完整 agent 面(bash / 文件读写),`dsh.yaml` `web.lan` 注释已标注「仅可信网络开启」。长期开启须叠加门禁派插件,不裸奔。
  2. **与已装插件的已知冲突**:`ui-archive-manager` 的 `TRUSTED_HOSTS` 默认空 → 仅限 loopback(127.0.0.1/localhost),**开启 web.lan 需源码加 trustedHosts**(见 dsh.yaml 该条目 note),否则局域网下其路由会被信任防护挡掉。
- **开放问题**:
  1. 证书方案:mkcert 自签 CA(需在每台访问设备装 root CA) vs 内网 CA 签发 vs 直接走隧道派用公网证书;
  2. 是否把 HTTPS 能力纳入 `dsh.yaml` `web` 段(如 `web.https`)由 sync 统一渲染,还是仅作为 remote 定制条目接入;
  3. 门禁强度:密码 / CIDR 白名单 / TOTP,以及与 `web.lan` 开关的组合语义;
  4. 是否顺带评估隧道派以覆盖「不在同一局域网」的场景(与 B004 轴 B 的多机委派正交)。
- **本机现状核实(2026-08-24,推进前实测)**:
  - `dsh.yaml` `web.lan` 当前 **false**(默认关);`scripts/sync.mjs` 的 `LAN_FRAGMENT` 在开启时渲染 `webserver.config.host = ctx.webStartup.host ?? '0.0.0.0'`,manifest 校验只接受布尔,`DSH_LAN` env 优先级高于 manifest;
  - 本机 LAN 地址 = **192.168.64.3**(en0,网关 192.168.64.1),与用户诉求的 192 段一致;
  - secure-context 闸门**已核实存在**:当前部署的 client bundle 中 `crypto.randomUUID()` 共 9 处调用,其中浏览器侧关键路径 3 处(`dsh-client-connection/lib/client.js:242`、`:6181`,`dsh-client-ui-conversation/lib/client.js:62`),非安全上下文下该 API 为 `undefined`([MDN:randomUUID 仅安全上下文可用](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID));上游已有两条同题讨论确认 GUI 直接不可用而非仅告警([#4209 mintRpcId 报错](https://github.com/deepseek-ai/deepseek-harness/discussions/4209)、[#2396 LAN 绑定不可用](https://github.com/deepseek-ai/deepseek-harness/discussions/2396));
  - `dsh-web-app` 侧已内建 LAN 信任推导:`resolveLanTrust()` 在 bind 为 `0.0.0.0` 时枚举非内部 IPv4 作为 `trustedHosts`(**无端口的 IP 字面量**,注释说明 DNS 重绑定需攻击者可控域名故 IP 字面量安全),另有 `--trusted-host` CLI 可追加 → **官方 `/api` 围栏本身不阻挡局域网 IP 访问**,阻挡点只在 secure context 与第三方插件各自的围栏;
  - `ui-archive-manager` 冲突**已核实**:`lib/index.js:38` `const TRUSTED_HOSTS = []` 硬编码空数组(非配置项),`:104` 处非 loopback 且不在该数组即拒绝 → 局域网下其 unarchive 路由必被挡,需 patch 源码或接受该功能在 LAN 下不可用;
  - `@wingsky-1/dsh-lan-proxy` **npm 核实**:0.1.12,MIT,2026-08-23 更新(活跃),`dsh.bundle` + `dsh.client`(platform web)双面,运行依赖仅 `schemastery`,peer 仅 react;
  - 工具链:本机 **mkcert 未安装**(brew 可装),`openssl` 可用(`/usr/bin/openssl`)。
- **关键否决:TLS 代理与密码门禁不可叠加(2026-08-24 源码审查实证)**:
  - `dsh-lan-gate` 的准入判定基于 **`socket.remoteAddress`**(`lib/admit.js`,`SECURITY.md` 明写「uses socket.remoteAddress, not Host / X-Forwarded-For」);
  - `@wingsky-1/dsh-lan-proxy` 在 `0.0.0.0` 终结连接后**自己作为客户端**转发到回环,故到达 gate 的对端地址恒为 `127.0.0.1` → 命中 `loopbackBypassAuth`(默认 true)→ **门禁被完全旁路,局域网任何人免密获得完整 agent**;
  - 反向也不通:gate 的 `rejectProxyHeaders` 默认 true,代理若补 `X-Forwarded-*` 则请求被 403 全拒。两条路均不可用,**故否决「代理 + 门禁」组合**;
  - 附:lan-proxy 本身代码质量良好(targetHost 强制回环否则拒启、Host 仅收 IP 字面量/localhost 防 DNS 重绑定、自签证书 0600/825 天/SAN 含本机 LAN IP、无 child_process/无外联),但**不含任何认证**,且 HTTPS 失败会静默降级为明文 HTTP(仅 warn),留待 HTTPS 阶段重新评估。
- **中间态(已回退)**: 曾接入 `dsh-lan-gate@0.1.2` 拿到「内网 IP 访问 + 密码/CIDR 门禁」,但仍是明文 HTTP(同网可嗅探密码与 cookie,gate README 自述「not a TLS terminator」)。改用隧道后该条目 `enabled: false`,包已从 bundles 卸载。
- **未采用的 HTTPS 直连路线(留作移动端场景备选)**: 自研薄层在 `dsh.yaml` 加 `web.https`,用 `https.createServer` **包裹同一个 server**(而非代理转发)以保留真实 `socket.remoteAddress`,从而与门禁兼容;进阶可加 mTLS 客户端证书实现浏览器原生公钥免登。仅当需要手机/平板访问(隧道不便)时才值得投入。
- **更新**: 2026-08-24 新增;完成 backlog 选型调研与前置条件梳理,未立项、未安装任何插件;2026-08-24 用户明确要求推进(内网 IP + HTTPS),升 P1 并进入讨论中,完成本机现状核实(web.lan 现状 / LAN IP / secure-context 闸门与上游讨论 / 官方 trustedHosts 推导机制 / archive-manager 硬编码冲突 / lan-proxy npm 元数据 / mkcert 缺失),仍未安装任何插件;2026-08-24 审查 lan-proxy 与 lan-gate 源码后**否决代理+门禁组合**(代理使对端 IP 恒为回环,门禁被 loopback 旁路),改为先只装 `dsh-lan-gate@0.1.2` 拿到「内网 IP 访问 + 密码/CIDR 门禁」,HTTPS 留作下一步(倾向自研 TLS 包裹同一 server 以保留真实对端 IP);2026-08-24 用户提出「有没有类似 ssh 那种免登方案」后终选 **SSH 隧道**——公钥免登 + SSH 加密 + 回环天然 secure context,一举满足全部诉求且暴露面最小,`lan-gate` 随之禁用回退,HTTPS 直连路线转为移动端场景的备选,本条归档为已完成。

### [B007] 类似 Claude 的 /btw 沟通模式
- **状态**: 已完成
- **背景 / 动机**: 增加类似 Claude Code `/btw`(by the way)的沟通方式:发一条消息让 agent 只记录、不立即处理,不打断当前任务。
- **要点**:
  - 入口形态:slash 命令或输入触发;先查 DSH 现有 command/input-trigger 机制(`dsh-client-ui-commands`、`dsh-client-ui-input-trigger`)的扩展点;
  - 语义:低优先级侧注,不触发即时行动,写入持久记忆;
  - 存储位置待设计:会话内记忆 vs workspace 文件(如 NOTES.md)vs 任务级;
  - 消费时机:当前任务完成后回顾,或后续任务开始时带上;
  - 待设计:多任务并行时 btw 的归属(属于哪个任务/会话)、与 goal/todo 列表的交互;
  - 社区调研(2026-08-24):同类实现已有**三家**,核心语义一致 = fork 独立子会话 / 独立会话,不打断主线程:
    - **[dsh-sidechain](https://github.com/omdsh-dev/dsh-sidechain)**(omdsh-dev,GitHub 源,**npm 未发布**):`/btw <问题>` 一次性侧问(后台单轮,只读不可续问)+ `/side <问题>` 可持续侧会话 + `/side list`;fork 当前会话,侧会话日志/工具活动不写主历史,默认只读 persona;适配声明至 `0.1.1-rc.1`(当前 pin rc.2 待验证);README 安装示例指向 `Buyi-wsgzg` org,与现仓库不一致,接入前确认来源;
    - **[dsh-air](https://github.com/kaieye/dsh-AIR)@0.1.2**(npm,MIT):`/btw [问题]` 打开停靠式侧边对话(`/side` **等价别名,可持续追问**,区别于 sidechain 的只读一次性 /btw)+ 侧边栏内嵌问答;顺带 ↑/↓ 历史发送记录召回 + Ctrl+R 搜索(localStorage,上限 500 可调 10–5000);输入框历史与侧问打包,键盘党顺带收益;实现 = 纯 client(input-trigger 劫持 `/btw` 提交 → 官方 `sessions.fork`(已完成 turn 前缀,主会话进行中 fallback `create`+快照) → 首条 prompt 注入隐藏 boundary 信封(继承历史仅参考/禁工具改动/禁子代理) → 抽屉渲染子会话原生树,主会话不产生模型回合、历史与视口不动),语义对齐 Codex TUI side conversation(源码注释逐条对照 `codex-rs/tui/src/app/side.rs`);**模型选择 = 零干预**:无 selectModel 调用,面板无模型 UI——fork 子会话模型继承父会话当前模型(fork 契约仅 sessionId/atSeq/increaseTitle,host 端按 boundary 复制含 request/header 的事件日志,ModelDirectory current 随之恢复),fallback create 空会话用部署默认 `agent-default-model`(本机 = codex/gpt-5.6-sol/high);**上下文感知分路径**:fork = 完整感知(全量已完成事件含工具调用,仅以 boundary 标记为参考),fallback = 文本级部分感知(`<parent-thread-snapshot>` 可见节点序列化:user/assistant 文本 + tool-result 参数输出 + 在途 partial/runningCalls,reasoning 块故意排除);
    - **[dsh-sidebar-qa](https://github.com/ChenRuoT/dsh-sidebar-qa)@0.4.0**(npm,MIT):划选任意文本 → 「提问」浮层 → 侧边栏内嵌问答(独立会话 `❓<主题>`,可继续/归档);三种上下文策略 = `sessions.fork` 全量继承(前缀缓存命中)/ 压缩 / 机械裁切;嵌套追问 + 追问记录树(归档/删除置灰);**功能最全但依赖第三方 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) ≥0.14.0**(对应 DSH 0.1.0-rc.8 起,rc.2 peer 解析待验证),多一件依赖、信任面更大;
    - 旁类(非侧问,记录备查):[dsh-session-fork](https://github.com/Jason-skd/dsh-session-fork)(npm,「会话 = 分支」范式:并行分支 + squash 回主 + 内置 branch 图,Wiki 宣称与 git worktree 搭配——与 worktree 会话精神同向,关联 B014)、dsh-routed-subagent(bpc-oss:one-shot subagent 挂任意 preset + per-call 模型覆盖);
  - 匹配度:三家均覆盖「/btw 不打断主会话」核心诉求;「只记录、不立即处理」的纯记忆形态(写 NOTES.md 待回顾)三家均未覆盖,如需可叠加;
  - 选型结论:语义最贴 = sidechain;顺带历史召回 = dsh-air;功能最全 = sidebar-qa(代价:better-sidebar 依赖链)。**终选 sidebar-qa**,已按 add-dsh-plugin 流程接入并确认 DSH 0.1.1-rc.2 兼容;
  - 落地形态:`better-sidebar` 0.15.2 + `dsh-sidebar-qa` 0.4.0(manifest 均已启用),划选任意文本 → 「提问」浮层 → 侧边栏内嵌问答(独立会话,可继续/归档),默认 compressed 上下文策略省 token;
  - 未覆盖项(如需另立项):「只记录、不立即处理」的纯记忆形态三家均未提供；`dsh-memex-scoped-memory` 提供的是经过可复用写卡判据筛选的长期知识卡片，也不等于 `/btw` 的无处理暂存队列。若仍需要该语义，应另做 inbox/capture 层，而不是把临时消息污染进知识库。侧问上下文看不到主会话**进行中**的 tool call / 流式输出(实现所限,完整性与省 token 不可兼得)。
- **更新**: 2026-08-14 新增;2026-08-24 完成两轮社区调研:首轮发现 dsh-sidechain,二轮确认同类共三家(sidechain / dsh-air / dsh-sidebar-qa)并拉齐对比,诉求核心普遍被覆盖,推进为讨论中,待选型试用;2026-08-24 试装 dsh-air 后弃用(=/btw fork 子会话全量继承父历史,每轮重复计费,主模型 codex 订阅无前缀缓存保障,侧问会话堆积),终选 sidebar-qa(better-sidebar 0.15.2 + dsh-sidebar-qa 0.4.0 已入 manifest 并合入 main,默认 compressed 策略省 token),待实测归档;2026-08-24 sidebar-qa 实现审查结论(源码核实):侧问发起零阻塞——create/fork 独立会话、prompt 走 queue,主对话进行中 inherit 自动降级 compressed(fork 需已完成 turn);host 仅对主会话只读 readSurface + 快速模型 160 token 摘要,不改主会话;侧问上下文只含已完成落盘内容,**看不到进行中 tool call/流式输出**(与 dsh-air 的 interrupted snapshot 携带在途状态相反,完整性/省 token 不可兼得);2026-08-24 日常使用确认 sidebar-qa 已满足诉求,归档为已完成。


### [B009] 仓库结构定稿:总配置 + 可插拔定制(monorepo)
- **状态**: 已完成
- **优先级**: P0
- **背景 / 动机**: zydsh 预期承载大量 DSH 定制(preset、插件包、skill、profile patch 等),期望一个总配置统一管理,各项定制可插拔开关、各自独立发布维护,但都放在同一仓库内。
- **要点**:
  - 目标形态:monorepo;根级"总配置"(manifest)声明启用哪些定制;每项定制独立目录(或包),可单独启用/禁用;
  - 定制类型盘点:agent preset、host 插件包(llm provider / subagent 接线 / 工具)、skill、cordis.patch 片段、启动脚本(`scripts/dsh.fish` 已有);
  - 发布/维护:每项定制独立版本(各自 package.json 或独立版本记录),总配置按版本引用;
  - 部署同步:总配置 → `~/.dsh` 落点(`.agent-presets/`、`profiles/web/cordis.patch.yml`、profile node_modules)的同步工具(`dsh plugin add` / 脚本);
  - 结合此前草案:`plugins/`、`presets/`、`profile/`、`skills/` 布局;与 openspec 工作流、BACKLOG.md 配合;
  - 待设计:目录布局、总配置格式(JSON/YAML)、开关粒度(全局 vs per-session)、多定制间依赖关系。
  - 方向定稿(2026-08-14):定制单元采用社区 `dsh.bundle` 标准(package.json 声明 bundle + 自带 cordis.patch.yml + src/),patch 跟包走;presets 走官方 `.agent-presets` 机制;skills 跟包或 project 源;总配置 manifest + sync 为自研薄层。
  - 结构定稿文档位置(2026-08-19):`README.md`(目录结构 + 真相源约定 + sync 用法)、`dsh.yaml`(manifest 契约:customizations / 顶层 `dependencies` / 字段约定)、`packages/README.md` / `presets/README.md` / `patches/README.md` / `skills/README.md`(各类定制单元规范);设计过程见 openspec change `repo-layout`(design D7/D8 定稿,归档后移入 `openspec/changes/archive/`)。
- **更新**: 2026-08-14 新增,即定 P0;同日方向定稿,进入 openspec 设计(change: repo-layout);设计定稿 + 实施完成(骨架 / `dsh.yaml` / `scripts/sync.mjs` / 迁移,spike 与 spec 场景验收通过),首个 remote 定制 cost-meter 纳入,首个按新结构落地的定制 subagent-codex(remote 包 + 顶层 dependencies + patches 接线)落地(2026-08-19);4.6 重启验收通过(cost-meter host+client 加载、subagent 两行激活、`dsh restart` 子命令补充);2026-08-19 openspec 归档完成(`2026-08-19-repo-layout`,主 specs 8 需求/16 场景),B004 codex 委派端到端验收通过,本条目完成。

### [B003] IDE 集成:打开当前项目目录
- **状态**: 已完成
- **背景 / 动机**: 增加用 IDE 打开当前项目目录的能力,暂时只支持 VSCode。
- **要点**:
  - 方案定稿(2026-08-19):复用社区插件 [dsh-open-in-vscode](https://github.com/omdsh-dev/dsh-open-in-vscode) v0.1.6——workspace 行 `…` 菜单「在 VSCode 中打开」,host 侧 spawn `code <path>`(进程分离);MIT,源码已审,无模型可见面;
  - npm 0.2.0 已 unpublished,按官方 README 用 tag v0.1.6 tarball 直装(manifest id: `open-in-vscode`,非 npm spec 显式 `name` 字段);sync 为此支持非 npm spec;
  - 未来扩展:JetBrains 等——插件 config 的 `command`/`args` 可配任意编辑器 CLI。
- **更新**: 2026-08-14 新增;2026-08-19 落地社区插件方案,重启验收通过(菜单打开 VSCode 正常),本条目完成。

### [B013] 侧边栏会话列表每个 session 前显示当前模型 icon（provider logo）
- **状态**: 已完成
- **优先级**: P2
- **背景 / 动机**: 多模型混用(DeepSeek / Codex / Claude / Grok 订阅等)后,不进入会话看不出各会话正在用哪个模型;希望在侧边栏会话列表**每个 session 标题前**放一个类似 icon 的模型标识(provider logo / 缩写徽标),一眼区分。
- **要点**:
  - 落地形态:session 行**前置** provider logo SVG,以该会话输入框**当前选中的下一次请求模型**为基准,选择器切换成功即立即切换 logo;官方 model-selection 的 per-session `ModelDirectory.store` 为真相源,host projection 仅作未打开历史会话的冷启动 fallback;
  - 实现路线:**轻量 DOM 注入 + 独立 `row-locator` 模块**(role="treeitem" + 标题反查,避免 hashed class),不重写官方浏览器;官方 session 行无 per-row slot,升级只修 row-locator 一处;
  - 边界:不触碰官方 StateDot / 时间 / 菜单 / 拖拽,保持官方原样;
  - logo:品牌 SVG 下载随包固定保存(DeepSeek/OpenAI/Anthropic/Grok/OpenCode 等),不手绘;未知/兼容 route 按 model fallback,再未知取首字母;
  - 设计过程、替代方案对比(影子替换 browser 被否、dsh-sentinel 依赖不存在契约)见 openspec change `sidebar-session-provider-icon`(已归档)。
- **更新**: 2026-08-20 新增并明确形态,社区调研确认无现成同款需自研;2026-08-21 初版落地 + 实机反馈修订(provider 基准改输入框当前选择、替换为真实品牌 SVG、补 OpenCode 映射);openspec 归档完成(主 spec 入 `openspec/specs/sidebar-session-provider-icon/`,manifest 条目已启用),2026-08-24 回填本条目为已完成。

### [B010] 任意页面查看 API 使用量
- **状态**: 已完成
- **优先级**: P2
- **背景 / 动机**: 希望不切换到专门页面,在 Web GUI 任意页面(会话、设置等)都能随时看到 API 用量(请求数 / token / 费用 / 余额 / 配额)。
- **要点**:
  - 调研结论(2026-08-18):社区已有大量现成产品,npm 均已发布,无需从零自研,优先评估复用;完整候选清单(全局可见类 / 专用页类 / 通用方案)见本条历史记录(git history 可复核);
  - 采纳路径:按调研结论启用功能最全的 [dsh-cost-meter](https://www.npmjs.com/package/dsh-cost-meter)(任意页面常驻展示本会话费用 / 当日费用 / 官方余额等,侧边栏 / 输入区 / dock 多位置可配),满足即用,不启动自研;
  - 落地版本:1.5.35(rc.2 适配修复费用展示缺失、内置 DeepSeek-V4-Flash-Vision-Exp 计价、修正未命中模型列表口径),manifest 条目已启用,重启验收 host + web client 加载正常;
  - 试用心得:日常使用确认满足「任意页面常驻看用量」诉求;若后续对指标范围 / 多厂商聚合有新要求,可回到本条重新评估候选(如 @kenz1117/dsh-ui-usage-billing)或自研。
- **更新**: 2026-08-18 新增;完成社区调研,结论「评估复用优先」;2026-08-21 cost-meter 1.5.35 启用并重启验收;2026-08-24 试用确认满意,归档为已完成。

### [B004] AI provider 订阅制认证(单机)
- **状态**: 已完成
- **优先级**: P0
- **背景 / 动机**: 希望 Codex / Claude 等不填 api-key,直接用订阅账号授权(OAuth / 本机 CLI 登录态)接入。
- **要点**:
  - 实现形态 = **provider 级订阅**(V1ki `dsh-plugin-subscriptions`,manifest id `llm-subscriptions`,当前 0.5.2+pr40.d927e3a = 临时 fork PR#40「按模型默认推理档」tarball,设置页默认档列表收起;上游合并发版后切回 npm):codex / claude / grok 订阅登录后出现在输入框模型选择器,claude 复用本机 Claude Code 凭据(keychain 导入秒登录);选型与重评估触发条件见 change `2026-08-20-llm-subscriptions-upgrade`(ADR-0001);
  - 形态演进:官方 CLI-as-subagent 路线(subagent-codex 接线)2026-08-19 落地后,于 2026-08-21(`7bf394e`)移除——主对话已被订阅制 provider 覆盖,委派能力经内置 spawn/fork 子代理保留,modlens 独立走 codex CLI 不受影响;
  - 单机验收:codex 订阅(2026-08-19 委派端到端 + 主对话)通过;claude 本机 CLI 2.1.221 可用、凭据导入登录可用(2026-08-24 确认);
  - 范围边界:多机派发 / 分布式(轴 B:官方 subagent/ACP 平面)暂缓,另行立项。
- **更新**: 2026-08-14 新增 P0 并定单机范围;2026-08-19 codex 落地验收;2026-08-21 subagent-codex 移除、订阅制定为主形态;2026-08-24 claude 本机可用确认,单机目标达成,归档为已完成。

### [B005] 新任务自动建 worktree,再 cwd 进入开始 agent 交互
- **状态**: 已完成
- **背景 / 动机**: 创建新任务时自动进入独立 git worktree,保证任务间文件隔离、并行任务互不干扰。
- **要点**:
  - 落地实现 = 自研 **Worktree Session**(`packages/worktree-session` + `ws` / `sw` skill + `scripts/ws-*.mjs`,manifest 已启用):首页空白会话首次普通发送时从 base 创建唯一 `ws/*` branch 与 `.worktrees/*` checkout,Agent 托管执行目录即该 worktree;npm lean 依赖复用、隔离开发 DSH_HOME、status/promote/clean 收尾,不切换主 checkout;
  - 首版适配当前 ohmydsh 仓;zydsh 嵌套仓库 / 多项目结构的泛化仍需单独评估;
  - 隔离层次的进一步讨论见 B014(未完成,需另行立项)。
- **更新**: 2026-08-14 新增;2026-08-24 确认当前 ws 机制已达成诉求(会话级隔离 worktree + 独立执行目录),归档为已完成;嵌套仓库泛化如需另立项。

### [B006] DeepSeek 模型下支持图片能力
- **状态**: 已完成
- **优先级**: P0
- **背景 / 动机**: 希望用 deepseek / 订阅模型时也能处理图片输入(截图理解、读图等)。
- **要点**:
  - 能力现状(2026-08-24):DeepSeek 官方已发布 **DeepSeek-V4-Flash-Vision-Exp**(多模态,vision at text prices,cost-meter 已内置计价)→ DeepSeek 原生图片能力已成,无需适配器改造;原闸门定位(apiproxy `inputModalities` 拒图 + `assertTextOnly` 抛错)随视觉模型加入而失效;
  - 生态兜底(已退场):`modlens` 曾作为「粘贴即视觉」兜底启用(走 codex CLI,实测读图成功);DeepSeek 原生视觉可用后于 2026-08-24 从 manifest 移除并卸载(`92368d0`),本条不再依赖任何第三方视觉插件;如需重新引入按 add-dsh-plugin 流程接入;
  - 遗留观察:**opencode-go 路由暂无可靠原生 vision**(社区网关 OmniRoute PR #2740 显示其声明过度、需 vision-bridge 强制),待上游支持即可,无本仓动作;
  - 历史调研细节见本条 git history。
- **更新**: 2026-08-14 新增 P0 并完成闸门定位;2026-08-24 确认 DeepSeek Vision-Exp 已发布、modlens 兜底已启用、opencode-go 待上游,归档为已完成;2026-08-24 收尾:原生视觉已足够,modlens 兜底移除(manifest 条目删除 + 卸载),本条收敛为纯原生能力。

### [B022] 答疑群绑定粒度需下沉到话题(topic)
- **状态**: 未开始
- **背景 / 动机**: 现行 `pet-qa-group` / `pet-qa-bind-existing-group` 的绑定粒度是**群**:
  一个群绑定一个源会话,群成员 @bot 即向该会话的 fork child 提问。但真实的大群往往
  同时进行多个话题,而不同话题可能对应不同的工作会话——群维度不够用。
- **要点**:
  - 诉求:在群内**按话题**建立类似 `/bind` 的关联,使同一个群里不同话题各自绑到不同
    会话,互不串扰;
  - 现状约束:`chat_bindings` 以 `chatId` 为键、双向 1:1 不变量也建立在群维度上,
    话题维度需要新的键与新的占用判据;
  - 技术前提待验:飞书话题群(`--chat-mode topic`)的入站事件是否携带可用的 `thread_id`,
    以及 `im +threads-messages-list` 等能力在 bot 身份下的可用性——按二期1 的教训,
    scope 与字段以真实调用为准,不从文档推断;
  - 交互待定:话题内如何发起绑定(话题首条 `/bind`?)、回执发在话题内还是群内、
    话题归档/消亡时绑定如何失效;
  - 与既有不变量的关系:若引入话题维度,「一群一会话」需重述为「一个绑定单元
    (群或话题)一个会话」,spec 与占用判定需同步调整。
- **更新**: 2026-09-07 由用户在 `pet-qa-bind-existing-group` 真机验收期间提出,
  明确本期不做,记录待后续立项。

### [B043] Pet 悬浮球任务面板残留英文文案需汉化
- **状态**: 未开始
- **优先级**: P2
- **背景 / 动机**: 所有者在 `pet-locus-intent-triage` 真机验收期间报「设置页待办列表空状态是英文」，
  验收子会话查证后澄清：**设置页（settings.tsx）六个 tab 的空状态文案已全部是中文**，
  真正残留英文的是点 Pet 悬浮球弹出的任务面板（`overlay.tsx` 的 `TaskPanel`），
  这是 Pet 前端目前仅剩的英文文案片区。
- **要点**:
  - 空状态本体：`packages/dsh-pet/src/client/overlay.tsx:1100-1103`
    ```tsx
    {tab === 'current' ? 'No task for the current source yet.' : `No ${tab} tasks.`}
    ```
    **`No ${tab} tasks.` 是英文语法拼接**，会拼出 `No all tasks.` / `No archived tasks.`，
    汉化时必须按 tab 分支给完整中文句子，不能只替换前缀；
  - 同一 `TaskPanel`（`overlay.tsx:992` 起）连带残留：`:1067-1068` 标题与 aria-label `Pet tasks`、
    `:1077/:1086/:1095` 三个 tab 按钮 `Current`/`All`/`Archived`、`:1128` `Independent task`、
    `:1145` `source archived`、`:1177` `Retry`、`:1212` `Send`、
    `:1204-1205` answer 区 aria-label 与 placeholder；
  - **改动会挂测试**：`packages/dsh-pet/test/client.test.ts:822-823` 用字面量锁死了按钮文本
    (`'>\n          Current\n        </button>'` 等)。该测试意图是「面板提供 当前/全部/已归档 三视图」
    而非锁英文，按仓库惯例应同步更新断言，不是绕过；
  - **必须重新构建**：部署副本在 `~/.dsh/profiles/web/node_modules/dsh-pet/lib/client.js`
    （已确认其中仍含 `No task for the current source yet.`），仅改 `src/` 不影响当前 GUI；
  - 建议文案：current `当前来源还没有任务。`、all `还没有任何任务。`、archived `没有已归档的任务。`；
    tab `当前`/`全部`/`已归档`；标题 `Pet 任务`；`独立任务`；`来源已归档`；`重试`；`发送`；
    placeholder `回复正在等待的问题…`。
- **更新**: 2026-09-17 由 `pet-locus-intent-triage` 真机验收中的 locus 子会话查证发现并登记为待办
  （台账 `ledger_item` 首条记录），所有者确认转入 BACKLOG 后续处理。

### [B044] 常态说明混进故障通道：bot-added 诊断被渲染成像报错
- **状态**: 未开始
- **优先级**: P2
- **背景 / 动机**: 所有者在 Pet 诊断页长期看到一条「Bot-added does not initialize a locus;
  the first allowlist @ will.」，误以为有未完成的初始化。实际上这**不是故障**：
  `src/index.ts:2786` 的注释写明拉 bot 入群本就不建 locus（入群零副作用），
  整棵树由首条合格 @ 消息按需建立，且明确写着 "This is not a degraded state:
  it is the only path"。功能完全正常，问题在表达层。
- **要点**:
  - 根因在 `src/host/channel/service.ts:252` 的 `??` 兜底链：
    ```js
    const diagnostic =
      this.deps.locusDiagnostic ??        // 真故障
      current.diagnostic ??               // 真故障
      this.lifecycleSubscription?.current.diagnostic ??  // 真故障
      this.lifecycleDiagnostic ??         // 真故障
      durableLifecycle ??                 // 真故障(bot-added-unverified)
      this.deps.botLifecycleDiagnostic    // ← 常态说明，不是故障
    ```
    前五项正常运行时均为 `undefined`，所以最后这条**永远兜底命中**，
    表现为「始终存在的报错」；
  - 前端 `src/client/settings.tsx:3777` 与 `:3833` 对该字段一视同仁地渲染成
    `（{diagnostic}）` 紧贴连接状态徽标，视觉上属于状态的一部分；
  - 三个因素叠加放大误导：**位置**（紧贴状态）、**语言**（周边文案全中文，
    包括同一条链上的 `durableLifecycle`，唯独它是英文）、**语气**
    (`does not initialize` 读作「没能初始化」而非「按设计不初始化」)；
  - 两个修法方向：
    - **A（倾向）**：给常态说明单独字段（如 `notice`），前端用中性样式渲染，
      与故障通道彻底分离。需要改 `PetChannelView` wire 契约；
    - **B（治标）**：只改措辞为中文并点明是常态，如「入群不建立关联；首次
      allowlist @ 时按需建立（正常）」。一行改动，但仍混在故障通道里，
      下次再看到还是会怀疑；
  - 选 A 时注意：`unifiedLocusReadiness` 已经是独立字段并有自己的渲染
    (`:3734`)，可作为「常态事实与故障分开表达」的既有先例参照。
- **更新**: 2026-09-17 所有者在 `pet-locus-intent-triage` 收尾期间提出，
  确认为表达层缺陷而非功能缺陷，本期不做，记录待后续立项。
