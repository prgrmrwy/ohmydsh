## Context

- 召回遥测现状：`packages/dsh-memex/src/telemetry/` 每次关键词检索追加一行 NDJSON 到 `$DSH_HOME/plugins/dsh-memex/recall-YYYY-MM.ndjson`；命中只有 `slug`、`scope`、近似的 `anchored`。写卡没有任何遥测。
- 工具执行上下文（DSH 0.2.0-rc.2 `ToolRunContext`）提供 `callId`、`agent`（含 `session.id`、`session.header`、`session.requestHeader()`）。`requestHeader().config` 带当前请求的 provider/model。
- 内核搜索输出（`formatSearchResult`）只有标题、第一段、匹配行与 Links，不含分项得分；`--compact` 只给归一化总分。字段权重为 `slug:5, title:5, tags:4, category:3, headings:3, wikilinks:2, body:1`（`@touchskyer/memex@0.4.1` 的 `src/lib/scoring.ts`）。
- 卡片在库目录 `cards/<slug>.md`；各库目前都是 git 仓库，由内核 sync 每日提交。
- 现行规范约束：遥测旁路、不写库、无外发、关闭记忆不记录（`dsh-memex-memory`）；工具描述沿用上游原文（同上）；注入只读、有界（`dsh-memex-integration`）。

## Goals / Non-Goals

**Goals:**
- 每次召回与写卡都留下可与会话记录对齐、可还原库与卡片版本的判据。
- 召回意图由当时的 Agent 在看到结果前声明。
- 写卡引导要求第一段可独立使用。
- 返回给模型的检索结果逐字节不变。

**Non-Goals:**
- 不改检索排序、不过滤或沉底任何卡（`dsh-memex-demote-in-context-self-cards` 另行处理）。
- 不在召回结果中展示“为什么命中”（讨论稿列为 P0 之后的候选）。
- 不实现去卡重放、不实现评估脚本（评估脚本在仓库外）。
- 不回写已有卡片，不改上游 skill 与工具描述。

## Decisions

### 1. 命中解释在集成层近似复算，而不是解析内核输出或改内核

需要的是每条命中“第几个查询词在哪个字段”，内核不输出。可选：(a) patch 内核让它输出分项——违反“不 patch 上游”；(b) 用 `--compact` 的总分——没有字段信息；(c) 集成层读卡片文件，按内核字段与权重复算。选 (c)，在现有 `anchored()` 的基础上扩展为逐词、逐字段的匹配表。

字段抽取规则：`slug` 来自文件名，`title`/`tags`/`category` 来自 frontmatter，`headings` 为正文 `#` 行，`wikilinks` 为 `[[...]]`，其余为 `body`。每个查询词取命中的最高权重字段，与内核“best field”一致。汉字词按子串、ASCII 词按分段比较，沿用 `anchored()` 的约定。停用词、低信号惩罚、代码 token 加成不复刻——这是记录用的近似值，结论注明为近似，不影响返回结果。

查询词只以序号出现（`t: 0`）。序号对应的是发给内核、经过分段后的 token 顺序，查询原文不落盘。

### 2. 每条命中读一次卡片文件，计算内容 hash、`modified` 与命中解释

读取 `<库 home>/cards/<slug>.md`（与内核同一路径约定）。一次读取同时产出：内容 sha256（截前 16 个十六进制字符，足够区分版本且缩短记录）、frontmatter 的 `modified`、命中解释。文件不存在或读失败时，该命中只缺这三项，不报错。

成本：每次召回最多读 `limit`（默认 10、上限 50）个小文件，在检索返回之后同步完成。若实测单次额外耗时超过 20ms，改为在返回后用 `queueMicrotask` 记录；无论哪种都不改变返回内容。

### 3. 库快照用 `git rev-parse HEAD` 与 `git status --porcelain`，只读、带超时

对每个被查库执行两条只读 git 命令（`--no-optional-locks`，避免触碰 index 锁），超时 1 秒，失败记为 `unknown`。同一库在一次召回中只取一次；不做跨召回缓存，因为写卡与 sync 会随时改变 HEAD。

备选：读 `.git/HEAD` 文件自行解析——无法判断未提交改动，且 packed refs 需要额外处理；不采用。

### 4. 会话与调用关联：会话 id 做单向 hash，调用 id 原样

`exec.agent.session.id` 经 sha256 截 16 位后记录；`exec.callId` 原样记录（它本身就出现在会话记录里，不带额外信息）。分析时对会话记录里的会话 id 做同样的 hash 来对齐。不记录 turn：调用 id 已能在会话记录中精确定位到 turn 与 step。

### 5. 写卡事件单独成文件

写卡事件写到同目录 `writes-YYYY-MM.ndjson`，而不是混入 `recall-*.ndjson`：召回报告命令现在逐行读召回文件，混入异构记录会让旧版本报告把它们当成畸形召回。写卡事件复用同一 sink 的目录、权限、失败只告警一次的逻辑。

新建/覆盖的判断：写入前检查目标库 `cards/<slug>.md` 是否存在。写入后读一次文件取内容 hash。模型标识取 `session.requestHeader()?.config` 的 `provider/model`，取不到则省略。

附加库写入成功的，每个库各记一条，`scope` 为该库。

### 6. `intent` 是参数级说明，取值严格枚举，未知值记为 `unknown`

参数 schema 用 `enum`，但宿主是否强制校验不确定；实现上再做一次规范化：在枚举内原样记录，否则记 `unknown`，从不报错。参数说明写明“在看到结果前选择”。不进入发给内核的参数。

### 7. 注入文本：保留现有句子，新增两行

`RECALL_TEXT` 在“After the task, save only …”之后追加：

- 第一段写法：检索结果只显示标题与第一段，因此第一段写清触发情境 → 结论或做法 → 适用边界 → 使用前最低核验，背景放后面。
- 召回意图：调用 `memex_recall`/`memex_search` 时传 `intent`。

保持英文，与现有注入一致。`instructions/dsh-home.md` 的写卡句子补同样的第一段要求（中文），两处语义一致。不新增 frontmatter 字段，不要求固定标题格式，以免与上游 best-practices 冲突。

### 8. 版本 0.4.0

新增工具参数与遥测文件格式属于对外可见的新能力，按 minor 升级。与尚未部署的写卡提醒延后修复一起发布，CHANGELOG 的 Unreleased 合并为 0.4.0。

## Risks / Trade-offs

- [命中解释与内核真实打分有偏差] → 记录中标注为近似；只用于趋势与归因分析，不用于决定返回结果。若需要精确值，再向上游提议输出分项得分。
- [每次召回多读文件、多跑两条 git 命令，增加延迟] → 文件小、git 只读带超时；超过 20ms 改为返回后记录。测试中断言返回内容不变。
- [意图参数改变 Agent 的召回频率或成本] → 上线后比较前后各两周的召回频率与每次召回后的步数、token；变化超过 30% 回到讨论。
- [Agent 不填意图或乱填] → 缺失记为未提供，分析时单独成组；不把缺失当作任何一类。
- [第一段写法要求让新卡变长或格式僵化] → 只约束第一段的内容顺序，不规定字数与标题；1 周后用写入端指标检查。
- [模型标识可能取不到或不准]（例如 fork 会话改用默认模型） → 取不到时省略；分析时以会话记录中的 `request/header` 为准，遥测中的值只作冗余。
- [遥测文件增长] → 每条召回记录从约 1 KB 增至约 2–3 KB；按月分文件，当前量级每月不足 1 MB。

## Migration Plan

1. 实现与测试在本仓库完成，`npm test`、包内 typecheck/build/`check:descriptions` 通过。
2. 版本 0.3.0 → 0.4.0，`dsh.yaml` 同步，`node scripts/sync.mjs` 两次确认幂等。
3. 用户确认 DSH 空闲后重启，并以脱离调用方进程的方式启动。部署同时生效写卡提醒延后修复。
4. 上线即记录观察窗起点；GUI 实测：召回后检查遥测新字段与写卡事件。
5. 回滚：`dsh.yaml` 回退到 0.3.0 → sync → 重启。新增的遥测文件与字段留在状态目录，旧版本报告忽略未知字段，不需要清理。

## Open Questions

- DSH 宿主是否对工具参数的 `enum` 做强制校验：不影响设计，实现中以规范化兜底。
