## Review Metadata
- **Review round**: 1
- **Prior round**: none
- **Reviewer context**: cross-model（codex/gpt-6.1-sol，fresh context）
- **Tool restrictions**: read-only，唯一写入为 review.md
- **Artifacts reviewed**:
  - 仓库约定及配置：[AGENTS.md](<../../../AGENTS.md>)、[dsh.yaml:1–240](<../../../dsh.yaml#L1-L240>)、[instructions/dsh-home.md](<../../../instructions/dsh-home.md>)。
  - 本 change：[proposal.md](<proposal.md>)、[design.md](<design.md>)、[evaluation delta](<specs/dsh-memex-evaluation/spec.md>)、[memory delta](<specs/dsh-memex-memory/spec.md>)、[integration delta](<specs/dsh-memex-integration/spec.md>)、[.openspec.yaml](<.openspec.yaml>)。目录清单中没有 tasks.md，也没有既有 review.md。
  - 现行规范：[evaluation](<../../specs/dsh-memex-evaluation/spec.md>)、[memory](<../../specs/dsh-memex-memory/spec.md>)、[integration](<../../specs/dsh-memex-integration/spec.md>)，以及 [scope:115–154](<../../specs/dsh-memex-scope/spec.md#L115-L154>)。
  - 叠加依据：[fix-stale integration delta](<../dsh-memex-fix-stale-card-on-use/specs/dsh-memex-integration/spec.md>)、[fix-stale tasks](<../dsh-memex-fix-stale-card-on-use/tasks.md>)、[reuse-evidence integration delta](<../dsh-memex-reuse-evidence-and-card-lead/specs/dsh-memex-integration/spec.md>)、[reuse-evidence memory delta](<../dsh-memex-reuse-evidence-and-card-lead/specs/dsh-memex-memory/spec.md>)、[reuse-evidence tasks](<../dsh-memex-reuse-evidence-and-card-lead/tasks.md>)。
  - 出处：[scoped-memory design](<../archive/2026-09-20-dsh-memex-scoped-memory/design.md>) 及归档的 [memory delta](<../archive/2026-09-20-dsh-memex-scoped-memory/specs/dsh-memex-memory/spec.md>)、[integration delta](<../archive/2026-09-20-dsh-memex-scoped-memory/specs/dsh-memex-integration/spec.md>)、[scope delta](<../archive/2026-09-20-dsh-memex-scoped-memory/specs/dsh-memex-scope/spec.md>)、[guard delta](<../archive/2026-09-20-dsh-memex-scoped-memory/specs/dsh-memex-guard/spec.md>)；[settings-ui proposal](<../archive/2026-09-20-dsh-memex-settings-ui/proposal.md>)。
  - 插件调用链：[tools/index.ts](<../../../packages/dsh-memex/src/tools/index.ts>)、[query-segment.ts](<../../../packages/dsh-memex/src/tools/query-segment.ts>)、[run/kernel.ts](<../../../packages/dsh-memex/src/run/kernel.ts>)、[run/parse.ts](<../../../packages/dsh-memex/src/run/parse.ts>)、[run/types.ts](<../../../packages/dsh-memex/src/run/types.ts>)、[run/installation.ts](<../../../packages/dsh-memex/src/run/installation.ts>)、[lifecycle/index.ts](<../../../packages/dsh-memex/src/lifecycle/index.ts>)、[package.json](<../../../packages/dsh-memex/package.json>)。
  - 自检与冻结：[program-evidence.ts](<../../../packages/dsh-memex/src/eval/program-evidence.ts>)、[report.ts](<../../../packages/dsh-memex/src/eval/report.ts>)、[offline-report.ts](<../../../packages/dsh-memex/src/eval/offline-report.ts>)、[offline-outcomes.ts](<../../../packages/dsh-memex/src/eval/offline-outcomes.ts>)、[collection.ts](<../../../packages/dsh-memex/src/eval/collection.ts>)、[evidence-text.ts](<../../../packages/dsh-memex/src/eval/evidence-text.ts>)、[freeze.ts](<../../../packages/dsh-memex/src/eval/freeze.ts>)、[round.ts](<../../../packages/dsh-memex/src/eval/round.ts>)、[fixtures.ts](<../../../packages/dsh-memex/src/eval/fixtures.ts>)、[artifact-location.ts](<../../../packages/dsh-memex/src/eval/artifact-location.ts>)、[cli/eval-report.ts](<../../../packages/dsh-memex/src/cli/eval-report.ts>)、[固定题目](<../../../packages/dsh-memex/fixtures/eval/questions.json>)。
  - 遥测：[record.ts:1–200](<../../../packages/dsh-memex/src/telemetry/record.ts#L1-L200>)、[sink.ts](<../../../packages/dsh-memex/src/telemetry/sink.ts>)、[snapshot.ts](<../../../packages/dsh-memex/src/telemetry/snapshot.ts>)、[telemetry/report.ts:1–140](<../../../packages/dsh-memex/src/telemetry/report.ts#L1-L140>)。
  - 静态核对的测试源码（未运行）：[eval-collection.test.ts](<../../../packages/dsh-memex/test/eval-collection.test.ts>)、[eval-frozen-upgrade.test.ts:1–90](<../../../packages/dsh-memex/test/eval-frozen-upgrade.test.ts#L1-L90>)、[eval-program-outcomes.test.ts](<../../../packages/dsh-memex/test/eval-program-outcomes.test.ts>)、[eval-memex-tools-runtime.test.ts:170–223](<../../../packages/dsh-memex/test/eval-memex-tools-runtime.test.ts#L170-L223>)；检索了 [tools.test.ts](<../../../packages/dsh-memex/test/tools.test.ts>) 的 semantic、limit、分段相关断言。
  - 安装内核（仅相关片段）：cli.js（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js`） 的 CardStore（3487–3626）、配置解析（3664–3732）、格式化与 embedding provider/cache（7922–8494）、searchCommand/keywordSearch/semanticSearch（8505–8789）、CLI search 装配（42465–42498）。

## Findings
### 🔴 Critical (blocking)

#### C1. 安全边界漏掉已经存在的插件语义入口，关键设计前提与源码相反
- **位置**：[design D5:33](<design.md#L33>) 声称“插件侧当前不会走语义路径，因此不需要同步改插件”；[proposal:14、17、20](<proposal.md#L14-L20>) 同时要求新边界、插件行为不变、不接入远端；[memory delta:13、20–23](<specs/dsh-memex-memory/spec.md#L13-L23>) 要求任何组件拒绝远端。
- **反例与证据**：插件在 [tools/index.ts:475–494](<../../../packages/dsh-memex/src/tools/index.ts#L475-L494>) 向模型暴露 `semantic`；[318–323](<../../../packages/dsh-memex/src/tools/index.ts#L318-L323>) 会据此添加 `--semantic`，没有来源检查。模型调用 `memex_search({query: ..., semantic:true})`，库配置为 OpenAI，或无显式 provider 而进程有 OpenAI key，都会进入内核 embedding 路径。内核会把未缓存卡片全文和查询送给 provider，而不只是搜索一个已存在的向量索引（cli.js:8169–8185（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8169-L8185`）、8692–8717（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8692-L8717`））。这条入口甚至有现有测试明确要求保留 `semantic` 参数；并不是不可达的死代码。
- **为什么阻断**：只在新 CLI 加守门，不能兑现“任何本系统组件”不得外发的替代要求。旧 MUST NOT 本来至少在规范上禁止这件事；删除它、又以错误前提遗漏现有入口，会留下真实的全文外发漏洞。默认仍为关键词并不能修复显式语义调用。
- **建议修改**：先承认现行规范与实现已有偏差。选择最小且明确的方案：本 change 对插件显式语义请求也在 spawn 前应用同一来源检查，或暂时一律拒绝插件语义请求；相应调整 proposal 的“行为不变”边界。补上库配置、环境自动选择、未知来源三类插件拒绝场景，断言内核调用数为 0，而不仅是未观测到网络请求。

#### C2. “本地来源”检查没有定义有效配置与真实连接边界，不能承担解除禁令后的保密保证
- **位置**：[design Non-Goals:20](<design.md#L20>) 排除边界判定细则，但 [D5:33](<design.md#L33>) 又把判定作为第一处安全实现；[evaluation delta:48、55–58](<specs/dsh-memex-evaluation/spec.md#L48-L58>)、[memory delta:13](<specs/dsh-memex-memory/spec.md#L13>) 只写 local/回环允许。
- **可构造的绕过**：
  1. 快照仅复制 cards，没有 provider 配置时，不能把“没配置”视为 local。内核优先用 `.memexrc.embeddingProvider`，再用 `MEMEX_EMBEDDING_PROVIDER`，再自动检查 OpenAI key、Azure 配置，最后才尝试 local（cli.js:8093–8134（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8093-L8134`））。配置中的非法 provider 还会被内核忽略，而不是强制拒绝（3673–3696（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L3673-L3696`））。检查器若采用不同优先级或自行补默认值，就可能检查 local、实际发给远端。
  2. Ollama 地址实际优先级是配置 `ollamaBaseUrl` → `MEMEX_OLLAMA_BASE_URL` → `OLLAMA_HOST` → localhost（cli.js:8377–8397（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8377-L8397`））。只查 provider 与一个地址字段会漏掉环境覆盖。`localhost` 解析到非回环、`0.0.0.0`/`::`、IPv6 `[::1]`、IPv4-mapped IPv6 也没有接受/拒绝规则；“非公网”不等于回环。
  3. “回环服务始终允许”只说明第一跳，不能保证本地代理不把内容转给远端。当前文字把第一跳判定直接写成“不越出发布边界”的证明，未声明本地服务属于受信计算基。
- **为什么阻断**：这是删除无外发禁令后的主要替代保护，不是可后补的实现细节；目前唯一远端拒绝用例只覆盖 `.memexrc` 明写 OpenAI，不能覆盖真实选择链。
- **建议修改**：规定先构造并冻结经过校验的最小有效配置，再以受控环境执行同一份配置，未知/非法/自动选择一律 fail closed。最便宜的首版是只允许显式 local，推迟 Ollama；若保留 Ollama，必须规范化 URL、限定协议，核验/固定真实回环连接目标，拒绝 unspecified 与非回环解析结果，并明确本地服务的信任假设。为配置/环境冲突和上述地址形态各给拒绝或成功断言。远端授权应写成“未来另行变更”，不要在当前 SHALL 中保留一个本 change 根本无法配置、无法执行的允许分支。

#### C3. 快照、干扰卡和语义缓存缺少文件系统信任契约，“原库只读”可被路径别名及缓存写出界破坏
- **位置**：[evaluation delta:3–20](<specs/dsh-memex-evaluation/spec.md#L3-L20>)；[design D2、D5、Open Questions:27、33、65](<design.md#L27-L65>)。现行自检已要求完整目录链 lstat、拒绝软/硬链接、独占创建和目标身份检查（[主 evaluation:31–55](<../../specs/dsh-memex-evaluation/spec.md#L31-L55>)），新工具没有继承或定义等价边界。
- **具体反例**：源卡 `cards/x.md` 是指向库外文件的软链接，或者输出/快照的父目录通过软链接落回原库，或者干扰卡覆盖已有同名 slug。只做“复制后 hash”无法阻止读取库外文件、覆盖目标或丢失目标身份；硬链接也不能成为独立快照。内核 CardStore 会把以 `.md` 结尾的非目录条目纳入并用普通 readFile 读取（cli.js:3518–3534、3615–3618（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L3518-L3618`）），不能指望内核兜底。
- **缓存也是写操作**：语义查询每次执行 `cache.save()`，路径是 `<MEMEX_HOME>/.memex/embeddings/<provider.model>.json`（cli.js:8448–8476（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8448-L8476`）、8710–8717（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8710-L8717`））。当且仅当 MEMEX_HOME 为独立新快照、路径链安全时，这不会写原库；不能笼统声称“local-semantic 无写入”。Ollama 的 model 字符串原样来自配置/环境，未限制路径分隔符，`../../../../outside` 形式还能使缓存文件逃出预定缓存目录。
- **为什么阻断**：工具处理私有真实库和用户路径，却未定义私有副本的落点、权限、已有目录处理、别名关系或缓存允许写域。内容 hash 是一致性证据，不是路径授权或只读证明。
- **建议修改**：明确“读取原库制作快照”与“冻结后运行”两个阶段；只接受普通独立文件，拒绝软/硬链接、路径穿越、特殊文件及身份冲突；新输出目录独占创建并核验与所有原库不重叠，不覆盖旧运行；干扰卡必须是新 slug，拒绝与目标/原卡碰撞。受控 MEMEX_HOME 只指向快照；验证 provider model 到缓存路径的包含关系，或限制安全模型名。真实卡副本/冻结 gold 采用私有权限。加入上述失败场景，并断言拒绝发生在读取链接目标或写出界之前。安全创建和普通文件读取可复用现有自检的做法，不必另建通用快照框架。

### 🟡 Moderate

#### M1. 4 题指标夹具的误选率没有足够条件支持，按最直接解释应为 0.5
- **位置**：[evaluation delta:72–77](<specs/dsh-memex-evaluation/spec.md#L72-L77>)；[design D6:35](<design.md#L35>)。
- **核算**：主目标名次 1、2、未返回、1 的 reciprocal rank 为 1、1/2、0、1，所以 MRR = 2.5/4 = **0.625，正确**。若四题都是单目标，第二题首位不是目标，第三题首位又是干扰卡，误选率是 **2/4 = 0.5**，不是 0.25。只有第二题首位恰为一个额外可接受目标，才能让误选率变为 0.25，但 GIVEN 没有这一条件；若命中率也按可接受目标算，首位命中率又应为 0.75。
- **影响**：同一合法实现可按不同解释通过或失败，无法机械验收；它还掩盖了“命中”究竟按主目标还是任何可接受目标统计的问题。
- **建议修改**：给每题明确的 targets 与完整返回列表。最小修法：保持全部单目标，把误选率改为 0.5，另加一个首位为次要可接受目标的用例。规定空列表的误选处理、所有比例的分母及排名截断 K。

#### M2. targets 同时承担“可替代答案”与多跳题标注，核心指标的相关性语义尚未定稿
- **位置**：[proposal:13、15](<proposal.md#L13-L15>)；[evaluation delta:24、72](<specs/dsh-memex-evaluation/spec.md#L24-L72>)；[design Open Questions:66](<design.md#L66>)。
- **反例**：两个后端分别返回主目标 A 与等价可接受目标 B，按 design 当前倾向，前者 MRR 为 1、后者为 0，误选率却都为 0；调换 targets 数组次序就能改结论。对需要 A、B 两张卡共同支撑的多跳题，返回任一张也会被当前“首个可接受目标”记为命中，无法区分替代卡与必需证据集合。
- **影响**：首个基线还未产生就有两个未固定的 oracle；这些指标不能可靠地支持后端选择。`multi-hop` 若只是题型标签，必须防止把分组命中率称为多跳完成率。
- **建议修改**：在 spec 固定主目标指标与任意可接受目标指标的命名/公式，二者都可报但不得混用。首版最便宜的选择是明确 targets 全为 OR，并声明多跳仅为人工题型标签、不度量证据完整性；需要真正多卡覆盖时再另加独立字段与覆盖指标。

#### M3. 只冻结 cards 不会冻结原插件检索语义；“同一快照比同一命令”测试是自证
- **位置**：[proposal:11–12](<proposal.md#L11-L12>)、[design D1–D2:25–27](<design.md#L25-L27>)、[evaluation delta:48–53](<specs/dsh-memex-evaluation/spec.md#L48-L53>)。
- **反例**：原库启用 `nestedSlugs:true`，卡片为 `cards/a/x.md`。内核会返回 `a/x`；只复制 cards 后快照缺少配置，返回值变成 `x`，有重复 basename 时甚至读取到错误的同名卡（cli.js:3673–3679（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L3673-L3679`）、3525–3542（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L3525-L3542`）、42465–42493（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L42465-L42493`））。两次都对错误配置的快照跑相同命令仍会“逐 slug 一致”。
- **入口事实**：`kernelQuery` 和 `searchArgs` 都是文件私有函数（[tools/index.ts:209、318](<../../../packages/dsh-memex/src/tools/index.ts#L209-L323>)），不是现在即可调用的公共 helper。`memex_recall(query)` 确实复用预处理且固定 limit=10，但还支持过滤；无 query 时读 index，失败才 list（[532–577](<../../../packages/dsh-memex/src/tools/index.ts#L532-L577>)）。因此不能把所有召回模式都视为相同的搜索接口。
- **建议修改**：冻结安全白名单内的有效检索配置、slug 模式及最终 limit；不要直接复制含凭据/外部路径的整个配置。将关键词参数构造抽成一个无遥测的共享纯 helper，并用真实注册工具的调用结果做 parity 断言，覆盖中文、ASCII、limit 边界、nested slug 与过滤支持范围。将一致性承诺明确限定为单库 `memex_search` 的同参数路径；不要扩张到无 query 的 recall 或多库归并。

#### M4. “不改夹具即可旧轮次补算”的方向可行，但当前设计没有接入实际冻结产物，且 recall 解析会误报
- **位置**：[design D7、风险:37、52](<design.md#L37-L52>)；[evaluation delta:94–111](<specs/dsh-memex-evaluation/spec.md#L94-L111>)。
- **实际链路**：旧 `program-evidence` 只有 `{source,tool,text}`，search 的 text 已丢掉 slug；loader 严格校验键数（[program-evidence.ts:22–33、80–88](<../../../packages/dsh-memex/src/eval/program-evidence.ts#L22-L88>)）。离线报告只读这个摘要，既不读完整事件，也不调用新 `programEvidence()`（[offline-report.ts:68–77](<../../../packages/dsh-memex/src/eval/offline-report.ts#L68-L77>)）。修改在线提取函数不会自动补齐旧报告。
- **可复用证据**：采集实际上已经把成功工具返回全文另冻在 `collected-tool-results`（[collection.ts:36–44](<../../../packages/dsh-memex/src/eval/collection.ts#L36-L44>)、[evidence-text.ts:4–16](<../../../packages/dsh-memex/src/eval/evidence-text.ts#L4-L16>)），所以不必改夹具或依赖 Host 仍保留原日志。冻结文件通过哈希校验、独占创建，不能为了补字段原地重写（[freeze.ts:5–23](<../../../packages/dsh-memex/src/eval/freeze.ts#L5-L23>)）。另外报告模式本已不比较当前包的资源 hash（[round.ts:83–105](<../../../packages/dsh-memex/src/eval/round.ts#L83-L105>)），故 design 中“改夹具就使旧报告不能重算”的理由也不准确；那会阻止旧轮次执行，不必然阻止报告。
- **解析反例**：无 query 的 recall 可能返回 index 正文，其中的 `## retry-limit` 是普通标题，不是实际返回的排名条目；fallback list 的格式也不是 `## slug`。卡片首段本身若含同样标题，逐行正则同样可能制造命中。格式错误、证据缺失、nomem/N/A 不能统一显示“未召回”。
- **建议修改**：定义只读的版本化 rank diagnostic：从旧 `collected-tool-results` 验证并解析 JSON 返回，search 取带 scope 的 hits，recall 先检查 mode，仅对真实 search/list 采用对应结构解析，index 不解释为排名。保留原冻结摘要与现有判定不变；旧证据不足时显示 unknown，nomem 显示 N/A。补“仅旧产物、Host 日志已不可用、摘要无新键、index 含伪标题、损坏/缺失证据”的离线兼容测试。

#### M5. hybrid-rrf 的第二路本来就含关键词分，设计宣称避免上游线性混合却仍在使用它
- **位置**：[design D4:31](<design.md#L31>)；[evaluation delta:48、65–68](<specs/dsh-memex-evaluation/spec.md#L48-L68>)。
- **事实与反例**：内核 `--semantic` 的最终分数固定是 `cosine + 0.3 * keyword`（cli.js:8717–8728（`/Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8717-L8728`））。对 ASCII 或代码查询，该关键词分不会像所引中文探针那样自动为零。因此实际比较的是 `RRF(分段关键词, 上游线性混合)`，不是独立关键词与纯语义两路融合。设计自身在 Context 已承认前者，但 D4 的拒绝理由又把它当作被替换的方案。
- **影响**：可能把两路重复的词面信号当成向量贡献，后续根据报告选择默认路径时会误解收益来源。规范还没固定候选数 50（仅 design 有）、最后截断值、重复 slug 去重及 RRF 并列的打破规则。
- **建议修改**：最便宜的修法是保留内核、明确命名及报告为“关键词 + 上游混合的 RRF”，承认关键词重复贡献，不宣称消除了上游线性混合。冻结候选深度、RRF 公式和并列规则，给两路重合、缺一路、相同 RRF 分的精确结果场景；若坚持纯语义，则必须另行证明不改内核如何取得纯语义候选。

#### M6. gold set 的选集路径自相矛盾，且对不可信 JSON 的校验要求不足
- **位置**：[design D3:29](<design.md#L29>) 规定两集合放同一文件；[evaluation delta:24、36–44](<specs/dsh-memex-evaluation/spec.md#L24-L44>) 却拒绝 gold set 同时含两集合，没有 `--set` 或筛选顺序。
- **反例**：依 design 制作一个合法的 dev+holdout 文件后，运行总被“混用”场景拒绝，两个集合都无法从这个文件运行。若实现偷偷先过滤选集，又可能漏掉同主题跨集合校验。空数组、重复 id、空/非字符串 query、空 targets、非枚举字段、重复 target、超长文本/巨量题目也没有明确的 schema 与拒绝场景；仅检查 target 存在并不能验证输入契约。
- **建议修改**：明确整个文件先做结构、唯一性与跨集合 topic 检查，再要求显式选择一个 set，最终执行集不得混合；或首版只支持单集合文件并修改 design。定义有界 JSON schema 与未知字段策略，slug 校验与内核模式一致，所有校验失败都发生在检索和输出物化之前。至少补空套件、重复 id、非法类型、选集为空、路径形态 target 的失败场景。

#### M7. 可重算承诺没有冻结检索协议与观测结果，也没有规定失败题分母
- **位置**：[evaluation delta:5、48、72、89–92](<specs/dsh-memex-evaluation/spec.md#L5-L92>)；[design D1、D8:25、39](<design.md#L25-L39>)。
- **反例**：只有 cards/gold 的 hash 与“冻结输入”，删除快照后不能知道上次返回的有序 slug、每题耗时或后端错误，自然不能不检索重算 MRR 与延迟分位数。即使 cards 完全相同，更换同名本地模型文件、Ollama model、环境 provider、候选深度或 RRF 规则，仍可得到不同结果。现在也没规定内核超时、输出无法解析、模型缺失时是整轮失败、unknown，还是被误算成空结果；静默跳过一题会虚增命中率。
- **建议修改**：冻结运行协议版本、内核版本、有效配置的非敏感部分、模型身份/可用指纹、query 预处理与候选/截断参数、排除/干扰规则，以及逐题原始有序结果、状态和耗时。定义 hash 的规范化排序与生效阶段（排除和加干扰之后），每题运行均核验 cards 未变。离线重算只消费冻结观测，不覆盖旧报告。明确所有计划题保持分母，基础设施失败单列且不给完整有效基线；补中途失败、无效输出、冻结结果篡改和版本升级场景。

#### M8. 成本报告丢掉 proposal 明确承诺的注入 token，并混淆检索耗时与模型启动/缓存状态
- **位置**：[proposal:15](<proposal.md#L15>) 要求注入 token 数与缓存/安装足迹；[evaluation delta:72、84–87](<specs/dsh-memex-evaluation/spec.md#L72-L87>) 只要求延迟与安装说明；[design D8:39、风险:48](<design.md#L39-L48>) 未定义测量口径。
- **反例**：一个后端返回 10 张长首段，另一个只返回 1 张短卡，即使命中与查询耗时相同，后续上下文成本也不相同；现有列无法观察。语义第一次需全库 embedding，后续只读缓存，每题另 spawn 并加载模型；若不标冷/热缓存及计时起止，p95 的差异可能只是题目顺序而非后端可比成本。“每题的 p50/p95”若每题只跑一次也没有实际采样含义。
- **建议修改**：要么明确撤回 proposal 的 token 承诺并解释，要么冻结返回文本及明确的 token 计数器/估算协议，不调用 LLM；注明其为返回文本预算而不是实际 Host 注入用量。规定延迟是每题端到端一次采样、汇总跨题分位数，还是重复采样；分列首次建索引、模型加载与热查询状态，并记录缓存大小和模型文件身份。缺成本数据记 unknown，不必引入任何成本门禁。

### 📌 Suggestions

#### S1. 默认排除 research/decision 会顺带删掉正常知识，基线需避免把精度改善归功于后端
- **位置**：[design D2:27](<design.md#L27>)。
- **问题与例子**：普通架构决策卡的 category 为 `decision`，研究结论卡为 `research`，不等于它们是泄漏评测题的元卡。默认整类删除可能让目标校验失败，也可能删除真实日常干扰项、使基线比插件实际环境容易。
- **建议**：默认只排除可确认的评测/交接类别与前缀；对 research/decision 使用显式 opt-in。报告中区分“原库背景”和“排除后的背景”，不要将结果泛化到未过滤的日常库。最低成本首版可以只交付 lexical 基线，先固定 oracle 和快照安全，再逐个增加语义与 RRF；当前三后端不是必须同时交付才能证明基线有用。

#### S2. 叠加文本基本保留了底要求，但归档检查还只是一个指向不存在 tasks 的承诺
- **位置**：[proposal:39](<proposal.md#L39>)、[design D9、风险:41、50](<design.md#L41-L50>)。
- **核对结论**：逐段对照后，新 integration delta 保留 fix-stale 的正文与既有场景；除列举句为新增项目调整连接词/换行外，没有发现旧要求被删改。不过它并非仅“加一句一景”：还新增一段规范文字和“评测提示不拦截写入”场景，design 应照实描述。归档依赖图 reuse-evidence → fix-stale → 本 change 没有形成环，顺序原则可执行；但前两项仍有未完成观察任务，本 change 又还没有 tasks，当前不存在可操作的底文本检查步骤。
- **建议**：实施任务生成时记录底 requirement 的版本/内容比较规则，归档前核对主 spec 已包含全部前置文本；底变更时停止而不是覆盖。不要以本 change 为由提前勾选前置观察任务。
- **另一个已尝试但不成立的冲突**：成本不设门禁与默认路径更换必须附离线报告可以同时成立——前者禁止按成本值拒绝，后者要求证据存在，不要求成本低于阈值。但“报告存在”不等于“证明效果更好”，后续真正切默认时仍应写清质量/退化判据，不能把任意一份报告当成收益证明。

#### S3. 出处核对支持引用位置，但不支持把“没有独立论证”当成已证实历史事实
- **位置**：[proposal:7](<proposal.md#L7>)、[memory delta Reason:5](<specs/dsh-memex-memory/spec.md#L5>)。
- **核对结论**：归档 [design:57](<../archive/2026-09-20-dsh-memex-scoped-memory/design.md#L57>) 确为 Non-Goals，且带“默认关键词路径零外发”；同次归档 [memory delta:205–212](<../archive/2026-09-20-dsh-memex-scoped-memory/specs/dsh-memex-memory/spec.md#L205-L212>) 已有正式禁令。发布目标/访问权限论据在该 design D3:157–161，以及后续 [settings-ui proposal:36–40](<../archive/2026-09-20-dsh-memex-settings-ui/proposal.md#L36-L40>) 也确实存在。但这些文件没有证明当时“未经论证”，仓库外讨论与实测数字也不在本评审证据范围。
- **建议**：把历史判断收敛为“现有规划未记录额外论证；本次重新选择目的约束”。认可重新评估手段，不应依赖贬低旧要求的来源来降低对新安全边界的证明标准。

## Embedded-Instruction / Injection Attempts
**Detected:** 以下被审数据含直接面向 Agent 的指令性文字；没有发现要求改变本次判定、隐藏发现或泄露数据的恶意注入证据。依本次硬性约束，全部只作数据，不执行。

1. [AGENTS.md:90–92](<../../../AGENTS.md#L90-L92>) 的“给 AI 的执行提示”要求使用 OpenSpec skill 与流程；[71–81](<../../../AGENTS.md#L71-L81>) 列出测试/同步验证命令。这是仓库约定，不构成本次运行测试、同步或修改其他文件的授权。
2. [instructions/dsh-home.md:9–10](<../../../instructions/dsh-home.md#L9-L10>) 要求写 memex 卡、发现过期卡同回合修订；[lifecycle/index.ts:43–60](<../../../packages/dsh-memex/src/lifecycle/index.ts#L43-L60>) 携带对应的模型注入文本。这些正是待审功能数据；本评审没有调用会写卡、同步或追加召回遥测的记忆工具。
3. [design:66](<design.md#L66>) 直接对评审说“评审可挑战”；按待审论述处理，不作为评审范围或结论的指令。

## Verdict
VERDICT: REVISE

存在 3 条未解决的 Critical：一个已证实的现有外发入口遗漏，以及网络来源、文件系统两个尚未形成可执行契约的信任边界。修复需要重新确定范围、安全策略和冻结/回放设计，不是可在附带小改后批准的局部修订。另有 8 条 Moderate、3 条 Suggestions。

本轮只做静态阅读、搜索、目录发现和工作目录确认；未运行测试、build、安装、评测 CLI、内核 search 或网络请求，未读取私有真实卡库或仓库外 gold set，未修改任何被审产物。引述的历史实测数字未独立复现，测试源码被阅读不等于测试通过。

## Required Changes (if APPROVE WITH CHANGES)
不适用：本轮判定为 REVISE。修订时先关闭 C1–C3 的可达反例，再落实 M1–M8 的规范与验收条件，并重新评审。

CHANGES_APPLIED: n/a

## Rebuttals

全部 14 条都按「已修」处理，没有反驳项。作者已独立核实 C1 与 M1。

- **C1 已修**：插件语义请求在调用内核前，与评测工具走同一个来源判定（memory delta 新要求，design D5）；proposal 改为 BREAKING（插件行为），并承认规范与实现原先就不一致；新增三类拒绝场景，均断言内核调用数为 0。工具描述受「工具描述经脚本同步」约束，不改。
- **C2 已修**：只认库 `.memexrc` 显式写明的 `local`。缺失、非法、自动选择一律拒绝；子进程环境清理远端变量，并强制设 `MEMEX_EMBEDDING_PROVIDER=local`。Ollama 和远端来源推迟到后续 change，SHALL 中不再保留无法配置的允许分支；信任假设写明。
- **C3 已修**：新增「快照的文件系统边界」要求：两阶段；拒绝软链接、硬链接、特殊文件、路径穿越，且在读取前拒绝；独占新建、0700/0600、与任何库不重叠；干扰卡必须用新 slug；MEMEX_HOME 只指向快照；模型名限制字符集。
- **M1 已修**：误选率改为 0.5；补充多个可接受目标、空结果的场景；定义 K=10 和各项分母。
- **M2 已修**：targets 改为 OR 集合，取消主目标；`type` 只作标签。
- **M3 已修**：快照冻结白名单配置；抽出共享的参数构造函数，用真实注册的工具做 parity，覆盖 nestedSlugs、中文、ASCII 与 limit 边界；一致性范围限定为单库、带 query 的 search。
- **M4 已修**：从 `collected-tool-results` 解析；recall 只认检索模式；区分 unknown 与 N/A；补「仅旧产物」「索引伪标题」场景；更正 D8 的理由。
- **M5 已修**：改名 `rrf-lexical-semantic`，承认两路有重复的词面信号；候选深度、公式、去重、同分规则、截断都写进 spec，并给出精确结果场景。
- **M6 已修**：先全量校验再用 `--set` 选集；补全有界 schema 与六类失败场景。
- **M7 已修**：新增「冻结观测与离线重算」要求；error 保留在分母，整轮标为 incomplete；哈希在排除与加入干扰卡之后计算，运行前后各核验一次。
- **M8 已修**：改用返回文本字符数作为预算代理，明确不是 token；冷启动与热查询分列，缺失记 unknown。
- **S1 已采纳**：默认排除收窄，`research`、`decision` 改为显式追加。
- **S2 已采纳**：D11 照实描述新增内容，归档前比对底文本，有变即停。
- **S3 已采纳**：proposal 与 REMOVED Reason 改写为「现有规划材料没有记录额外论证」。
