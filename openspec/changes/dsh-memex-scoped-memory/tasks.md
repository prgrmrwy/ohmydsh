# Tasks: DSH 分域持久记忆层

> 定位：一层 Pi extension 的等价物（工具注册 + 生命周期 + skill 暴露），加一个 scope 维度。
> **不改 memex**：不改源码、不改 skill、不加卡片字段。

## 0. 实施前诊断（阻塞项：未完成不进入第 2 章）

- [x] 0.1 安装 `memex` 并 pin 版本；确认 `search` / `read` / `write` 与 `MEMEX_HOME` 行为成立
- [x] 0.2 **确定 CLI 输出解析契约**（2026-09-18 实测于 0.4.1，MEMEX_HOME 指向临时库，详见下方实测表）
  - `search <q>` 命中：stdout 为 `## <slug>` / 标题 / 首段 / 可选的 `> Matched: <field>:<token>`，多条之间空行分隔；**stdout 为空 = 无结果且 exit 0**
  - `search --list`：stdout 为**两列对齐表格**（`<slug>  <title>`），与命中格式完全不同
  - `read <slug>` 命中：stdout 为**含 frontmatter 的原文**（`---` 分隔），尾部多一个空行
  - `read <slug>` 未命中：**exit 1** + stderr `Card not found: <slug>`（stdout 空）
  - `read index` 索引缺失：**exit 1** + stderr `Card not found: index`（与普通未命中同形，需调用方按场景判断）
  - `write` 成功：**stdout 与 stderr 均可能为空**；有链接候选建议时 stderr 出现提示但**仍 exit 0** → **判据只能是 exit code，不能靠输出是否为空**
  - `write` 缺必填：**exit 1** + stderr `Missing required fields: <list>`（必填为 `title` / `created` / `source`）
  - 敏感输入：**exit 1** + stderr `Sensitive input rejected: ...`（上游凭据防护生效，本系统不重复实现）
  - ⚠ **库目录不存在**：`search` 返回 **exit 0 + 空 stdout + stderr `Warning: cards directory not found (<path>/cards)`** —— 与「无结果」同形。**多库检索里某个库缺失会静默表现为「没搜到」**，因此调用层 MUST 在调用前校验库目录存在，不可依赖 exit code 判别
- [x] 0.3 确认 DSH 提供 `ctx.tools.register`、`agent/session-start`、`agent/turn-stopping`、`ctx.settings`、以及 skill 的 `customSkillDirs`（对照当前 pin 与 `docs/notes/dsh-plugin-integration-pitfalls.md`）
- [ ] 0.4 **实测两个生命周期事件**：确认 `agent/session-start`（含 `source: compact`）与 `agent/turn-stopping` 的实际触发时机、注入是否在首回合前可见、以及不打断回复的投递方式
  - 类型面已核实（2026-09-18，pin 的 0.1.2-rc.1 运行体）：`agent/session-start(this: Scoped<Agent>, payload: {agent, source: 'startup'|'resume'|'clear'|'compact'})`，文档注明「Use `agent.inject()` to seed model-facing context ... once before the first turn」；`agent/turn-stopping(this: Scoped<Agent>, payload: {agent, turn, signal}): Promise<void>|void`，文档注明「a listener that objects steers (`agent.steer(...)`) and the machine re-reads its inbox: fresh steering runs another step, none closes the turn」；`agent.inject(message: UserMessage): void`
  - 内核已装（0.4.1），但仍属**运行时行为**，需在包骨架（第 1 章）与接入实现（5.x）落地时实测：注入是否真的在首回合可见、turn-stopping 的 steering 是否按预期延长回合
  - 已查清 `UserMessage` 形状（`@deepseek-ai/dsh-llm` 的 `message.d.ts`）：`{ id: MessageId, role: 'user', content: ContentBlock[], source: MessageSource }`
  - 注入应使用的来源：`MessageSourceMap.plugin` = `{ kind: 'plugin', plugin: <我们的插件名> } & ContextFormed`——用 plugin 来源而非 user 来源，使注入在会话记录中可辨识且不伪装成用户消息
  - 2026-09-19 已补真实 AgentLoop 集成测试：`startup` guidance 在首个模型 request 前可见；`turn-stopping` 在 recall 后只追加一个 reminder step，不无限循环；注入使用 `instructions` / `notice` form
  - 当前 0.1.2-rc.1 运行体没有完整 compact transaction 发布 `source: compact` 的可调用路径；仅以真实 Agent + 公共 `emitAgentEvent(... source: "compact")` 验证重注入与 wrote 状态保留。因此本项保留未完成，待真实 compaction 路径可用后验收
- [x] 0.5 确认 memex 包内 `skills/` 目录的稳定路径（`customSkillDirs` 的取值依据）
- [x] 0.6 枚举现有工作域并确定初始 scope 表：
  - `code.byted.org:apaas/nexus.git` → `apaas-nexus`（`~/mydir/dev/` 下 9 个目录共享此 remote，按 remote 派生收敛为 **1 个库**）
  - `code.byted.org:flow/flow-web-monorepo.git` → `flow-flow-web-monorepo`
  - `~/mydir/opensource/ohmydsh` → scope `ohmydsh`（库 `~/.dsh-memex/ohmydsh`）；`~/mydir/opensource/dsh-cockpit` → scope `dsh-cockpit`（库 `~/.dsh-memex/dsh-cockpit`）—— 开源仓各自成库，不并入 `personal`
  - `personal`（库 `~/.dsh-memex/personal`）→ 仅承载不属于任何具体项目的通用知识与无归属目录
  - 其余 `~/mydir/dev/*` 各自按 remote 派生
- [x] 0.7 确认各 scope 的同步目标与**发布方向**：
  - **external**：`ohmydsh`、`dsh-cockpit` 等个人托管平台上的项目仓（各自独立库），以及承载通用知识的 `personal`（库 `~/.dsh-memex/personal`）；均推送个人托管私有仓
  - **internal**：`apaas-nexus`、`flow-flow-web-monorepo` 及其余内网 remote 派生的 scope —— 推送公司内网仓
  - 说明：本项曾在评审中被修正——早期规则是「`github.com` 一律归 `personal`」，现改为**开源仓各自按 remote 派生独立 scope 与库**（见 spec 的「scope 名按 remote 确定性派生」需求与 design D4 的推翻说明）；`personal` 只保留给通用知识与无归属情形
- [x] 0.8 确定初始**绑定集合**：先不配置绑定，采用 spec 的退化行为（读 = 当前 scope；写 = 当前 scope + `personal`）。此时 `scope: "all"` 等价于「当前库 + personal」，跨团队仓读取默认关闭

## 1. 包骨架

- [x] 1.1 创建 `packages/dsh-memex/`（package.json、tsconfig、src 分模块：`scope` / `run` / `tools` / `lifecycle` / `guard`），对齐既有 local package 形态；构建产物不入版本控制
- [x] 1.2 build / typecheck / test 可独立运行（2026-09-18 实测通过）
  - `npm run typecheck` 通过；`npm run build` 产出 `lib/index.js` + `lib/index.d.ts`；`npm test` 2 passed
  - 过程记录：`ws promote` 首次失败——其内部用 `npm ci`，而 `npm ci` 要求 lockfile 与 package.json 同步，而新增的 workspace 成员尚未入 lockfile。先 `npm install --package-lock-only` 写入 `packages/dsh-memex` 条目，再 promote 即成功（lean → mutable）
  - `vitest.config.ts` 设 `passWithNoTests: true`：测试随各模块落地，首个模块出现前不应因零用例而让 `test` 脚本失败
- [x] 1.3 实现 `scripts/sync-memex-descriptions.mjs`：从锁定版本的内核包提取工具 name 与 description，生成 `src/tools/descriptions.generated.ts`（带生成标记）（2026-09-18 实测：从 0.4.1 提取 8 个工具，转义经 JSON.parse 正确解码，无残留 `\u` 字面量；生成物可 typecheck）
- [x] 1.4 为同步脚本实现 `--check` 模式：与上游不一致时非零退出（实测：与 0.4.1 一致时通过并打印版本；不一致时以非零状态退出并提示运行 `npm run sync:descriptions`）
- [x] 1.5 编写 `ATTRIBUTION.md`：逐项列明逐字派生（工具描述）、概念借鉴（生命周期设计，指向 `pi-extension/index.ts`）、以及未复用其实现代码的事实；附上游 MIT 许可全文副本

## 2. scope 解析

- [x] 2.1 定义解析结果（scope / 库路径 / 发布方向）与对外接口（`resolve(cwd)`、`list()`、`resolveByName(scope)`、`bindingFor(scope)`）
- [x] 2.2 注册 DSH settings namespace 与 schema（自动派生开关、scope 条目、绑定集合）；用校验钩子覆盖 schema 表达不了的约束（同名 scope、remote 模式可编译、绑定引用不存在的 scope）
- [x] 2.3 实现 settings 生命周期语义：分节缺失 → schema 默认；注册时不合法 → 注册失败且不发布工具；运行中非法编辑 → settings provider 保留 last-good 并告警（工具继续按 last-good，绝不退回默认）
- [x] 2.4 实现路径前缀匹配（路径段边界、`~` 展开、绝对路径归一化、最长条目优先；4 个单测通过）：按**路径段边界**判定，最长按段数优先；比较前展开 `~`、转绝对路径、去尾分隔符
- [x] 2.5 实现 remote 模式匹配与 scope 名确定性派生（scp/URL 路径取末两段、去 `.git`、归一化；4 个单测通过）：取 remote 路径末两段、去 `.git`、以 `-` 连接、归一化；**不得只取末段**
- [x] 2.6 实现库目录映射（统一 `~/.dsh-memex/<scope>` 命名空间，personal 同样在 namespace 下）：统一命名空间 `~/.dsh-memex/<scope>`（`personal` 为同空间下的 `personal`），命名空间根不在 `~/.dsh` 之内
- [x] 2.7 实现 fallback（无 origin / 非 git → personal；个人托管平台的仓库仍按 remote 各自派生 scope）：无 origin、非 git 目录归 `personal`
- [x] 2.8 实现已知 scope 集合（配置项 + namespace 下已有 cards/ 目录反推；实现完成，待集成测试）：配置声明 ∪ 已存在库目录反推，不引入额外持久化注册表
- [x] 2.9 实现归一化冲突检测：不同 remote 归一到同名 scope 时拒绝并要求显式配置消歧
- [x] 2.10 实现库目录创建（仅目录与 `cards/`，**不 `git init`、不配 remote**）与「已创建新记忆库 / 未配置同步」提示
- [x] 2.11 确认系统只创建命名空间与标准 `cards/` 目录；库内不生成私有配置、索引、审计、缓存或日志，不改写内核卡片格式
- [x] 2.12 实现绑定集合解析：按当前 scope 归属选取；无绑定时读退化为当前 scope、写退化为「当前 scope + personal」
- [x] 2.13 单测：路径段边界（前缀不误命中兄弟目录）、多工作副本经 remote 收敛、不同组织同名仓不共库、fallback、personal 库路径特例
- [x] 2.14 单测：启动时配置不合法则不发布工具、运行中非法更新保留 last-good、分节缺失降级、未知 scope 名被拒、绑定外 scope 不可达、删库后已知集合变化

## 3. 内核调用层

- [x] 3.1 封装唯一执行入口：`run(args, { scope })` → spawn 内核并注入该库的 `MEMEX_HOME`、超时、**失败不重试**、错误透传
- [x] 3.2 实现文本输出解析（依据 0.2 契约），**集中在单一模块**；解析失败按调用失败处理，不返回部分结果
- [x] 3.3 实现版本校验：非实测确认版本时在返回中告警
- [x] 3.4 实现参数传递安全：查询串与 slug 作为参数值传递，不被解释为命令行选项
- [x] 3.5 实现失败分类（内核缺失 / 非零退出 / 超时 / 解析失败）与对应错误返回
- [x] 3.6 单测：内核缺失报错含安装提示、超时不重试、以连字符开头的查询串不改变内核行为、解析失败不返回部分结果

## 4. 工具面与跨库协调

- [x] 4.1 注册工具，**沿用内核的工具名与描述原文**，仅追加 `scope` 参数说明
- [x] 4.2 `scope` 参数只加在语义允许跨库的工具上（检索 / 读取 / 写入）；召回与图级工具不带该参数
- [x] 4.3 实现 `scope: "all"` 解析为**绑定内可读的全部**；显式 scope 列表
- [x] 4.4 实现**多库并发派发**（带上界）与确定性归并：延迟不随库数线性增长，结果与完成顺序解耦
- [x] 4.5 实现结果来源标注：来源取自本次调用的目标库（不从内核输出反推）
- [x] 4.6 实现单库失败降级：返回其余库结果并标明失败 scope
- [x] 4.7 实现跨库读取：按 scope 解析库位置后读取；找不到时明确报错（不静默返回空）
- [x] 4.8 实现跨库写入：`scope` 指定另写的目标，校验其在绑定可写范围内且不影响其余目标
- [x] 4.9 实现失败语义：当前库未写入 → 失败；当前库已写入而附加目标被拒 → **返回成功**并逐目标标明
- [x] 4.10 确认不注册任何同步配置类动作
- [x] 4.11 单测：默认不跨库、绑定内多库检索、不越出绑定、并发生效、完成顺序不影响结果、同名 slug 不串内容、人工创建的卡片来源正确
- [x] 4.12 单测：跨库命中可读回、读不到报错、附加目标被拒时整体成功、绑定外写入目标被拒、不传 scope 时行为与内核原生一致

## 5. DSH 接入

- [x] 5.1 订阅 `agent/session-start`，在首回合前注入召回引导（含 scope 与库信息、召回提示、写卡提示、护栏建议）
- [x] 5.2 确认注入走**与工具执行相同**的 scope 解析，不引入第二套逻辑
- [x] 5.3 实现注入体积上界：只注入摘要与计数，不注入全部卡片正文
- [x] 5.4 实现注入的只读性与容错：不创建/修改卡片；失败只告警，不阻断会话启动
- [x] 5.5 订阅 `agent/turn-stopping`，在「已召回且未写卡」时以不打断回复的方式注入写卡提醒
- [x] 5.6 实现会话内状态跟踪（已召回 / 已写卡），并在**压缩发生后重置已召回状态**；确认压缩不重置已写卡状态
- [x] 5.7 通过 `customSkillDirs` 接入内核的 `skills/` 目录；实现接入失败的明确报错（不静默跳过）
- [x] 5.8 单测：会话开始即含引导、注入与工具解析一致、注入不写卡片、注入失败不阻断
- [x] 5.9 单测：已召回才提醒写卡、已写卡不重复提醒、未召回不提醒、压缩后引导重现且不重复提醒写卡

## 6. 守门

- [x] 6.1 实现按**目标库发布方向**触发：任何以外部发布库为目标的写入落盘前生效；未声明按外部处理
- [x] 6.2 实现 `denyTerms` 派生：全部已知**内部** scope 名（含自动派生），排除外部发布库名，长度 <4 的不单独成词条
- [x] 6.3 实现匹配规则：大小写不敏感；ASCII 按词边界，含 CJK 按子串；扫描 slug、title、body 全文
- [x] 6.4 实现内置结构性规则（内网域名与 IP 段、公司 remote 形态、内部 scope 工作区绝对路径）；工作区路径**由实际工作区派生**，不硬编码前缀；路径来源为空时显式告警该规则未生效
- [x] 6.5 实现 fail closed：规则加载失败、工作区路径集或发布方向不可确定 → 拒绝该目标；**scope 解析失败 → 整体拒绝，不写任何卡片**
- [x] 6.6 实现拒绝返回：保留其余已写入卡片、给出被拒目标与命中规则
- [x] 6.7 实现拒绝记录：经运行日志输出，只含 scope 与规则标识符；不含 title/body/slug 全文/命中片段，且不写入任何库目录
- [x] 6.8 确认不重复实现上游凭据规则
- [x] 6.9 单测：外部库写入被拒、内部库写入放行、发布方向未声明时保守受管、派生词命中、结构规则命中、外部库名不进 denyTerms、过短词不成词条
- [x] 6.10 单测：规则损坏时拒外部保其余、scope 解析失败整体拒绝、多目标中被拒目标不影响其余、拒绝记录不含正文且不落库目录

## 7. 文档与部署

- [x] 7.1 README：守门能力边界（拦可模式化标识与结构，不拦语义层业务信息；定位是「减少误写」而非「保证不泄漏」）、跨库内容必须去业务化重写、对外部库的定期复核；并声明守门不覆盖内部库互写
- [x] 7.2 README：本方案等于「Pi extension 的等价物 + scope」，以及「不改 memex」这条约束的含义
- [x] 7.3 `docs/notes/`：MCP 子进程拿不到会话 cwd 故必须进程内注册；CLI 无结构化输出故需解析适配层与版本绑定；上游 push/pull 整库粒度故「库数 = 推送目标数」；DSH 有会话级生命周期事件（`agent/session-start` / `agent/turn-stopping`），不要重复「无可用钩子」的误判
- [x] 7.4 `dsh.yaml` 新增一条 bundle 条目（含 enable 开关、来源、版本、审查记录）
- [ ] 7.5 `dsh build` 物化到 `~/.dsh/profiles/web` 并重启
  - 备用端口验收已完成（3080 全程未碰）：`DSH_MEMEX_ENABLED=1` 物化 → 3091 启动完整组合，启动清单含 `dsh-memex`、HTTP 401、运行日志 **0** 条 memex 报错 → 验收后立即用不带开关的 sync 恢复禁用并停掉 3091
  - 同一主干产物用**真实 `~/.dsh/settings.yaml`** 跑端到端：真实 scope 表解析为 5 条、本仓路由到 `ohmydsh`/external/独立库、写入成功并给出 created+notice、检索命中、frontmatter 仅内核字段（title/created/source/modified）、正文含内部 scope 名时在外部目标被拒且未落盘、拒绝日志只含规则 id
  - 该验收抓出一个真实可用性缺陷（已修）：`list()` 覆盖已解析条目导致内部 scope 丢失工作区路径证据，守门把**当前仓自己的库写入**也拒掉；现按本 change 的 guard spec 改为「规则缺输入 → 告警未生效、其余规则照常」，仅「发布方向未知 / 规则集加载失败」才拒绝
  - 待办：主实例 3080 的实际启用仍未执行；重启必须脱离调用方进程（上次 `dsh restart` 调用被中断，`dsh-startup.log` 无对应记录且日志无 memex 报错，属中断而非插件故障）
- [x] 7.6 在 settings 中写入初始 scope 表与绑定集合（待主实例启用时写入；已用临时 namespace + 实际 main/worktree remote 验证显式映射均收敛到 `ohmydsh`）
- [ ] 7.7 按需配置各库同步（需要用户提供各 scope 的真实 remote；实现与验收均不创建 git 仓、不猜 remote，当前未配置即无同步）
- [x] 7.8 在 `AGENTS.md` 补充写卡判据（写什么才算值得留档）——触发时机由生命周期事件承担
- [x] 7.9 幂等校验：完整主 profile 暂不运行；隔离全 profile sync 被既有 `dsh-setting-restart` peer 安装失败阻断（非 dsh-memex）。最小真实 Cordis 组合 smoke 已通过 8 tools / 6 skills
- [x] 7.10 升级内核版本时运行描述同步脚本并 review 差异；确认 `--check` 在描述一致时通过

## 8. 验收

- [x] 8.1 在业务仓会话调用检索（默认），确认只返回该 库且不含其他库卡片
- [x] 8.2 在 `~/mydir/opensource/ohmydsh` 会话确认解析为专属 scope `ohmydsh`、库为 `~/.dsh-memex/ohmydsh`（**不并入 personal**）
- [x] 8.3 在某业务仓的外部 worktree / clone 副本内调用，确认经 remote 落到同一 scope
- [x] 8.4 **多库检索**：以 `scope: "all"` 检索，确认结果含绑定内多个库的卡片且来源标注正确
- [x] 8.5 **不越出绑定**：确认结果不含绑定外 scope 的卡片
- [x] 8.6 **并发生效**：对比多库与单库检索耗时，确认未随库数线性增长；重复执行确认结果顺序稳定
- [x] 8.7 **跨库读回**：对上一步中来自其他 scope 的命中调用读取，确认读到完整正文
- [x] 8.8 **同名 slug 专项**：两个库各放一张同名 slug 卡片，多库检索确认来源与正文分别正确、无串库
- [x] 8.9 **人工卡片**：用 CLI 直接写一张不含任何私有约定的卡片，确认可被检索命中且来源正确
- [x] 8.10 **跨库写入**：写入时指定另一个库为目标，确认两库各新增一条
- [x] 8.11 **绑定外目标被拒**：指定绑定外的 scope 作为写入目标，确认被拒且当前库写入照常完成
- [x] 8.12 构造含业务标识的外部库目标写入，确认被拒、返回命中规则、其余卡片仍在、整体返回成功
- [x] 8.13 **守门触发面**：在外部发布库会话中先多库检索业务内容，再写含业务标识的卡片，确认被拒
- [x] 8.14 **内部库互写不受守门**：向另一个内部库写入含业务标识的卡片，确认不被拒绝
- [x] 8.15 **存储互不依赖**：整体删除（或改名）某个 scope 库，确认其余会话检索照常可用、仅告警
- [x] 8.16 确认各库目录内不存在本系统生成的文件
- [x] 8.17 构造不合法的 settings 分节（含绑定引用不存在的 scope），确认所有工具被拒并指明失败项
- [x] 8.18 **卡片无私有扩展**：检查写入的卡片 frontmatter，确认只有内核既有字段
- [x] 8.19 确认 `memex serve` 能浏览各库、Obsidian 能打开 `cards/` 并识别 `[[链接]]`
- [x] 8.20 **会话开始即发现记忆**：新开会话后不发任何工具调用，确认首回合上下文已含该 scope 的引导
- [x] 8.21 **写卡提醒条件**：确认未召回时不提醒、已召回未写卡时提醒、已写卡后不再提醒
- [ ] 8.22 **压缩后引导重现**：真实 Agent + synthetic compact-source dispatch 已验证重注入/状态语义；当前 runtime 无完整 compact transaction 触发 API，保留待真实端到端验证
- [x] 8.23 **方法论可加载**：确认内核随包发布的方法论出现在可用 skill 清单中
- [x] 8.24 **钩子不阻断**：构造注入失败，确认会话启动与回合关闭均不受影响，仅告警

## 9. 归档准备

- [ ] 9.1 已运行 package typecheck/build/tests、root `npm test`（124 pass / 1 skip）、`check:artifacts`、description check、strict validate；`node scripts/sync.mjs` 因主实例保持禁用而暂不作为最终完成项，隔离全 profile sync 被既有 remote package peer 问题阻断
- [x] 9.2 确认四份 delta spec 已反映最终实现行为
- [x] 9.3 回填 BACKLOG（含 B007 `/btw` 未覆盖项——「只记录、不立即处理」的纯记忆形态）
- [x] 9.4 评估是否向上游提 `dirPrefix` 串库缺陷的 issue/PR，记录结论
