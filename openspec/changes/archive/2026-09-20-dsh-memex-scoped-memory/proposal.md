# DSH 分域持久记忆层

## Why

DSH 没有跨会话记忆。会话事件日志只服务于单会话的重放与压缩，不是跨会话知识。

上游 [memex](https://github.com/iamtouchskyer/memex) 提供完整的 Zettelkasten 能力：
原子卡片、`[[双向链接]]`、关键词索引、以及面向 agent 的完整方法论（`skills/` 下的
recall / retro / organize / best-practices / agentic-memory / sync）。它已经为多个宿主
提供了原生接入——Claude Code（hooks + skills）、**Pi（extension）、VS Code、Cursor、
Codex、Windsurf、任何 MCP 客户端**。

**但它缺一个维度：scope。** memex 的整个设计前提是「只有一个库」——`MEMEX_HOME` 单一、
同步粒度是整库、`read` 没有跨库选项、索引卡是单库策划物。而本项目的知识分属互不相交的
知识域：公司仓（`code.byted.org` 的多个团队仓）与个人仓（`github.com`），它们的同步目标
不同、访问权限不同，**混在一个库里既产生噪音，也让同步目标无法分离**。

因此要补的不是存储，而是「这次用哪个库」这一维。

## What Changes

本质上是**做一层 Pi extension 的等价物，再加 scope 策略**。

- **新增本地包 `packages/dsh-memex`**：在 DSH 进程内注册 memex 的工具、订阅 DSH 的会话
  生命周期事件，并以子进程方式调用 memex CLI（每次注入一个库的 `MEMEX_HOME`）。
- **工具面与 Pi extension 对齐**：`memex_recall` / `memex_retro` / `memex_search` /
  `memex_read` / `memex_write` / `memex_links` / `memex_archive` / `memex_organize`，
  **沿用上游工具名与描述原文**。
- **scope 作为唯一的新维度**：会话 cwd 解析出 scope，scope 决定该次调用注入哪个库。
  多库操作用可选参数 `scope` 表达（默认当前库）。
- **跨库检索并发 fan-out**：`scope: "all"` 时对绑定范围内每个库并发调用一次 CLI 再归并，
  来源由调用方直接确定。
- **写入外部发布库前守门**：库可选引入的第一个风险是「写错库」，本方案补上这一层。
- **复用 memex 的方法论，不改写**：通过 DSH 的自定义 skill 根目录直接引用 memex 包内的
  `skills/`，卡片怎么写、如何链接、何时精炼，全部以 memex 的 skill 为准。
- **不使用 `dsh-mcp-client`**：MCP server 子进程的 cwd 是 DSH 主进程的 cwd，而上游
  `resolveMemexHome()` 在启动时解析一次即固定，拿不到当前会话的 cwd。

## 对 memex 的改动：无

本方案**不修改 memex 本体、不修改它的 skill、不扩展它的卡片格式**。所有新增能力都落在
我们自己的工具层与进程调用参数上。这是设计约束，也是检验标准：

| 动作 | 判定 |
|---|---|
| 改 memex 源码、fork 其行为 | ❌ 不做 |
| 给卡片加自定义 frontmatter 字段 | ❌ 不做（`retro` 的描述已声明自动处理 frontmatter / source / 同步） |
| 改写或复制它的 skill 内容 | ❌ 不做（直接引用其 `skills/` 目录） |
| 自己注册工具并以子进程调用它的 CLI | ✅ 这是我们的层 |
| 决定每次调用注入哪个 `MEMEX_HOME` | ✅ 上游原生支持的环境变量 |
| 在写入外部发布库前增加检查 | ✅ 我们的层，不写 memex |

## 与上游的关系

本方案与上游 memex 的关系分三类，判据是「能否在不兼容的运行体上复用其实现」：

| 内容 | 处理 |
|---|---|
| 内核随包发布的 `skills/`（方法论） | **直接引用**，零复制（通过 DSH 的自定义 skill 根目录） |
| Pi extension 的**实现代码** | **不复用**——其实现依赖 Pi 的 `ExtensionAPI`，与本运行体不兼容 |
| Pi extension 的**架构模式**（注册工具 + 订阅生命周期 + 暴露 skill） | 借鉴，注明出处 |
| 工具 name 与 description 文本 | **vendored**——由同步脚本从锁定版本提取，带生成标记 |

包内含出处说明与上游 MIT 许可全文副本，逐项列明上述边界。

## Capabilities

### New Capabilities

- `dsh-memex-scope`：会话 cwd → scope 解析、库位置映射、绑定集合对读写可达范围的界定、
  配置经 DSH settings 承载。
- `dsh-memex-integration`：把 memex 的能力接入 DSH——工具注册（含 `scope` 参数）、会话
  生命周期事件（召回注入、写卡提醒、压缩后重置）、方法论 skill 的引用。
- `dsh-memex-memory`：跨库协调语义——多库并发检索与结果归并、来源标注、跨库写入目标选择、
  以及 `memory` 面的失败语义。
- `dsh-memex-guard`：写入外部发布库前的守门——按目标库发布方向触发、规则来源、fail closed、
  拒绝记录不落库目录，以及「减少误写而非保证不泄漏」的边界声明。

### Modified Capabilities

无。`openspec/specs/` 下不存在记忆相关能力。

## Impact

- **新增包**：`packages/dsh-memex`（TypeScript local package，构建产物不入版本控制）。
- **manifest**：`dsh.yaml` 新增一条 bundle 条目。
- **配置**：一个 DSH settings namespace（scope 表与绑定集合）；一个指向 memex `skills/`
  的自定义 skill 根目录。
- **运行依赖**：`memex` CLI 在 PATH（`npm i -g @touchskyer/memex`）。
- **新增本地目录**：各 scope 的库，统一位于 `~/.dsh-memex/<scope>`（含 `personal`）。
  系统不在库目录内生成任何文件。
- **不修改 DSH core**，不引入 patch，不挂 `dsh-mcp-client`。
- **合规面**：库的同步目标由人显式配置，互不共用。写入发布方向为外部的库前经守门；
  读取不产生卡片、不进入任何库的同步范围。
- **上游耦合**：基线 `0.4.1` 的 `search` / `read` / `write` 无结构化输出，需解析文本输出。
  解析集中在单一模块并绑定版本；升级 memex 时须重跑输出解析用例。
