# DSH 分域持久记忆层（memex 内核）

## Why

DSH 没有跨会话记忆：事件日志只服务于单会话重放与压缩，官方在 cookbook 与
Discussion #2783 中明确把会话级记忆留给生态。结果是每个新会话从零开始，同一个坑
在不同项目里反复踩。

社区已有的 10+ 个 DSH 记忆插件解决了「记住」，但没有一个解决**「记在哪」**：它们
普遍是「LLM 自动抽取 + 全库注入」，不做按知识域的物理隔离。而本项目同时在互不
相交的业务域里工作——公司 `code.byted.org` 的 nexus / flow-web，个人
`github.com` 的开源项目。业务知识的概念空间本身就是项目私有的：混在一个库里产生
的不是联想而是噪音；更严重的是公司知识一旦进入推往 GitHub 的个人库，**泄漏不可
逆**（`memex sync` 自动 commit + push，git 历史无法收回）。

选定的内核 [memex](https://github.com/iamtouchskyer/memex)（141★，MIT，npm 38 版，
活跃）提供本方案认可的方法论：Zettelkasten 原子卡片 + `[[双向链接]]`，**无向量库、
无 embedding**，纯 markdown 可脱离工具读取。但其主接口是 MCP server，而
`dsh-mcp-client` spawn 的常驻 stdio 子进程 cwd 等于 DSH 主进程 cwd——
上游 `resolveMemexHome()` 在进程启动时解析一次即固定（`MEMEX_HOME` > 向上查找
`.memexrc` > `~/.memex`），**拿不到当前会话的 `agent.session.header.cwd`**，因此
无法按 workspace 路由到不同的库。这一条是本方案必须自建薄层、而不能直接挂 MCP 的
唯一原因；memex 的存储与链接机制本身复用，不重写。

## What Changes

- 新增本地包 `packages/dsh-memex-scope`：实现 `ctx.memexScope` 服务（Service
  Definition + Provider 分层），把「会话 cwd → scope → `MEMEX_HOME`」解析做成可
  独立替换的能力。
- 新增本地包 `packages/dsh-memex`：Consumer，在 DSH 进程内注册 4 个工具
  （`memory_recall` / `memory_read` / `memory_search` / `memory_retro`），以 memex
  CLI 为存储内核（注入 `MEMEX_HOME`）。
- **多库物理隔离**：每个 scope 独立 `MEMEX_HOME` 与独立 git remote。**读侧单库**——
  工具执行时只连当前 scope 的库，模型既不能指定库也搜不到别库。
- **唯一跨库写入点**：`memory_retro` 的 `alsoPersonal`。业务 scope 下可额外向
  `personal` 库写入一条**必须独立重写**的去业务化卡片（不接受「复制一份」）。跨库
  关系因此是星形（business → personal），business 之间永不互写。
- 新增 `CrossWriteGuard`：仅在写 `personal` 前生效。`denyTerms` 由 scope 名自动派生
  （有 `nexus` scope 就有 `nexus` 词条）加结构性规则（内网域名、公司 remote 形态、
  `~/corp/` 绝对路径），并继承 memex 原生凭据防护。命中即拒绝该条，**主卡照常保存**；
  审计日志只记元数据不记正文。
- 新增配置文件 `~/.dsh/memex-scopes.yaml`（**不放入 `dsh.yaml`**——scope 映射是个人
  知识资产的组织方式与高频变动项，不是部署声明）。解析优先级：DSH settings >
  配置文件 > 内置默认。文件**缺失视为默认**（personal + `autoDerive`），文件**损坏
  则 fail closed**。
- `memory_retro` 写入前自动按 slug 精确 + title 关键词查重，命中**警告但不拦截**。
- **不使用 `dsh-mcp-client`**：工具在 DSH 进程内注册是取得会话 cwd 的前提。

明确不做（YAGNI）：

- 不引入 embedding / 向量检索 / RAG（默认关键词路径零外发）。
- 不自动 `git init`、不自动配置 sync remote——同步是合规决策，必须人显式做。
- 不自动跟链展开：A-MEM 的核心约定是链接必须由 agent 读过候选卡后主动决定，
  相似度只能作候选信号。
- 不做后台自动 retro：DSH 无合适钩子，且违反「记忆是写出来的」这一方法论前提。
- 不做 GUI 面板（V1 用 `memex serve` + CLI）。
- 不提供跨 scope 读。

## Capabilities

### New Capabilities

- `dsh-memex-scope`：会话 cwd → scope 解析（路径前缀匹配 > git remote 匹配 > 自动
  派生 > fallback），三层配置优先级，以及「缺失降级 / 损坏 fail closed」的区分。
- `dsh-memex-memory`：四个记忆工具的语义——读侧单库、写侧本库加可选跨库、写入前
  查重、以及不注册运维类工具（organize / archive / sync 归人）。
- `dsh-memex-guard`：跨库写入守门——规则来源与派生、拒绝语义、不回滚主卡、审计
  不留正文，以及「减少误写而非保证不泄漏」的既有边界声明。

### Modified Capabilities

无。`openspec/specs/` 下不存在记忆相关能力，本 change 不修改既有 spec。

## Impact

- **新增包**：`packages/dsh-memex-scope`、`packages/dsh-memex`（TypeScript local
  package，`lib/` 等构建产物不入版本控制）。
- **manifest**：`dsh.yaml` 新增两条 bundle 条目，含 enable 开关、来源、版本与审查记录。
- **运行依赖**：`memex` CLI 需在 PATH（`npm i -g @touchskyer/memex`，各设备各自安装）。
- **新增配置文件**：`~/.dsh/memex-scopes.yaml`——不受 sync 管理、不被 `dsh build`
  物化，换机需自行迁移（代价已接受）。
- **新增本地目录**：各 scope 的 `~/.memex*` 库。
- **不修改 DSH core**，不引入 patch，不挂 `dsh-mcp-client`。
- **合规面**：业务库推公司内部 GitLab，`personal` 库推 GitHub。泄漏方向单向
  （业务 → 个人），守门只拦该方向。
- **安全面**：守门 fail closed；拒绝时不回滚主卡（业务库写入本身安全，回滚反而
  丢失有效记忆）。
