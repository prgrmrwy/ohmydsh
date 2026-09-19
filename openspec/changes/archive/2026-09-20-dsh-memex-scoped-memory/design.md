# 设计：DSH 分域持久记忆层

## Context

### 本方案是什么

**一层 Pi extension 的等价物，加一个 scope 维度。**

上游 memex 已经为多种宿主提供了原生接入。其中 [Pi](https://github.com/badlogic/pi-mono)
的接入形态与本方案目标最接近——它随 memex 包发布（`pi-extension/index.ts`，487 行），做三件事：

1. 注册 8 个 memex 工具（自己写 name / description）
2. 订阅宿主生命周期事件，做召回注入与写卡提醒
3. 把包内的 `skills/` 目录暴露给宿主的 skill 机制

**它没有策略层、没有抽象端口、没有自己的域模型。** 本方案在结构上与它一致，唯一新增的
是 scope——因为 memex 的设计前提是「只有一个库」，而本项目需要多个。

### 三方分工

| | 提供什么 | 本方案如何对待 |
|---|---|---|
| **memex** | 卡片格式、slug 规范、链接策略、标签体系、索引；recall / retro / organize / best-practices / agentic-memory / sync 六个方法论 skill；CLI 与 MCP 两套接口 | **原样使用**。方法论以它的 skill 为准，本方案不复述、不改写 |
| **DSH** | 会话生命周期事件、工具注册、系统提示注入、DSH settings、自定义 skill 根目录 | **订阅与使用**。不修改 core |
| **本方案** | 只有「跨库」这一件事：选库、并发、归并、来源标注、库间守门 | 全部实现落在我们的层 |

**「怎么写」不属于我们。** 卡片怎么写、如何建立链接、何时精炼归档，memex 的 skill 已经
定义完整（包括 `[[wikilink]]` 必须嵌在解释关系的句子里、关系类型分类、slug 的 kebab-case
与长度约束、frontmatter 必填与可选字段）。本方案不重复这些规定。

### 硬约束（已核实）

- **MCP 路径不可用。** `dsh-mcp-client` spawn 的常驻 stdio 子进程 cwd 等于 DSH 主进程 cwd；
  上游 `resolveMemexHome()` 在进程启动时解析一次即固定（`MEMEX_HOME` > 向上查找 `.memexrc`
  > `~/.memex`），因此纯 MCP 方案拿不到当前会话的 cwd。**这是必须自建进程内薄层的唯一原因。**
- **上游 API 按「单库」设计。** `read` 只有 `--nested` 选项，没有任何跨库开关；
  `search --all` 依赖库内 `.memexrc` 的 `searchDirs`，且在合并输出时丢失来源信息
  （`dirPrefix` 由各库卡片目录名派生，各库该名相同）。**多库语义必须由我们合成。**
- **同步粒度是整库。** `push()` 执行 `git -C <home> add cards` + `add archive`；
  `pull()` 执行 `fetch` + `merge`。无按卡过滤，因此**一个库只能有一个推送目的地**——
  这是「库数 = 推送目标数」的直接来源，也是独立存储不可替代的原因。
- **CLI 无结构化输出。** 基线 `0.4.1` 的 `search` / `read` / `write` 均不提供 `--json`
  （仅 `links` 有）。需解析面向人的文本输出，这是本方案最脆弱的耦合点。

## Goals / Non-Goals

**Goals:**

- 让 DSH 获得跨会话持久记忆，且按 knowledge domain 物理隔离**存储**。
- 复用 memex 的完整方法论与实现，**不做非必要改造**。
- 库之间零引用：任一库可单独复制、同步、删除，其余库照常工作。
- 支持跨库检索与跨库写入，因为跨项目任务需要同时感知双边上下文。

**Non-Goals:**

- 不重写、不 fork、不扩展 memex 的卡片格式与 skill。
- 不做 RAG / embedding / 向量检索（默认关键词路径零外发）。
- 不做跨库双链：`[[wikilink]]` 解析域仍是单库，否则删库会在另一库留下断链。
- 不做**有序**或带优先级的跨库检索：多库同时检索即可。
- 不做内部库之间的写入守门：那类写入不泄漏，只误归档，且误归档可由检索发现。
- 不做 GUI 面板（用 `memex serve`）。

## 生命周期

本方案的行为集中在六个时刻。**memex 在前四步中始终是「单库」视角**——它不知道有多个库。

### ① 会话开始

```
DSH 起会话，cwd 已知
  → 订阅 agent/session-start
  → resolveScope(cwd) → 当前 scope 与库路径
  → 查绑定集合 → 本次会话的可读 / 可写范围
  → agent.inject() 注入召回提醒
```

注入的文本对齐 Pi 的 `before_agent_start`（其原文包含「BEFORE starting work, call
`memex_recall`」「AFTER completing the task … call `memex_retro`」以及护栏提示
「max 3 link hops, max 20 cards read」）。**护栏是提示词文本，不是系统强制**——
上游即如此处理。

### ② 召回（recall）

```
模型调 memex_recall（通常无 query）
  → 隐式使用当前 scope，不暴露 scope 参数
  → spawn: MEMEX_HOME=<当前库> memex read index
  → 索引缺失时回退到列全部卡片
  → 输出原样返回
```

**`recall` 不带 `scope` 参数**：无 query 时它读的是该库的索引卡，而索引是**单库的策划物**，
跨库拼接不是索引而是噪音。

### ③ 检索（search）

```
默认：memex_search(query)
  → 当前 scope 一个库 → 一次 CLI 调用

跨库：memex_search(query, scope: "all")
  → 绑定可读范围 N 个库
  → 并发 N 次 CLI 调用（各自 MEMEX_HOME）
  → 归并，每条标注来源 scope
```

**并发是必需的**：每次调用是一次子进程，串行会让延迟随库数线性增长。并发数有上界。

**来源由调用方直接确定**：逐库调用使「这条结果来自哪个库」成为系统已知的事实，无需从
合并输出反推——而后者在单次 `--all` 调用下已经不可能（来源信息在合并时已丢失）。

### ④ 写卡（retro / write）

```
memex_retro(slug, title, body, category?)
  → 写当前 scope 的库
  → 若指定 scope: <另一个库>，则另写一份
  → 目标库发布方向为外部时，写入前经守门
```

`retro` 的描述已声明它「Handles frontmatter, source tagging, and cross-device sync
automatically」——**这些都不需要我们做**。本方案只增加「写哪个库」与「外部库前检查」。

### ⑤ 回合关闭

```
订阅 agent/turn-stopping
  → 若本会话尚未写卡，且已发生过召回 → 注入写卡提醒
  → 采用不打断当前回复的投递方式
```

对齐 Pi 的判断：`if (retroDone || !recallDone) return;`——**没召回就不提醒写卡**，
否则对没在用记忆的会话是纯噪音。

### ⑥ 压缩后重置

```
会话压缩发生（agent/session-start 的 source 含 compact）
  → 重置「已召回」标志
  → 下次用户提问时重新注入召回提醒
```

**这是实测踩过的坑**：压缩会把注入的提醒总结掉，不重置则长会话中记忆引导静默消失。

## Decisions

### D1. 复用 memex 的完整能力，只补 scope

上游已有完整方法论与多宿主接入经验，本方案不重新发明。**判据**：改动 memex 本体 / skill /
卡片格式 = 不必要；在我们的工具层或 spawn 参数上做手脚 = 必要（那是我们唯一拥有的地方）。

### D2. 进程内注册工具，不使用 MCP

工具由本包通过 `ctx.tools.register` 注册，执行时以子进程调用 memex CLI。
这是取得 `agent.session.header.cwd` 的前提（见硬约束）。MCP 这条渠道被**替换**而非包装。

### D3. 库的数量等于推送目标的数量

上游 push / pull 都是整库粒度，一个库只能有一个同步目标。因此「库」的划分依据是
**发布目标与访问权限**，而不是概念域。若两个 scope 实际推同一个仓库，它们就该合并为一个库
——那才是过度隔离。本项目各业务域推不同团队仓，故分库成立。

**代价（明确接受）**：库目录数量随项目数增长。缓解方式有二：所有库集中于 `~/.dsh-memex/` 命名空间（不散落主目录），以及自动派生按
remote 仓库名收敛（同一仓库的多个工作副本归一个库）。

### D4. scope 解析：路径前缀 > remote 模式 > 自动派生 > fallback

路径前缀匹配无需 git 调用、覆盖日常；remote 模式匹配覆盖 cwd 不足以代表业务域的场景，
典型是外部手工创建的 git worktree 与 clone 副本。

路径前缀 SHALL 按**路径段边界**判定（等于前缀，或以前缀加分隔符开头），MUST NOT 用纯字符串
比较——否则前缀 `…/nexus` 会错误命中 `…/nexus-ops` 这类兄弟目录。

自动派生 SHALL 按 git remote `origin` 派生，取路径末两段、去 `.git`、以 `-` 连接并归一化；
MUST NOT 只取末段（不同组织下的同名仓库会静默共库）。

**个人托管平台上的仓库同样各自建库**，不并入 `personal`：开源项目也有自己的知识域，
混入通用库会重蹈本方案要避免的「混库产生噪音」。`personal` 只保留给不属于任何具体项目的
通用知识，以及无 `origin`、非 git 等无法确定归属的情形。

这一条推翻了本 change 早期的「`github.com` 一律归 `personal`」规则。当时的理由是
「不为个人开源项目各自建库」，但与本方案的核心论证矛盾——那条论证说业务知识的概念空间是
项目私有的；开源项目的知识空间同样是项目私有的，只是发布方向不同。

### D5. 绑定集合界定可达范围

由配置声明的绑定集合定义一次会话可读与可写的 scope 范围。集合是**限制而非授权**：
无绑定声明时，可读退化为当前 scope，可写退化为「当前 scope + `personal`」——
即 memex 原生行为，无额外约束。

### D6. 工具面与 Pi extension 对齐，沿用上游名字与描述

8 个工具对齐 Pi：`memex_recall` / `memex_retro` / `memex_search` / `memex_read` /
`memex_write` / `memex_links` / `memex_archive` / `memex_organize`，**name 与 description
沿用上游 MCP 原文**。

模型看到的名字虽与 memex CLI 子命令同名，但**模型看不到 CLI**——它只看到我们注册的工具。
沿用上游名字的直接收益是：**包内 skill 里引用的工具名（`memex_read` / `memex_search` /
`memex_write` / `memex_links` / `memex_archive`）无需任何替换**，方法论可以原样复用。

`scope` 参数只加在语义允许跨库的工具上（见 D7），其余工具隐式使用当前 scope，
因此 skill 描述的调用路径（不传 scope）完全不受影响。

### D7. `scope` 参数只加在「操作一张卡或一次查询」的工具上

| 工具 | scope 参数 | 理由 |
|---|---|---|
| `search` | ✅ `current` / `all` / 列表 | 原子查询，跨库合并合理 |
| `read` | ✅ 具体 scope 名 | 跨库读回需要；`read` 只作用一个库 |
| `write` / `retro` | ✅ 具体 scope 名 | 决定写哪个库 |
| `recall` | ❌ 隐式当前 scope | 读该库索引卡，索引是单库策划物 |
| `organize` / `archive` / `links` | ❌ 隐式当前 scope | 图级操作，孤儿 / 枢纽 / 矛盾是单库概念 |

**判据**：操作对象是「一张卡或一次查询」→ 可跨库；是「整个卡图或索引」→ 单库。

### D8. 多库检索并发派发，来源由调用方确定

对所选范围内每个库并发调用一次 CLI，各自注入 `MEMEX_HOME`，再按确定性规则归并。
MUST NOT 依赖上游 `searchDirs` + `--all`——那条路径下来源信息已经丢失，且需要在每个库目录
内生成指向其他库的配置文件，与「库之间零引用」冲突。

**合并 SHALL 是确定性的**：各库内保持 CLI 原序，按 `(scope 名升序, 库内原序)` 稳定归并后
截断。并发的完成顺序 MUST NOT 影响结果。

选择确定性归并而非按相关性分数排序，是为**可预期与可测试**——内核评分是各字段匹配权重的
求和、与库规模无关，跨库排序技术上可行且相关性更好，但那需要额外定义归一化与并列打破规则，
与「多库同时检索、不引入优先级语义」的约定相悖。若实测发现相关性不足，改为按分数排序是
允许的演进方向。

### D9. 复用 memex 的 skill，通过 DSH 自定义 skill 根目录直接引用

DSH 的 skill provider 支持 `customSkillDirs`。本方案 SHALL 将 memex 包内的 `skills/`
目录作为自定义根目录接入，MUST NOT 复制或改写其内容——复制会产生需要跟随上游重新打补丁的
本地副本。

收益：方法论零翻译损耗、上游更新即生效。代价：依赖 memex 包的安装位置稳定。

### D10. 守门按目标库的发布方向触发

`CrossWriteGuard` 在任何**发布方向为外部**的库被写入前生效。判据是发布方向，MUST NOT 是
库名，也 MUST NOT 是参数名——不可逆的风险来自「内容进入可被外部获取的仓库」，而不是
「进入了一个恰好叫 personal 的库」。发布方向未声明时按外部处理（保守默认）。

**为什么需要它**：memex 无多库概念，因此无从感知「这个库会推到哪里」。库选择是本方案引入
的维度，它的衍生风险也由本方案承担。

**内部库之间的写入不过守门**：那类写入不泄漏，只误归档，且误归档可由检索发现。
加一层会误报的拦截，代价高于收益。

拒绝时保留其余已写入的卡片，MUST NOT 回滚。拒绝记录经运行日志输出，只含 scope 与**规则
标识符**，不含正文、title、slug 全文或命中片段，且 MUST NOT 写入任何库目录——库目录会被
同步并推送，在其中留存业务标识等于用防泄漏机制制造泄漏通道。

### D11. 不自动 `git init`、不自动配置 sync remote

同步到何处是**合规决策**，必须由人显式作出。自动派生只创建目录与 `cards/`，并在返回中
提示该库尚未配置同步。上游 `pull` / `push` 工具的 MCP 描述本身就写着
"If sync is not configured, DO NOT attempt to set it up yourself"——与本决策一致。

### D12. 派生内容 vendored 并带出处，skill 直接引用

本方案对上游内容分三类处理，判据是「能否在不兼容的运行体上复用其实现」：

| 内容 | 处理 | 理由 |
|---|---|---|
| 内核的 `skills/`（方法论） | **直接引用**，零复制 | 与运行体无关，可原样复用；复制会产生需跟随上游打补丁的本地副本（见 D9） |
| Pi extension 的**实现代码** | **不复用** | 其实现依赖 Pi 的 `ExtensionAPI` 与 TypeBox，本运行体没有这些 API；只能按同一思路重写 |
| Pi extension 的**架构模式** | 借鉴，注明出处 | 模式不受版权保护，但出处须可追溯 |
| 工具的 name 与 description 文本 | **vendored**：逐字提取并随包携带 | 描述是喂给模型的提示词，上游已调优；但它是编译产物内的字符串，运行时提取脆弱 |

**工具描述的同步机制**：提供 `scripts/sync-memex-descriptions.mjs`，从 pin 版本的内核包提取各工具的
name 与 description，生成 `src/tools/descriptions.generated.ts`（带生成标记，符合本仓
「生成物不入库为源码」的既有惯例）。脚本支持 `--check` 模式：与远端不一致时非零退出，
供升级与校验流程使用。

**更新时机（两类内容不同）**：

| 内容 | 更新方式 |
|---|---|
| 工具描述（vendored） | **按需**：升级内核版本时、或 `--check` 报不一致时，运行同步脚本并 review 差异 |
| 方法论 skill（引用） | **自动**：指向内核包内目录，升级内核即生效，无需任何动作 |

系统 MUST NOT 在运行时动态读取工具描述，否则不一致会静默表现为「用了旧描述」而不易察觉。
两种方式并存是有意的：skill 内容与方法论演进快、且不依赖我们的接口，适合自动跟随；
工具描述与我们的注册代码耦合、且直接影响模型行为，需要人过目。

**出处与许可**：包内 SHALL 含 `ATTRIBUTION.md` 与上游 MIT 许可全文副本，逐项列明：哪些内容
逐字派生、哪些是概念借鉴、以及「未复制其代码」的事实。这是 MIT 对「副本或实质性部分」的
要求，也让后人不必重新考古。

## Risks / Trade-offs

- **[守门拦不住语义层面的业务信息]** → 规格明确声明守门是「减少误写」而非「保证不泄漏」；
  配套保证是跨库卡片必须去业务化重写 + 人对发布方向为外部的库定期复核。
- **[CLI 无结构化输出]** → 已实测（`--json` 仅 `links` 有）。解析集中在单一模块、绑定版本、
  解析失败即报错不返回部分结果。**这是实施前必须先验证的前置项。**
- **[上游版本漂移]** → 精确 pin 并记录审查；子命令稳定不等于输出格式稳定。
- **[`autoDerive` 产生碎片库]** → 按 remote 优先派生收敛；首次建库在返回中明确告知。
- **[多库检索的并发放大]** → 并发数有上界；单库失败时返回其余库结果并标明失败 scope。
- **[skill 根目录依赖包安装位置]** → memex 若改变包布局，自定义根目录会失效。作为升级
  回归项记录。
- **[外部库的定期复核无机制强制]** → 只是文档承诺，无工具保障。已知缺口。

## Migration Plan

**部署（按序）：**

1. 安装 CLI：`npm i -g @touchskyer/memex`（pin 版本），并确认 `search` / `read` / `write`
   的输出形态符合解析层预期。
2. `packages/dsh-memex/` 落地，`dsh.yaml` 新增一条 bundle 条目。
3. `dsh build` 物化并重启 DSH。
4. 在 settings 中写入初始 scope 表与绑定集合（或使用默认）。
5. 按需配置各库同步（外部库 → 个人托管私有仓；内部库 → 公司内网仓）。
   **未显式配置则不产生任何同步行为。**
6. 在 `AGENTS.md` 补充写卡判据（写什么才算值得留档）——触发时机由生命周期事件承担，
   提示词只负责质量标准。
7. 幂等校验：`node scripts/sync.mjs` 连跑两次报 `no changes`。

**回滚：**

`dsh.yaml` 中该条目置 `enabled: false` → `dsh build` → 重启。**库与卡片不受影响**
（本方案从不在库目录内生成文件），可继续用 memex CLI 与 Obsidian 访问。彻底移除时删除
`~/.dsh-memex/` 整个命名空间与 settings 中的对应分节即可，无残留状态。

## Open Questions

1. **写卡提醒的措辞与节流策略？** 触发点已解决（`agent/turn-stopping`），但强度需实测：
   太弱则不写卡，太强则每轮噪音。这决定记忆的实际密度。
2. **`scope: "all"` 默认关闭是否合适？** 当前默认只读当前 scope，跨库是显式动作。
   若实测跨域需求高频，可评估对特定 scope 对默认放开。
3. **外部库的定期复核如何落实？** 目前只是文档承诺。是否需要机制（如按库内卡片数阈值提醒）？
4. **是否向上游提 `dirPrefix` 串库缺陷的 issue/PR？** 该缺陷对所有多目录用户成立，
   修法明确（用 `searchDir` 全路径而非 basename 作 key）。不作为本方案前置依赖。
5. **memex 的 `experimental.agenticMemory` 是否在 `personal` 库启用？** 该开关按库可配
   （`.memexrc` 在库目录内），A-MEM 结构化流程更重但产出质量更高。
