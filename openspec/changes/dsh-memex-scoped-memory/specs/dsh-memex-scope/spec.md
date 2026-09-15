## Purpose

把「当前会话属于哪个知识域」解析为可替换的能力：给定会话 cwd，得出 scope 名与对应的
`MEMEX_HOME`。本能力覆盖解析优先级、库位置的归属、配置的三层优先级与两种失败语义
（缺失降级 / 损坏 fail closed），以及解析结果对调用方的如实呈现。

本能力是 `dsh-memex-memory` 与 `dsh-memex-guard` 的前置：读侧单库与跨库守门都建立在
「scope 可被确定且不可被调用方伪造」之上。

## ADDED Requirements

### Requirement: scope 由会话 cwd 解析得出，调用方无法指定

系统 SHALL 在每次工具调用时，以**当前会话的 cwd**（`agent.session.header.cwd`）为唯一
输入解析 scope。系统 MUST NOT 接受模型或工具参数指定的 scope 名、库路径或
`MEMEX_HOME`。解析结果 SHALL 是进程内可信值，规格上等价于「模型无法伪造自己的知识域」。

#### Scenario: 模型无法越域读取
- **WHEN** 模型在 nexus 会话中调用 `memory_search`，并在参数中试图指定 personal 库
- **THEN** 工具忽略该意图，只检索 nexus 库

#### Scenario: 会话 cwd 决定 scope
- **WHEN** 在 `~/corp/nexus` 下启动的会话调用任一记忆工具
- **THEN** 解析出的 scope 为 `nexus`，`MEMEX_HOME` 指向 nexus 库

### Requirement: 解析优先级为路径匹配 > git remote 匹配 > 自动派生 > fallback

系统 SHALL 按固定顺序解析 scope：配置表的路径前缀匹配（最长前缀优先）→ 配置表的
git remote 正则匹配 → 自动派生 → fallback。路径匹配与 remote 匹配 SHALL 同时存在，
因为 Worktree Session 下 cwd 不稳定而 `git -C` 仍能取得 origin。

自动派生 SHALL 采用目录名规则：cwd 位于 `<工作根>/<x>` 下时 scope 名为 `<x>`、库目录为
`~/.memex-<x>`。落在 `github.com` remote 或无 git 的目录 SHALL 归入 `personal`，
MUST NOT 为个人开源项目各自建库。

#### Scenario: 路径匹配优先于自动派生
- **WHEN** cwd 命中配置表中显式声明的路径前缀
- **THEN** 使用该条目的 scope 与库目录，自动派生不参与

#### Scenario: worktree 内经 remote 命中主仓 scope
- **WHEN** 会话运行在某业务仓的 git worktree 内，其 cwd 不命中任何路径前缀
- **THEN** 系统经 `git -C` 读取 origin 并命中主仓的 scope

#### Scenario: 个人仓库归入 personal
- **WHEN** cwd 位于 `github.com` 下的个人开源仓库
- **THEN** scope 为 `personal`，库目录为 `~/.memex`，不新建业务库

#### Scenario: 无 git 目录落到 fallback
- **WHEN** cwd 既不在任何已配置路径下，也不是 git 仓库
- **THEN** scope 为 fallback 值 `personal`，且解析来源标记为 `fallback`

### Requirement: 记忆库位于项目之外，由插件注入 MEMEX_HOME

系统 SHALL 以 `MEMEX_HOME` 环境变量向 memex CLI 指定库位置，库目录 SHALL 位于项目
工作区之外（如 `~/.memex-<scope>`）。系统 MUST NOT 依赖上游的 `.memexrc` 向上查找机制
来确定库位置——该机制只能声明「库在本目录」，无法表达「库在别处」，两者混用会产生两套
互相打架的优先级。

#### Scenario: 库不落在项目工作区
- **WHEN** 在 nexus 会话中写入一张卡片
- **THEN** 卡片写入 `~/.memex-nexus/cards/`，项目工作区内不产生 `cards/` 目录或 `.memexrc`

#### Scenario: 未使用 .memexrc
- **WHEN** 项目根存在一个 `.memexrc` 文件
- **THEN** 它不改变 scope 解析结果，库位置仍由插件的 `MEMEX_HOME` 注入决定

### Requirement: 配置解析区分「缺失」与「损坏」

配置来源的优先级 SHALL 为：DSH settings > `~/.dsh/memex-scopes.yaml` > 内置默认。

配置文件**不存在**时，系统 SHALL 使用内置默认（仅 `personal`，`autoDerive: true`）并
正常服务。配置文件**存在但无法解析**（非法 YAML、schema 不合法）时，系统 SHALL 拒绝
所有记忆工具调用，MUST NOT 静默降级到默认值——静默降级会把业务内容路由进 personal 库。

#### Scenario: 文件缺失时用默认配置
- **WHEN** `~/.dsh/memex-scopes.yaml` 不存在且 settings 无相关分节
- **THEN** 系统以「仅 personal + 自动派生」正常服务，不报错

#### Scenario: 文件损坏时拒绝服务
- **WHEN** `~/.dsh/memex-scopes.yaml` 内容为非法 YAML
- **THEN** 所有记忆工具调用被拒绝，错误信息指明该配置文件路径

#### Scenario: settings 覆盖文件
- **WHEN** DSH settings 中提供了 scope 分节，同时 `~/.dsh/memex-scopes.yaml` 也存在
- **THEN** settings 的值生效

### Requirement: 解析结果如实呈现 scope 与来源

每次工具返回 SHALL 携带本次解析出的 scope 名与解析来源（`config` / `derived` /
`fallback`），使路由错误可被立即发现。系统 SHALL 在首次为某 scope 创建库目录时明确
告知「已创建新记忆库」并提示尚未配置同步。

新建库时系统 MUST NOT 自动执行 `git init`、MUST NOT 自动配置 sync remote——是否同步
以及同步到何处是合规决策，必须由人显式作出。

#### Scenario: 返回携带来源
- **WHEN** 一次 `memory_recall` 经自动派生解析到 scope `nexus`
- **THEN** 返回值中包含 scope 名与来源标记 `derived`

#### Scenario: 首次派生新库给出提示
- **WHEN** 自动派生指向一个尚不存在的库目录
- **THEN** 系统创建目录与 `cards/`，并在返回中提示该库未配置同步

#### Scenario: 不自动建立 git 仓
- **WHEN** 系统为一个新 scope 创建库目录
- **THEN** 该目录内不出现 `.git`，也不出现任何已配置的 remote

### Requirement: 解析在会话内缓存，跨会话重新计算

系统 SHALL 在单次工具调用时解析 scope；同一会话内 cwd 不变时 MAY 复用解析结果。
系统 MUST NOT 跨会话复用解析结果——DSH 是单进程多会话，cwd 随会话变化。

#### Scenario: 同一会话内结果稳定
- **WHEN** 同一会话连续调用两次记忆工具
- **THEN** 两次解析出相同 scope

#### Scenario: 不同会话解析出各自 scope
- **WHEN** 同一 DSH 进程内，一个会话在 `~/corp/nexus`、另一个在 `~/opensource/ohmydsh`
- **THEN** 两个会话分别解析出 `nexus` 与 `personal`
