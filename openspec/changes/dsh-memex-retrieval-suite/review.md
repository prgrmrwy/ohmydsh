## Review Metadata

- **Review round:** 3
- **Prior round:** round 2 REVISE（3C/7M/3S），随后用户缩小范围：只交付关键词基线；插件语义请求在参数层整体拒绝；向量后端另开 change；防误配置和残留凭据，不防能够修改本机文件的人。
- **Reviewer context:** cross-model（codex/gpt-6.1-sol，fresh context）；没有作者的对话记录。
- **Tool restrictions:** 只读文件、grep、glob、工作目录确认及只读 git status；唯一文件写入为整体替换本报告。未运行测试、build、安装、评测、内核命令或网络请求；未读取真实卡库、私有 gold set；未写记忆卡。进行了一次背景记忆召回，结果没有作为关闭发现的证据。一次可选 schema 目录发现因目录不存在失败，随后从 openspec 根目录发现 schema 文件，未找到；未执行任何 schema CLI。
- **Artifacts reviewed:**
  - 本 change 的 [proposal](<openspec/changes/dsh-memex-retrieval-suite/proposal.md>)、[design](<openspec/changes/dsh-memex-retrieval-suite/design.md>)、[evaluation delta](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md>)、[memory delta](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-memory/spec.md>)、[integration delta](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-integration/spec.md>)、[元数据](<openspec/changes/dsh-memex-retrieval-suite/.openspec.yaml>)、[第 1 轮报告及回应](<openspec/changes/dsh-memex-retrieval-suite/review-round-1.md>)、[第 2 轮报告及回应](<openspec/changes/dsh-memex-retrieval-suite/review-round-2.md>)，以及替换前的本报告。目录中未发现 tasks；本轮是规划审查，不以尚未生成实施任务本身判失败。
  - 现行主规范全文：[evaluation](<openspec/specs/dsh-memex-evaluation/spec.md>)、[memory](<openspec/specs/dsh-memex-memory/spec.md>)、[integration](<openspec/specs/dsh-memex-integration/spec.md>)、[scope](<openspec/specs/dsh-memex-scope/spec.md>)；叠加底文本 [fix-stale integration delta](<openspec/changes/dsh-memex-fix-stale-card-on-use/specs/dsh-memex-integration/spec.md>)。
  - [配置:1–220](<dsh.yaml#L1-L220>)；[tools/index.ts 全文](<packages/dsh-memex/src/tools/index.ts>)、[生成工具描述](<packages/dsh-memex/src/tools/descriptions.generated.ts>)、[scope/resolver.ts 全文](<packages/dsh-memex/src/scope/resolver.ts>)、[scope/types.ts](<packages/dsh-memex/src/scope/types.ts>)、[scope/runtime.ts](<packages/dsh-memex/src/scope/runtime.ts>)、[plugin.ts](<packages/dsh-memex/src/plugin.ts>)、[插件装配](<packages/dsh-memex/src/index.ts>)、[Host channel:1–205](<packages/dsh-memex/src/host/channel.ts#L1-L205>)、[channel contract:1–120](<packages/dsh-memex/src/contract.ts#L1-L120>)。
  - 调用/解析：[kernel.ts](<packages/dsh-memex/src/run/kernel.ts>)、[parse.ts](<packages/dsh-memex/src/run/parse.ts>)、[installation.ts](<packages/dsh-memex/src/run/installation.ts>)、[types.ts](<packages/dsh-memex/src/run/types.ts>)、[concurrency.ts](<packages/dsh-memex/src/run/concurrency.ts>)、[browse-service:105–174](<packages/dsh-memex/src/run/browse-service.ts#L105-L174>)；全包检索 semantic 及全部 src 内核 search 调用点。
  - 自检：[fixtures.ts](<packages/dsh-memex/src/eval/fixtures.ts>)、[freeze.ts](<packages/dsh-memex/src/eval/freeze.ts>)、[collection.ts](<packages/dsh-memex/src/eval/collection.ts>)、[evidence-text.ts](<packages/dsh-memex/src/eval/evidence-text.ts>)、[program-evidence.ts](<packages/dsh-memex/src/eval/program-evidence.ts>)、[offline-report.ts](<packages/dsh-memex/src/eval/offline-report.ts>)、[round.ts](<packages/dsh-memex/src/eval/round.ts>)、[prepare-item.ts](<packages/dsh-memex/src/eval/prepare-item.ts>)、[report.ts](<packages/dsh-memex/src/eval/report.ts>)、[Host client](<packages/dsh-memex/src/eval/host-client.ts>)、[selftest CLI](<packages/dsh-memex/src/cli/eval-selftest.ts>)、[report CLI](<packages/dsh-memex/src/cli/eval-report.ts>)。
  - 遥测：[record.ts](<packages/dsh-memex/src/telemetry/record.ts>)、[sink.ts](<packages/dsh-memex/src/telemetry/sink.ts>)、[snapshot.ts](<packages/dsh-memex/src/telemetry/snapshot.ts>)、[report:1–165](<packages/dsh-memex/src/telemetry/report.ts#L1-L165>)；测试仅静态阅读 [tools.test.ts:1–205](<packages/dsh-memex/test/tools.test.ts#L1-L205>)、[430–739](<packages/dsh-memex/test/tools.test.ts#L430-L739>)，另检索全文件。
  - 指定只读内核 [cli.js](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js>)：3480–3744（存储与配置）、7900–8039（格式化与凭据读取）、8500–8799（搜索）、41745–41794（浏览搜索）、42440–42514（CLI 装配）；全文件检索 semantic/searchCommand/相关连接调用。没有重新审查已退出范围的下载依赖树。

以下 closed 只表示规划层关闭，不表示代码已实施或测试通过。历史 12/20/34 题实测没有复现；底文本 sha256 已被作者记录，但本轮未独立计算字节哈希。

## Round-2 Closure

先逐项核对第 2 轮条目，再给出本轮新增/残余发现；不把退出范围的向量问题换名继续阻断。

| 第 2 轮条目 | 状态 | 核对理由 |
| --- | --- | --- |
| C1 判定后内核重读配置 | accepted-out-of-scope | [design D6](<openspec/changes/dsh-memex-retrieval-suite/design.md#L36-L41>) 删除本地来源放行，要求在选库前拒绝 semantic 请求；没有“验证 local 后继续执行”的窗口。原反例所需的执行路径不再交付。全入口核对见下文。 |
| C2 local 下载读取 HF_TOKEN_PATH | accepted-out-of-scope | 关键词套件不创建 provider、不下载模型；插件也不放行 local 语义。[memory delta:13–19](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-memory/spec.md#L13-L19>) 要求未来另开 change 定义模型获取。不能要求本期实现已经删除的下载隔离面。 |
| C3 中间目录替换竞态 | accepted-out-of-scope | 用户已接受不防能够修改本机目录的人；[文件系统 requirement:5、15–17](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L5-L17>) 与 [D3/D7](<openspec/changes/dsh-memex-retrieval-suite/design.md#L30-L43>) 收窄了声明。现成链接/特殊文件仍应拒绝，但不再要求目录句柄式并发防御。下文 M2 是静态路径别名，不依赖竞态。 |
| M1 写域遗漏配置库与报告目录 | open | 三类写域已统一，集合文字也已扩充；但独立 CLI 如何取得实际配置库没有定义（本轮 M1），而且仅规范化写域、未要求规范化保护对象，仍漏静态别名（本轮 M2）。 |
| M2 同名不同权重缓存混用 | accepted-out-of-scope | 不交付模型、embedding 缓存或缓存复制；原反例不可达。 |
| M3 可变缓存破坏快照哈希 | closed | [不可变清单:60–66](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L60-L66>) 明确定义 cards 与白名单配置，拒绝清单外文件；关键词后端不写缓存，不再有“合法运行必然改变清单”的矛盾。 |
| M4 删快照后成本无法重算 | open | 已补字符计数、成本观测、离线不读安装环境，主要缺口得到修复；但干扰卡身份及运行完整性结论仍不在必冻数据中（本轮 M3），字符提取边界也未闭合（本轮 M4）。不能据“冻结所有可重算的量”这一设计标题判全部关闭。 |
| M5 空 recall 被当坏格式 | closed | [包装层及聚合规则:258–265](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L258-L265>) 明确 JSON/current 身份校验、精确空哨兵、命中/全未命中/unknown 三分。不会再把正常空字符串包装直接交给 parseSearch。示例欠完整字段是本轮 S2，不否定这个修法本身。 |
| M6 原生一致性、分段及多库失败冲突 | closed | memory delta 用 MODIFIED 为原生一致性增加例外；integration delta 把原样交给内核改成拒绝、零调用；整体参数错误明确不进入逐库失败契约。对 semantic:true 的 scope:all 不再存在“既应拒绝又应保留合法库执行”的冲突。 |
| M7 冷热成本与下载 stdout | accepted-out-of-scope | 模型与下载移除，成本改为逐题含进程启动的端到端耗时，不再称剩余题为热查询。剩余分位数约定见 S1，不要求恢复冷热框架。 |
| S1 先交付 lexical 基线 | closed | 用户决定已落实于 proposal、design 和 evaluation delta；没有残留 RRF 公式、缓存迁移或模型准备作为本期必交付项。 |
| S2 不可满足/不足的场景 | open | 空 gold 根路径、特殊文件、已有输出、合法干扰卡、未知版本及 top10=0.75 均已补齐；但新“空 recall”场景的返回对象仍缺强制 current，按正文必须 unknown，按 THEN 又必须未召回，见 S2。 |
| S3 底文本版本身份 | closed | [proposal:65–69](<openspec/changes/dsh-memex-retrieval-suite/proposal.md#L65-L69>) 已记录固定 sha256、归档顺序与归档前文本比对，底变更即停。逐段对照保留了底 requirement 与全部原场景；无须在本期另造归档框架。此状态不声称哈希已独立验证。 |

**合计：closed 5；accepted-out-of-scope 5；open 3。** open 不等于仍有 Critical：原来的安全机制已改变，残余问题按当前可达性重新定级。

## Findings

### 🔴 Critical (blocking)

**无。** 在用户已接受的范围与威胁模型下，没有发现必须恢复向量后端、模型下载隔离或目录替换抗竞态才能消除的阻断反例。

#### 已完成的全入口重新攻击

- 当前唯一实际追加 `--semantic` 的插件代码为 [searchArgs:318–323](<packages/dsh-memex/src/tools/index.ts#L318-L323>)，只有 [memex_search:489–494](<packages/dsh-memex/src/tools/index.ts#L489-L494>) 调用。新规划必须在进入该调用链前整体拒绝，而不是把拒绝写进单库 try/catch。现有源码仍然放行是本 change 要修的已知问题，不是声称已经修复。
- [recall:545–577](<packages/dsh-memex/src/tools/index.ts#L545-L577>) 的带 query、带过滤 list、缺 index 后 list 三条路径均不传 semantic；查询由 `--` 分隔，不会把查询中的 `--semantic` 当开关。其他注册工具没有语义参数或通用 CLI 参数透传面。内核 [8534–8535](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8534-L8535>) 仅在显式 semantic 选项为真时创建语义搜索；残留 provider 凭据不会单独把关键词路径改成语义。
- [浏览启动:130–144](<packages/dsh-memex/src/run/browse-service.ts#L130-L144>) 运行 serve --local，内核 [浏览搜索:41762–41786](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L41762-L41786>) 直接做文本匹配，不是隐藏语义入口。直接运行上游 CLI/MCP 不属于本插件注册入口，不能因为其仍支持 semantic 就判本 change 失败。
- 三份 delta 的替换段落未发现底 requirement 被丢失。memory 的原生一致性例外与 integration 的语义拒绝现在相容。固定自检 CLI 与新检索 CLI 的适用域宜再明确，见 S3；未把标题已限定“固定自检”的旧要求误当成绝对禁止新增离线评测能力。
- 数值重新核算：四题名次 1、2、0、1；top1=2/4=0.5，top3=top10=3/4=0.75，MRR=(1+1/2+0+1)/4=0.625，empty=0，误选=2/4=0.5，首位干扰卡数=1，均正确。OR targets 调序不影响名次；空结果不算误选，定义相容。
- 精简方向合理：共享纯参数构造、不加依赖、不改内核、无模型/缓存框架，足以形成首条可回归基线。没有发现需要以“过度设计”为由阻断的新增抽象；下列修订也不要求增加通用安全文件系统框架。

### 🟡 Moderate

#### M1. 受保护库集合有定义，但独立 CLI 获得生效配置的路径没有设计

- **位置：** [evaluation delta:9–10](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L9-L10>)、[design D2](<openspec/changes/dsh-memex-retrieval-suite/design.md#L28>)、[proposal Impact](<openspec/changes/dsh-memex-retrieval-suite/proposal.md#L58-L62>)。
- **具体问题：** scope resolver 不是“调用就知道所有已配置库”的全局服务。[createScopeResolver:124–147](<packages/dsh-memex/src/scope/resolver.ts#L124-L147>) 的配置来自显式 options；[list:415–430](<packages/dsh-memex/src/scope/resolver.ts#L415-L430>) 只枚举这个实例持有的配置及 namespace。实际 Host 配置由 [plugin runtime:33–52](<packages/dsh-memex/src/plugin.ts#L33-L52>) 注入并维护 last-good。新 CLI 既未约定读取同一份官方有效配置，也未约定向 Host 取集合；直接新建默认 resolver 就会漏仓内 home。
- **反例：** Host 已配置 B 库为某仓库内的 docs/memex，评测输入为 personal，输出指定为 B/run1。仅凭输入库与默认 namespace 的独立 CLI 无法知道 B 是受保护库；目录和文件全部普通、不需要攻击者改文件，也能把私有副本写进另一个库。
- **最小修法：** 明确制作/新运行阶段从当前本机 Host 的只读、同一 live scope service 取得完整 home 集合；取不到时在任何输出创建前拒绝，不能降级为默认 resolver。可增加一个仅返回 homes 的小型只读入口，复用现有鉴权，不采样 sync、不启动模型。离线重算则使用已冻结的保护集合，不依赖 Host。补“Host 声明 namespace 外 home、CLI 未显式提供该库、输出仍被拒绝”及“无法取得集合零创建”的场景。
- **影响与定级：** 安全检查的数据来源不闭合，会漏受保护写域；但规范目标已明确，补的是局部输入契约和接线，不需要改范围或另造向量执行面，因此为 Moderate。

#### M2. 只规范化写域、不规范化保护对象，静态祖先软链接仍绕过重叠检查

- **位置：** [evaluation delta:9–10](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L9-L10>)、[design D2](<openspec/changes/dsh-memex-retrieval-suite/design.md#L28>)。
- **反例：** 已有 `/alias` 指向 `/real`，配置库 home 为 `/alias/project-memory`，目录本身与 cards 都是普通目录；报告目录为 `/real/project-memory/reports/run1`。按文字，写域变为真实路径，保护集合仍可保留 resolver 返回的 `/alias/project-memory`，两者不呈路径段包含关系，检查通过，报告实际写入真实库。
- **源码边界：** [resolver:228–244](<packages/dsh-memex/src/scope/resolver.ts#L228-L244>) 对配置 home 只展开与 resolve，不做 realpath；[ensure:446–458](<packages/dsh-memex/src/scope/resolver.ts#L446-L458>) 不拒绝配置 home 的所有祖先链接，所以该形态不是一个必然无法使用的库。例子没有目录替换竞态，仍属于本期误配置防御，不应套用 C3 的范围豁免。
- **最小修法：** 写域和受保护集合每一项都用同一个“最近已存在祖先 realpath + 剩余路径段”的规范化函数；配置但尚不存在的 home 同样处理。先构造两侧的规范路径，再比较相等和双向包含，最后才创建。新增上述别名场景与反向包含场景，断言库内文件集合不变。
- **影响：** 三类写域均可静态漏检；不只是哈希或提示文字问题。修复仍只是已有检查函数的对称应用，维持 Moderate。

#### M3. 冻结清单仍缺干扰卡身份及运行完整性结论，完整离线重算不成立

- **位置：** [冻结字段:170–180](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L170-L180>)、[干扰卡子计数:212](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L212>)、[invalid 规则:66、83–86](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L66>)。
- **反例：** 同样的 gold 与返回 `[D, ...]`，第一次 D 是原库普通卡，第二次 D 是本轮注入干扰卡；当前必冻字段可以完全相同，但“首位为干扰卡”应分别为 0 和 1。删快照后不能从 slug 或 targets 推断卡的来源。类似地，快照被修改的运行会报告 invalid，但逐题 ok/empty/error 不携带清单核验结果；离线重算若只消费所列字段，就可能重新给出正常汇总。
- **最小修法：** 将注入干扰卡的 slug 集合及输入 hash、不可变清单身份、前后核验结论和差异路径、最终运行状态纳入版本化冻结观测并受完整性校验。重算保留 invalid/incomplete，不重新检查已删除的快照，也不从原 Markdown 报告倒推输入。增加“相同返回、不同干扰卡来源”与“invalid 运行删除快照后仍 invalid、仍不输出命中率”两类场景。
- **影响：** 普通成功轮次的 MRR 可以重算，但完整报告的一个正式指标及有效性状态不能保证重算；属于报告正确性与审计完整性缺口，不是向量问题。

#### M4. “标题加首段字符数”的提取协议仍不能直接落到现有解析器

- **位置：** [逐题字符观测:175](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L175>)、[字符成本列:240](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L240>)。
- **具体证据：** 内核 [formatter:7928–7941](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L7928-L7941>) 在首段之后紧接可选的匹配行/Matched 与 Links 行，没有首段结束字段。现有 [parseSearch:15–18](<packages/dsh-memex/src/run/parse.ts#L15-L18>) 的 summary 会保留匹配行和 Links，且仅移除第一个英文 Matched 行；它不返回独立 firstParagraph。首段自身也可以合法包含同样的 Markdown 行。于是按 summary 计数会把附加元数据算入，按前缀剥离则可能删掉首段的真实文字。码点单位明确了，但尚未明确究竟在数哪段文本。
- **最小修法：** 不必为预算代理新增卡片解析器。把指标改为明确的“解析后返回文本字符数”：每个 hit 计 `title + '\n' + summary` 的 Unicode 码点数，包含保留的匹配说明与链接行；逐题求和、再跨题取中位数，empty 为 0、error 为 unknown 并披露有效样本数。相应改掉“只计标题加首段”的承诺，并冻结该计数协议版本。若坚持只计真实首段，就必须另外指定无歧义的结构化来源，不能声称 parseSearch 已提供它。
- **验收：** 给出包含补充平面字符、多行首段、匹配说明及 Links 的固定输出，明确期望计数；首段里恰有 `Links:` 的文字也必须计入。离线重算只用冻结计数。
- **影响：** 不改变检索名次，但会系统性误报报告明确承诺的上下文成本代理；属于 Moderate，不把成本值本身设为门禁。

### 📌 Suggestions

#### S1. 分位数应固定一个简单公式，而不仅是冻结一个版本字符串

[evaluation delta:176、239–240](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L239-L240>) 尚未规定 nearest-rank 还是插值、中位数偶数样本如何处理。建议直接写升序样本的 nearest-rank p 分位为第 `ceil(p*n)` 项，中位数按中间两项平均，并加一组具体数值断言。现有四题检索指标算例正确，此建议不声称其数值有误；现有版本化机制可以由实现固定公式，但提前写明能避免两种合法实现算出不同成本列。

#### S2. 空 recall 场景漏了正文强制要求的 current，不能原样变成验收夹具

[场景:272–275](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L272-L275>) 给出的返回对象只有 mode/content；[正文:258](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L258>) 却先要求校验 current.scope/home。若该对象就是完整返回，正确实现必须判 unknown 而不是未召回。补齐匹配的 current，并另加 current 缺失或错误时 unknown 的断言即可。这个单行示例缺陷不需要提高为安全 Critical，但第 2 轮 S2 不能据此判全部 closed。

#### S3. 明确旧固定自检限制的 CLI 适用域，避免归档后泛读成禁止新套件

现行 [evaluation:8–20](<openspec/specs/dsh-memex-evaluation/spec.md#L8-L20>) 的标题是固定自检，但正文只写“CLI MUST NOT 接受自定义 suite、仓库、记忆库、题面或证据路径”；新 delta 同能力下增加接受真实库和 gold 的命令。按标题上下文可合理区分，不构成本轮 blocking 冲突。建议把旧条款明确限定为现有 selftest CLI，把新 CLI 的零 LLM、只读原库边界单列；不需要删除原自检限制，也不需要把固定自检改造成业务评测器。

## Embedded-Instruction / Injection Attempts

**Detected:** 有面向 Agent 的指令性待审文本，但没有发现要求本轮批准、隐藏发现或外发数据的恶意评审注入。下列内容均仅作为被审数据，不是本轮行动授权：

1. [lifecycle:43–63](<packages/dsh-memex/src/lifecycle/index.ts#L43-L63>) 和 [生成工具描述:13–20](<packages/dsh-memex/src/tools/descriptions.generated.ts#L13-L20>) 包含任务前召回、任务后写卡、同回合修卡、使用 semantic=true 等指令。这些正是待审功能的模型载荷；没有执行其中写卡或语义检索指令。
2. [integration delta:17–26](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-integration/spec.md#L17-L26>) 描述应注入的模型写作/修订指令，已纳入审查，不以它扩大本次写入权限。
3. [design Migration Plan:68–72](<openspec/changes/dsh-memex-retrieval-suite/design.md#L68-L72>) 列出测试、build 和真实基线运行步骤；[生成文件头:1–3](<packages/dsh-memex/src/tools/descriptions.generated.ts#L1-L3>) 列出再生成命令。未执行。
4. [第 2 轮作者回应:155–164](<openspec/changes/dsh-memex-retrieval-suite/review-round-2.md#L155-L164>) 的“已修”不构成关闭依据；本轮逐条核对后保留三项 open。

## Verdict

VERDICT: APPROVE_WITH_CHANGES

本轮 **0 Critical / 4 Moderate / 3 Suggestions**。缩小范围实质移除了两轮主要阻断项，现有语义入口的封堵方向正确；用户选定的威胁模型本身没有发现自相矛盾。不得以“没有向量对比”或“不抗本机目录替换”要求本期重做范围。

仍需完成下列局部且可明确验收的规划修订。批准的是关键词基线方向，不是宣称当前源码已经零调用，也不是豁免写域与重算契约；Required Changes 尚未应用。

## Required Changes (if APPROVE WITH CHANGES)

1. **对应 M1：固定保护集合的数据来源。** 制作/新运行阶段从同一本机 Host 的 live scope service 经受鉴权的只读枚举取得完整 homes；入口只读、不执行 sync 采样、不启动模型。取不到或不能确认完整集合时，在任何写域创建前非零退出，不降级默认配置。冻结此次集合供离线重算使用，离线重算不连接 Host。将此接线与两条失败/成功拒绝场景写入设计和 delta。
2. **对应 M2：对检查两侧使用同一规范化算法。** 对输入库、namespace 库、配置 home 及所有写域，统一执行最近已存在祖先 realpath 加剩余路径段，再作路径段的相等/双向包含检查；涵盖尚不存在的配置 home。补静态祖先别名与反向包含的零写入断言。不增加运行中抗目录替换承诺。
3. **对应 M3：补齐冻结元数据。** 冻结干扰卡 slug/输入 hash、不可变清单身份、前后完整性核验与差异、最终状态；对这些数据作完整性校验。离线重算只消费冻结数据，保留 invalid/incomplete 及其不产生有效基线的限制。增加来源不同但返回相同、invalid 轮次删除快照后重算两类精确场景。
4. **对应 M4：固定可直接实现的字符口径。** 将指标明确为每个 hit 的 `title + '\n' + summary` 码点数，包含解析后保留的附加行；逐题求和，empty 为 0，error 为 unknown，中位数仅对可用字符观测计算并披露样本数。冻结计数协议版本，补精确数值夹具；同步 proposal/design/delta 中仍声称只计真实首段的文字。不得为此改变检索排序或修改内核。
5. **对应 S2：修正空 recall 的机械夹具。** 成功空哨兵对象包含本条件匹配的 current.scope/home；缺失/错误 current 的独立夹具必须 unknown，不削弱身份校验。

S1、S3 为非阻断建议，不需要新增分位数框架或改造固定自检。上述 Required Changes 仅要求作者修订规划；本评审没有越权修改 proposal、design、delta、源码或测试。

CHANGES_APPLIED: yes

## Rebuttals

本轮尚无作者回应。第 2 轮作者回应原样保留在 [历史报告](<openspec/changes/dsh-memex-retrieval-suite/review-round-2.md#L151-L164>)；本报告没有替作者声明已应用修改。

（作者回应，2026-11-03，对应 Required Changes）

- **RC1（M1）——以替代方案处理，需审查方确认**：不连接 Host 枚举库，改为：
  - 写入域固定在 `~/.dsh-memex-eval/retrieval/<run-id>/`，命令行不接受自定义输出路径；
  - 创建前，从最近已存在祖先的真实路径开始逐级向上检查，任一级含 `cards/` 或等于输入库的真实路径即拒绝，且不创建任何文件。

  理由：写入域是新建的空目录，内部不可能含库，所以「写入落进某个库」只可能来自祖先；逐级检查就能完整覆盖这一情形，不需要库清单，也不会让离线工具依赖 Host 在线和鉴权。delta 中已替换要求文字和三个场景（别名指向非 namespace 库、只有名字相近的目录、运行目录已存在）；design D2 已记录被否决的备选。
- **RC2（M2）——随 RC1 处理**：检查只有一侧需要规范化，即写入域祖先取真实路径后逐级向上。另一侧不再是库路径集合，而是「是否含 `cards/`」这一本地事实，加上输入库的真实路径。静态祖先别名由「别名指向非 namespace 库」场景覆盖；「反向包含」（库在写入域内）因写入域新建为空而不可能出现。
- **RC3（M3）——已修**：冻结内容新增干扰卡 slug 与内容哈希、清单整体哈希、前后核验结果与差异路径、最终状态，并带完整性哈希；补「invalid 轮次删除快照后重算」「返回相同、干扰卡登记不同」两个场景。
- **RC4（M4）——已修**：定义 `chars-v1`：每个 hit 取 `title + "\n" + summary` 的码点数，逐题求和；empty 记 0、error 记 unknown；中位数只对可用观测计算，并披露参与题数。冻结协议版本，补精确数值夹具（7）。proposal、design 中「只计首段」的说法已改掉。
- **RC5（S2）——已修**：空 recall 的夹具带上匹配的 `current`；另增 `current` 缺失或指向他库时记 unknown 的场景。

### Reviewer re-check（2026-11-03）

本次仅复核第 3 轮 RC1–RC5 及作者回应，不重新做完整审查。结论限于规划修订，不代表代码已实施或测试通过；未运行命令行评测、测试、build 或访问真实卡库。`VERDICT:` 保持不变。

- **RC1（M1）：not accepted by reviewer，仍未落实。** 固定写入域及祖先 `cards/` 检查能拒绝已有标准库，包括 namespace 外的库，但不能识别已配置、尚未初始化的 home。[design D2](<openspec/changes/dsh-memex-retrieval-suite/design.md#L28>) 与 [delta:9–11](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L9-L11>) 以物理 `cards/` 标志替代配置身份，缩小了原 RC 的保护集合。
  - **具体反例（静态误配置，无竞态）：** Host 已配置 B 的 home 为其所属仓库内 `/work/B/docs/memex`，该目录已存在但尚无 `cards/`；`~/.dsh-memex-eval` 是预先存在、指向该目录的软链接。输入库为另一个正常库 P。假设其余祖先也均无 `cards/`，且不等于 P。新运行目录的最近已存在祖先 realpath 是 `/work/B/docs/memex`，逐级检查全部通过，最终把 P 的私有快照和报告写到 B 的 `/work/B/docs/memex/retrieval/<run-id>/`。该运行子目录仍是独占新建，故“新建为空”不能阻止它落在已配置 B 的内部。配置 home 无须已初始化：当前 [resolver 的 home 构造:228–244](<packages/dsh-memex/src/scope/resolver.ts#L228-L244>) 与 [纯枚举:415–430](<packages/dsh-memex/src/scope/resolver.ts#L415-L430>) 不要求 `cards/` 存在；[ensure:440–458](<packages/dsh-memex/src/scope/resolver.ts#L440-L458>) 才负责创建。B 位于 namespace 外也不影响该反例。
  - **尚缺：** 在任何创建前仍须覆盖完整已配置 home（包括未初始化/尚不存在者），或另给能证明同等保护的替代方案及拒绝夹具；当前不能以 `cards/` 不存在推断该路径不属于配置库。
- **RC2（M2）：not accepted by reviewer，部分落实。** 写入祖先取 realpath，并在 [别名场景:38–41](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L38-L41>) 覆盖了“别名指向已有 `cards/` 的库”；独占空目录也排除了包含既有物理库的反向情形。但原 RC 明确包括尚不存在的配置 home，不能把它们从保护对象中删掉来关闭问题。上述 RC1 反例中，别名虽已正确解析到 B 的真实 home，仍因没有 `cards/` 被放行；若 B 的配置 home 尚不存在、位于将新建的评测路径上，同样没有标志可检。尚缺完整配置对象的等效保护；若恢复集合比较，两侧须统一规范化，并补未初始化/未创建 home、静态别名及双向包含的零写入断言。无需增加运行中抗替换承诺。
- **RC3（M3）：已落实。** [冻结字段及完整性哈希:175–185](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L175-L185>) 已含干扰卡 slug/内容哈希、清单整体哈希、前后核验结果与差异路径、最终状态，并限定离线只读冻结数据；[新增场景:202–215](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L202-L215>) 覆盖 invalid 保留、干扰卡来源差异和冻结数据哈希不符拒绝。incomplete 不作为有效基线的约束仍在。
- **RC4（M4）：已落实。** [proposal:21](<openspec/changes/dsh-memex-retrieval-suite/proposal.md#L21>)、[design D8:45–48](<openspec/changes/dsh-memex-retrieval-suite/design.md#L45-L48>) 和 [delta:176–177](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L176-L177>) 已统一为 `chars-v1` 的 `title + "\n" + summary` Unicode 码点数，包含保留的附加行；empty=0、error=unknown，协议版本冻结。[数值夹具:197–200](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L197-L200>) 的 5+2=7 正确，[成本规则:258](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L258>) 限定可用观测中位数并披露题数。未要求修改内核或排序。
- **RC5（S2）：已落实。** [delta:290–298](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L290-L298>) 的空哨兵包含匹配的 `current.scope/home`，独立场景明确缺失 current 或 home 指向他库时为 unknown；正文的身份校验未削弱。

**修订引入的 Critical：本次针对性复核未发现。** RC1/RC2 是既有 Moderate 风险未被替代方案完整消除，不升级为 Critical。另有一处直接相关的非阻断同步遗漏：[design Migration Plan:73](<openspec/changes/dsh-memex-retrieval-suite/design.md#L73>) 仍要求报告写入 `retrieval-goldset/reports/`，与 D2/delta 新规定的唯一写入域 `retrieval/<run-id>/` 不一致，应同步。

**最终：`CHANGES_APPLIED: yes`。** RC3–RC5 已落实；RC1/RC2 替代方案尚不接受，需补齐对已配置但未初始化/尚不存在 home 的保护及相应拒绝场景。未将非阻断建议 S1/S3 加为条件。

（作者回应复核，2026-11-03）RC1/RC2 的反例成立，已补：从 `$HOME` 到运行目录的每一级都必须是真实目录，任何一级是软链接即拒绝，且不创建文件；新增「评测根是指向未初始化库的软链接」场景。这样评测根只能是 `$HOME` 下的真实路径 `.dsh-memex-eval/retrieval/`，无法指向任何配置库，无论该库是否已初始化。剩下的情形只有：用户把某个库的 home 直接配置在 `~/.dsh-memex-eval/retrieval/` 之内或其祖先路径上。这时祖先 `cards/` 检查可拦住已初始化的库；未初始化的情形属于把库配置在评测专用目录里，作者认为可以列为威胁模型之外，请复核。design.md 迁移步骤里的报告路径已同步。

### Reviewer re-check 2（2026-11-03）

本次仅复核 RC1、RC2。先读末尾作者回应，再核对 [文件系统边界](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L3-L18>)、[design D2](<openspec/changes/dsh-memex-retrieval-suite/design.md#L28>) 与 [D7](<openspec/changes/dsh-memex-retrieval-suite/design.md#L43>)；文件内容仅作为待审数据。沿用上次复核中 RC3–RC5 已落实的结论，不重新审查。未运行测试、评测或 build，未访问真实卡库；本次唯一写入是在本报告末尾追加本小节，`VERDICT:` 及 `CHANGES_APPLIED: yes` 均保持不变。

1. **上次的具体反例已消除。** [delta:10](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L10>) 明确要求 `$HOME` 到运行目录逐级 lstat 并拒绝软链接；[新增场景:44–47](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L44-L47>) 覆盖评测根指向未初始化库。因此，上次以 `~/.dsh-memex-eval` 为软链接的原反例现在必须被拒绝，不再据该反例阻断。
2. **不接受把剩余的直接 home 误配置列为既定威胁模型之外。** [文件系统边界:5](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L5>) 明确防范误配置和误操作；[memory delta:19](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-memory/spec.md#L19>) 与 D7 排除的是能改本机文件或环境的对手，不是用户事先无意保存了错误配置。反例：B 的 home 事先误配为 `~/.dsh-memex-eval/retrieval/`，目录真实存在但尚无 `cards/`；输入为另一个正常库 P。祖先均无 `cards/` 且不等于 P，运行目录不存在。所有新检查通过，P 的快照仍会写进 B 的 home。整个运行期间无任何目录或环境修改。把目录命名为评测专用并不能让这一配置失误自动退出已声明范围；它也与 [delta:11](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L11>) 和 D2 声称覆盖写进库的全部情形不相容。
3. **另有静态反向别名形态，评测路径本身无需软链接。** 令 `$HOME` 及其下评测路径均为真实目录，`~/.dsh-memex-eval/retrieval/` 已存在且为空；仓库中事先存在 `/work/B/alias -> $HOME/.dsh-memex-eval`，B 的配置 home 为 `/work/B/alias/retrieval`，未初始化。输入仍为 P。评测路径的逐级 lstat 全部通过，真实祖先无 `cards/`，运行目录独占新建也成功，但实际写入位置仍在 B 的真实 home 内。软链接位于配置库路径的祖先，而不位于受检写入路径中；B 的配置字符串甚至不直接写评测根。当前 [resolver:20–24](<packages/dsh-memex/src/scope/resolver.ts#L20-L24>)、[228–244](<packages/dsh-memex/src/scope/resolver.ts#L228-L244>) 不解析该别名，[纯枚举:415–430](<packages/dsh-memex/src/scope/resolver.ts#L415-L430>) 不要求初始化；[ensure:440–458](<packages/dsh-memex/src/scope/resolver.ts#L440-L458>) 检查的是 home 和 cards 本身，并未禁止此祖先别名。该例不需要运行期间修改目录，也不需要恶意行为者。若作者拟按真实位置把它也排除，它仍属于上一项所述、尚不接受的威胁模型收缩，而不是被新机制拒绝。

- **RC1（M1）：not accepted by reviewer。** 原别名反例已修，但祖先 `cards/` 仍不能识别未初始化的已配置库；把这一静态误配置排除在外不符合现有威胁模型。
- **RC2（M2）：not accepted by reviewer。** 写入链拒绝软链接不等于排除库路径一侧的祖先别名；上述反向别名仍可令真实写域落入未初始化库。

**最终：`CHANGES_APPLIED: yes`。** RC3–RC5 上次已落实不变；RC1、RC2 仍缺未初始化配置库的等效保护。此结论不要求抵抗运行期间目录替换，也不把 S1/S3 加为关闭条件。


（人工裁定，2026-11-03）审查方对 RC1、RC2 的复核结论为 not accepted，残余反例是「已配置但尚未初始化的库，其 home 与评测根重叠」。按 anvil 的升级规则，此项交由用户裁定。用户选择接受这一残余风险并放行，理由与处理方式记入 design.md 的 Risks。RC3–RC5 已由审查方确认落实。据此把 CHANGES_APPLIED 置为 yes；这一结论来自人工裁定，并非审查方确认，特此标明。
