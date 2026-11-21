## REMOVED Requirements

### Requirement: 不引入向量检索

**Reason**: 现有规划材料没有记录这条禁令之外的论证：它在 `archive/2026-09-20-dsh-memex-scoped-memory/design.md:57` 的「不做」清单里以「默认关键词路径零外发」出现，同次归档的 delta 直接写成了 MUST NOT。本 change 改为约束它实际要保护的性质：卡片内容不越出库的访问权限边界。另外，现有实现已偏离该要求：插件 `memex_search` 接受 `semantic` 参数并原样传给内核，没有任何来源检查。

**Migration**: 默认检索仍是内核关键词路径。插件对语义检索请求改为在参数层整体拒绝，不调用内核；原有测试「semantic 查询原样透传」改为断言拒绝且内核调用数为 0。工具描述仍逐字沿用内核。

## ADDED Requirements

### Requirement: 检索后端的来源边界与更换条件

系统 SHALL 以内核关键词路径为默认且唯一启用的检索后端。

本要求的完整约束列于首个场景末尾，对本要求的全部适用情形均有效。

#### Scenario: 默认路径不带语义开关
- **GIVEN** 未请求语义检索
- **WHEN** 通过插件执行 `memex_search`
- **THEN** 传给内核的参数不含 `--semantic`

**本要求的完整约束（适用于全部场景）：**

系统 SHALL 以内核关键词路径为默认且唯一启用的检索后端。

任何检索后端 MUST NOT 把卡片内容或查询送到比该库访问权限更低的接收方。本 change 不启用任何向量来源：插件 `memex_search` 收到 `semantic: true` 时，SHALL 在调用任何目标库的内核之前，把整次调用作为参数错误拒绝。错误信息 SHALL 说明「语义检索当前未启用」及原因。该拒绝作用于所有目标 scope，不按库逐个判定，也不进入「单库失败返回其余库结果」的部分失败语义，因为它不是某个库的失败。

今后启用任何向量来源（包括本地模型），须由单独的 change 定义：来源判定、配置在判定与执行之间的一致性、模型获取过程不携带卡片内容，以及评测证据。

威胁模型：本要求防范的是配置失误和进程环境中残留的远端凭据导致的外发，不防范能够修改本机环境变量或库目录文件的人；后者本已能直接读取卡片。

更换默认后端 SHALL 伴随一份离线检索套件的完整报告，报告路径记录在对应 change 中，并写明质量判据。后端成本 SHALL 随评测报告呈现，MUST NOT 单独作为拒绝某后端的判据。

#### Scenario: 语义请求在环境有远端 key 时零调用
- **GIVEN** 进程环境设置了 `OPENAI_API_KEY`，库没有 `.memexrc`
- **WHEN** 模型调用 `memex_search` 并传 `semantic: true`
- **THEN** 工具返回错误，信息含「语义检索当前未启用」，替身内核的调用次数为 0

#### Scenario: 多库语义请求整体拒绝
- **GIVEN** 当前 scope 与另一个 scope 都可检索
- **WHEN** 模型以 `scope: "all"` 和 `semantic: true` 调用 `memex_search`
- **THEN** 工具返回参数错误，没有返回任何 hits，替身内核对两个库的调用次数都为 0

#### Scenario: 语义请求不写召回遥测
- **GIVEN** 记录调用前召回遥测文件的大小
- **WHEN** 一次语义请求被拒绝
- **THEN** 遥测文件大小不变

## MODIFIED Requirements

### Requirement: `scope` 参数只加在语义允许跨库的工具上

系统 SHALL 只在操作对象是「一张卡片或一次查询」的工具上提供 `scope` 参数，其取值为
`current`（默认）、`all`，或一个具体的 scope 名。

对操作对象是「整个卡片网络或索引」的工具（召回、网络分析、归档、链接统计），系统
MUST NOT 提供 `scope` 参数，它们 SHALL 始终作用于当前 scope。理由是这类操作的结果是
单库的结构性事实——跨库聚合孤儿、枢纽或索引不产生有意义的语义。

不传 `scope` 时，工具行为 SHALL 与不含本层时的内核原生行为一致；唯一例外是「检索后端的来源边界与更换条件」要求拒绝的语义检索请求。

#### Scenario: 召回不带 scope 参数
- **WHEN** 模型获取工具清单
- **THEN** 召回工具的参数中不含 `scope`

#### Scenario: 检索与写入带 scope 参数
- **WHEN** 模型获取工具清单
- **THEN** 检索、读取与写入类工具的参数中含可选的 `scope`

#### Scenario: 不传 scope 时行为与内核原生一致
- **WHEN** 调用任一工具且不传 `scope`，且不是被拒绝的语义检索请求
- **THEN** 该次调用只作用于当前 scope 的库，行为与不含本层时一致

#### Scenario: 被拒绝的语义请求是唯一例外
- **GIVEN** 不传 `scope`
- **WHEN** 调用 `memex_search` 并传 `semantic: true`
- **THEN** 调用被拒绝，内核未被调用；这与内核原生行为不同，属于本要求声明的例外
