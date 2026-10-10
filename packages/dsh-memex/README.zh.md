# dsh-memex

[English](README.md) · 简体中文

<!-- problem -->
AI agent 一旦会话结束就什么都忘了；而把所有项目的笔记混在同一个本子里，很快就会变成噪音，还可能把一个项目的细节泄漏到另一个项目。dsh-memex 给 DSH 的 agent 配上一份按项目隔离的持久 Zettelkasten 记忆：每个工作区读写自己的卡片库，写入要对外发布的库之前还会先过一道检查。

![DSH 设置 →「记忆」：工作区、各自的记忆入口与库的事实信息](docs/overview.png)

**你能得到什么**

- **跨会话留存的记忆。** 会话开始时提示 agent 先召回，结束前提醒它把学到的东西存下来；用的是 [memex](https://github.com/iamtouchskyer/memex) 卡片，它们始终是普通文件，可以用 git 同步，也可以用 Obsidian 打开。
- **每个项目一个库，无需配置。** 会话的工作目录决定它使用哪个库，所以新工作区开箱即用，互不相关的项目也不会共用同一个库。
- **需要时可以跨库检索。** agent 可以同时检索多个库，或另写一份到别的库，但只能在你配置好的可达范围内。
- **对外发布的内容有守门。** 写入对外发布的库之前，会扫描其中是否含有内部 scope 名、域名、remote 与工作区路径。
- **「记忆」设置页。** 不用手改文件，就能查看并编辑每个工作区用哪些库、按工作区关闭记忆、配置远端，并在浏览器里打开卡片。

**安装。** 在 ohmydsh 里，本 package 由 `dsh.yaml` 管理（条目 `dsh-memex`，`source: local`）：设为 `enabled: true` 后运行 `dsh build`。设置 `DSH_MEMEX_ENABLED=0` 会在下次 build 时把它整体移除。它需要 memex 存储内核作为全局 npm 安装，`dsh` 会替你自动补齐，见[安装与前置条件](#安装与前置条件)。本 README 没有记录独立安装方式。周边仓库见[插件索引](../../README.zh.md#插件索引)。

**快速跳转：**[工作方式](#工作方式) · [配置](#配置) · [守门边界](#守门边界) · [安装与前置条件](#安装与前置条件) · [开发](#开发)

## 工作方式
<!-- section: how-it-works -->

本 package 在结构上相当于 [`@touchskyer/memex`](https://github.com/iamtouchskyer/memex) 自带的 Pi 扩展在 DSH 里的对应物：它在进程内注册 memex 的工具集，订阅宿主的会话生命周期，并发布 memex 自带的方法论 skill。此外，它会把每个 DSH Session 解析到一个相互隔离的 memex 库，并协调多库的读写。为什么选择进程内接入而不是直接用 memex 的 MCP server，见 [integration-notes](docs/integration-notes.md)（英文）。

### 谁负责什么

- **memex 负责：**卡片格式、Zettelkasten 方法论、slug、wikilink、recall/retro/organize 工作流、sync 与 serve。
- **DSH 负责：**Session、工具、生命周期事件、设置与 skill 发现。
- **本 package 负责：**cwd → scope → `MEMEX_HOME`、并发的跨库检索、结果来源标注、绑定范围限制，以及对外发布的写入守门。

不修改任何 memex 源码、skill 或卡片格式。见 [`ATTRIBUTION.md`](ATTRIBUTION.md)。

### 存储布局

所有库都位于同一个命名空间下，彼此从不互相引用。scope 按 Session 的 cwd 依次解析：配置的工作区路径（最长匹配，按路径段边界）、配置的仓库 remote 模式，然后是派生——有仓库的取仓库 `origin`（取 remote 路径的末两段，所以不同组织下的同名仓库不会共用一个库），不属于任何仓库的目录则取目录自身的路径：

```text
~/.dsh-memex/
  personal/               # declared: shared by the workspaces the config lists
  acme/                   # declared
  documents-learning/     # derived locally: a directory outside every repository
  example-org-project/    # derived from a remote that no entry claims
```

每个子目录都是一个标准的 memex home（`cards/`，可选的 git 仓库与 remote）。库可以被单独复制、同步或删除。本 package 每次调用内核时只注入一个 `MEMEX_HOME`，也不会在库内写入任何私有配置、索引或日志。

值得知道的几点：

- **不属于任何仓库的目录不会落进共享库。**它会得到自己专属的库，名字取其路径末两段，并且该库只留在本地：在人为配置远端之前，不会向任何地方推送。
- **`personal` 是兜底入口：**默认读写两个方向都可达，所以新工作区不用任何配置就能使用。入口声明 `fallback: false` 的工作区，读和写都够不到它；而显式列出它的绑定仍然可以（显式声明优先于默认值）。
- 一个工作区可以有多个入口：恰好一个是**主入口**（承载路由：召回、图级操作、默认读写）；附加入口可达，但除非调用显式指名，否则不会被碰。两个入口不能共用同一个库目录。
- 库只在第一次写入时才会真正创建，所以从不碰记忆的仓库永远不会产生库。

### 工具行为

本 package 注册 memex 的 Pi 扩展暴露的八个工具：

- `memex_recall`、`memex_retro`、`memex_search`、`memex_read`
- `memex_write`、`memex_links`、`memex_archive`、`memex_organize`

名称和描述原样取自固定版本的 memex。scope 默认隐含为 `current`，只有接受可选 `scope` 参数的操作才能指定：只有检索、读取和写入带它，因为召回以及图级工具（links、archive、organize）描述的是单个库的事实。多库检索并发展开，每个库一次普通的 memex CLI 调用，每条命中都带有它所属的 scope，以便被读回。写入也可以另指一个库接收副本，范围限于该会话绑定的可写范围。关键词检索会在查询到达内核之前，对其中连续的汉字做分段；不涉及向量检索。

### 召回引导与写卡提醒

会话开始时，插件会在第一个回合之前注入一段有界的召回引导（解析出的 scope 与库、如何召回、何时写卡）；它是只读的，失败也只记一条告警。

当一个会话召回过内容但还没写过卡片时，插件会提醒模型把学到的东西存下来。这条提醒随**下一个**回合送达，绝不在刚结束的那个回合里，所以每个回合总是以对其请求的回答收尾。如果对话在那个回合之后就停了，就不会送达提醒，也不会自动写卡。

### 召回遥测

每次关键词检索都会在 `$DSH_HOME/plugins/dsh-memex/` 下追加一条记录（绝不写进任何库，也不会发往任何地方）。记录只保留判据——时间、scope、命中条数、返回的 slug、每条命中是否来自 `slug`/`title`/`tags`——不保留查询原文或卡片正文。只读命令 `dsh-memex-recall-report` 会把它整理成报告：空结果、仅正文命中，以及从未被召回的卡片：

```bash
dsh-memex-recall-report --days 14 --scope personal
```

## 配置
<!-- section: configuration -->

配置是插件自己的 config，其中 scope 表相关字段可以在线编辑，无需重新挂载插件。各个键如下，定义见 `src/scope/settings.ts`：

```yaml
autoDerive: true            # derive libraries for unclaimed workspaces (default)
scopes:                     # the "memory entries"
  - name: acme              # kebab-case library name
    home: ~/path/to/library # optional; default is ~/.dsh-memex/<name>
    pathPrefixes: [~/work/acme]   # workspaces this entry claims
    remotePatterns: []      # repository remotes this entry claims
    publish: external       # internal | external (default external)
    primary: true           # needed when several entries claim the same path: exactly one
    fallback: false         # false closes the personal fallback (older entry-level form)
bindings:                   # the extra reach a scope may select; limits, never grants
  - name: acme-set
    read: [acme, personal]
    write: [acme, personal]
workspaces:                 # per-path declarations; they can only close things
  - path: ~/work/acme
    memory: false           # memory off for everything under this path
    fallback: false         # personal fallback closed for this path
```

缺少该分节时使用 schema 默认值：只有 `personal`，自动派生开启。注册时设置无效，插件将不发布工具；运行中的无效在线编辑会被拒绝，插件继续使用上一份有效值，所以一份无效草稿永远不会改变记忆的路由。绑定集合限定了 agent 额外可选的范围：它是限制而非授权，工作区自己的入口始终可达。解析顺序是路径前缀、remote 模式、自动派生，最后是本地路径派生的兜底。入口级旧的 `memory` 和 `fallback` 字段仍会被读取；声明或入口任一方关闭，即视为关闭。

### 「记忆」设置页

Web 半区在 DSH 网页设置面板里注册了一个 **记忆**（英文界面显示为 Memory）分区。

它的单位是**工作区**——宿主自己的工作区注册表，而不是对配置路径的反推——每个工作区列出该目录下会话所使用的记忆入口：

- **主入口**承载路由：召回、图级操作以及默认读写。没有任何声明的工作区会显示解析器为它*派生*出的库，并标明是派生的；只有当某个决定（第二个入口或兜底）需要时，才会写入配置。
- **附加入口**——包括兜底入口 `personal`（默认开启，可直接在该行切换）——可达，但除非调用显式指名，否则不会被碰。

每个入口显示为 角色 + 名称 + 卡片数，展开后是它自己的事实信息：库路径（可复制，命名空间默认值作占位）、remote 地址、自动同步状态、上次同步时间，以及发布方向（只读）。

添加入口时，从已存在的库中挑选（已声明的，加上命名空间下发现的未声明的），或选择新建，所以界面上不可能出现重名——无论有多少工作区认领，一个库始终只对应一条配置条目。

每个工作区还有一个**记忆开关**。关闭意味着该工作区完全无记忆：没有召回提示，没有写卡提醒，所有 memex 工具在那里都会拒绝——而且拒绝发生在库被创建之前。它是该工作区路由的属性，所以同时作为另一个工作区兜底目标的库，对那个工作区依然可写。开关在会话开始时读取，因此重新打开无需重启。（`dsh.yaml` 的 `DSH_MEMEX_ENABLED` 是另一个极端：它在构建期把整个插件移除。）已关闭记忆的工作区会收进列表末尾一个默认折叠的分组。

页面还会列出命名空间下存在、但没有任何入口声明的库（包括派生出的），并允许声明它们；另有一个路径探测功能，可告知某个目录会解析到哪个库，且**不会创建任何东西**。切换主入口是替换：原主入口不再服务该工作区。

保存前会拒绝两类认领：同一个库目录被两个入口共用，以及同一个仓库模式被逐字写在两个入口下。至于两个*不同*的模式是否认领了同一个仓库，无法仅凭配置判定，因此这种情况会在会话实际解析时报告。

发布方向刻意**不能**在此页面编辑（见[守门边界](#守门边界)）。

### 远端操作

页面配置远端，且只通过内核 CLI 完成：

| 库的状态 | 可用操作 |
|---|---|
| 未配置远端 | 配置远端（`memex sync --init <url>`） |
| 已配置远端 | 立即同步、拉取、自动同步开/关、更换远端（独立且需确认） |

已配置的库**绝不会被重新初始化或重建**：内核会检测到已存在的仓库，转而更新 remote。每次内核调用都使用 C locale，因为内核是靠匹配一条英文的 git 错误串来判断「remote 已存在」的——本地化后的 `git remote add` 失败信息会让重复执行 `--init` 被拒绝。

系统从不写库自己的文件：`.sync.json`、`.gitignore` 和 git 仓库始终归内核所有。

### 浏览卡片

展开的入口提供**打开卡片**。它会按需为该库启动内核自带的 `memex serve`，仅在本地运行，抑制内核在 Host 机器上自动打开浏览器的行为，采用内核实际报告的地址（端口冲突时取最后打印的那个），并在插件停止时回收。关闭了记忆的库在拉起任何进程之前就会被拒绝。这里没有自研任何浏览界面，也不改写任何上游资源。跨机器时，地址通过一个扩展点解析，由 [`cockpit-memex-browse-shim`](../cockpit-memex-browse-shim/README.zh.md) 把它接到驾驶舱；如果注册失败，按钮绝不会回退到本机地址，因为在远程机器上那会指向错误的主机。已知限制：上游页面从公网 CDN 加载 Markdown 渲染器，离线时渲染会降级。

## 守门边界
<!-- section: guard -->

写入 `publish` 方向为 `external` 的库时，会扫描以下内容：

- 已知的内部 scope 名，
- 内部域名/remote/私有 IP，
- 已知的内部工作区路径。

哪些主机算内部，是**部署配置**而非源码。本 package 不自带任何内部主机；私有 overlay 通过覆盖 profile patch 中本插件的行来提供：

```yaml
- id: dsh-memex
  name: dsh-memex
  config:
    internalHosts: [git.corp.example]   # remotes on these hosts derive internal libraries
    internalDomains: [corp.example]     # these domains and their subdomains are denied in external writes
```

`internalHosts` 同时会把这些主机上由 remote 派生的库标记为内部。什么都没配置时，主机/域名规则没有输入：它们保持不生效，每次写入都会报告 `structural:internal-host-rule-inactive`，而不是悄悄放行。无效条目会被丢弃并记录日志。工作区路径规则由内部 scope 的实际工作区派生，绝不使用硬编码前缀。凭据类密钥则交给 memex 内核自身的防护。

是否启用守门，取决于目标库的发布方向，而绝不取决于它的名字。未声明发布方向时按外部处理（fail closed）。守门能减少误写，但**无法保证不含语义层面的业务信息**。跨库内容仍须以符合上下文的、去业务化的方式重写，对外发布的库需要定期人工复核。多库写入中某一张卡被拒绝时，已经写入的其余卡片会保留。

内部库之间的写入不受守门约束：那只是可能的归档错误，而不是不可逆的对外泄漏。

发布方向刻意**不能**在设置页编辑：它是守门的输入，所以放宽它仍需要显式手改。

## 安装与前置条件
<!-- section: installation -->

存储内核是一个**全局 npm 安装**，在 `dsh.yaml` 中声明为 `dsh-memex` 条目的 `hostPrerequisites`：

```yaml
    hostPrerequisites:
      - kind: npm-global
        package: "@touchskyer/memex"
        version: "0.4.1"
        # registry: https://registry.npmjs.org/   # optional per-entry override
```

`bin/dsh` 会在 **start / -b / build / restart** 之前补齐它，所以重装、重新镜像或从备份恢复的机器能自愈。要点如下：

- 只处理已声明且**启用**的前置条件（`enabled: false` 或为假的 `enabledEnv` 也会停用补齐），并且只安装声明的**精确**版本——绝不是范围或 `latest`。
- 安装失败（离线、registry 拒绝、超时）只会告警并写入 `~/.dsh/dsh-startup.log`，绝不阻止 DSH 启动。
- `DSH_SKIP_HOST_PREREQUISITES=1` 可在单次调用中跳过补齐。
- `dsh doctor` 立即检查并安装；`dsh doctor --check` 只读。
- manifest 里的 pin 必须与本 package 生成的 `KERNEL_VERSION` 一致——一旦漂移，`tests/host-prerequisites.test.mjs` 会让构建失败。

手动安装（依然有效，例如在没有本仓库检出的机器上）：

```bash
npm install -g @touchskyer/memex@0.4.1 --registry=https://registry.npmjs.org/
```

全局 npm 安装可能忽略仓库的 `.npmrc`，回落到用户级镜像。用户级私有镜像可能落后于 npmjs，所以对固定版本来说，显式传入 registry 参数很关键——补齐程序也正是出于同样原因显式传入它。

内核即便仍然缺失，设置页也会说明需要哪个版本，以及是没检测到还是检测到了不同版本；它绝不会只显示一个内部失败码。

回滚方式是 `enabled: false` 加 `dsh build`；`~/.dsh-memex/` 下的库不受影响。

## 开发
<!-- section: development -->

```bash
npm run build              # host (tsc) + client (tsdown)
npm run typecheck          # both programs
npm test                   # vitest
npm run check:descriptions # fail when tool descriptions drift from the pinned kernel
npm run sync:descriptions  # regenerate them after a kernel version change
```

当前行为的规范位于 `openspec/specs/`（`dsh-memex-integration`、`dsh-memex-memory`、`dsh-memex-scope`、`dsh-memex-guard`、`dsh-memex-settings-ui`、`dsh-memex-card-browser`）。集成背景见 [integration-notes](docs/integration-notes.md)（英文）。

## 许可证

MIT。memex 本身同为 MIT 许可；见 [`LICENSE-memex`](LICENSE-memex) 与 [`ATTRIBUTION.md`](ATTRIBUTION.md)。
