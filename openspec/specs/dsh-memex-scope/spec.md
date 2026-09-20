# dsh-memex-scope Specification

## Purpose
把「当前会话属于哪个知识域」解析为可替换的能力：给定会话 cwd，得出 scope 名与对应的库位置，
以及本次会话可读与可写的范围。

本能力是「跨库」这一维的全部——它存在的唯一原因是上游 memex 的设计前提是单库，它没有、
也不需要有 scope 概念。除此之外的一切（卡片格式、写法、链接、索引）都不属于本能力。

## Requirements

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

**同级可以有多个命中者。** 系统 SHALL 收集**路径段数最多的那一层里的全部**认领条目，
而不是只取第一个：这些条目共同构成该工作区的关联入口集合（见「一个工作区可关联多个入口」）。
命中者多于一个时，其中 SHALL 恰好有一个标为主入口；没有主入口或多于一个主入口时，
系统 SHALL 报错并列出全部命中者，MUST NOT 静默采用其中一个——「按声明顺序取第一个」会把记忆
静默写进另一个库。

最后一步 fallback SHALL 定义为**本地路径派生**：cwd 不属于任何仓库（非 git 目录，或仓库没有
`origin`）时，按本地路径派生出该目录专属的库，而不是并入任何共享库。该规则见下方同名要求。

「外部 worktree 命中主仓」SHALL 只在**该仓库的 remote 已被某个 scope 以 remote 模式显式认领**
时成立；未被认领的仓库按自动派生处理，因此其库与声明路径下的库是**两个不同的库**。

#### Scenario: 路径匹配优先于自动派生
- **WHEN** cwd 命中配置中显式声明的路径前缀
- **THEN** 使用该条目的 scope 与库，自动派生不参与

#### Scenario: 前缀不误命中兄弟目录
- **WHEN** 配置声明前缀为 `…/nexus`，而在 `…/nexus-ops` 下启动会话
- **THEN** 该会话 MUST NOT 命中 `nexus` 条目的路径前缀

#### Scenario: 外部 worktree 经 remote 命中主仓
- **WHEN** 会话运行在某仓库的外部 git worktree 内，其 cwd 不命中任何路径前缀，
  且该仓库的 remote 已被某个 scope 以 remote 模式认领
- **THEN** 系统经 `git -C` 读取 origin 并命中该 scope 与其库

#### Scenario: 未认领仓库的仓外副本不保证共库
- **WHEN** 会话运行在某个仓库的仓外副本内，而该仓库的 remote 未被任何 scope 认领
- **THEN** 系统按自动派生给出该仓库的派生库，MUST NOT 声称它与任何声明路径下的库是同一个

#### Scenario: 同一工作区被多个入口声明
- **WHEN** 两个 scope 声明了完全相同的路径前缀，其中恰好一个标为主入口，且会话 cwd 命中该前缀
- **THEN** 当前 scope 为那个主入口，另一个进入该会话的关联入口集合

#### Scenario: 同级多个命中却没有唯一主入口
- **WHEN** 两个 scope 声明了完全相同的路径前缀，但都没有标为主入口（或都标了）
- **THEN** 解析报错并列出两个 scope，MUST NOT 静默取声明顺序中的第一个

### Requirement: scope 名按 remote 确定性派生，不按目录名

自动派生 SHALL 依据 git remote `origin`，取 remote 路径的末两段、去除 `.git` 后缀、
以 `-` 连接并归一化。MUST NOT 只取末段——不同组织下的同名仓库会因此静默共用一个库，
直接破坏存储隔离。

个人托管平台上的仓库 SHALL **与其他仓库同样按 remote 派生 scope 并独立建库**——
开源项目同样拥有自己的知识域，把它们的知识混入通用库会重蹈「混库产生噪音」的问题。
这类库的发布方向通常为外部（见 `dsh-memex-guard`）。

`personal` SHALL 是一个**与其他 scope 地位相同的显式声明的库**，MUST NOT 再承担「无法确定归属」
情形的兜底。它与其他 scope 一样只服务被显式声明的工作区。

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
- **WHEN** 用户把某个不指向具体项目的工作区显式声明为 `personal` 条目
- **THEN** 该工作区照常解析到 `personal` 与其库，通用知识留在该库

#### Scenario: 非 git 目录落到 fallback
- **WHEN** cwd 既不在任何已配置路径下，也不是 git 仓库
- **THEN** 解析走 fallback 阶段，该阶段按本地路径派生出该目录专属的库，MUST NOT 并入 `personal`

#### Scenario: 无归属的目录不再并入 personal
- **WHEN** cwd 不是 git 仓库，或仓库没有 `origin`，且该目录不命中任何已配置路径前缀
- **THEN** 系统按本地路径派生出该目录专属的库，MUST NOT 解析为 `personal`

### Requirement: 库位置映射固定，库位于工作区之外

库目录 SHALL 默认位于统一命名空间 `~/.dsh-memex/<scope>` 之下；配置 MAY 为某个 scope 指定一个
**位于该 scope 自己仓库内**的库目录（例如 `<repo>/docs/memex`），使该库的卡片随项目代码一起
提交与评审。该取值来自用户配置，MUST NOT 受工具参数影响。，使多个库集中一处而不是散落在
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

#### Scenario: 默认库不落在项目工作区
- **WHEN** 未为该 scope 配置库目录，且在其会话中写入一张卡片
- **THEN** 卡片写入 `~/.dsh-memex/<scope>/cards/`，项目工作区内不产生 `cards/` 目录

#### Scenario: 仓内库随代码提交
- **WHEN** 某 scope 配置了位于其自己仓库内的库目录
- **THEN** 卡片写入该目录，可作为该项目提交的一部分被评审与推送

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

一次会话的**可达入口集合** SHALL 由三部分合成：**① 该工作区的主入口**（总是可读可写）；
**② 该工作区的其他关联入口**（见「一个工作区可关联多个入口」）；**③ 兜底入口与当前 scope 所属
绑定集合声明的 read / write**。

绑定集合 SHALL 由配置显式声明，MUST NOT 由系统按目录邻近或命名相似自行推断；其意义是
**限制而非授权**——它界定 agent 可以**额外**选到的范围上界。工作区自带的关联入口属于该工作区
自身的声明，不受绑定集合限制；绑定集合限制的是除此之外还能选到哪些 scope。

**兜底入口**（默认 `personal`）SHALL 是**默认授予**的可达范围：该工作区的主入口默认可读且可写
`personal`，因此一个新工作区不需要任何配置即可使用。它 SHALL 可由主入口自己的声明关闭，关闭后
`personal` 在该工作区**既不可读也不可写**。绑定集合 SHALL NOT 取消兜底（它只做加法）；反过来，
绑定集合**显式**列出 `personal` 时可达性成立——显式声明覆盖默认值。

**可达不等于默认动作**：默认读取与默认写入 SHALL 只作用于主入口（见 `dsh-memex-memory` 的跨库
语义），附加入口只有被显式指名时才会被读或写。

#### Scenario: 项目绑定三库
- **WHEN** 配置声明某绑定含可读与可写 `[a, b, personal]`，且会话解析到 scope `a`
- **THEN** 该会话的检索范围与可选写入目标均为这三个 scope

#### Scenario: 无绑定时行为退化
- **WHEN** 配置未声明任何绑定集合
- **THEN** 可达范围只由该工作区自己的入口与兜底入口合成：可读该工作区的全部入口与 `personal`，
  可写主入口与 `personal`（不再有"读不到 `personal`"的情形，除非兜底被显式关闭）

#### Scenario: 兜底入口默认开启
- **WHEN** 某工作区未声明任何绑定、也未关闭兜底
- **THEN** 该会话可读该工作区的全部入口与 `personal`，可写主入口与 `personal`

#### Scenario: 关闭兜底后两个方向都不可达
- **WHEN** 某工作区的主入口声明关闭兜底，且没有任何绑定列出 `personal`
- **THEN** 该会话既不能读也不能写 `personal`，指名它会被拒绝并说明原因

#### Scenario: 绑定外 scope 不可达
- **WHEN** 会话绑定为某集合，模型在参数中指定一个不在该集合内的已知 scope
- **THEN** 调用被拒绝并说明该 scope 不在当前绑定范围内

#### Scenario: 工作区的关联入口无需绑定即可达
- **WHEN** 某工作区由主入口 `a` 与附加入口 `b` 共同声明，且 `a` 不属于任何绑定
- **THEN** 该会话可检索 `a` 与 `b`，并可将 `b` 作为写入目标

#### Scenario: 附加入口不被默认读取或写入
- **WHEN** 会话的主入口为 `a`、附加入口为 `b`，且调用未指名 `b`
- **THEN** 读取与写入都只作用于 `a`，`b` 的库不产生新卡片

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

### Requirement: 一个工作区可关联多个入口，其中恰好一个是主入口

一个工作区（一个声明的路径前缀，或同一次 remote 命中的一组条目）SHALL 可以关联**多个**记忆入口，
其中 SHALL **恰好有一个是主入口**：

- **主入口**承载该工作区的**当前 scope**：召回（读该库的索引卡）、网络分析、归档与链接统计等
  **图级操作**只作用于它；默认读取与默认写入也只作用于它。
- **其他关联入口**是该工作区的附加入口：它们在可达范围内（可被检索、可被指名读取与写入），
  但 MUST NOT 被默认读取或写入。

该关系 SHALL 由配置显式声明（多个 scope 声明同一工作区，其中一个标为主入口），MUST NOT 由系统
按目录邻近、命名相似或声明顺序推断。

**唯一性按可判定性分级**：路径前缀与字面相同的 remote 模式在**配置期**可判定，校验 SHALL 拒绝
「同级多个认领者却没有唯一主入口」；不同 remote 模式是否命中同一仓库在配置期不可判定，故在
**解析时**判定并报错。

同一路径前缀被多个 scope 声明时，除主入口唯一性之外 MUST NOT 再有其他隐含优先级——命名顺序、
声明顺序、条目长度都不得成为判据。

#### Scenario: 一个项目分内部与外部两个库
- **WHEN** `proj-internal`（publish internal，主入口）与 `proj-public`（publish external）声明
  同一个路径前缀
- **THEN** 会话的当前 scope 为 `proj-internal`，`proj-public` 在可达范围内；写入 `proj-public`
  需显式指名，并按该方法方向各自过守门

#### Scenario: 缺主入口时拒绝而非猜测
- **WHEN** 两个 scope 声明同一路径前缀且都没有标为主入口
- **THEN** settings 校验拒绝该配置并指出冲突的两个 scope

#### Scenario: 重复主入口时拒绝
- **WHEN** 两个 scope 声明同一路径前缀且都标了主入口
- **THEN** settings 校验拒绝该配置并指出两个 scope

#### Scenario: 字面相同的 remote 模式同理
- **WHEN** 两个 scope 声明完全相同的 remote 模式，且其中一个标为主入口
- **THEN** 该配置合法；运行时命中该 remote 时以主入口为当前 scope

#### Scenario: 运行时命中的多个 remote 模式缺唯一主入口
- **WHEN** 某个仓库的 remote 同时匹配两个 scope 的 remote 模式，且两者都没有标为主入口
- **THEN** 解析报错并指出两个 scope，MUST NOT 静默使用其中一个

#### Scenario: 单条目声明无需标注
- **WHEN** 某个路径前缀只被一个 scope 声明且未标主入口
- **THEN** 该 scope 即该工作区的主入口，行为与显式标注等价

### Requirement: 一个库目录只能被一个 scope 使用

同一个库目录 MUST NOT 被两个 scope 共用：共享同一目录会让两个 scope 名指向同一份存储与同一个
同步目标，产生无法解释的别名。违反时系统 SHALL 在 settings 校验阶段拒绝该配置并指明冲突的两方。

库目录的比较 SHALL 使用展开 `~` 之后的绝对路径，并 SHALL 把「未配置时按命名空间派生的默认地址」
一并纳入比较。

#### Scenario: 共用同一库目录的配置被拒
- **WHEN** 两个 scope 被配置为同一个库目录
- **THEN** 该配置在校验阶段被拒绝，并指出冲突的两个 scope

#### Scenario: 显式路径与另一个 scope 的默认地址相撞
- **WHEN** 某个 scope 显式配置的库路径等于另一个 scope 未配置时的默认派生地址
- **THEN** 该配置在校验阶段被拒绝，并指出冲突的两个 scope

### Requirement: 无仓库目录按本地路径派生独立库，且不配置远端同步

cwd 不属于任何仓库时，系统 SHALL 按**本地路径**派生出一个该目录专属的 scope 与库：

- 名字 SHALL 与 remote 派生**同形**：取路径末两段、以 `-` 连接并归一化；MUST NOT 只取末段
  ——`…/work/learning` 与 `…/Documents/learning` 只取末段会静默共用一个库。
- 库位置 SHALL 位于统一命名空间 `~/.dsh-memex/<派生名>` 之下，MUST NOT 为本情形引入任何临时或
  位置特殊的库。
- 派生名归一化后不满足 scope 名规则时，系统 SHALL 使用一个固定的本地兜底库名，其行为与该规则下的
  其他库一致。
- 该库 SHALL NOT 被系统配置远端同步；在用户显式配置之前，它不产生任何推送或拉取。
- 本地派生与 remote 派生 SHALL 共用同一套保护：同一 scope 名由**不同来源**（不同仓库、不同本地路径、
  或两者混合）派生出来时，系统 SHALL 报错并指明需要显式映射，MUST NOT 让它们静默共用一个库。

#### Scenario: 无仓库目录各自一个库
- **WHEN** 会话在 `~/Documents/learning` 下启动，该目录不是 git 仓库
- **THEN** 系统解析出该目录专属的库，位于命名空间之下，且与 `personal` 不是同一个库

#### Scenario: 同名末段的不同目录不共库
- **WHEN** 两个不是 git 仓库的目录分别为 `…/work/learning` 与 `…/Documents/learning`
- **THEN** 二者派生出不同的 scope，MUST NOT 落到同一个库

#### Scenario: 本地派生的库不产生远端同步
- **WHEN** 在本地派生的库中写入一张卡片
- **THEN** 系统不执行任何推送或拉取，该库的远端状态为未配置

#### Scenario: 不同来源派生同名时显式报错
- **WHEN** 某个仓库的 remote 与某个本地路径派生出同一个 scope 名
- **THEN** 系统报错并指明需要显式映射，MUST NOT 让两者共用一个库
