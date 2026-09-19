## Purpose

把「当前会话属于哪个知识域」解析为可替换的能力：给定会话 cwd，得出 scope 名与对应的库位置，
以及本次会话可读与可写的范围。

本能力是「跨库」这一维的全部——它存在的唯一原因是上游 memex 的设计前提是单库，它没有、
也不需要有 scope 概念。除此之外的一切（卡片格式、写法、链接、索引）都不属于本能力。

## ADDED Requirements

### Requirement: scope 由会话 cwd 解析得出，调用方无法指定

系统 SHALL 在每次调用时以**当前会话的 cwd**（`agent.session.header.cwd`）为唯一输入解析
**当前 scope**。当前 scope MUST NOT 被工具参数改写，也 MUST NOT 接受调用方指定的库路径。

工具参数中的 `scope`（见 `dsh-memex-memory`）SHALL 只用于在**已知 scope 集合内选择操作
目标**——它选择「操作哪个已存在的库」，而不是声明「我属于哪个知识域」。系统 MUST NOT 把
该参数当作路径拼接，MUST NOT 依据它改变写入目标之外的任何解析结果。

#### Scenario: 模型无法伪造当前知识域
- **WHEN** 模型在业务库会话中调用工具，并试图用参数把当前 scope 指定为 `personal`
- **THEN** 当前 scope 仍解析为原业务 scope

#### Scenario: 会话 cwd 决定 scope
- **WHEN** 在 `~/mydir/dev/nexus` 下启动的会话调用任一记忆工具
- **THEN** 解析出的 scope 指向该仓库对应的库，`MEMEX_HOME` 指向该库目录

#### Scenario: 未知 scope 名被拒绝
- **WHEN** 工具调用携带的 `scope` 既不是当前 scope，也不属于已知 scope 集合
- **THEN** 调用被拒绝并说明该 scope 不存在，系统不据此拼接任何库路径

### Requirement: 解析优先级为路径前缀 > remote 模式 > 自动派生 > fallback

系统 SHALL 按固定顺序解析：配置的路径前缀匹配（最长优先）→ 配置的 remote 模式匹配 →
自动派生 → fallback。

路径前缀匹配 SHALL 按**路径段边界**判定：cwd 等于该前缀，或以该前缀加路径分隔符开头。
MUST NOT 使用纯字符串前缀比较——否则前缀 `…/nexus` 会错误命中 `…/nexus-ops` 这类兄弟
目录，把一个知识域的记忆写进另一个。比较前 SHALL 展开 `~`、解析为绝对路径并去除尾部分隔符；
「最长」SHALL 按路径段数比较。

#### Scenario: 路径匹配优先于自动派生
- **WHEN** cwd 命中配置中显式声明的路径前缀
- **THEN** 使用该条目的 scope 与库，自动派生不参与

#### Scenario: 前缀不误命中兄弟目录
- **WHEN** 配置声明前缀为 `…/nexus`，而在 `…/nexus-ops` 下启动会话
- **THEN** 该会话 MUST NOT 命中 `nexus` 条目的路径前缀

#### Scenario: 外部 worktree 经 remote 命中主仓
- **WHEN** 会话运行在某仓库的外部 git worktree 内，其 cwd 不命中任何路径前缀
- **THEN** 系统经 `git -C` 读取 origin 并命中主仓对应的 scope

### Requirement: scope 名按 remote 确定性派生，不按目录名

自动派生 SHALL 依据 git remote `origin`，取 remote 路径的末两段、去除 `.git` 后缀、
以 `-` 连接并归一化。MUST NOT 只取末段——不同组织下的同名仓库会因此静默共用一个库，
直接破坏存储隔离。

个人托管平台上的仓库 SHALL **与其他仓库同样按 remote 派生 scope 并独立建库**——
开源项目同样拥有自己的知识域，把它们的知识混入通用库会重蹈「混库产生噪音」的问题。
这类库的发布方向通常为外部（见 `dsh-memex-guard`）。

`personal` SHALL 保留给**不属于任何具体项目**的通用知识（技能、语言陷阱、方法论），
以及无 `origin` 的仓库、非 git 目录等无法确定归属的情形。

#### Scenario: 同一仓库的多个工作副本收敛到一个 scope
- **WHEN** 多个目录共享同一个仓库 origin，且都不命中任何路径前缀
- **THEN** 它们派生出**同一个** scope 与同一个库，不按各自目录名建库

#### Scenario: 不同组织的同名仓库不共库
- **WHEN** 两个仓库的 remote 路径分别为 `<orgA>/<repo>` 与 `<orgB>/<repo>`
- **THEN** 二者派生出不同的 scope，MUST NOT 落到同一个库

#### Scenario: 开源仓库有自己的库
- **WHEN** cwd 位于个人托管平台（如 `github.com`）下的某个项目仓库
- **THEN** 该系统按该仓库的 remote 派生出**专属** scope 与独立库，不并入 `personal`

#### Scenario: 无归属的通用知识留在 personal
- **WHEN** cwd 不是 git 仓库，或仓库没有 `origin`
- **THEN** scope 解析为 `personal`

#### Scenario: 非 git 目录落到 fallback
- **WHEN** cwd 既不在任何已配置路径下，也不是 git 仓库
- **THEN** scope 解析为 `personal`，且不按目录名建库

### Requirement: 库位置映射固定，库位于工作区之外

库目录 SHALL 位于统一命名空间 `~/.dsh-memex/<scope>` 之下，使多个库集中一处而不是散落在
用户主目录（本项目的库数量随项目数增长，散落会迅速变得难以管理）。

`personal` SHALL 使用同一命名空间下的 `~/.dsh-memex/personal`，与本系统其余库保持一致；
本系统始终以 `MEMEX_HOME` 显式注入库位置，不依赖存储内核的默认库，因此无需为兼容它而把
`personal` 放在 `~/.memex`。

命名空间根目录 SHALL NOT 位于 DSH 的配置目录（`~/.dsh`）之内——库是可独立复制与同步的
知识资产，不应混在宿主配置里。

系统 SHALL 以 `MEMEX_HOME` 环境变量向存储内核指定库位置。系统 MUST NOT 依赖上游的
`.memexrc` 向上查找机制做路由：`MEMEX_HOME` 优先级最高且不随 cwd 漂移。

系统 MAY 创建库目录与标准 `cards/` 目录，后续卡片文件全部由存储内核写入。系统 MUST NOT
在库内生成私有配置、索引、审计、缓存或日志文件，MUST NOT 改写内核管理的卡片格式，也 MUST NOT
让任一库的配置引用另一个库的路径。该约束使「库互不依赖」成为结构事实：任一库可被单独
复制、同步或删除，既不影响其他库，也不会在其他库留下失效引用。

#### Scenario: 库不落在项目工作区
- **WHEN** 在业务会话中写入一张卡片
- **THEN** 卡片写入对应的 `~/.dsh-memex/<scope>/cards/`，项目工作区内不产生 `cards/` 目录

#### Scenario: 各库集中在同一命名空间
- **WHEN** 系统解析出多个 scope 并访问其库
- **THEN** 所有这些库都位于 `~/.dsh-memex/` 之下，用户主目录下不出现其他库目录

#### Scenario: 库内不出现私有运行时文件
- **WHEN** 系统为某 scope 创建新库并执行跨库检索
- **THEN** 库内只出现标准 `cards/` 与存储内核管理的内容，不出现本系统生成的私有配置、索引、审计、缓存或日志文件

#### Scenario: 删除某个库不影响其余库
- **WHEN** 某个 scope 的库目录被整体删除，随后在另一个 scope 的会话中检索
- **THEN** 该会话正常返回本库结果；跨库检索跳过缺失的库并给出告警，不拒绝服务

### Requirement: 配置经 DSH settings 承载，不自建配置文件

scope 表与绑定集合 SHALL 注册为一个 DSH settings namespace，由该能力提供分层解析、
外部编辑与校验。系统 MUST NOT 自建独立的配置文件与解析器。

配置分节**缺失**时，系统 SHALL 使用 schema 默认（仅 `personal`，允许自动派生）并正常服务。

**注册时**分节存在但不合法，settings 注册 SHALL 失败，工具与生命周期接入 MUST NOT 发布。
**运行中**外部编辑产生不合法分节时，系统 SHALL 遵循 DSH settings 的官方语义：继续使用上一份
已验证的 last-good 配置并告警，MUST NOT 静默降级到 schema 默认——后者可能把业务内容路由进
错误的库。该状态由 settings provider 拒绝提交，不触发工具层配置替换。

#### Scenario: 分节缺失时用默认配置
- **WHEN** settings 中不存在该 namespace 的分节
- **THEN** 系统以「仅 personal + 自动派生」正常服务，不报错

#### Scenario: 启动时配置不合法则不发布工具
- **WHEN** 注册时的分节含重复 scope 名、无法编译的 remote 模式，或绑定引用不存在的 scope
- **THEN** settings 注册失败，记忆工具与生命周期接入均不发布，并指出失败配置项

#### Scenario: 运行中非法编辑保留 last-good
- **WHEN** 工具已发布后，外部把 settings 分节编辑成不合法内容
- **THEN** settings provider 拒绝该次更新、保留上一份已验证配置并告警；工具继续按 last-good
  路由，MUST NOT 使用非法值，也 MUST NOT退回 schema 默认

### Requirement: 绑定集合界定会话的读写可达范围

系统 SHALL 由配置的**绑定集合**界定一次会话可读与可写的 scope 范围。绑定集合 SHALL 由
配置显式声明，MUST NOT 由系统按目录邻近或命名相似自行推断。

当前 scope 不属于任何绑定时，可读范围 SHALL 退化为「当前 scope」，可写范围 SHALL 退化为
「当前 scope + `personal`」——即与不引入绑定集合时完全一致的行为。

集合的意义是**限制而非授权**：它定义 agent 可以选择的范围上界。`personal` SHALL 在所有
绑定集合的可读范围内可见；是否可写由各绑定显式声明。

#### Scenario: 项目绑定三库
- **WHEN** 配置声明某绑定含可读与可写 `[a, b, personal]`，且会话解析到 scope `a`
- **THEN** 该会话的检索范围与可选写入目标均为这三个 scope

#### Scenario: 无绑定时行为退化
- **WHEN** 配置未声明任何绑定集合
- **THEN** 会话只可读当前 scope，且只可写当前 scope 与 `personal`

#### Scenario: 绑定外 scope 不可达
- **WHEN** 会话绑定为某集合，模型在参数中指定一个不在该集合内的已知 scope
- **THEN** 调用被拒绝并说明该 scope 不在当前绑定范围内

### Requirement: 解析结果如实呈现 scope 与库路径

每次工具返回 SHALL 携带本次解析出的**当前** scope 名与其库路径，使路由错误可被立即发现。
系统 SHALL 在首次为某 scope 创建库目录时明确告知「已创建新记忆库」并提示尚未配置同步——
该提示是碎片库的主要暴露手段。

本能力 SHALL 向调用方提供**枚举已知 scope** 与**按 scope 名解析库位置**的能力。已知 scope
集合 SHALL 为配置声明的全部 scope，并上已存在库目录的 scope（按库目录命名约定反向识别）。
该集合 MUST NOT 依赖额外的持久化注册表。

#### Scenario: 返回携带 scope 与库路径
- **WHEN** 一次召回经自动派生解析到某业务 scope
- **THEN** 返回值中包含该 scope 名与其库路径

#### Scenario: 首次派生新库给出提示
- **WHEN** 自动派生指向一个尚不存在的库目录
- **THEN** 系统创建目录与 `cards/`，并在返回中提示该库未配置同步

#### Scenario: 不自动建立 git 仓
- **WHEN** 系统为一个新 scope 创建库目录
- **THEN** 该目录内不出现 `.git`，也不出现任何已配置的 remote

### Requirement: 每次调用按会话 cwd 独立解析

系统 SHALL 在每次调用时按该次调用所属会话的 cwd 解析 scope。系统 MUST NOT 在多个会话间
共享解析结果——DSH 是单进程多会话，cwd 随会话变化，跨会话复用会把一个会话的知识域错用到
另一个会话。是否缓存是实现细节，不作规范要求。

#### Scenario: 不同会话解析出各自 scope
- **WHEN** 同一 DSH 进程内，一个会话在业务仓、另一个在个人仓
- **THEN** 两个会话分别解析出各自的 scope 与库路径
