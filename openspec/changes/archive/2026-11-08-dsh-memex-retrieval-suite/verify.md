# Verification: dsh-memex-retrieval-suite

日期：2026-11-03。实现与可执行验收通过；20 题完整基线和归档前置检查仍未关闭。未重启 Host、未启动新模型自检、未推送源码。

## 实现与覆盖

- 插件在解析当前库、选库及启动内核之前拒绝 `semantic: true`；默认关键词路径抽出共享参数构造函数。生成的上游工具描述保持一致。
- 离线 CLI 只支持 lexical；从普通独立源文件制作私有快照，白名单配置、排除元卡、校验 gold set、冻结观测与完整性后输出报告；重算只读取冻结数据。
- 自检诊断读取冻结的 attempt 与 collected-tool-results，核验 scope/home；只补目标卡是否召回及最好名次，不改变评分、夹具或版本哈希。
- 注入引导提示评测类卡片引用题号或 gold set 路径，避免复制查询原文。
- [test-plan.md](test-plan.md) 的 67 个场景全部有真实测试映射并通过。映射检查确认测试文件存在、记录的测试名称实际存在；不再使用截断或虚构的名称。
- 改变的行为先以成功导入后的断言失败验证，再实现通过。既有参数与生命周期兼容性测试首次即绿，未伪造红阶段。`评测提示不拦截写入` 属于此类兼容性证据。

主要入口：[CLI](../../../../packages/dsh-memex/src/cli/eval-retrieval.ts)、[运行器](../../../../packages/dsh-memex/src/eval/retrieval/run.ts)、[快照](../../../../packages/dsh-memex/src/eval/retrieval/snapshot.ts)、[指标](../../../../packages/dsh-memex/src/eval/retrieval/metrics.ts)、[冻结重算](../../../../packages/dsh-memex/src/eval/retrieval/freeze.ts)、[名次诊断](../../../../packages/dsh-memex/src/eval/rank-diagnostic.ts)。

## 实际检查

| 检查 | 最终结果 | 本机证据 |
| --- | --- | --- |
| `MEMEX_TEST_LIVE_CONNECTION=1 npm test`（package） | 133 文件，902 测试通过，0 跳过，0 失败 | `/tmp/memex-retrieval-package-final3.log` |
| package typecheck | 通过 | `/tmp/memex-retrieval-typecheck-final3.log` |
| `npm run check:descriptions` | 与 `@touchskyer/memex@0.4.1` 一致 | `/tmp/memex-retrieval-descriptions-final3.log` |
| 根目录 `npm test` | 707 项：704 通过、0 失败、3 项原有跳过 | `/tmp/memex-retrieval-root-final2.log` |
| `npm run check:artifacts` | 通过 | 实际运行，未跟踪构建产物 |
| `openspec validate dsh-memex-retrieval-suite --strict` | 通过 | 实际运行 |
| `git diff --check` | 通过 | 实际运行 |
| 第一次 `dsh build` | 退出 0，构建并原子安装本地 package | `/tmp/memex-retrieval-build1.log` |
| 连续第二次 `dsh build` | 退出 0，`no changes — deployment already matches manifest` | `/tmp/memex-retrieval-build2.log` |

live 测试只验证现有 Host 对未鉴权/跨源请求的拒绝，不创建会话或模型。根目录三项既有跳过分别是两个要求精确 MCP 集成依赖的探针和一个 Linux 专属 SIGKILL 测试；本机为 macOS。本 change 新增测试没有跳过，真实内核 nestedSlugs 场景已实际执行。

最初根目录失败的历史审查 Markdown 相对链接已修正；新增 CLI 后构建权限测试的固定夹具漏掉新入口，也已补齐并在根目录全量重跑通过。没有放宽断言。

部署后抽查 tools/index、tools/search-args、lifecycle/index、cli/eval-retrieval、eval/retrieval/run、eval/rank-diagnostic 六份 JS 与仓库构建产物 SHA-256 均一致；部署文件内可见语义请求拒绝与新引导句。新 CLI 的 npm bin 链接真实可执行。运行中的 Host 未重启，不能据此声称其工具已切换到新实现。

## 代码审查与修复

按不同职责成员只读审查与 lead 实际代码复核收口，未宣称跨模型审查。发现并修复了：

1. 运行目录与快照模块重复创建目录；nestedSlugs 为 false 时错误保留路径前缀；已排除原卡未参与干扰卡冲突；清单排序依赖 locale；路径预检吞掉非 ENOENT 错误。
2. npm bin 经符号链接启动时入口未执行；版本字段错误使用生成常量；运行前完整性失败仍启动检索；未选集合的目标未参与干扰卡冲突。四个真实行为反例先失败，再通过。
3. gold set 和干扰卡误拒绝内核支持的下划线、点号、大写和中文 slug。已共用安全校验，保留本 spec 额外的路径限制。
4. 类别正则漏掉 quoted key/Unicode 转义，并在初修中误读嵌套或 block 内 category。最终只读取根映射字段，无法明确判断的类别形态在运行前拒绝；不引入通用 YAML 框架或新依赖。

最终只读复核对 category 的六个独立内存断言全部通过，slug 发现亦关闭；审查范围无剩余 blocking。相关边界、快照、gold set 三份测试最终 30/30 通过，并纳入 902 项全量。

部分摘要式 Jev review 因置信度不足返回 escalate、没有具体反例；未把它们写成自动通过，也未据此停工或要求用户重复批准。上述结论来自实际代码、具体反例、测试和人工复核。

## 私有种子基线（2026-11-03 历史记录）

当时原 20 题 seed 只有 9 题具有既有目标标注，其余 11 题仍待确认。未从返回排名反推目标，也未扩充或虚构 gold。使用已标注的 9 题生成私有 dev 输入；已有标注中部分仍是历史推断，未把它们升级为人工封闭的可靠 oracle。因此当时 task 8.3 的“20 题完整基线”保持未勾选；11-08 的补齐记录见下节。

- gold set：`~/.dsh-memex-eval/retrieval-goldset/seed-9-labeled-dev-2026-11-03.json`。
- 运行：`~/.dsh-memex-eval/retrieval/4d7db0d1-0400-4ac9-9d92-1ccc8f72c04f/`。
- 状态 `ok`；内核 `0.4.1`；K=10；快照 1095 个清单文件，排除 5 张卡；无人工干扰卡。
- 清单整体 SHA-256：`c14518294f298994df4c387306af6e56d8a4f4865c295fcdebdee501e06409e9`。

| 指标 | 实测 |
| --- | --- |
| hit@1 / hit@3 / hit@10 | 均为 6/9（66.7%） |
| MRR | 0.667 |
| 空结果率 | 0/9 |
| 误选率 | 3/9（33.3%） |
| 未召回目标的题号 | probe-01、probe-06、probe-07 |
| 每题进程启动在内的 p50 / p95 | 232.3 / 343.1 ms |
| 返回字符数中位数 | 5308，9 题参与 |
| 内核安装大小 / 快照大小 | 85,629,442 / 1,655,375 bytes |

全部为 single-hop 标签，multi-hop 无样本。报告明确标注“样本不足，只看趋势”。这是当前快照的检索观测，不能证明模型使用了记忆、节省了工作或改善了总体效果。

`report/report.md` 列出完整排除规则、5 张排除卡及逐文件哈希，供用户复核。`acceptance-audit.json` 对调用紧邻的运行前后 1157 个源文件记录内容哈希、大小和 mtime：无变化；真实召回遥测亦无变化。开发期间曾有一张已过期 CJK 卡被成员修订，其他会话也有写卡活动；这些发生在本次运行边界外，不能把“本 CLI 无写入”表述为“整项开发期间记忆库未变”。

从本轮复制的 frozen.json 单独建立 replay 目录，没有 snapshot，并把 MEMEX_HOME 指向不存在的库：已部署 CLI 离线重算退出 0，报告 JSON 与原始报告完全相同。replay 目录为 `~/.dsh-memex-eval/retrieval/replay-c04af2dc-5ee7-4c25-9682-afa39dfd368f/`。原轮次与原报告未覆盖。

## 20 题目标补齐与正式基线（2026-11-08）

[完整脱敏记录与排除清单](checking/summary.md)记录独立语义目标确认、输入版本、指标、七张排除卡与读取限制。先冻结 personal 1,361 张卡片，再由未见本轮排名/实现的独立会话对 20 题逐项按原文确认目标，核对 37 段引文及 20 个目标内容 hash；种子自带历史提示/汇总数字曾被看到的限制也明确披露，没有升级成纯盲出题或 holdout。

正式运行目录为 `~/.dsh-memex-eval/retrieval/37d8a8c5-f483-4d2b-ab45-e33c681fea0a/`，退出 0、状态 ok，前后快照完整性均有效。排除 7 张后保留 1,354 张卡，清单 hash `2135510732e10647dac366d007e0df5c27e974f00d70c24cd1fcf08fb3555264`。hit@1/3/10 为 13/14/16（分母20），MRR 0.6931，空结果0/20，误选7/20；p50/p95 243.4/264.8ms，chars-v1中位数5,567。正式离线重算退出0，实际新生成的 report JSON 与原 report JSON 逐字节/结构均相同。

8.3 现已完成，开发集偏差、single-hop 小样本与版本边界继续有效。不同快照与目标确认过程使它不能与上节旧9题直接比较改进，更不能证明总体收益。没有修改默认后端、原卡库、生产配置，亦未重启日常 Host。

## 旧自检兼容

只读补算两个历史 selftest-v1 轮次，未启动 Host 调用或模型：

| 轮次 | 诊断与原判定 | 冻结产物 |
| --- | --- | --- |
| round-34bbf914-cb38-45a3-bf42-e439c624523b | know-mem 目标名次 1；其余缺证保持 unknown；原评分仍未完成，CLI 退出 1 | 30 个文件哈希不变 |
| round-9fd9a885-4198-4907-9dc9-6acf263dadda | 三个 mem 条件目标名次均为 1；原 fail/unknown 不变，CLI 退出 1 | 164 个文件哈希不变 |

退出 1 是历史轮次仍有 fail/unknown 的如实报告，不是读取/格式错误；退出 2 才表示证据或参数错误。报告及审计存于 `~/.dsh-memex-eval/retrieval/selftest-compatibility-20261103/`。没有改写原冻结文件、程序证据、夹具或评分。

## 尚未关闭的边界

- task 8.3 已于 2026-11-08 补齐，原9题运行作为历史记录保留，不再描述为当前未完成项。
- task 8.5 已于 2026-11-08 完成：两个前置观察 change 均先行归档；核对固定底文的全部原约束和场景后，因主规范长描述排版调整重新生成 integration delta，再同步本 change 并归档。原 fix-stale delta SHA-256 保持 5b82428fb61ae123f9af279e6108340c988c4ef9b7611a43c710c98145804c40。
- 已接受的路径残余风险沿用 review 中的明确人工裁决：不读取 Host 配置时，不能识别配置中尚未初始化且 home 与评测根直接重叠的库。不是审查者已接受 RC1/RC2 的宣称。
- 2026-11-03 的 build/sync 记录没有包含日常 Host 重启；本轮专用原生 Host 已实际加载后继 0.4.7，但不把该隔离实例当作日常运行回执。本次归档未要求或执行生产部署与日常重启。
