## Review Metadata
- **Review round**: 2
- **Prior round**: round 1 REVISE（3 Critical / 8 Moderate / 3 Suggestions；详见 [review-round-1.md](<openspec/changes/dsh-memex-retrieval-suite/review-round-1.md>)）
- **Reviewer context**: cross-model（codex/gpt-6.1-sol，fresh context）
- **Tool restrictions**: read-only，唯一写入为 review.md
- **Artifacts reviewed**:
  - 本 change 的 [proposal.md](<openspec/changes/dsh-memex-retrieval-suite/proposal.md>)、[design.md](<openspec/changes/dsh-memex-retrieval-suite/design.md>)、[evaluation delta](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md>)、[memory delta](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-memory/spec.md>)、[integration delta](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-integration/spec.md>)、[元数据](<openspec/changes/dsh-memex-retrieval-suite/.openspec.yaml>)、第 1 轮报告及作者回应，以及替换前的 [review.md](<openspec/changes/dsh-memex-retrieval-suite/review.md>)。目录发现结果没有 tasks.md。
  - 主规范全文：[evaluation](<openspec/specs/dsh-memex-evaluation/spec.md>)、[memory](<openspec/specs/dsh-memex-memory/spec.md>)、[integration](<openspec/specs/dsh-memex-integration/spec.md>)；补读 [scope:110–184](<openspec/specs/dsh-memex-scope/spec.md#L110-L184>)。叠加底文本：[fix-stale integration delta](<openspec/changes/dsh-memex-fix-stale-card-on-use/specs/dsh-memex-integration/spec.md>)。
  - 配置：[dsh.yaml:1–220](<dsh.yaml#L1-L220>)。调用链：[tools/index.ts:1–660](<packages/dsh-memex/src/tools/index.ts#L1-L660>)、[query-segment.ts](<packages/dsh-memex/src/tools/query-segment.ts>)、[生成描述](<packages/dsh-memex/src/tools/descriptions.generated.ts>)、[描述同步脚本](<packages/dsh-memex/scripts/sync-memex-descriptions.mjs>)、[kernel.ts](<packages/dsh-memex/src/run/kernel.ts>)、[parse.ts](<packages/dsh-memex/src/run/parse.ts>)、[installation.ts](<packages/dsh-memex/src/run/installation.ts>)、[run/types.ts](<packages/dsh-memex/src/run/types.ts>)、[lifecycle/index.ts](<packages/dsh-memex/src/lifecycle/index.ts>)、[scope/resolver.ts:1–282、400–474](<packages/dsh-memex/src/scope/resolver.ts>)。
  - 自检：[fixtures.ts](<packages/dsh-memex/src/eval/fixtures.ts>)、[freeze.ts](<packages/dsh-memex/src/eval/freeze.ts>)、[collection.ts](<packages/dsh-memex/src/eval/collection.ts>)、[evidence-text.ts](<packages/dsh-memex/src/eval/evidence-text.ts>)、[program-evidence.ts](<packages/dsh-memex/src/eval/program-evidence.ts>)、[offline-report.ts](<packages/dsh-memex/src/eval/offline-report.ts>)、[offline-outcomes.ts](<packages/dsh-memex/src/eval/offline-outcomes.ts>)、[round.ts](<packages/dsh-memex/src/eval/round.ts>)、[report.ts](<packages/dsh-memex/src/eval/report.ts>)、[prepare-item.ts](<packages/dsh-memex/src/eval/prepare-item.ts>)、[routing.ts](<packages/dsh-memex/src/eval/routing.ts>)、[storage-reader.ts](<packages/dsh-memex/src/eval/storage-reader.ts>)、[artifact-location.ts](<packages/dsh-memex/src/eval/artifact-location.ts>)、[eval-report CLI](<packages/dsh-memex/src/cli/eval-report.ts>)。
  - 遥测：[record.ts](<packages/dsh-memex/src/telemetry/record.ts>)、[sink.ts](<packages/dsh-memex/src/telemetry/sink.ts>)、[snapshot.ts](<packages/dsh-memex/src/telemetry/snapshot.ts>)、[telemetry/report.ts:1–180](<packages/dsh-memex/src/telemetry/report.ts#L1-L180>)。
  - 测试仅静态阅读：[tools.test.ts:1–205、430–494、680–734](<packages/dsh-memex/test/tools.test.ts>)（另检索全文件）、[eval-collection.test.ts](<packages/dsh-memex/test/eval-collection.test.ts>)、[run.test.ts](<packages/dsh-memex/test/run.test.ts>)；检索了其他自检测试的相关调用点，未把检索当成全文阅读。
  - 指定安装内核：[cli.js:3480–3744](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L3480-L3744>)、[7920–8029](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L7920-L8029>)、[8080–8794](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8080-L8794>)、[42440–42529](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L42440-L42529>)，另检索配置与环境读取点。
  - 为验证下载信任假设，继续只读检查安装内核的依赖：[resolveModelFile.js](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/node-llama-cpp/dist/utils/resolveModelFile.js>)、[resolveModelDestination.js](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/node-llama-cpp/dist/utils/resolveModelDestination.js>)、[modelFileAccessTokens.js](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/node-llama-cpp/dist/utils/modelFileAccessTokens.js>)、[config.js](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/node-llama-cpp/dist/config.js>)、[createModelDownloader.js:1–235、280–474](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/node-llama-cpp/dist/utils/createModelDownloader.js>)、[认证重试:45–104](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/ipull/dist/download/download-engine/streams/download-engine-fetch-stream/base-download-engine-fetch-stream.js#L45-L104>)、[fetch 实现](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/ipull/dist/download/download-engine/streams/download-engine-fetch-stream/download-engine-fetch-stream-fetch.js>)。

本轮是规划审查，closed 表示规划问题已关闭，不表示实现或测试已经完成。没有作者对话记录。未运行测试、build、安装、评测、内核 search 或网络请求；未读真实卡库或私有 gold set。只运行过工作目录确认与只读 git status；工具结果未显示非零失败。除整体替换本报告外，没有主动写入其他文件；没有写记忆卡。历史实测数字未独立复现。

## Round-1 Closure

| 第 1 轮条目 | 状态 | 本轮核对理由 |
| --- | --- | --- |
| C1 插件语义入口遗漏 | partially | 已承认入口并声明 BREAKING、增加零调用场景；但检查后的配置仍由内核重读，安全闭合尚未成立，见本轮 C1。 |
| C2 有效来源与连接边界 | partially | 已明确拒绝自动选择、Ollama 和远端 provider；但 local 的模型下载仍有可达的内容外发反例，见本轮 C2。 |
| C3 快照文件系统信任契约 | partially | 新增普通文件、链接拒绝、独占创建和权限要求；静态 lstat 不能承担所声称的竞态保证，且落点集合不完整，见本轮 C3、M1。 |
| M1 四题指标 | closed | 单目标误选率修正为 0.5，MRR 0.625 正确，并增加 OR targets 和空结果用例。 |
| M2 targets 语义 | closed | targets 已固定为 OR、无主次；multi-hop 明确仅为标签，不声称度量证据完整性。 |
| M3 快照配置与 parity | closed | 已冻结 nestedSlugs 白名单，计划抽共享纯函数，并以真实注册工具及真实内核做限定范围的 parity。后续模型缓存身份是新问题，另见 M2。 |
| M4 旧自检离线名次诊断 | partially | 已改从冻结全文读取、排除 index/list，并不改原判定；但正常空 search 的 recall 包装仍会被指定解析器判成 unknown，见 M5。 |
| M5 RRF 第二路及确定性 | closed | 已如实承认第二路含关键词分，固定 50/60/10 与同分规则；两个算例逐项重算均正确。 |
| M6 gold schema 与选集 | closed | 全文件校验后显式 --set、有界 schema、唯一性和 target 存在性已明确；个别 THEN 仍不可满足，作为 S2 的验收文字问题列出。 |
| M7 冻结观测与失败分母 | partially | 已保留 error 分母、增加版本化观测和重算；可变缓存哈希及成本观测未冻结仍破坏承诺，见 M3、M4。 |
| M8 成本口径 | partially | 已明确撤回 token 数，改报字符代理并允许 unknown；冷/热定义仍不符合每题独立 spawn 的真实路径，见 M7。 |
| S1 排除范围 | closed | 默认不再整类排除 research/decision，并说明过滤背景的外推限制。 |
| S2 叠加底文本与归档步骤 | partially | 本轮逐段核对未发现底要求丢失，D11 也照实列出一段文字和两个场景；但仍没有承载该检查的 tasks 或底文本指纹，见 S3。 |
| S3 历史动机表述 | closed | 已改为“现有规划材料没有记录额外论证”，不再把仓库外是否论证过当成已证事实。 |

**合计：closed 7，partially 7，open 0。** partially 不等于可批准，尤其三条 Critical 的核心保护仍未关闭。

## Findings

### 🔴 Critical (blocking)

#### C1. 检查 local 后内核重新读取配置，环境强制值不能防止 provider 被改回远端
- **位置**：[memory delta:15–23](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-memory/spec.md#L15-L23>)、[design D5:45–51](<openspec/changes/dsh-memex-retrieval-suite/design.md#L45-L51>)。
- **问题与反例**：插件读取普通配置并验证 local 后、子进程读取配置前，另一个编辑器或同步进程把配置替换成带内嵌 key 的 openai 配置。内核 [search 装配:42489–42493](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L42489-L42493>) 会重新读配置；[createEmbeddingProvider:8093–8107](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8093-L8107>) 使用 `options.type ?? env`，所以配置中的 openai 胜过强制的 `MEMEX_EMBEDDING_PROVIDER=local`。即使删光环境 key，配置中的 key 仍足以发出请求。模型路径与 nestedSlugs 也可在此窗口换值。拒绝软链接不防普通文件原子替换。
- **为什么重要**：新版把来源检查当作解除禁令后的主要保密保证，却没有让“检查的配置”等于“内核实际消费的配置”。卡片全文仍可被远端向量化；事后检查配置 hash 已来不及。
- **建议修法**：让内核只能消费本次已验证、白名单化、受控的配置与卡片视图，明确配置不可在检查后被重新选择，且不要改写原库配置。如果不准备为插件增加这个隔离执行面，首版最便宜的安全选择是保留 semantic 参数但暂时全部拒绝插件语义调用，仅评测支持独立冻结视图；逐字保留描述并不强迫执行任何参数。新增同步替身在“判定完成→spawn/readConfig”之间替换普通配置的场景，断言远端请求为 0、敏感内容未离开本机；不能只断言环境有 local。

#### C2. local 的下载过程可通过 HF_TOKEN_PATH 把卡片当认证令牌发送，信任假设并不成立
- **位置**：[memory delta:19–25](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-memory/spec.md#L19-L25>)、[design:75](<openspec/changes/dsh-memex-retrieval-suite/design.md#L75>)。
- **问题与可达反例**：`localModelPath` 只校验最后的模型名，因此 `hf:org/private/model.gguf` 或任意末段合法的 HTTP(S) URL 都可通过。内核 [8319–8335](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8319-L8335>) 把整串交给 resolveModelFile；依赖 [78–145](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/node-llama-cpp/dist/utils/resolveModelFile.js#L78-L145>) 默认自动下载。设置 `HF_TOKEN_PATH` 指向一张**单行、可用于 HTTP header 的普通 Markdown 卡片**，不设 HF_TOKEN；HF 下载收到 401/403 时，[token 读取:22–34](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/node-llama-cpp/dist/utils/modelFileAccessTokens.js#L22-L34>) 会读取整张卡并构造 Bearer header，[下载重试:62–75](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/ipull/dist/download/download-engine/streams/download-engine-fetch-stream/base-download-engine-fetch-stream.js#L62-L75>) 将其发给下载服务。外发发生在模型加载失败之前，最终报错不撤销泄露。所列环境清理完全没有覆盖这条链。
- **核对边界**：在固定 local 且配置不变时，内核没有因 OpenAI/Azure 环境变量而自动换 provider 的分支；不能把漏删变量本身虚报成自动外发。但清理列表确实还漏了内核读取的 `MEMEX_AZURE_OPENAI_*`，而 HF_TOKEN、HF_TOKEN_PATH、HF_HOME、XDG_CACHE_HOME 及用户 token 文件读取属于另一条真实出网路径。普通模型下载没有把 embedding 文本作为请求 body，不足以证明“下载不携带卡片内容”。下载还会写到默认全局模型目录，而非快照内。
- **为什么重要**：这是在 provider 始终为 local、配置不发生竞态的情况下也成立的外发反例，直接推翻替代安全边界中的信任假设；只限制缓存文件名无法阻止。
- **建议修法**：首版只接受预先存在的、规范化绝对路径的普通本地模型，核验实际文件与 sha256，拒绝 URL/HF URI、符号链接和缺失文件；默认模型也必须先由人显式预置并解析为受控本地文件，不在带私有卡片的进程里自动下载。若确要保留下载，须分离为不接触卡库、无私有环境/凭据文件访问的独立准备阶段，并单独定义下载来源、写域和授权；这不再只是“清理几个 provider key”。补 HF_TOKEN_PATH 指向单行卡片及未知 HTTP 下载的拒绝场景，断言读取和网络调用均为 0。

#### C3. lstat 后按路径打开存在中间目录替换窗口，所复用 helper 不能证明“读取前拒绝”
- **位置**：[evaluation delta:7–9](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L7-L9>)、[design D2:35–39](<openspec/changes/dsh-memex-retrieval-suite/design.md#L35-L39>)。
- **问题与反例**：完成完整链 lstat 后，把 `cards/sub` 改名并替换成指向库外的链接，随后读取 `cards/sub/x.md`。声称可直接复用的 [fixtures.ts:60–69](<packages/dsh-memex/src/eval/fixtures.ts#L60-L69>) 仅对最后一个组成部分用 O_NOFOLLOW；父目录仍被跟随。fstat 只检查普通文件和 nlink，没有与事先观察的 dev/ino 绑定。任意真实库没有随包固定的可信内容 hash，即使事后发现内容不同，也已经读取了库外文件。写入侧 [fixtures.ts:90–102](<packages/dsh-memex/src/eval/fixtures.ts#L90-L102>) 也是检查父链后再按路径递归 mkdir/write，未持续绑定目标身份；可替换祖先会使写入重新落回原库。0700 不阻止有权改名其父目录的人替换目录项。
- **为什么重要**：规范明确要求在读取链接目标或写出界之前拒绝，但设计只给了静态检查。运行前后内容 hash 对读越界和已发生的写越界都不是预防措施；“两次核验足以发现外部改动”也遗漏改动后恢复的情况。
- **建议修法**：明确并落实威胁边界：若防并发不可信目录替换，需要使用绑定目录身份的文件操作，至少把文件打开后的身份、稳定性及祖先身份纳入契约，不能把 O_NOFOLLOW 叶子检查称为整链安全；如果不做这类实现，必须把源树静止、祖先目录不可由并发不可信方改名写入列为执行前提，并拒绝不能建立该前提的路径，收窄绝对安全声明。添加读前中间目录替换、创建前父目录替换、运行中替换后恢复的确定性竞态场景。只在测试前放一个现成软链接不够。

### 🟡 Moderate

#### M1. 不重叠检查遗漏其他配置库及报告目录，仍可往真实库写报告或副本
- **位置**：[evaluation delta:9、155、163](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L9>)、[design D2:36](<openspec/changes/dsh-memex-retrieval-suite/design.md#L36>)。
- **问题**：proposal 声称与“任何记忆库”不重叠，规范实际只检查默认命名空间的库与输入原库。现行 [scope spec:117–124](<openspec/specs/dsh-memex-scope/spec.md#L117-L124>)、[resolver:228–243](<packages/dsh-memex/src/scope/resolver.ts#L228-L243>) 允许其他 scope 使用仓内配置库。以默认 personal 为输入，把新快照建在另一个已配置仓内库里，按现有文字会通过。报告目录更没有同等边界；即使快照安全，把新报告/冻结观测写进原库的新子目录仍不受第 9 行约束。独占创建只防覆盖，不防未经授权的新增。
- **为什么重要**：可能把私有 cards/gold 复制进会随项目提交的另一个库，或破坏“原库无新增文件”断言。这是不需要竞态的反例。
- **建议修法**：对快照、报告、冻结观测所有写域统一检查；库集合至少包括 resolver 可列举的配置 home、默认命名空间和显式输入，不能声称能发现未登记的任意库。先解析已存在祖先并检查相等/两向路径段包含，再独占创建、核对新身份；不能先 mkdir 再 realpath 后才发现已写进原库。补跨 namespace 的配置库、报告指向源库、共同字符串前缀但非包含的正常场景。

#### M2. 按文件名复制向量缓存会把不同权重混用，模型 sha256 不能为旧缓存背书
- **位置**：[design D2:38、D7:55](<openspec/changes/dsh-memex-retrieval-suite/design.md#L38>)、[evaluation delta:158](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L158>)。
- **问题**：先用 `/models/v1/embed.gguf` 建缓存，之后配置换成 `/models/v2/embed.gguf`，卡片不变。内核 [8319–8322](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8319-L8322>) 对两者都叫 embed；[cache:8464–8493](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8464-L8493>) 只查 model 名、版本和卡片内容 hash，不查权重。复制原缓存后，卡向量来自 v1，查询向量来自 v2，报告却记录 v2 的 sha256。即使维数一致，也可产生错误排名。合法文件名不代表向量可复用。
- **为什么重要**：评测测到的是混合坐标系，不是所声称的后端；模型身份冻结并未绑定卡片向量的生成身份。
- **建议修法**：首版删除“复制原库向量缓存”选项，空缓存重建最便宜。若保留，须有经过验证的权重指纹、生成协议、卡内容 hash 与缓存内容 hash 的联合身份；原缓存无来源证据就不能复用。补同名不同权重、模型文件被替换、缓存结构/维数异常的失败场景。

#### M3. 快照哈希没有排除可变 embedding 缓存，正常语义运行也可能被判 invalid
- **位置**：[evaluation delta:40–46](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L40-L46>)、[design:37–38、55](<openspec/changes/dsh-memex-retrieval-suite/design.md#L37>)。
- **问题**：哈希规则写“对每个文件”，运行前后核验“整体哈希”，没有明确限定不可变 cards/配置清单。语义内核 [8710–8717](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/dist/cli.js#L8710-L8717>) 每次 cache.save，冷启动还会新建缓存文件。按快照全树解释，正常 local-semantic 与 RRF 都改变哈希；按仅 cards 解释，则实现自行缩小了正式规则，而且配置是否冻结未被核验。
- **为什么重要**：三后端的成功场景与完整性规则不兼容，会让有效运行一律 invalid，或让不同实现选不同文件集合。
- **建议修法**：冻结明确的不可变输入 manifest（cards、白名单配置和需绑定的输入），整体 hash 只覆盖这个 manifest；可变 embedding 缓存单独记录初末状态、大小与身份，不计入不可变输入相等断言。补“创建/更新缓存仍有效”“改 cards/配置为 invalid”“快照出现未知输入文件”的场景。

#### M4. 删除快照后重算成本表缺少冻结数据，逐项相等承诺无法兑现
- **位置**：[evaluation delta:155–172、219–224](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L155-L172>)。
- **问题**：必须冻结的逐题数据只有 slug、状态、错误与耗时；成本表却还要“标题加首段”的字符中位数、原生依赖和缓存大小。仅有 slug 不能恢复字符数，运行结束后的缓存 footprint 也不在必需观测中。删除快照并升级/卸载依赖后，原报告可有数值，重算只能 unknown 或读取当前环境，均不满足逐项相等。
- **为什么重要**：这是 M7 修订后仍存在的可重算缺口。记录报告文本不能替代声明清楚可验证的计算输入。
- **建议修法**：逐题冻结最终截断结果的字符计数（明确字符单位及标题/首段的提取协议），同时冻结成本测量值、unknown 原因、冷/暖标记和分位数算法版本；依赖/模型/缓存 footprint 作为当次观测冻结。离线重算不得再读取安装环境或重新读卡。补返回文本不同长度、删除快照并换安装环境后仍逐项一致的场景。

#### M5. 成功的空 recall 搜索被指定解析器当成坏格式，无法区分“没找到”和“缺证”
- **位置**：[evaluation delta:241–248](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L241-L248>)、[design D8:57](<openspec/changes/dsh-memex-retrieval-suite/design.md#L57>)。
- **问题与证据**：带 query 的 recall 找不到卡时，内核 stdout 为空；插件 [tools/index.ts:577](<packages/dsh-memex/src/tools/index.ts#L577>) 把它包装成 `{mode:"search", content:"No cards found."}`。指定直接复用的 [parseSearch:3–12](<packages/dsh-memex/src/run/parse.ts#L3-L12>) 对该非块文本抛错。于是一次完整、成功、确定未召回的旧证据会被诊断为 unknown。新场景只测试 index 伪标题，没有测试这个最常见负路径；recall 还未像 search 一样明确核验 current 的 scope/home 归属。
- **为什么重要**：本功能目标就是拆开“没找到/找到没用”，正常未找到却归入证据不足，导致诊断最需要的负例不可用。
- **建议修法**：在版本化包装解析层先校验 JSON、mode、current 身份，并把该版本的确切空结果哨兵还原为已知空列表，再调用共享检索解析器；不要全局把任意非块文本当空。明确多次检索混有已知结果和 unknown 时的聚合规则，增加“空 recall→未召回”“另一库的同名卡→不算”“坏格式→unknown”三类场景，不改变原评分。

#### M6. 插件拒绝策略未同步现行语义场景与多库失败契约
- **位置**：[memory delta:15–23、36–54](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-memory/spec.md#L15-L54>)；现行 [integration:268–271](<openspec/specs/dsh-memex-integration/spec.md#L268-L271>)、[memory:48–50、163–176](<openspec/specs/dsh-memex-memory/spec.md#L48-L50>)。
- **问题**：现行“语义检索不做分段”场景仍对任何语义模式断言“查询按原样交给内核”；新要求对多数这种请求断言零调用。默认 scope 的“行为与不含本层时一致”也没有来源门禁例外。BREAKING 摘要不等于修改这些仍有效的 SHALL/THEN。另外，`scope:all` 中一个库 local、一个库缺配置时，现有实现 [492–507](<packages/dsh-memex/src/tools/index.ts#L492-L507>) 与主规范要求保留其他库结果；新文字“其余一律拒绝、不调用内核”没有说明逐库判定还是整次预检，新增测试又全部单库，可能实现成整次拒绝，带来未声明的多库回归。
- **为什么重要**：同一调用不能既零调用又把查询交给内核；全局预检失败还会把原来可用的其他库结果一并丢掉。作者已声明单库语义 BREAKING，但没有解决这两个兼容性契约。
- **建议修法**：修改相关原 requirement/scenario，把原样传递断言限定为“来源判定通过的语义执行”，为原生一致性明确安全门禁例外。规定来源检查逐目标进行、失败 scope 进入 failures，其他合法目标照常执行；若决定整次拒绝，必须显式修改部分失败规范并声明破坏面。补 mixed-local/denied、全部 denied、合法本地中文不分段的场景。保留生成的顶层描述原文，不手改生成文件；同步脚本和现有描述测试仍应有效。

#### M7. “其余题=热查询”不符合每题独立进程的实际成本，首次自动下载还会污染文本输出
- **位置**：[evaluation delta:221–223](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L221-L223>)、[design:60–64、77](<openspec/changes/dsh-memex-retrieval-suite/design.md#L60-L77>)。
- **问题**：[runKernel:24–35](<packages/dsh-memex/src/run/kernel.ts#L24-L35>) 每次独立 spawn；LocalEmbeddingProvider 的 context 是进程内实例状态，每道语义题都重新加载模型。第一题和其余题最多是 embedding **磁盘缓存**冷热之别，不是模型加载冷热；若按 D2 复制缓存，第一题连“首次全库向量化”也不成立。自动下载还在 [resolveModelFile:160–166](</Users/bytedance/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/@touchskyer/memex/node_modules/node-llama-cpp/dist/utils/resolveModelFile.js#L160-L166>) 向 stdout 打印下载信息，首题输出可能无法被 parseSearch 解析，不能把这归为不可预见的偶发错误。design 的“只影响离线评测”也不准确，插件合法 local 语义同样加载模型并受 30 秒默认超时影响。
- **为什么重要**：跨后端 p50/p95 会被初始化策略和缓存起点混淆，成本表不能支持声称的冷/热比较；允许的首次模型下载甚至没有正常可解析路径。
- **建议修法**：不必为测量引入常驻进程：明确报“首次端到端调用/卡向量缓存暖态的逐题端到端调用”，声明每次都含模型加载，冻结起始缓存策略与题序；初始化/下载独立准备并单列，不让日志进入结果解析。定义单题套件没有其余样本时为 unknown，选择固定分位数算法。增加空缓存/已暖缓存、每次重载、冷准备输出噪声的机械场景；修正插件影响说明。

### 📌 Suggestions

#### S1. 最便宜的交付仍是 lexical 基线加旧自检诊断，不必把模型下载与缓存迁移塞进同一批
- **位置**：[proposal:13–20](<openspec/changes/dsh-memex-retrieval-suite/proposal.md#L13-L20>)、[design D2/D5/D6](<openspec/changes/dsh-memex-retrieval-suite/design.md#L35-L53>)。
- **问题/影响**：本 change 同时承担数据集、真实库复制、三后端、模型来源门禁、插件行为变更和旧报告兼容；大多数阻断问题来自还没证明收益的语义能力，而不是“先有可回归基线”本身。
- **建议修法**：可保留插件 semantic 参数但先安全拒绝，交付 lexical 安全快照/冻结观测/名次诊断；语义阶段只认预置模型，再加 RRF。若仍一次交付，也应删除原缓存复制和自动下载，减少需要证明的信任面。顶层描述逐字同步不构成必须立即保留语义执行能力的理由；可以仅在 semantic 参数说明里披露限制，沿用现有 intent 参数本地补充的模式。

#### S2. 两个新失败场景的 GIVEN/THEN 不可满足，不能用它们声称已有完整失败验收
- **位置**：[evaluation delta:94–97](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-evaluation/spec.md#L94-L97>)、[memory delta:19、47](<openspec/changes/dsh-memex-retrieval-suite/specs/dsh-memex-memory/spec.md#L19-L47>)。
- **问题/影响**：空 gold 数组没有题 id 或题字段，却要求输出题 id 与字段名；“去掉目录后模型名为 ../../x”在 basename 语义下也构造不出来。后者不能测试缓存路径穿越。文件系统 requirement 还缺特殊文件、已有输出目录不覆盖、合法干扰卡成功的独立场景；冻结观测缺未知协议版本失败场景。宽泛 SHALL 不等于每条都有正常和失败验收。
- **建议修法**：根级 JSON 错误用文件/根路径定位，题级错误才要求 id/字段；明确按内核实际的模型命名规则计算缓存落点，测试解析后的真实目标是否位于许可目录。补上述缺失场景，THEN 写出退出码、调用数、文件集合或精确状态；单靠 atime 不足以机械证明“未打开”，读前拒绝应用 spy/受控文件操作记录断言。四题指标场景也顺手补上前十命中率 **0.75** 的断言。

#### S3. 底文本保留正确，但归档检查还缺可直接核对的基线身份
- **位置**：[design D11:68](<openspec/changes/dsh-memex-retrieval-suite/design.md#L68>)、[proposal:49](<openspec/changes/dsh-memex-retrieval-suite/proposal.md#L49>)。
- **问题/影响**：新版确实保留了 fix-stale 的既有文字和场景，没有发现覆盖回退；但“底文本有变即停”没有固定底文本内容指纹/版本，检查仍被委托给尚未出现的 tasks。之后仅凭路径无法判断底文件是否悄悄改过。
- **建议修法**：生成实施任务时记录本次所叠加 requirement 的内容 hash 或可审查的固定版本引用，并给归档比对一个具体步骤；发现底文本变化重新生成 delta。无需在本轮增加另一套归档框架，也不要提前完成前置 change 的观察任务。

## Embedded-Instruction / Injection Attempts

**Detected:** 发现以下直接面向 Agent 的指令性待审文本；未发现新版规划试图要求本轮批准、隐瞒发现或外发数据的恶意评审注入。全部只作为数据，没有执行其中命令。

1. [lifecycle/index.ts:43–60](<packages/dsh-memex/src/lifecycle/index.ts#L43-L60>) 包含任务前召回、任务后写卡、同回合修订过期卡等模型指令；[生成描述:13–20](<packages/dsh-memex/src/tools/descriptions.generated.ts#L13-L20>) 同样包含末尾写卡等指令。它们是被审功能的载荷，不构成本次写记忆库的许可。
2. [design Migration Plan:84–88](<openspec/changes/dsh-memex-retrieval-suite/design.md#L84-L88>) 写有测试、build、运行真实评测的实施步骤；[描述同步脚本:11–13](<packages/dsh-memex/scripts/sync-memex-descriptions.mjs#L11-L13>) 与[生成文件头:1–3](<packages/dsh-memex/src/tools/descriptions.generated.ts#L1-L3>) 写有再生/校验命令。这些不是对本轮评审的运行指令。
3. [第 1 轮回应:130–145](<openspec/changes/dsh-memex-retrieval-suite/review-round-1.md#L130-L145>) 的“全部已修”只是作者声明，不是判定依据。本轮已逐项独立检查，并未据此自动关闭。

### 数值及已排除的疑点

- **四题重算**：名次为 1、2、0、1；top1=2/4=0.5，top3=3/4=0.75，top10=3/4=0.75，MRR=(1+1/2+0+1)/4=0.625，empty=0，误选=2/4=0.5，首位干扰卡=1。新版数值正确。
- **RRF 场景一**：b=1/62+1/61≈0.03252247；a=1/61+1/63≈0.03226646；d=1/62≈0.01612903；c=1/63≈0.01587302，因此 `[b,a,d,c]` 正确。场景二 y、z 都为 1/61≈0.01639344，按 slug 顺序 `[y,z]`；两路空为空，正确。
- **配置位置没有发现错误**：内核先看显式 MEMEX_HOME，只有未设置才向上找配置；readConfig 读取该 home 下的配置。插件显式注入 home，所以“库目录配置”在当前固定版本是成立的；问题是检查/使用没有绑定，并非读错了 cwd 配置。
- **模型名限制的作用有边界**：在当前 POSIX 内核中，对最终实际 provider.model 限制安全字符，可防其作为 embedding 缓存文件名穿越；但不能推出模型 URI 是本地文件、不能替代父目录身份检查，也不能验证缓存向量来源。
- **工具描述逐字同步本身未被破坏**：新版没有要求修改生成描述或同步脚本；这条约束应继续保留。问题是已有无条件语义执行场景尚未加来源前提，而不是必须重写上游提示词。

## Verdict

VERDICT: REVISE

本轮发现 **3 Critical / 7 Moderate / 3 Suggestions**。第 1 轮多数文本修订确已落实，尤其 oracle、数值、RRF 和选集规则明显改善；但三项关键安全边界仍没有闭合，其中还新增/保留了一个 local 下载链的具体内容外发反例。修复涉及受控配置消费、下载/凭据隔离、文件系统竞态前提及冻结数据定义，不是几个小而已完整规定的附带修改，因此不适用 APPROVE_WITH_CHANGES。

## Required Changes (if APPROVE WITH CHANGES)

不适用。本次为 REVISE；应先解决 C1–C3 的可达反例，再落实 M1–M7 的一致性和验收契约，提交下一轮完整审查。

CHANGES_APPLIED: n/a

## Rebuttals

（作者回应，2026-11-03。连续两轮 REVISE 后已升级给用户；用户选择缩小范围：本期只交付关键词基线，插件语义请求一律拒绝，向量后端留给后续 change。）

- C1、C2：因范围变化不再适用。本期不执行任何语义请求，插件在参数层整体拒绝，内核调用为 0；向量来源的判定、配置一致性和模型获取，交给后续 change 定义。memory delta 已写明威胁模型。
- C3：部分修复，部分声明不在范围内。改为 lstat 链 + O_NOFOLLOW 打开 + fstat 复核，打开前就拒绝软链接。目录替换类竞态属于「能改本机目录的人」，按 memory delta 的威胁模型列为不在范围内（design D3、D7）。
- M1：已修。快照、报告、冻结观测三个写入域统一在创建前检查；受保护库集合含已配置的库；补跨库、前缀相同、已有目录三个场景。
- M2、M3、M7：因范围变化不再适用（没有语义后端，也没有缓存）。不可变输入清单已显式定义，包括「快照里不得有清单外文件」。
- M4：已修。逐题冻结字符数（按码点计，提取规则写明）和成本观测；补「删快照并改名安装目录后仍逐项一致」场景。
- M5：已修。包装层校验 current 的 scope 与 home，把 `No cards found.` 还原为空列表；补空召回、他库同名卡、坏格式三个场景，并写明聚合规则。
- M6：已修。语义请求在选库前整体拒绝，`scope: all` 也是零调用；用 MODIFIED 同步了 scope 原生一致性条款和分段要求中的语义场景。
- S1：已采纳，正是本次缩小范围的方向。
- S2：已修。文件级错误按 `$` 定位；删除无法构造的模型名场景；补特殊文件、已有目录、合法干扰卡、未知协议版本场景，以及前十命中率 0.75。
- S3：已修。proposal 记录底文件的 sha256，并写明归档前的比对步骤。
