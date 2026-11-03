## Test Plan

测试名采用 vitest 的 `describe(要求名) › it(场景名)`，下表的 Test Name 列为 `要求名前 12 字 › 场景名`。场景共 67 个，每个对应一个测试。

| Requirement | Scenario | Test File | Test Name | Initial State |
|-------------|----------|-----------|-----------|---------------|
| specs/dsh-memex-evaluation/spec.md → 检索评测的文件系统边界 | 普通库制作快照且原库不变 | packages/dsh-memex/test/eval-retrieval-fs.test.ts | `检索评测的文件系统边界 › 普通库制作快照且原库不变` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 检索评测的文件系统边界 | 软链接卡片在打开前被拒绝 | packages/dsh-memex/test/eval-retrieval-fs.test.ts | `检索评测的文件系统边界 › 软链接卡片在打开前被拒绝` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 检索评测的文件系统边界 | 硬链接与特殊文件被拒绝 | packages/dsh-memex/test/eval-retrieval-fs.test.ts | `检索评测的文件系统边界 › 硬链接与特殊文件被拒绝` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 检索评测的文件系统边界 | 评测根经别名落入某个库时被拒绝 | packages/dsh-memex/test/eval-retrieval-fs.test.ts | `检索评测的文件系统边界 › 评测根经别名落入某个库时被拒绝` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 检索评测的文件系统边界 | 评测根是指向未初始化库的软链接时被拒绝 | packages/dsh-memex/test/eval-retrieval-fs.test.ts | `检索评测的文件系统边界 › 评测根是指向未初始化库的软链接时被拒绝` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 检索评测的文件系统边界 | 祖先中只有名字相近的目录时通过 | packages/dsh-memex/test/eval-retrieval-fs.test.ts | `检索评测的文件系统边界 › 祖先中只有名字相近的目录时通过` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 检索评测的文件系统边界 | 已存在的运行目录不被覆盖 | packages/dsh-memex/test/eval-retrieval-fs.test.ts | `检索评测的文件系统边界 › 已存在的运行目录不被覆盖` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 检索评测的文件系统边界 | 干扰卡与已有 slug 同名被拒绝 | packages/dsh-memex/test/eval-retrieval-fs.test.ts | `检索评测的文件系统边界 › 干扰卡与已有 slug 同名被拒绝` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 快照不可变输入清单与元卡排除 | 默认规则排除元卡并列出 | packages/dsh-memex/test/eval-retrieval-snapshot.test.ts | `快照不可变输入清单与元卡 › 默认规则排除元卡并列出` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 快照不可变输入清单与元卡排除 | 非白名单配置不进入快照 | packages/dsh-memex/test/eval-retrieval-snapshot.test.ts | `快照不可变输入清单与元卡 › 非白名单配置不进入快照` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 快照不可变输入清单与元卡排除 | 声明哈希不符拒绝运行 | packages/dsh-memex/test/eval-retrieval-snapshot.test.ts | `快照不可变输入清单与元卡 › 声明哈希不符拒绝运行` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 快照不可变输入清单与元卡排除 | 运行中改卡或多出文件则整轮无效 | packages/dsh-memex/test/eval-retrieval-snapshot.test.ts | `快照不可变输入清单与元卡 › 运行中改卡或多出文件则整轮无效` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → gold set 契约与选集 | 混合集合文件按选集运行 | packages/dsh-memex/test/eval-retrieval-goldset.test.ts | `gold set 契约与 › 混合集合文件按选集运行` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → gold set 契约与选集 | 同主题跨集合被拒绝 | packages/dsh-memex/test/eval-retrieval-goldset.test.ts | `gold set 契约与 › 同主题跨集合被拒绝` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → gold set 契约与选集 | 文件级错误定位到根 | packages/dsh-memex/test/eval-retrieval-goldset.test.ts | `gold set 契约与 › 文件级错误定位到根` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → gold set 契约与选集 | 题级错误定位到 id 与字段 | packages/dsh-memex/test/eval-retrieval-goldset.test.ts | `gold set 契约与 › 题级错误定位到 id 与字段` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → gold set 契约与选集 | 目标卡不存在时报出 slug | packages/dsh-memex/test/eval-retrieval-goldset.test.ts | `gold set 契约与 › 目标卡不存在时报出 slug` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → gold set 契约与选集 | 未指定或选空集合被拒绝 | packages/dsh-memex/test/eval-retrieval-goldset.test.ts | `gold set 契约与 › 未指定或选空集合被拒绝` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 评测检索与插件关键词路径一致 | 评测与插件工具的内核参数一致 | packages/dsh-memex/test/eval-retrieval-parity.test.ts | `评测检索与插件关键词路径 › 评测与插件工具的内核参数一致` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 评测检索与插件关键词路径一致 | nestedSlugs 库返回带前缀的 slug | packages/dsh-memex/test/eval-retrieval-parity.test.ts | `评测检索与插件关键词路径 › nestedSlugs 库返回带前缀的 slug` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 评测检索与插件关键词路径一致 | 未知后端被拒绝 | packages/dsh-memex/test/eval-retrieval-parity.test.ts | `评测检索与插件关键词路径 › 未知后端被拒绝` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 评测检索与插件关键词路径一致 | 评测不写遥测 | packages/dsh-memex/test/eval-retrieval-parity.test.ts | `评测检索与插件关键词路径 › 评测不写遥测` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 冻结观测与离线重算 | 删除快照并换环境后离线重算一致 | packages/dsh-memex/test/eval-retrieval-freeze.test.ts | `冻结观测与离线重算 › 删除快照并换环境后离线重算一致` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 冻结观测与离线重算 | 中途出错的题保留在分母 | packages/dsh-memex/test/eval-retrieval-freeze.test.ts | `冻结观测与离线重算 › 中途出错的题保留在分母` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 冻结观测与离线重算 | 返回字符数按协议计算 | packages/dsh-memex/test/eval-retrieval-freeze.test.ts | `冻结观测与离线重算 › 返回字符数按协议计算` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 冻结观测与离线重算 | invalid 轮次删除快照后重算仍为 invalid | packages/dsh-memex/test/eval-retrieval-freeze.test.ts | `冻结观测与离线重算 › invalid 轮次删除快照后重算仍为 invalid` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 冻结观测与离线重算 | 干扰卡计数可离线重算 | packages/dsh-memex/test/eval-retrieval-freeze.test.ts | `冻结观测与离线重算 › 干扰卡计数可离线重算` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 冻结观测与离线重算 | 冻结观测被篡改则拒绝重算 | packages/dsh-memex/test/eval-retrieval-freeze.test.ts | `冻结观测与离线重算 › 冻结观测被篡改则拒绝重算` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 冻结观测与离线重算 | 未知协议版本拒绝重算 | packages/dsh-memex/test/eval-retrieval-freeze.test.ts | `冻结观测与离线重算 › 未知协议版本拒绝重算` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 指标定义 | 已知返回列表得到预期指标 | packages/dsh-memex/test/eval-retrieval-metrics.test.ts | `指标定义 › 已知返回列表得到预期指标` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 指标定义 | 多个可接受目标任一命中 | packages/dsh-memex/test/eval-retrieval-metrics.test.ts | `指标定义 › 多个可接受目标任一命中` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 指标定义 | 空结果不计入误选 | packages/dsh-memex/test/eval-retrieval-metrics.test.ts | `指标定义 › 空结果不计入误选` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 成本与指标同表报告 | 成本列存在且不影响状态 | packages/dsh-memex/test/eval-retrieval-cost.test.ts | `成本与指标同表报告 › 成本列存在且不影响状态` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 成本与指标同表报告 | 单题套件的分位数为 unknown | packages/dsh-memex/test/eval-retrieval-cost.test.ts | `成本与指标同表报告 › 单题套件的分位数为 unknown` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 固定自检的目标卡召回名次诊断 | 目标卡在第二位被记录 | packages/dsh-memex/test/eval-rank-diagnostic.test.ts | `固定自检的目标卡召回名次 › 目标卡在第二位被记录` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 固定自检的目标卡召回名次诊断 | 空 recall 记为未召回 | packages/dsh-memex/test/eval-rank-diagnostic.test.ts | `固定自检的目标卡召回名次 › 空 recall 记为未召回` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 固定自检的目标卡召回名次诊断 | 空 recall 的 current 不符时为 unknown | packages/dsh-memex/test/eval-rank-diagnostic.test.ts | `固定自检的目标卡召回名次 › 空 recall 的 current 不符时为 unknown` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 固定自检的目标卡召回名次诊断 | 其他库的同名卡不算召回 | packages/dsh-memex/test/eval-rank-diagnostic.test.ts | `固定自检的目标卡召回名次 › 其他库的同名卡不算召回` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 固定自检的目标卡召回名次诊断 | 索引正文中的标题与坏格式 | packages/dsh-memex/test/eval-rank-diagnostic.test.ts | `固定自检的目标卡召回名次 › 索引正文中的标题与坏格式` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 固定自检的目标卡召回名次诊断 | 旧轮次仅凭冻结产物补算 | packages/dsh-memex/test/eval-rank-diagnostic.test.ts | `固定自检的目标卡召回名次 › 旧轮次仅凭冻结产物补算` | 🔴 red |
| specs/dsh-memex-evaluation/spec.md → 固定自检的目标卡召回名次诊断 | 无记忆与证据缺失分别标注 | packages/dsh-memex/test/eval-rank-diagnostic.test.ts | `固定自检的目标卡召回名次 › 无记忆与证据缺失分别标注` | 🔴 red |
| specs/dsh-memex-memory/spec.md → 检索后端的来源边界与更换条件 | 默认路径不带语义开关 | packages/dsh-memex/test/tools-semantic-reject.test.ts | `检索后端的来源边界与更换 › 默认路径不带语义开关` | 🔴 red |
| specs/dsh-memex-memory/spec.md → 检索后端的来源边界与更换条件 | 语义请求在环境有远端 key 时零调用 | packages/dsh-memex/test/tools-semantic-reject.test.ts | `检索后端的来源边界与更换 › 语义请求在环境有远端 key 时零调用` | 🔴 red |
| specs/dsh-memex-memory/spec.md → 检索后端的来源边界与更换条件 | 多库语义请求整体拒绝 | packages/dsh-memex/test/tools-semantic-reject.test.ts | `检索后端的来源边界与更换 › 多库语义请求整体拒绝` | 🔴 red |
| specs/dsh-memex-memory/spec.md → 检索后端的来源边界与更换条件 | 语义请求不写召回遥测 | packages/dsh-memex/test/tools-semantic-reject.test.ts | `检索后端的来源边界与更换 › 语义请求不写召回遥测` | 🔴 red |
| specs/dsh-memex-memory/spec.md → `scope` 参数只加在语义允许跨库的工具上 | 召回不带 scope 参数 | packages/dsh-memex/test/tools.test.ts | ``scope` 参数只加 › 召回不带 scope 参数` | 🔴 red |
| specs/dsh-memex-memory/spec.md → `scope` 参数只加在语义允许跨库的工具上 | 检索与写入带 scope 参数 | packages/dsh-memex/test/tools.test.ts | ``scope` 参数只加 › 检索与写入带 scope 参数` | 🔴 red |
| specs/dsh-memex-memory/spec.md → `scope` 参数只加在语义允许跨库的工具上 | 不传 scope 时行为与内核原生一致 | packages/dsh-memex/test/tools.test.ts | ``scope` 参数只加 › 不传 scope 时行为与内核原生一致` | 🔴 red |
| specs/dsh-memex-memory/spec.md → `scope` 参数只加在语义允许跨库的工具上 | 被拒绝的语义请求是唯一例外 | packages/dsh-memex/test/tools.test.ts | ``scope` 参数只加 › 被拒绝的语义请求是唯一例外` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 会话开始即知道有记忆 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 会话开始即知道有记忆` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 注入包含第一段写法要求 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 注入包含第一段写法要求` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 注入提示声明召回意图 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 注入提示声明召回意图` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 注入提示使用时修订过期卡片 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 注入提示使用时修订过期卡片` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 注入提示评测类卡片不贴查询原文 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 注入提示评测类卡片不贴查询原文` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 评测提示不拦截写入 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 评测提示不拦截写入` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 修订提示不改变写入行为 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 修订提示不改变写入行为` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 本地附加不改变上游方法论 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 本地附加不改变上游方法论` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 注入与工具解析一致 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 注入与工具解析一致` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 注入不写卡片 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 注入不写卡片` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 会话开始时注入召回引导 | 注入失败不阻断会话 | packages/dsh-memex/test/lifecycle.test.ts | `会话开始时注入召回引导 › 注入失败不阻断会话` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 关键词检索前对查询中的连续汉字做分段 | 无相关卡片时允许返回低分候选 | packages/dsh-memex/test/query-segment.test.ts | `关键词检索前对查询中的连 › 无相关卡片时允许返回低分候选` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 关键词检索前对查询中的连续汉字做分段 | 噪声不挤占真实命中 | packages/dsh-memex/test/query-segment.test.ts | `关键词检索前对查询中的连 › 噪声不挤占真实命中` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 关键词检索前对查询中的连续汉字做分段 | 中文自然语言提问可召回 | packages/dsh-memex/test/query-segment.test.ts | `关键词检索前对查询中的连 › 中文自然语言提问可召回` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 关键词检索前对查询中的连续汉字做分段 | 纯 ASCII 查询不受影响 | packages/dsh-memex/test/query-segment.test.ts | `关键词检索前对查询中的连 › 纯 ASCII 查询不受影响` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 关键词检索前对查询中的连续汉字做分段 | 代码 token 在混合查询中保持完整 | packages/dsh-memex/test/query-segment.test.ts | `关键词检索前对查询中的连 › 代码 token 在混合查询中保持完整` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 关键词检索前对查询中的连续汉字做分段 | 语义检索不做分段 | packages/dsh-memex/test/query-segment.test.ts | `关键词检索前对查询中的连 › 语义检索不做分段` | 🔴 red |
| specs/dsh-memex-integration/spec.md → 关键词检索前对查询中的连续汉字做分段 | 卡片与库不被改写 | packages/dsh-memex/test/query-segment.test.ts | `关键词检索前对查询中的连 › 卡片与库不被改写` | 🔴 red |

## Coverage Notes

- **夹具**：全部为自造的最小夹具，在临时 HOME 下构造库、软链接、硬链接与命名管道（Windows 上跳过管道与软链接用例，并在测试里注明原因）。不使用真实卡库与 gold set。
- **替身内核**：记录参数数组、环境与调用次数，并按用例返回预设的 stdout。「读取前拒绝」的断言通过注入记录 open 调用的文件操作层完成，不依赖 atime。
- **真实内核用例**：只有 parity 测试中的 nestedSlugs 用例调用本机已安装的内核；内核不可用时跳过并注明原因，不算通过。
- **已有测试的调整**：`test/tools.test.ts` 里「passes the query through unchanged for semantic search」改为断言拒绝且内核调用数为 0；工具描述含 `semantic=true` 的断言保持不变（描述逐字沿用内核）。
- **integration 中的叠加场景**：「会话开始时注入召回引导」的既有场景已有测试；这里只新增两条（注入提示、不拦截写入），其余行在 apply 时沿用现有测试名，确认为绿后直接标 🟢。
- **残余风险**（design Risks，用户已接受）：没有对应测试。
