# 设计：DSH 分域持久记忆层

## Context

### 方法论前提（本方案的原始驱动力）

**记忆是「写」出来的，不是「存」下来的。** RAG 的隐含假设是「信息已经存在，问题在于
找到它」，所以它优化检索——切块、embedding、相似度。Zettelkasten 的假设相反：理解不
存在于原文里，而产生于你重述它的那一刻，所以它优化**写入**。这正是本方案不需要向量库
的原因——核心动作不是检索得更准，而是在写的时候就完成思考；检索只要够用即可。

这条路线有清晰源流：Vannevar Bush 1945 年《As We May Think》提出的 memex 机器与
**associative trails**（联想路径）；Niklas Luhmann 的 **Zettelkasten**（约 9 万张手写
卡片，70 本书）；Andy Matuschak 的 Evergreen notes（「笔记标题像 API」——好标题是一个
可被调用的概念接口，直接对应上游的 slug 设计）。

复利来自三个机制，缺一不可：

1. **原子性 → 可重组。** 一卡一想法。只有原子的东西才能被任意重组；n 张卡的潜在连接
   是 n²/2 量级——卡片线性增长，连接可能性平方增长，这是复利的数学来源。
2. **链接即思考 → 产生新知识。** 标签是**分类**（把东西放进已知的桶，不产生新知识），
   链接是**发现**（建立一条以前不存在的关系，产生新知识）。所以 retro 强制写明「这与
   `[[X]]` 相关，**因为**……」——那个「因为」才是知识。
3. **涌现结构 → 不预设分类。** 结构从链接里长出来，因此不需要在写第一张卡时就知道
   知识体系长什么样。

**写入判据**（率失真视角，「Remember the Decision, Not the Description」arXiv 2605.10870）：
记忆是有损压缩，该保留什么取决于**下游要做什么决策**。所以判据不是「这件事重要吗」，
而是**「未来遇到类似情况时，这条会不会改变我的做法」**。

**链接的判定权归 agent**（A-MEM，NeurIPS 2025）：链接必须由 agent 读过候选卡之后主动
决定，embedding 相似度只能作为候选信号。**相似 ≠ 相关**——自动连边产生「看起来像」
的噪音边，会稀释图谱价值。

**回报曲线后置**：几十张卡时几乎没有链接价值，过临界点后才出现「居然连到了这里」的
时刻。这是本方案最容易在头三个月被放弃的地方。

### 当前状态

DSH 没有跨会话记忆。会话事件日志（`dsh-session-persistence`）服务于单会话的重放与压缩，
不是跨会话知识；官方在 cookbook 中只给了一行「Memory = section provider + tool」的机制
建议，Discussion #2783 / #525 均确认有意把记忆留给生态。社区已有 10+ 个 DSH 记忆插件，
但**无一解决「记在哪」**：它们普遍是「LLM 自动抽取 + 全库注入」，不做按知识域的物理隔离，
且没有一个同时提供双向链接图谱。

选定内核 [memex](https://github.com/iamtouchskyer/memex)（141★，MIT，npm 38 个版本）：
Zettelkasten 原子卡片 + `[[双向链接]]`，无向量库、无 embedding，纯 markdown，可脱离工具
读取。其检索默认走关键词 AND 匹配（`--semantic` 为显式开关，默认关闭，零外发）。

### 硬约束（均已核实）

- **MCP 子进程拿不到会话 cwd。** `dsh-mcp-client` spawn 的常驻 stdio 子进程 cwd 等于
  DSH 主进程 cwd；上游 `resolveMemexHome()` 在进程启动时解析一次即固定
  （`MEMEX_HOME` > 从 cwd 向上查找 `.memexrc` > `~/.memex`）。因此纯 MCP 方案无法按
  workspace 路由到不同的库——**这是本方案必须自建进程内薄层的唯一原因**。而在 DSH
  进程内的插件可以读到 `agent.session.header.cwd`。
- **sync 粒度是整个库。** 上游 `GitAdapter` 在构造时绑定 home，push 时执行
  `git -C <home> add cards` 与 `add archive`，**无法按卡片过滤**。因此在同一库内靠
  tag / category 区分「可同步 / 不可同步」是不可行的，隔离必须做在 `MEMEX_HOME` 层。
- **上游凭据防护不覆盖业务信息。** `sensitive-input.ts` 拒绝高置信度明文密钥、redact
  URL 内嵌凭据、屏蔽 `Authorization` 头、识别 `~/.ssh` `.env` 这类路径——它拦的是**凭据
  泄漏**，不是**商业信息泄漏**。「某内部系统在高并发下用两阶段提交会出现 X 问题」不含
  任何关键词，正则一个都拦不住。
- **工作域分布**：公司 `code.byted.org`（`nexus`、`flow-web-monorepo`）与个人
  `github.com`（`ohmydsh`、`dsh-cockpit`）。

## Goals / Non-Goals

**Goals:**

- 为 DSH 提供跨会话持久记忆，按知识域**物理隔离**。
- 读侧单库由**能力缺失**保证（模型搜不到别库），而不是提示词劝阻。
- 业务场景产出的通用洞察能积累到 `personal` 库，同时「业务内容进入推往 GitHub 的个人库」
  这一不可逆方向的风险被结构性降低。
- 复用 memex 已验证的机制层，不自研存储与链接。
- 无 lock-in：卡片保持上游标准格式，`memex serve` / Obsidian / CLI / git sync 在不经
  本插件时同样可用。

**Non-Goals:**

- 不做 RAG / embedding / 向量检索。
- 不做 LLM 自动抽取写入（与「记忆是写出来的」这一方法论前提冲突；本方案的写入是
  显式的思考动作）。
- 不做 GUI 面板（V1 用 `memex serve` 与 CLI）。
- 不做跨 scope 读。
- 不做多用户 / 团队共享（本项目为单人使用的定制仓）。
- 不做记忆的自动整理、归档与合并（属人的精炼活动，走 CLI）。

## Decisions

### D1. 以 memex 为存储内核，自建薄策略层

| 备选 | 否决理由 |
|---|---|
| 完全自研存储与链接 | 需重写约 6000 行已验证代码（卡片格式、wikilink 解析、原子写、backlinks、organize、git sync、凭据 redact，42 个测试文件），并自负方法论正确性——自研时最容易把 A-MEM 那条「链接由 agent 读后决定」退化成相似度自动连边 |
| 纯 MCP 直连（挂 `dsh-mcp-client`） | 拿不到会话 cwd，无法按 workspace 路由（见硬约束） |
| 直接采用社区 DSH 记忆插件 | 全部是「自动抽取 + 全库注入」，无按库隔离；社区最接近双链模型的实现（qwert702）无 LICENSE 文件；另有伪造元数据（冒用 `@deepseek-ai` scope 且 npm 上不存在该包）、未声明 peerDeps、硬 pin 单一 alpha 版本等质量问题 |

**选定**：策略层自建（预估 400–600 行，职责单一且可测），机制层复用。

### D2. 不使用 `dsh-mcp-client`，工具在 DSH 进程内注册

工具由 `dsh-memex` 通过 `ctx.tools.register` 注册，执行时以子进程调用 memex CLI 并注入
`MEMEX_HOME`。这是取得 `agent.session.header.cwd` 的前提，也是本方案与「挂个 MCP 就完事」
的分界线。

### D3. 多库物理隔离 + 读侧单库

备选是「单库 + `nestedSlugs` 目录分组」。否决理由有两条，缺一不可：

1. **概念空间不同。** 通用知识（TypeScript 陷阱、DSH 架构）的概念空间是共享的，跨项目
   复用产生价值；业务知识（nexus 的领域模型、flow-web 的业务规则）的概念空间本身就是
   项目私有的——混在一起产生的不是联想，是噪音。用户判据是**「这个问题值不值得在 nexus
   项目下留档」**：范围越小，写入标准越具体。
2. **合规上不可行。** sync 粒度是整个库，同一库无法分离同步目标。

Luhmann 的卡片盒之所以能全局连通，是因为他一辈子研究一个领域，概念空间统一；本项目
同时工作在多个不相交的业务域里，因此不适用「全局单库 + 目录分组」。

### D4. 跨库写入产出两条独立的卡片，而非共享引用

备选是「一张卡被多个 scope 共享引用」。否决理由：可见性判定、删除语义、同步边界都会
复杂化，且违背原子性——同一洞察在不同语境下本就应该有不同表述（nexus 那条会逐渐长出
业务上下文，personal 那条保持通用）。

因此 `alsoPersonal` **必须提供独立重写的正文**，不接受「复制一份加标记」。这同时给守门
一个明确的、可扫描的对象。跨库关系因此呈**星形**（business → personal），business
之间永不互写。

### D5. 库位于项目之外，由插件注入 `MEMEX_HOME`

| 备选 | 否决理由 |
|---|---|
| 项目内 `.memexrc` + `cards/` | 库混入工作区，需额外 gitignore；且公司卡片有被误提交的风险 |
| 用 `.memexrc` 声明「库在别处」 | 机制不支持：`resolveMemexHome()` 返回 `.memexrc` **所在的目录**，`.memexrc` 无法表达「库在别处」 |
| 库在项目外 + 项目内文件声明映射 | 仍需在项目内放文件，收益不抵复杂度 |

**选定**：库位于 `~/.memex-<scope>`，由插件注入 `MEMEX_HOME`。**不使用** `.memexrc`
机制，避免两套优先级互相打架。

### D6. scope 配置放 `~/.dsh/memex-scopes.yaml`，不放 `dsh.yaml`

`dsh.yaml` 只保留 `enabled` 与可选 `configPath`，以维持「`dsh.yaml` 是定制单一开关面」
的仓库原则。scope 映射被排除在外的理由是它**性质不同**：高频变动、记录的是个人项目布局
而非「DSH 装了什么」、且应在换机时独立迁移——它与 `~/.dsh/storages/workspace.json` 同属
运行时状态。

代价已接受：该文件**不被 `dsh build` 物化、不进版本控制**，换机需手工迁移，且写错时
`dsh build` 不会发现（由插件启动校验兜底，见 D7）。

### D7. 配置优先级 `settings` > 文件 > 内置默认；缺失降级、损坏 fail closed

三层优先级：DSH settings（`ctx.settings`）> `~/.dsh/memex-scopes.yaml` > 内置默认
（仅 `personal` + `autoDerive: true`）。

关键区分：**「文件不存在」是正常状态（降级到默认），「文件存在但损坏」是错误状态
（拒绝服务）**。静默降级会把业务内容路由进 `personal` 库，因此不可接受。

### D8. scope 解析：路径匹配 > git remote 匹配 > 自动派生 > fallback

两条匹配路径都保留：路径前缀匹配快且无 git 调用，覆盖日常；git remote 匹配覆盖
Worktree Session 等 cwd 不稳定的场景（`git -C` 在 worktree 内仍能取得主仓 origin）。

自动派生采用目录名规则：`<工作根>/<x>` → scope 名 `<x>`、库目录 `~/.memex-<x>`。
`github.com` remote 与无 git 目录一律归入 `personal`，不为个人开源项目各自建库。

已知取舍：目录重命名会导致 scope 名变化（已接受，可用配置表覆盖）。

### D9. 两包分层：`dsh-memex-scope` 与 `dsh-memex`

| 包 | 角色 | 职责 |
|---|---|---|
| `dsh-memex-scope` | Service Definition + Provider | `ctx.memexScope`：cwd → scope → `MEMEX_HOME`，含配置优先级与 fail-closed 语义 |
| `dsh-memex` | Consumer | 注册 4 个工具、调用 memex CLI、执行守门 |

对齐 DSH 的 capability seam 惯例（如 `dsh-compaction` 的 Definition / Provider 拆分）：
换存储后端只需换 Consumer，换 scope 策略只需换 Provider。

### D10. 工具面只 4 个，运维动作归人

`memory_recall` / `memory_read` / `memory_search` / `memory_retro`。

砍掉上游的 `write` / `organize` / `archive` / `links` / `pull` / `push`：裸 `write` 会
绕过查重与守门；其余属运维视角，用 `memex <cmd>` CLI 执行更合适。原则是**模型手里只有
「读 + 写洞察」，运维归人**——这也符合 A-MEM 的分工：agent 负责判断与链接，人负责精炼
与维护。

`memory_retro` 写入前以 slug 精确 + title 关键词自动查重，命中则**警告但不拦截**（信号
在正确的时刻到达：模型仍在同一轮内，可立刻改用 `mode: "update"` 重发）。

### D11. 守门 fail closed、不回滚主卡、审计不留正文

`CrossWriteGuard` 只在写 `personal` 之前生效。拒绝时**保留主卡**：主卡写在业务库中本身
正确且安全，回滚只会丢失有效记忆。泄漏方向是单向的（business → personal），因此只需
拦这一侧。

`denyTerms` 默认由 scope 名自动派生（有 `nexus` scope 就有 `nexus` 词条），避免人工维护
第二份平行清单；`allowTerms` 用于豁免恰好也是通用技术名词的词条。内置结构性规则
（内网域名与 IP 段、公司 remote 形态、`~/corp/` 绝对路径）不可被 `allowTerms` 关闭。

审计只记时间、scope、slug、命中规则，**不记正文**——记录正文等同于把敏感内容又落到
`personal` 侧。

### D12. 不自动 `git init`、不自动配置 sync remote

同步到何处是**合规决策**，必须由人显式作出。自动派生只创建目录与 `cards/`，并在返回中
提示该库尚未配置同步。

## Risks / Trade-offs

- **[守门拦不住语义层面的业务信息]** → 规格明确声明守门是「减少误写」而非「保证不泄漏」，
  不作过度承诺；配套保证是跨库卡片必须去业务化重写 + 人对 `personal` 库定期复核。
- **[配置文件不被 sync 物化，换机丢失]** → 列入部署步骤与 `docs/notes`；建议纳入 dotfiles
  管理（Open Question）。
- **[memex CLI 不在 PATH]** → 工具返回明确错误与安装命令，不静默降级。
- **[`autoDerive` 产生意外碎片库]** → 首次建库在返回中明确告知「已创建新记忆库」；库目录
  不自动建 git 仓，避免自动推送。
- **[子进程调用 memex 的延迟]** → 相对 LLM 调用可忽略；失败**不重试**（重试可能造成
  重复卡片）。
- **[上游 memex 版本漂移]** → 精确 pin 版本并记录审查；只依赖稳定子集
  （`search` / `read` / `write`）；卡片是标准 markdown，最坏情况可脱离工具直接使用。
- **[上游 backlinks 为 O(n) 全量扫描]** → 几百张卡无感，上千张会变慢。记为已知限制，
  不阻塞 V1；规模增长后再评估索引方案。
- **[业务库需人工配置内部 GitLab remote]** → 列为部署步骤，不在插件内自动化（D12）。

## Migration Plan

**部署（按序）：**

1. 各设备安装 CLI：`npm i -g @touchskyer/memex`（版本精确 pin 并记录）。
2. 两个包落地 `packages/`，`dsh.yaml` 新增两条 bundle 条目（含 enable 开关、来源、
   版本与审查记录）。
3. `dsh build` 物化到 `~/.dsh/profiles/web`，重启 DSH。
4. 创建 `~/.dsh/memex-scopes.yaml`（**或直接使用内置默认**——文件缺失即降级为
   `personal` + `autoDerive`）。
5. 按需配置各库同步：`personal` → GitHub 私有仓；业务库 → 公司内部 GitLab
   （`memex sync --init <remote>`）。**未显式配置则不产生任何同步行为。**
6. 可选：在 `~/.dsh/AGENTS.md` 或项目 `AGENTS.md` 加入 retro 时机指引（DSH 无天然钩子，
   只能靠模型自觉）。
7. 幂等校验：`node scripts/sync.mjs` 连跑两次应报 `no changes`。

**回滚：**

`dsh.yaml` 中两条条目置 `enabled: false` → `dsh build` → 重启。**记忆库与卡片不受影响**
（插件从不修改卡片以外的状态），可继续用 memex CLI 与 Obsidian 访问；如需彻底移除，
删除 `~/.memex*` 目录与 `~/.dsh/memex-scopes.yaml` 即可，无残留状态。

## Open Questions

1. **`personal` 库是否启用 auto-sync？** `memex sync on` 会在每次 retro 后自动 commit +
   push，优点是不会忘记；缺点是不留人工审计窗口。当前倾向：先手动 push，观察一段时间。
2. **scope 配置文件是否纳入 dotfiles？** 纳入则换机自动恢复，但会把公司项目路径写入
   dotfiles 仓库（本身又是一处泄漏面）。
3. **`autoDerive` 默认是否应为 `true`？** 当前设计为 `true`（零配置、新项目自动归位），
   风险是碎片库。替代方案是默认 `false`、要求显式声明 scope 才建库。
4. **retro 的触发时机怎么写进 `AGENTS.md`？** 没有 `SessionStart` / `agent_end` 这类钩子，
   只能靠提示词约定「任务完成后主动 retro」。这决定了记忆的实际密度，需要实测后再定措辞。
