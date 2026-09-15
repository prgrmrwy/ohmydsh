## Purpose

定义面向模型的记忆工具面与记忆的生产/消费语义：读侧严格单库、写侧以当前库为主，
唯一的跨库写入是 retro 时向 `personal` 追加一条**独立重写**的去业务化卡片。本能力
覆盖四个工具各自的职责与参数、召回护栏、写入前查重，以及存储内核的复用边界。

存储与链接机制复用上游 memex（卡片格式、`[[wikilink]]`、原子写、backlinks、git
sync、`serve`），本能力只定义 DSH 侧的策略层语义。

## ADDED Requirements

### Requirement: 读操作只作用于当前 scope 的库

`memory_recall`、`memory_read`、`memory_search` 三个读工具 SHALL 只访问当前 scope 解析
出的库。系统 MUST NOT 提供跨 scope 读，MUST NOT 让模型通过参数扩大检索范围。模型
「搜不到别库」SHALL 是能力缺失，而不是提示词劝阻。

#### Scenario: 业务会话搜不到 personal 库的卡
- **WHEN** 在 nexus 会话中执行 `memory_search`，personal 库存在同关键词的卡
- **THEN** 结果中不包含 personal 库的任何卡片

#### Scenario: 读工具返回当前 scope
- **WHEN** 任一读工具在 nexus 会话中执行
- **THEN** 返回值标明 scope 为 `nexus`

### Requirement: 工具面只含记忆读写，运维动作归人

系统 SHALL 只向模型注册 4 个工具：`memory_recall`、`memory_read`、`memory_search`、
`memory_retro`。系统 MUST NOT 注册 `organize`、`archive`、`links`、`pull`、`push`
等运维类动作，也 MUST NOT 注册裸写入工具——裸写入会绕过查重与守门。运维动作 SHALL
由人经 memex CLI 执行。

#### Scenario: 模型看不到运维工具
- **WHEN** 模型获取工具清单
- **THEN** 清单中只有上述 4 个记忆工具，不含 organize / archive / sync 类动作

#### Scenario: 不存在绕过守门的裸写入
- **WHEN** 模型需要保存一条洞察
- **THEN** 唯一入口是 `memory_retro`，其跨库写入必经守门

### Requirement: 跨库写入只发生在 retro，且必须独立重写

`memory_retro` 在业务 scope 下 SHALL 接受可选参数 `alsoPersonal`，其内容为
`{ slug, title, body }`，表示向 `personal` 库写入一条卡片。系统 MUST NOT 接受
「与原卡相同、仅加标记」的跨库写入：跨库卡片 SHALL 由模型独立重写为去业务化表述，
因为同一洞察在不同语境下本就应该有不同表述，且守门需要一个可扫描的明确对象。

写入顺序 SHALL 为：先写当前 scope 的主卡，再处理 `alsoPersonal`。跨库关系因此
SHALL 呈星形（business → personal），business 之间 MUST NOT 互写。

#### Scenario: 业务洞察同时落两库
- **WHEN** 在 nexus 会话中调用 `memory_retro`，提供主卡与 `alsoPersonal`
- **THEN** nexus 库与 personal 库各新增一条卡片，且两者内容不同

#### Scenario: 业务库之间不互写
- **WHEN** 在 nexus 会话中调用 `memory_retro`
- **THEN** 只有 nexus 与 personal 两个库可能被写入，flow-web 等其他业务库不受影响

#### Scenario: 主卡先落地
- **WHEN** `memory_retro` 的 `alsoPersonal` 因守门被拒绝
- **THEN** 当前 scope 的主卡已经写入并保留

### Requirement: 写入前自动查重，命中则警告但不拦截

`memory_retro` SHALL 在写入前以 slug 精确匹配与 title 关键词对目标库做一次查重。
命中时系统 SHALL 在结果中给出警告并建议改用 `mode: "update"`，但 MUST NOT 拦截写入。
`alsoPersonal` SHALL 在 personal 库独立查重。

#### Scenario: 重复 slug 给出警告
- **WHEN** `memory_retro` 使用的 slug 在当前库已存在
- **THEN** 写入成功，返回结果中含「可能重复」警告并建议改用 update

#### Scenario: 全新洞察无警告
- **WHEN** slug 与 title 在当前库均无相近命中
- **THEN** 正常写入，返回结果不含重复警告

### Requirement: personal 会话中的 alsoPersonal 被拒绝

当解析出的 scope 为 `personal` 时，`alsoPersonal` 参数 SHALL 被视为无意义并报错，
而不是被静默忽略——静默忽略会让模型误以为已经完成跨库写入。

#### Scenario: personal 会话传 alsoPersonal 报错
- **WHEN** 在 personal 会话中调用 `memory_retro` 并提供 `alsoPersonal`
- **THEN** 工具返回明确的参数错误，说明当前已是 personal scope

### Requirement: 召回带护栏，且不自动展开链接

`memory_recall` SHALL 接受可选 `query`（1–3 个关键词），省略时 SHALL 返回该库的人工
策展索引卡。召回结果 SHALL 是卡片摘要列表，正文中的 `[[链接]]` 由模型决定是否继续
跟进——系统 MUST NOT 自动展开链接、MUST NOT 自动批量读卡。

护栏 SHALL 为：跟链深度不超过 3 跳、单次召回读卡不超过 20 张。护栏是模型侧行为约定，
与工具返回值一同呈现。

#### Scenario: 省略 query 时返回索引卡
- **WHEN** 调用 `memory_recall` 且不带 `query`
- **THEN** 返回当前库的索引卡内容

#### Scenario: 链接不自动展开
- **WHEN** 召回结果中的卡片正文含 `[[other-card]]`
- **THEN** 该链接的目标卡片不在本次返回中，需要模型显式调用 `memory_read`

### Requirement: 存储内核为上游 memex，卡片保持上游格式

系统 SHALL 以 memex CLI 作为存储与检索内核，向其注入 `MEMEX_HOME` 以选择库。卡片
SHALL 保持上游格式（YAML frontmatter + markdown 正文 + `[[wikilink]]`），使
`memex serve`、Obsidian、memex CLI 与 git sync 在不经本插件时同样可用。系统 MUST NOT
引入私有存储格式或私有索引，MUST NOT 使插件成为读取记忆的唯一途径。

#### Scenario: 脱离插件仍可读
- **WHEN** 直接用 `memex search` 在某个库目录下检索
- **THEN** 能检索到本插件写入的卡片

#### Scenario: 卡片可由 Obsidian 打开
- **WHEN** 用 Obsidian 打开某库的 `cards/` 目录
- **THEN** 卡片正常显示，`[[链接]]` 被识别为双链

### Requirement: 不引入向量检索

系统 SHALL 使用 memex 的默认关键词检索路径，MUST NOT 启用 `--semantic`，MUST NOT
引入 embedding、向量库或任何模型侧外发。默认路径 SHALL 零网络外发。

#### Scenario: 检索不走语义路径
- **WHEN** 执行 `memory_search`
- **THEN** 底层调用不携带 `--semantic`，不产生 embedding 请求
