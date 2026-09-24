# 并发 Agent 写隔离与冲突协商调研

> 对象：多个 AI 编码 Agent 并发写同一仓库时的写隔离与冲突协商。
> 背景：Pet Locus「多子会话共享代码目录，持久会话隔离不提供文件隔离；本期展示共享根风险，不发明全局写锁」
> （`openspec/changes/pet-unified-locus-collaboration/design.md:269`）为已知未解风险。
> 日期：2026-09-15。结论均附来源；无公开来源处明确标注。

## 0. 结论先行

1. **worktree 不消除冲突，只把「写时静默覆盖」推迟为「合入时显式 merge conflict」。** 这个推迟是净收益
   （静默损坏 → 可拒绝的失败）。**这是唯一无保留推荐的一步。**
2. **「锁太粗暴」的直觉对了，但「意图声明」不是免费替代品。** 写前准入（Claim Plane）有完整架构与实验，
   实测却是：**粗声明退化成变相全局锁**（串行化 96.7% 的执行，含 93.3% 本无冲突的 case），
   **细声明又因范围覆盖不全频繁 fail closed**（§B.2）。低成本可抄的是 **STORM 的「拒绝载荷」**（§B.3）。
3. **「不卡进度」与「安全」可兼得，代价是把串行点从「开工」挪到「落地」。** 即 merge queue。
   而这一步**不可省**：Crystal 实测**33% 被版本控制判为「干净 merge」的合并，实际是 build 或 test 冲突**（§C.3）。
4. **但真正的瓶颈不是机器写代码的速度，是你 review 的速度。** 并行 agent 净吞吐的对照实验**根本不存在**
   （METR 自陈其测量对并发多 agent 用户失效，§C.5）；而「**worktree 部分是简单的那一半**」（§C.1）。

---

## A. 业界写隔离方案

### A.1 git worktree per task —— 事实上的默认

**官方推荐属实。** Claude Code 有独立 worktree 文档，支持 subagent frontmatter 写 `isolation: worktree`
永久隔离，官方示例正是「Applies mechanical refactors across many files」——**机械式跨文件重构被官方当作需强隔离的场景**；
**会话恢复会回到原 worktree**（[worktrees](https://code.claude.com/docs/en/worktrees)），这对「长期子会话」语义是必要的。
但同一套文档也划了界：agent teams **不做 worktree 隔离**，因此
「**Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of files.**」
（[agent-teams](https://code.claude.com/docs/en/agent-teams)），并建议从「review PR、调研库、排查 bug」这类不写代码的任务起步。

| 工具 | 隔离单元 | 来源 |
|---|---|---|
| `claude-squad` | 每 agent 一个 worktree + tmux | [augmentcode](https://www.augmentcode.com/tools/open-source-agent-orchestrators) |
| `crystal` | 每会话一个 worktree；**2026-02 已弃用**（转 Nimbalyst） | [repo](https://github.com/stravu/crystal) |
| `uzi` | worktree + tmux + **唯一做端口分配者之一**；合并走 rebase，**冲突即报错留残局** | [checkpoint.go](https://github.com/devflowinc/uzi/blob/main/cmd/checkpoint/checkpoint.go) |
| `cyrus` | **每 issue 一个隔离 worktree**；唯一 `.worktreeinclude` + **setup/teardown 双全** | [cyrus](https://github.com/cyrusagents/cyrus) |
| `vibe-kanban` | 每 task 一个 worktree；git 层最细（区分 DirectMerge/PrMerge）；**正在关停** | [repo](https://github.com/BloopAI/vibe-kanban) |
| `conductor` | workspace = 分支+文件+终端+review；**依赖问题解决得最完整** | [Files to copy](https://www.conductor.build/docs/reference/files-to-copy) |
| `container-use` | worktree 之上加一层：**每 session 一个容器 + 一个分支** | [Dagger](https://github.com/dagger/container-use) |

> **`cyrus` 与 Pet Locus 拓扑最同构**：「一个 issue = 一个长期会话 = 一个隔离 worktree」，同样由外部 issue 系统驱动。

**代价一：gitignored 文件不进新 worktree。** [claude-code#27744](https://github.com/anthropics/claude-code/issues/27744)：
`git worktree add` 复制所有 tracked 文件但**不带过 gitignored 状态**，「worktree 里的 agent 无法执行代码、跑测试或用 linter——
**worktree 隔离的核心价值主张就此丧失**」；[claude-squad#260](https://github.com/smtg-ai/claude-squad/issues/260)
记录「需完整重装（每 session 数分钟 + 数 GB），`.env`/secrets 丢失导致 agent 立即失败」。三档解法：
**重装**（[pnpm 已出专门文档](https://pnpm.io/git-worktrees)：node_modules 只含指向内容寻址 store 的 symlink，
「**新增 agent 很快且几乎不占额外磁盘**」，但警告**「不要让互不信任的 agent 共用一个可写 store」**）；
**symlink**（[标为 risky](https://www.gitworktree.org/guides/node-modules)，且
[pnpm#14286](https://github.com/pnpm/pnpm/issues/14286) 记录「symlink 化布局下 **install 会静默重写另一个 checkout 的依赖 symlink**」，
即**在 worktree 里安装会损坏主 checkout**）；**选择性复制**（Claude Code 的 `.worktreeinclude`，
前导 `**/` 有[静默不匹配 bug](https://github.com/anthropics/claude-code/issues/79424)）。

> **映射到本仓库**：Worktree Session 三档都处理过且更严谨。npm 走 lean——按 lockfile 内容寻址的共享 cache，
> `node_modules` 为指向 cache 的 symlink，**lean 下禁改依赖、必须先 promote**
> （`archive/2026-08-21-worktree-session/design.md:180-201`），恰好规避「分支依赖分叉」。
> pnpm 则在 worktree 内按 lockfile 真实安装、实体复用全局 store。文档诚实标注**「lean 是性能复用而非安全沙箱」**。
> **需专门复核**：`pnpm#14286` 的「安装损坏另一 checkout」正对应 npm lean 的 symlink 形态，
> **多 locus 并发会显著提高触发概率**——一个 agent「重装依赖试试」即可能破坏其他 locus。推进 D2 前应验证。

**代价二：构建缓存、IDE 与端口。** 绝对路径致缓存失效有官方背书：
[Gradle](https://docs.gradle.org/current/userguide/build_cache_concepts.html)「ABSOLUTE 路径敏感度的 property
**不可重定位**，而这是未声明时的默认值」；[Bazel](https://bazel.build/remote/output-directories) 的 `outputBase`
是 **workspace root 路径的 MD5**，每个 worktree ⇒ 一份独立分析缓存与 server；Rust 叠加每 worktree 独立 `target/`
即**每 worktree 付一次全量重建**（[claude-code#69874](https://github.com/anthropics/claude-code/issues/69874)）。
IDE 侧：[rust-analyzer#16534](https://github.com/rust-lang/rust-analyzer/issues/16534)（约 90 个 worktree 时「整个系统被拖垮」）、
[vscode#305544](https://github.com/microsoft/vscode/issues/305544)（ripgrep 无上限、**95%+ CPU、macOS 冻结**）。
**端口冲突是 Pet Locus 必撞的**：[claude-squad#260](https://github.com/smtg-ai/claude-squad/issues/260)「两个 session 都占 3000」；
`vibe-kanban` 用 [`{{ auto_port() }}`](https://github.com/BloopAI/vibe-kanban/pull/1493) 解决。**若多 locus 起服务，端口分配须进设计。**

**代价三：Git 限制与一条安全边界。** 同一分支不能在两个 worktree 同时 checkout
（[git-worktree(1)](https://git-scm.com/docs/git-worktree)）——对本设计反而是**好事**，天然保证「一个 locus 一个分支」。

> **worktree 不是隔离边界。** `hooks` 与 config 跨 worktree **共享**
> （[gitrepository-layout(5)](https://git-scm.com/docs/gitrepository-layout)）。后果端到端演示于
> [Git worktrees are not an isolation boundary for coding agents](https://fletch.sh/blog/git-worktrees-vs-clones-for-ai-agents/)
> （[HN](https://news.ycombinator.com/item?id=49110389)）：**从 worktree 内装的 hook 实际装到父仓库，
> 并在你下次触发时以你的身份执行**；文中还演示 worktree 内 `git config user.email` 改写父仓库身份、
> 一个 worktree 弹出另一个的 `refs/stash`。**对不可信代码或会装 hook 的流程，worktree 给不了保护。**

**关键问题：延迟的冲突怎么办？** 这是该路线最诚实的弱点，答案是：**几乎没有工具真正解决它。**
逐个核查被调研编排器的 merge 期行为：

| 层级 | 工具 | 实际行为 |
|---|---|---|
| 只给分支 | `claude-squad` | push + 开浏览器；**无 merge/rebase** |
| 单次 rebase | `uzi` | 主 worktree 跑 `git rebase`，失败直接报错，**留下半完成的 rebase** |
| merge / apply | `container-use` | 原生 git 冲突语义；文档鼓励丢弃重来（`Environments are disposable by design`） |
| PR | `cyrus`、云端工具 | `gh` 建 PR；**无冲突自动化** |
| PR + 冲突指示器 | `vibe-kanban`、`conductor` | 有 conflict indicator，但流程是打开编辑器找 `<<<<<<<`；AI 仅「可选建议」 |
| **连续 restack + merge queue** | **Graphite** | `gt modify` 自动级联 restack；**stack-aware merge queue**。冲突仍 `stops and asks the human` |

**三条结论**：(a) **连续 rebase 只有 Graphite 真做到**；(b) **被调研的 agent 编排器一个都没有 merge queue**，
只有 Graphite 这个 PR 工具有；(c) **AI 自动解冲突无一做成自动步骤**，全部是「你可以手动让 agent 试试」。
→ 即业界现状是「worktree 管隔离，合并靠人」，而 §C.1 的 96.1% 正是这个现状的账单。
社区已在补前移检测（如 Clash：`Unlike git, which only shows conflicts at merge time, Clash detects conflicts
between all active worktrees during development`，只读输出 JSON 供 agent 自行调整），但尚未产品化。

> **还有一条比冲突更容易被忽略的边界**（[lpm.cx](https://lpm.cx/git-worktree-for-ai-agents)）：
> 「**Every isolation model on this page draws its boundary at the filesystem. Nothing about a separate directory
> reserves a port, namespaces a Postgres schema, or forks a Docker volume.**」
> → worktree 只隔离文件，**不隔离端口、数据库与容器卷**。真正处理了运行期状态的只有
> `cyrus`（`cyrus-teardown.sh` 在 issue 终态时执行 `dropdb` / `docker compose down -v`，并用「面包屑」文件
> 在 setup 与 teardown 之间传递随机端口与 compose project 名）与 `container-use`（容器天然命名空间）。
> **若 Pet Locus 的 locus 会起服务或碰数据库，这一层必须单独设计，worktree 给不了。**

### A.2 容器 / VM 级隔离

- **Devin**：组织维护**一个** VM snapshot，**每 session 启动全新副本，结束即弃**
  （[blueprints](https://docs.devin.ai/onboard-devin/environment/blueprints)）。**MultiDevin**：1 manager + 至多 10 worker，
  **manager 负责把所有成功 worker 的改动合成一个分支/PR**——少见的「显式指派角色负责收敛」设计。
- **Codex cloud**：每 task 一个**临时容器**，状态**缓存最多 12 小时**；**setup 阶段有网、agent 阶段默认断网**，
  **secrets 在 agent 阶段开始前被移除**（[environments](https://developers.openai.com/codex/cloud/environments)）。
- **Cursor Cloud Agents**：**Firecracker microVM**，每 agent 一个 VM 边界「not a shared process sandbox」；
  **Builds 是可启动快照**，「keeps **pre-warmed copies** ready，**removes repository cloning and dependency installation
  from the agent startup path**」（[Builds](https://cursor.com/docs/cloud-agent/builds.md)）。
- **Copilot cloud agent**：GitHub Actions 驱动，**单 session 硬上限 59 分钟、一次一个分支一个 PR、
  产出必须是 draft PR 且 Copilot 不能自行 merge**（[docs](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)）。

**全行业共性**：隔离单元收敛到 VM/容器 per session-or-task；**回流一律是 push 分支 → PR → 人审**。
容器/VM 多出 worktree 给不了的能力（强制断网、凭据隔离），也多出冷启动与调试摩擦。
**对 Pet Locus 代价过高**：要求把开发主循环迁到远端，与「绑定本机长期 workspace」的定位冲突。

### A.3 Copy-on-write 文件系统 —— 存在，但产品层缺席

原以为「无先例」，实则有直接对口项目。**agent-harbor** 把文件系统快照做成可插拔 provider，
并**显式把 git worktree 降级为 fallback**：ZFS / Btrfs / **AgentFS**（全平台用户态 CoW）/ Git
（[Under the hood](https://docs.agent-harbor.com/project)）。性能主张：比 worktree **启动快 10 倍、省磁盘 100 倍**；
更关键的是 **CoW overlay 让 agent 看到的仍是原始 repo 路径**（[ACP](https://docs.agent-harbor.com/acp)）——直接消除代价二。

但**主流编码 agent 产品（Devin/Codex/Cursor/Jules/Copilot）公开文档里没有任何一家**把 overlayfs、
btrfs/ZFS 快照或 `cp --reflink` 作为「每 agent 廉价工作区隔离」点名描述。CoW 丰富于**基础设施层**：
E2B `fork()`（「snapshot is captured once regardless of how many forks」，[docs](https://e2b.dev/docs/sandbox/fork)）、
Daytona 的 **fork tree**（父 sandbox 在有活跃子 fork 时不能删除）。
macOS 等价原语是 APFS clone（`cp -c` 调用 `clonefile(2)`，[Apple](https://developer.apple.com/forums/thread/818372)），
**推测**可近零成本克隆含 `node_modules` 的整个 repo，但**未找到 agent 工具公开使用该路径的证据**。
**CoW 不解决「怎么合回去」，不建议作主路线。**

### A.4 不隔离，改为串行化

**未找到任何主流工具公开宣称「同一仓库同时只跑一个 agent」是其设计选择**——厂商叙事都指向并行。
但**有一个明确的反多-agent 立场**：[Ralph](https://ghuntley.com/ralph/)（ghuntley, 2025-07）主张单体——
「everyone seemed to be trying to crack on multi-agent……**At this stage, it's not needed.** ……**Ralph is monolithic**,
a single process that **performs one task per loop**」，且划出边界：
「**There's no way in heck would I use Ralph in an existing code base**……best for **bootstrapping Greenfield**。」
Codex 的 **N-versions** 则是另一种形态：用同一 repo/分支/prompt **并行跑多次独立尝试**再人工挑选，
即**并行探索同一任务**，刻意不产生写冲突。

### A.5 乐观并发 + 冲突检测

**git 本身就是该方案**。增强手段：**`git rerere`** 记录冲突 pre/post image 并自动复用解法
（[docs](https://git-scm.com/docs/git-rerere)），对「多 agent 反复 rebase 到移动的 main」**极其对口且零成本**，
本仓库可直接开。结构化 merge `mergiraf` 用 tree-sitter 支持 33 语言，
**先跑行级 merge、成功就不进昂贵的树合并**（[LWN](https://lwn.net/Articles/1042355/)），务实可启用。

---

## B. 冲突协商机制

### B.1 文件/目录级租约 —— 有先例且已产品化

- **board-mcp**：MCP 公告板，`claim_files / check_conflict / release_claim` 等 7 个工具，
  **认领带 TTL（默认 120 分钟）——是租约而非永久锁**（[收录页](https://himcp.ai/server/board-mcp)）。
  **局限：建议性协调，agent 可绕过。**
- **`multiagents`**（npm）：两层——**静态 Ownership Zones**（`Engineer owns src/**`，零开销）+
  **动态 File Locks**（仅共享文件，`acquire_file("package.json", "adding dependency")`，**5 分钟自动过期**）
  （[npm](https://www.npmjs.com/package/multiagents)）。

**两层设计可直接借鉴**：多数冲突用静态分区消解（零协商），只有热点共享文件才进动态租约。
租约**带 TTL、带理由**——这正面回答「锁卡进度」：会卡的是**无期限**的锁，带 TTL 的租约语义上是**声明**而非独占。
注意 [SmolkAI 报告](https://www.smolkin.org/blog/2026/02/SmolkAI-Multi-Agent-Setup-Report.pdf) 直言
「**Claude Code has no automatic file locking**」。

### B.2 意图声明 + 预检 —— 有完整架构，但实测是警告而非背书

**Claim Plane** 明确自我定位为「pre-write admission problem」而非锁（[arXiv 2607.21909](https://arxiv.org/abs/2607.21909)、
[agentpatterns](https://agentpatterns.ai/patterns/multi-agent/pre-write-change-intent-admission/)）。
每个 worker **在碰任何文件前**提交版本化 **ChangeIntent**：精确 base commit、typed resources（路径/行范围/符号）、
依赖、操作标记 **committed / contingent**。控制面：**同文件并行受限于声明区域**（行范围不重叠即可并行改同文件）、
未解重叠**串行化**、**fencing token 定全序**、**权威不明 fail closed**；超范围走 **dynamic scope promotion**
（宽泛 pattern 须收窄到具体资源）并**对活跃集重新准入**。

**但实测必须连同代价一起读**（[arXiv 2608.00947](https://arxiv.org/abs/2608.00947)，30 对任务 / 三随机种子）：

- **静态准入**：pair pass **23.3% → 50.0%**，集成成功率 **65.6% → 96.7%**。
  **但它串行化了 96.7% 的执行，含 93.3% 本来无冲突的 case**；作者自陈收益
  "largely by collapsing toward serial execution"——**即实测中退化成了变相的全局锁**。
- **动态准入**更有选择性（冲突 case 串行 66.7%、clean 仅 13.3%），
  **但 90 次执行中 46 次因范围未声明而 fail closed，pair pass 反降到 22.2%**；
  其中 **45/46 次被阻塞的目标文件其实已在声明里，只是 region 粒度覆盖不足**。

> **这修正了本文初稿的倾向**：意图声明**不是**「既安全又不卡进度」的免费午餐。
> 粗声明 → 退化成全局锁；细声明 → 因覆盖不全频繁 fail closed，反而更差。
> **成败取决于「声明粒度」，而它目前是公开研究里的未解瓶颈。** 故 D4 降级为第二阶段可选项。

### B.3 乐观锁 / CAS —— STORM 的「拒绝载荷」是最实用的发现

**STORM**（[arXiv 2605.20563](https://arxiv.org/abs/2605.20563)）明确「受 OCC 启发」，
且**明确批评 worktree「把冲突推迟到事后 merge，恢复成本高昂」**，改为在**写入时刻**检测；Commit0-Lite **+18.7**。
机制是文件级 CAS：每文件维护单调递增版本 `v_f`，读返回内容 **+ `v_f`**，**写必须声明期望版本**。

**精华在拒绝时返回什么**——不是「失败了」，而是三件套：(1) 文件当前内容；
(2) **自你上次读以来的 unified diff**；(3) 过期依赖及版本差。让 LLM**从当前基线重新规划而不必重读所有文件**。
另一细节值得抄：**拒绝后给被拒 agent 一个短租约**，防两 agent 互相 invalidate 形成活锁。

> **这可能比锁本身更有价值**：它把「冲突」从**阻塞事件**变成**一次带上下文的廉价重试**。
> 人类需要「协商」因为重做成本高；**agent 不需要协商，它只需要一份足够好的重规划输入**。
> 这是最适合直接移植到 Pet Locus 的单点设计。

**git 本身就是 OCC**，更精确的 CAS 原语是 **`--force-with-lease`**——「overrides this restriction
**if the current value of the remote ref is the expected value**」（[git-push](https://git-scm.com/docs/git-push)）。
**MVCC 类比**：branch = 快照读，merge = 提交时写写冲突检测，「精确 base commit」即 read timestamp。
**未找到**把 git 分支显式框定为 agent MVCC 的权威论文——文献要么谈 worktree 隔离，要么谈数据库侧 MVCC，中间是空白。

### B.4 OT / CRDT 用于代码 —— 可以，但不该用来解决你的问题

**确实有人做**：Zed 协作建立在 CRDT 上（[官方](https://zed.dev/blog/crdts)，2017 年试过 OT 后选了 CRDT）；
2026 年的 **Delta** 用 CRDT 引擎 DeltaDB 把 conversation 与 worktree 一起实时复制，
且「works with the git repository you already have」（[Introducing Delta](https://zed.dev/blog/introducing-delta)）。
**这是最直接的产品级反例——它选择了不隔离、实时收敛。** 但**这是实时同缓冲区字符级协作，不是异步分支合并。**

**为何多数代码工具不这么做——最强证据来自一篇支持 CRDT 的论文本身**：
[CodeCRDT](https://arxiv.org/abs/2510.18893) 600 次试验**100% 收敛、零 merge 失败**，却自陈
"CRDTs cannot detect semantic inconsistencies (duplicate declarations, type mismatches, broken references)"，
实测**语义冲突率 5–10%，简单任务 20%、复杂任务高达 80%**。
→ **CRDT 保证「字节收敛」，而代码需要「语义有效」。**
[Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) 划清边界：
**"Since Figma isn't a text editor, we didn't need the power of OTs"**——**明确承认文本编辑才是 OT 的用武之地**。

**经典语义冲突反例**（[Agent Native Version Control](https://nmbr7.github.io/notes/programming/agent-native-version-control/)）：
A 在解引用前加 null check，B 加了一行会解引用该指针的日志 → 合并后日志先于 check 执行 → crash。
两者 AST 层面完全兼容、合并无冲突，结果却是错的。结论：检测这类问题**至少需对合并结果做类型检查，理想需跑测试**。
**任何自动 merge 方案都必须以「合并后跑验证」收尾。** 而语义冲突至今无可靠自动解：
[Merge-Bench](https://arxiv.org/abs/2605.25890)（7,938 个真实冲突 hunk）测出**最好的模型也只正确解决 <60%**。

### B.5 Merge queue —— 「并行开发、串行落地」的工业答案

- **GitHub**：PR 入队后创建临时分支，把该 PR + **base 最新状态** + **队列中它前面所有 PR** 打包成 `merge_group`
  在组合状态上跑检查（[docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)）。
  **关键：验证「合并后的状态」而非「PR 自身状态」**，这才挡得住语义冲突。
  失败时**重建队列、从头重测幸存 PR**（非二分）；`Build concurrency`（1–100）用来节流 CI 放大。
- **GitLab merge trains**：每 MR 与前面所有 MR 的**合并态**一起测试，**pipeline 全部并行**（[docs](https://docs.gitlab.com/ci/pipelines/merge_trains/)）。
- **Uber SubmitQueue**：对冲突改动用 **speculation tree** 验证不同落地顺序——收到 C₁C₂C₃ 且前两者未完成时，
  **对 C₁/C₂ 的 4 种可能结果分别起 build**（[Uber](https://www.uber.com/en-CR/blog/bypassing-large-diffs-in-submitqueue/)）；
  因指数放大 CI，引入**概率模型 + 冲突分析剪枝**（[CI at Scale](https://arxiv.org/abs/2501.03440)）。
- **为什么必须有它——merge skew**：[Graphite](https://www.graphite.com/blog/bors-google-tap-merge-queue)：
  CI 只证明变更在 (a) 上通过，合并时 trunk 已到 (a')，**你不再拥有任何证明**。即 Graydon Hoare 的
  **Not Rocket Science Rule**：始终自动维护一个「所有测试都通过」的仓库。

> **对 Pet Locus**：不需要 Uber 规模投机，但需要其**核心不变量**——
> 「**任何分支落地前，必须在『它 + 当前主干最新状态』的组合上被验证过一次**」。单机最小实现即 serialize merges。
> 可复用基座：本仓库 `ws clean` 已有「ancestry / patch 等价」双证明
> （`archive/2026-09-04-prove-merge-by-patch-equivalence/design.md`）。

### B.6 人类团队类比：Google Rosie

[《Software Engineering at Google》ch.22](https://abseil.io/resources/swe-book/html/ch22.html) 给出了最完整的公开范式：

- **为什么必须分片**：「随着代码库与工程师数量增长，**可能的最大原子变更反直觉地变小**」；
  「随着变更涉及文件数增加，遇到 merge 冲突的概率也增长，**并被并发工程师数量复合放大**」——
  **冲突概率 ≈ 文件数 × 并发数，这就是并行 agent 的风险公式。**
- **分片依据**：Rosie **按 project boundaries 与 ownership rules 分片**，每片走**独立的 test-mail-submit 流水线**。
- **显式背压**：**为任一大规模变更设定「未完成分片数」上限**，并以低优先级运行。
- **分级 review**：全局 approver 用**基于 pattern 的工具自动批准**符合预期的片，
  **只人工检查因 merge 冲突或工具故障而异常的一小部分**。
- **Cattle vs pets**：**冲突时丢弃重做优于修复**——对 agent 产出尤其适用。

---

## C. 何时串行、何时并行

### C.1 并行的冲突成本 —— 有大样本量化数据

**Xu / Subramanian / Karthik**：AIDev-pop 中 **2,807 仓库的 33,596 个 agent PR**
（[arXiv 2607.04697](https://arxiv.org/abs/2607.04697)）：

- **40.2%** 仓库存在**时间精确重叠**的 agent PR 对，占全部 agent PR 的 **79.4%**；一周窗口升至 **53.4% / 95.0%**。
- 基于 747 对真实三方 merge 重放：**跨 agent 文本冲突率 41.7%，同 agent 19.8%**（95% CI 不重叠）。
- 冲突文件 **84.4% 是源码而非依赖清单**（lockfile 仅 3.9%）；**近 42% 是结构性冲突**
  （modify/delete 占 26.8%、add/add）——**行级 merge 无从调和**。

> **一个极易被二次引用误传的点**：跨 agent 对虽冲突率翻倍，但**只占全部重叠对的 0.5%**。
> **绝大多数并行冲突是「同一 agent 的多个 PR 之间」的 19.8%。** 对 Pet Locus 这反而更贴切——
> 你的多个 locus 用同一 agent 栈，**应以 ~20% 而非 41.7% 作为一阶返工税率**。作者自陈这是**下界**（未测 build 与语义冲突）。
>
> **另一个直接推翻常见直觉的数字**：**lockfile 仅占 3.9%**。「依赖变更必须串行」虽正确，
> **但它根本不是主要冲突源**——主因是两个 agent 对同一段逻辑做了不同的架构决定。

[AgenticFlict](https://arxiv.org/html/2604.03551v2)（142K+ agent PR / 59K+ 仓库，确定性 merge 模拟）独立佐证：
**整体冲突率 27.67%**，抽出 33.6 万个细粒度冲突区域。**对照人类基线约 11.9%**
（[Ghiotto 等，2,731 个 Java 项目 / 960,366 个 merge 场景](https://cbsoft.sbc.org.br/2026/data/papers/sbes/How%20AI%20Coding%20Agents%20Resolve%20Merge%20Conflicts%20An%20Empirical%20Study.pdf)）——
**agent PR 的冲突率显著高于人类。**

> **本次调研最决定性的一个数字，它直接量化了「推迟冲突」的真实账单。**
> 同一篇 SBES 2026 研究分析 12,299 个 AI PR 中的 14,960 个冲突 merge commit，结论是：
> 「**agents rarely resolve the conflicts they produce: humans author 14,386 (96.1%) of conflicting merge commits**」。
> **96.1% 由 agent 制造的冲突，最后是人类去解决的。**
> 论文还指出各家 agent 的自解率相差近 **60 倍**，且 Codex 与 Claude Code 各自 >83% 的自解案例来自单一仓库——
> 「reflects the dominant repository's workflow, not the agent」，即**看不到通用的冲突解决能力**。
>
> → **这说明 worktree 的「推迟冲突」不是把成本分摊到未来，而是把成本集中转嫁给人。**
> 它同时解释了为什么 §C.5 的「review 带宽才是瓶颈」是本主题的核心结论，
> 也解释了为什么 D3（落地前在组合态验证）必须自动化——否则积压的就是人工解冲突。

**最关键的洞见：文本冲突只是简单的那一半。** [Zed 并行 agent 的 HN 讨论](https://news.ycombinator.com/item?id=47866750)中
`ArielTM`：「**The worktree part is the easy half.** Agent A 把某类型重命名为 X，Agent B 在另一个 worktree 独立重命名为 Y，
因为**谁也没看见对方的决定**。合并时两边都不算『错』，但代码是不自洽的。……
**更难的协调问题是语义层面的，而并行带来的时间节省正是死在那里。**」
一位成熟仓库实践者印证（[Ask HN](https://news.ycombinator.com/item?id=46993479)）：
「**随着项目成熟稳定，每个新特性都是横切的，不撞上冲突就无法并行**——既有设计冲突（两个 agent 加了相似而重叠的机制），
也有寻常的代码冲突。」→ **对 ohmydsh 这种已成熟、规范驱动的仓库，这条警告权重应高于「并行很香」的叙事。**

### C.2 任务依赖性 —— 一个 +81% / −70% 的断崖

Google Research 2026 测了 180 种 agent 配置（[arXiv 2512.08296](https://arxiv.org/html/2512.08296v1/)）：
**可并行任务**上中心化协调比单 agent **提升 80.9%**；**顺序推理任务**上**每种多 agent 变体都下降 39–70%**。
它测的是多 agent 协作解决**一个**任务，与「N 个独立 issue」不完全同构，不可直接外推；
但判据通用——**子任务间是否存在「后一步依赖前一步产出」**。

[Conductor 的决策表](https://www.conductor.build/docs/concepts/parallel-agents)是最具体的公开分解指引：
**并行**用于独立 feature、可单独发布的 bugfix、issue 扇出、可能丢弃的实验；
**单 workspace（协作/串行）**用于「一个实现另一个 review 同一 diff」「一个改代码另一个修测试」、
以及**必须一起落地的前后端改动**。其并行指南有一条直接禁忌：
**「Avoid assigning two workspaces the same file-heavy refactor unless you expect merge conflicts.」**

### C.3 能否静态预测两个 issue 会碰同一批文件

**能，有二十年学术积累，数字相当硬，但几乎没被 agent 工具产品化。**

**Crystal（推测式合并）**——[Brun, Holmes, Ernst, Notkin, ESEC/FSE 2011](https://www.cs.umass.edu/~brun/pubs/pubs/Brun11fse.pdf)。
后台把各分支两两预先 merge、build、跑测试，把冲突分为 **TEXTUAL / BUILD / TEST** 三层。9 个项目、340 万行实测：
16% merge 有文本冲突；**致命一击**：「**33% of the 399 merges that the version control system reported as being
a clean merge, actually were a build or test conflict.**」冲突平均存活 **9.8 天 / 23.2 changeset**（最坏 334 天）。

> **这直接证明了 D3 的必要性**：`git merge-tree` 这类纯文本预检只能覆盖那 16%，
> **额外的 33% 必须靠「合并后跑 build + test」才能发现**。而「存活 9.8 天」与 §C.5 的排队论构成闭环：
> **分支等待越久，冲突越贵。**

**Cassandra（冲突感知调度）**——[Kasi & Sarma, ICSE 2013](https://web.engr.oregonstate.edu/~sarmaa/wp-content/uploads/2020/08/2486788.2486884.pdf)：
**把冲突可能性编码成约束、用 Z3 求解出冲突最小的任务执行顺序**。GitHub 历史回放：Jenkins 六月切片**避免冲突 81/83**，
Perl **25/26**，Storm **36/40**；最长 **16.65 秒**求解。**「排队顺序本身是可优化变量」的直接证据，且成本秒级。**

**ROSE（演化耦合挖掘）**——[Zimmermann et al., TSE 2005](https://thomas-zimmermann.com/publications/files/zimmermann-tse-2005.pdf)：
对 VCS 事务做关联规则挖掘得出「改了 X 的人也改了 Y」，top-3 命中率 **>70%**。
但根本权衡是「**One can either have precise suggestions or many suggestions, but not both**」：
低阈值 precision 仅 0.30，高阈值下 **precision > 66%、recall ≈ 75%** 却只覆盖 3%。
→ **正确用法是双档：低阈值出「提示」，高阈值触发「强制串行」**，不要当通用拦截器。

**ML 预测**——[ESEM 2019](https://arxiv.org/abs/1907.06274)，267,657 个 merge 场景，仅用 9 组轻量 Git 特征：
预测**「安全」F1 高达 0.95–0.97，预测「会冲突」只有 0.57–0.68**。
→ **最实用的映射：用预测器做「放行」（高可靠），用推测式 merge 做「拦截」**，而非反过来。

**最省事的近似**：`git log --name-only` 统计 co-change 频次即得经验性 logical coupling
（源头是 [Gall et al., ICSM 1998](https://ieeexplore.ieee.org/document/738508)）。**未找到**有编排工具公开用该信号调度。

### C.4 分级处理

| 层级 | 信号 | 建议 | 证据 |
|---|---|---|---|
| L0 强制串行 | 同文件 | 串行 | [84.4% 冲突在源码](https://arxiv.org/abs/2607.04697)；[Conductor 明令避免同一 file-heavy refactor](https://www.conductor.build/docs/concepts/parallel-agents) |
| L1 强制串行 | **读写混合** / 高置信共变 | 串行或同 workspace | [Armin「mixing reads and writes → chaos」](https://lucumr.pocoo.org/2025/7/30/things-that-didnt-work/)；[ROSE 高阈值 precision>66%](https://thomas-zimmermann.com/publications/files/zimmermann-tse-2005.pdf) |
| L2 谨慎并行 | 同模块 / 同 CODEOWNERS | 并行 + `git merge-tree` 预检 | [Rosie 按 ownership 分片](https://abseil.io/resources/swe-book/html/ch22.html) |
| L3 谨慎并行 | 反向依赖闭包相交 | 并行 + **合并后必跑 build/test** | [Crystal：33% 干净 merge 实为 build/test 冲突](https://www.cs.umass.edu/~brun/pubs/pubs/Brun11fse.pdf) |
| L4 放心并行 | 不相交目录 + ML 判 safe | 并行 | [safe 判定 F1 0.95–0.97](https://arxiv.org/abs/1907.06274) |

**三个独立于分级的旋钮**：

1. **并发必须显式设上限，且由 review 吞吐而非机器吞吐决定**：[Cursor 数据](https://cursor.com/blog/scaling-agents)
   （20 agent 退化为 2–3 有效吞吐）、Rosie 的未完成分片上限、实践者收敛的 **2–4**——全部同向。
2. **仓库成熟度 / 变更是否 cross-cutting 是比文件重叠更靠前的一级判据**（§C.1、§A.4 的 greenfield 边界）。
3. **验证必须单点串行**：[Ralph 的背压规则](https://ghuntley.com/ralph/)——
   **搜索与写文件可无限扇出，但 build/test 只能用单个 subagent**，否则得到「bad form back pressure」。

### C.5 「我日常都在主 session 排队跟进」—— 你的现状有充分证据支持

**衡量「并行 agent 是否划算」的对照实验根本不存在。**
[METR 的 RCT](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)（16 名资深 OSS 开发者 / 246 任务）
本身已反直觉——允许用 AI 时**耗时增加 19%**，而开发者事前预期加速 24%、事后仍自认加速 20%。
最关键的是 METR 自陈：其耗时测量**对「并发使用多个 AI agent」的那部分开发者不可靠**。

- **Simon Willison**（[原文](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)）：
  「**天然瓶颈是我审查结果的速度**……如果并行只让我更落后，同时跑多个的收益在哪？」
  他采用**受限并行**：一次只专注 review 并落地一个重要改动。
- **Armin Ronacher 的 8 个月反转**：2025-06 [支持](https://lucumr.pocoo.org/2025/6/12/agentic-coding/)
  （已把问题定义为**「管理共享状态」**而非目录隔离）→ 2025-07
  [收缩](https://lucumr.pocoo.org/2025/7/30/things-that-didnt-work/)（「**读写混合的任务会制造混乱**」）→
  2026-01 [Agent Psychosis](https://lucumr.pocoo.org/2026/1/18/agent-psychosis/) 反对，核心是**不对称性**：
  「提示只要一分钟，诚实 review 一个 PR 要花好多倍时间。」
  [The Final Bottleneck](https://lucumr.pocoo.org/2026/2/13/the-final-bottleneck/) 形式化为排队论：
  「输入增长快于吞吐即累积性失败，只有 **backpressure 与 load shedding** 能保住系统」，
  且「过了某点，很多 PR 因**过于陈旧**而无法合并」——与 Crystal 的「冲突平均存活 9.8 天」构成**正反馈回路**。
- **Cursor 的大规模报告**两条教训：**「锁会吃掉并行度」**（20 agent 退化为 2–3）、
  **「专职冲突解决者是反模式」**（「integrator 角色制造的瓶颈比解决的更多」）。

**结论**：always-serial 不是落后，而是与证据一致的选择。**真正的瓶颈是你的 review 带宽，它不会因为多开 agent 而变宽。**

---

## D. 方案候选

**D1 现状（baseline）**：共享根 + 展示风险。隔离无；不卡进度；**冲突静默覆盖、可能永不暴露**；复杂度 0。
唯一一个**冲突不产生任何信号**的方案。适用：确认只有一个 locus 会写时。

**D2 一个 locus 一个 worktree（推荐主路线）**：子会话首次写代码时走既有 Worktree Session 流程，
绑定 `<repo>/.worktrees/<task>` 与独立 task branch；规范已保证「一活动 Session 同时只绑一个未清理 worktree」
「主 checkout 禁写」「依赖变更前 promote」（`openspec/specs/source-workspace-worktree-session/spec.md`）。
隔离强（文件级；**非安全沙箱**）；**不卡进度**；冲突在合入时显式暴露；**复杂度低**（能力已存在，缺编排线）。
风险：**冲突只是被推迟（必须配 D3）**、构建缓存失效、§A.1 的 symlink 穿透风险需复核；
以及 **worktree 只隔离文件、不隔离端口/DB/容器卷**——若 locus 会起服务，需另配 setup/teardown
（`cyrus` 的 `cyrus-teardown.sh` + 面包屑文件是唯一成体系的公开答案）。

**D3 单机 merge queue（D2 的必要补件）**：完成后不直接 merge 而入队；一次一个：rebase 到当前 main →
**在组合态跑 build + test** → 通过才落地 → 后续候选自动重新 rebase 重验；失败退回该 locus，不阻塞不相交候选。
开 `rerere.enabled`。**只卡落地不卡开发**——这是「不卡进度又安全」的核心机制。
**必要性由 Crystal 的 33% 量化**：纯文本预检漏掉的 build/test 冲突只能在这一步抓到。可复用 `ws clean` 双证明作闸门。

**D4 写前意图声明 + 重叠准入（需谨慎）**：开工前提交 ChangeIntent，不相交立即放行，相交才协商。
**但 §B.2 实测表明这不是免费午餐**：粗声明退化成全局锁，细声明因覆盖不全频繁 fail closed。
**建议只抄「拒绝载荷」（B.3）而非「准入门」**：冲突时不阻塞，回一份 diff 让 agent 廉价重规划。

**D5 冲突感知调度**：用 git 历史 co-change 预测哪些 locus 会相交，据此重排队列。不卡进度（只改顺序）；
**学术证据比预期强**（Cassandra 避免 81/83、求解 16.65 秒），但**从未在 agent 场景复现验证**，
且 ROSE 的 precision/recall 权衡要求做双阈值而非单一拦截器。

**D6（已评估否决）**：容器/VM 要求把开发主循环迁到远端，与 Pet Locus 定位冲突；
CoW（[agent-harbor](https://docs.agent-harbor.com/project)）可行但依赖特定文件系统、生态极新，且**不解决合回去的问题**。

## 方案候选对比表

| 方案 | 隔离强度 | 是否卡进度 | 冲突暴露时机 | 实现复杂度 | 适用场景 |
|---|---|---|---|---|---|
| **D1 共享根 + 展示风险** | 无 | 否 | **静默覆盖，可能永不暴露** | 0（已有） | 确认单写者；只读/问答型 locus |
| **D2 worktree per locus** | 强（文件级，非安全沙箱） | 否 | 合入时（显式 merge conflict） | 低（能力已存在） | **主路线**：多 issue 各自独立跟进 |
| **D3 单机 merge queue** | 不适用（落地层） | **仅卡落地，不卡开发** | 入队验证时，**合并后组合态** | 中 | D2 必要补件；唯一能抓 build/语义冲突 |
| **D4 意图声明准入** | 中（协调层） | **理论不卡，实测常退化为串行** | 开工前，最早 | 中 | 谨慎；建议只取「拒绝载荷」 |
| **D5 冲突感知调度** | 无 | 否（只改顺序） | 调度时（预测，有误报） | 中高 | locus 多、历史数据足时的加分项 |
| **D6 容器/VM 或 CoW** | 最强 | 否 | 仍在合入时 | 高 | 需防御破坏性 agent 或远端算力 |
| **（对照）全局写锁** | 强 | **卡，且全量卡** | 获取锁时 | 低 | 不推荐：把不相交的工作也串行化 |

### 推荐组合：D2 + D3 起步；D4 只抄「拒绝载荷」

- **D2** 让「各 locus 并行改代码」立刻安全，复用本仓库已验收的能力。**唯一无保留推荐的一步。**
- **D3** 把 worktree 推迟的冲突在落地前、组合态上收掉。**没有 D3 的 D2 是不完整的**——
  Crystal 的 33% 证明纯文本检查不够，必须跑 build/test。最小形态：一次只 merge 一个 + 自动 rebase 重验 + `rerere.enabled`。
- **D4 拆开看**：「拒绝载荷」值得抄，「准入门」暂不值得（§B.2 实测）。
- **并发上限设 2–3，由 review 带宽决定**，而非机器能同时跑几个（§C.4）。
- **不要做全局写锁**：它把 L4 级（完全不相交）的工作也串行化，而那恰是并行收益最干净的部分。

> **最后一句诚实的话**：本文能证明「**如何让并发写变安全**」，不能证明「**并发写会让你更快**」——
> 后者的对照实验不存在，而多位实践者在成熟仓库上的结论偏负面。
> 建议把 D2+D3 当作**风险消除**（消除 D1 的静默覆盖）来做，而非提速手段。
> 若目标只是提速，**先扩 review 带宽比先开 locus 更对症**。

### 仍未找到公开答案的问题

1. **「N 个 agent 并行在同一 repo 上的净吞吐（扣除冲突与返工）」没有任何公开对照实验**（§C.5）——
   本主题最大的证据空白，任何「并行更快」的主张目前都缺乏实证支撑。
2. **无**主流工具公开宣称「同一仓库同时只跑一个 agent」是其设计选择（§A.4，Ralph 是最接近的反多-agent 立场）。
3. **无**编排工具产品化基于 git 历史 co-change 的冲突预测调度；Cassandra/ROSE **从未在 agent 场景复现验证**，
   数字均来自人类开发者历史回放（§C.3、D5）。
4. AI 辅助解 merge conflict 落地效果缺乏可信数据；已知天花板是 Merge-Bench 的 **<60%**（§B.4）。
5. macOS APFS `clonefile` 用于 agent 工作副本克隆**未见公开先例**（§A.3，推测）。
6. **未找到** Meta stacked diffs 降低冲突率的官方量化数据，也未找到「共享决策日志」
   （§C.1 中唯一被提出可覆盖语义分歧层的机制）效果的任何量化评估。
7. **被调研的 agent 编排器无一实现 merge queue，也无一把 AI 解冲突做成自动步骤**（§A.1）——
   这正是本文 D3 建议要补的空白，也意味着**没有现成实现可直接抄**。
