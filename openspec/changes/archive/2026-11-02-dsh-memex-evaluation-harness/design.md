## Context

本文件替换前两轮未通过的设计。用户于 2026-10-27 在连续两次 REVISE 后授权按收缩建议继续。目标从通用效果评估降为固定虚构套件的真实 Host 自检；长期方法保留，不以自检冒充效果检验。

已核实的接口与限制：

- `src/scope/resolver.ts:85-92,233-240,403-410`：无 origin 时由 cwd 最后两段派生 scope；目录 workspace 声明可独立关闭 fallback/memory，不需把目录认领到固定 scope。
- 本轮调用已部署 `lib/scope/resolver.js` 的只读离线 probe：`mem/eval-a1/repo` 与 `mem/eval-a2/repo` 分别解析到 `eval-a1-repo`、`eval-a2-repo`，只可达自身；`nomem/eval-a3/repo` memory:false。此 probe 不创建文件或真实会话，不证明 Host 集成。
- 官方 `session/create` 可指定 sessionId 和 agentPreset；`selectModel` 存日常默认值，且保存异步排队。因此删除自动恢复写通道。
- 官方 spawn：fresh 不继承父会话对话，但继承父实际 standing preset。allow:[] 过滤继承工具，不过滤 own 工具；outputSchema 以 own structured_output 交结果。standard preset 会 own 注册 subagent，不可作为裁判父组合。
- maxDepth 是本次子代绝对上限；顶层父 depth0 的首个子代 depth1，应传 1。它不是自动继承到孙代的权限上限。
- 官方 one-shot `start` 返回前可能已 child.followup；返回后检查工具面太迟。factory setup→publish→串行 awaited agent/created→followup 是可挂门禁的顺序。
- idle/turn-end 不代表后台 jobs 已停止。现有 AgentHandle.dispose 是创建者持有的能力，`agents.get` 不提供所有权；不得伪造 disposer 或把取消 accepted 当资源已清退。

证据基准为当前 DSH 0.2.0-rc.2 compatibility runtime。相关包：dsh-subagent/lib/types/child-agent.js，dsh-subagent-in-process-driver/lib/index.js:161-217，dsh-tools/lib/index.js:2896-2985，dsh-agent-preset-registry/lib/index.js:675-718，dsh-agent-loop/lib/index.js:1800-1813,1929-1947。实现前必须重查版本；类型和静态源码不是 live 验收。

## Goals / Non-Goals

Goals：六个配对条件的普通顶层执行、受限 LLM 裁判、完整递归证据、安全身份/路径、离线重建报告和流量排除。

Non-Goals：自定义套件、业务输入、跨库拓扑、文件沙箱、封存集、正式校准、效果区间/排名/优化门槛、自动默认值恢复、部署日常 Host。实现仅在后续 apply 授权后进行。

## Decisions

### D1. 最小命令与固定数据

CLI：`selftest [--resume <round>]`、`report <round>`。输出根固定在用户私有 `~/.dsh-memex-eval/selftest/`；不接收题目/仓库/卡片任意路径。

包内固定数据包含三个题、gold、repo 普通文件、卡片、判据、评分协议和资源 manifest，manifest 哈希由发布构建代码常量固定，不信任可随题修改的本地 sidecar。题1 Know 有效知识，题2 Act 过期知识，题3 Act+写回；全部有无记忆配对。固定数据不是自适应挑选的效果题库。2026-10-29可判定性修正：题3向两条件共同明确给出“当前租约15秒”的待核验旧声明，但不提供当前正确值，也不要求写卡；避免nomem被要求猜仅存在旧卡中的15秒。旧冻结轮次不重判，报告保留历史输入与原判据结果；只有新登记轮次使用更新的发布manifest。

先 lstat 路径链和树，拒绝软/硬链接、额外条目、gitdir、同步元数据，再读取并校验字节。来源边界是受信安装包；不声称能抵抗篡改程序的宿主用户。固定内容降低输入来源风险，但普通被测会话仍有宿主文件/shell权限；即使虚构输入也不构成安全边界。

替代方案：路径叫 fixtures 就信任，已因第二轮 C4 拒绝；继续开放任意套件会重复未验证的安全承诺，延期。

### D2. 永不复用 cwd/home，删除槽位

执行路径：`~/.dsh-memex-eval-runs/{mem,nomem}/eval-<round-question-attempt-uuid>/repo`。唯一部分必须在最后两段之一，防止只改更高父目录却派生相同 scope。library：`~/.dsh-memex/<deriveScopeFromLocalPath(cwd)>`。root 的 judge 子目录关闭 memory/fallback。

受管配置只需 workspace declarations：run-root fallback:false；nomem 与 judge memory:false。不添加 pathPrefixes claimer，不指向固定 home，不新增绑定。发布方向沿用 local 默认 external，固定套件声明该语义；首版无跨库。

预检从 Host 当前生效配置的 resolver 取得实际解析，必须等于预期唯一库与集合。有冲突 scope、可达 personal、origin、memory 关闭不生效均拒绝。不靠 CLI 自己构造一份理想配置证明 Host 正确。

源验证→新父目录/no-symlink确认→独占目标→只写已验普通文件→本地 git init/初始提交→最终 git无remote/指针、无同步/链接验证。仓库不用 clone；不读取真实卡片内容以建立身份集合。独占新文件杜绝共享 inode，最终 nlink=1；现有目标拒绝不删。

旧会话再唤醒只指向旧路径，后续尝试绝不覆盖。仍不能阻止有意 shell 扫描其他路径，报告明确限制。

### D3. 一个 Host eval 桥，固定操作而非任意执行器

新增 `src/eval/host.ts`，只该模块从插件运行时导入；其余 CLI 模块不加载到日常循环。桥注册在现有 Connection 路由，沿用 Host authority/Origin/cookie 校验。Connection 的 authority 允许 loopback 或 trustedHosts，不检查 socket remoteAddress，故这只是现有 Host operator 认证边界，不是逐请求本机来源证明；不假装能辨识 CLI 进程。受信 authenticated operator 可访问该桥，与现有 Host API 同一权限边界。

操作：registerRound、readDefaultModel、judgeItem、cancelRound/status。无 saveSelection/restore 操作。registerRound 仅接受自检版本、模型配置与预算；从受信包校验固定输入，自己分配 canonical round 路径，不接受任意 path。桥保存实际冻结副本和哈希、绑定题目/条件/评分schema/提示，后续 judgeItem 只收 round/item/requestId。证据取自桥拥有的对应 session 账本，不收自由 evidence、schema、provider 或 parent 参数。未知字段拒绝。

调用具有稳定 requestId；已结束返回已有结果，不重启；运行中返回已知状态；提交不确定时先查状态，不自动重复。创建前写 raw sessionId，官方 create 用指定 sessionId；响应丢失仍可按身份核对。父身份由桥登记，不允许任意日常会话作为 parent。

### D4. 普通被测会话与明确的事后边界

被测会话经官方 session/create 使用普通标准 preset；首次 prompt 前 setMode MANUAL 并回读、selectModel 并核对。CLI预先保存指定sessionId，登记成功后才发题面。每个实际 request/header校验 provider/model/effort。

六个顶层条件会话首个 prompt 前，调用官方 `session/rename` 写入固定非题面标题 `Memex selftest <round>/<question>/<condition>/<attempt>`，回读确认 user-pinned；失败不得发题。此操作阻止默认 Host first-prompt 标题 provider 另发 `purpose=session-title` 请求，不全局关闭日常标题服务。最小裁判 preset 不会关闭 Host 标题服务；裁判父不收 prompt，fresh 子 Agent 有 parentSession，默认标题策略不触发。真实默认标题 provider 与 mock adapter 共装验收：六个条件 title 请求数=0，未登记日常会话仍自动生成标题。

保持普通委派能力，不声称 MANUAL 禁止显式子 Agent 选其他模型。Host 监听创建/lineage记录递归后代，采集其配置、动作、写入和成本。后代变路线→整题配置不符；缺任一证据→证据缺失。**这是用户接受的首版事后审计，不保证首次外发前拦截，不得送入业务内容。** 裁判自身则仍执行冻结路线与无危险工具要求。

路线声明记录计划选择与实际观察，不把声明解释为所有普通工具外发的强制allowlist。启动确认必须解释其差异。

### D5. 最小裁判 preset 与首请求前执行门禁

新增独立 preset `memex-eval-judge`，只装 `@deepseek-ai/dsh-agent-tool-presentation` mode:native（可加固定纯 persona）。不装 coding/AGENTS/skills/bash/fs/delegation/workflow。Host 默认全局工具仍须显式 mask。创建父时必须在 setup 真实 `agentPresets.mount`，meta 只是记录，见 integration-pitfalls 第1节。裁判父 cwd 在 memory:false/fallback:false，无prompt、无selectModel。

官方 fresh spawn 参数：allow:[]，maxDepth:1（只允许此次depth1创建），agentOptions explicit provider/model/effort，outputSchema。不用 deny-all fallback，不要求绝对零工具。

`agent/created` 串行 awaited listener 在 exact registered parent lineage 的 child 上、followup之前：登记child；安装 child scoped `tools.guard`，除了structured_output拒绝所有执行（包含 own 工具）；安装 Host/root 侧的 `llm/stream` listener（事件绑定 LlmRuntime，不能只注册在 child context）。使用即将交给 `next()` 的真实冻结 loop request：按 `options.sessionId` 查创建窗口登记的精确 child 对象，要求 `agents.get(id) === registeredChild` 且 `agents.isOwnedBy(id, registeredParent)`；仅 durable parentSession/cwd 不算绑定。对精确请求的 tools/schema、route、messages 和允许的 Host 管理上下文核验，不重新 assemble 替代快照；裁判身份未绑定或不符时拒绝。assembly hook可作附加诊断，不能称最终边界。首版限文本/native，可信下游 middleware 不改写或旁发请求。用真实依赖 mock adapter 证明：正常 structured_output 成功；后置 assemble 注入 own subagent 或 AGENTS 时 adapter 调用数为0；相同 durable lineage 但错 live owner/child 拒绝；无关日常会话不被门禁影响。核对 native工具集合恰为structured_output、schema等于冻结值，异常throw阻止LLM；无法建立该调用边界则裁判验收失败，不继续live自检。执行guard负责后置注册的危险工具，即使先前schema通过也不能调用；guard在真正tool.execute前会再次检查。不得 inject异步后同步断言，也不得start返回后才设门禁。

extra上下文：memory:false阻止Memex引导；最小preset不加载AGENTS/skill；fresh不带父对话。可信Host可能仍注入runtime/time；记录完整实际消息来源与系统prompt，裁判协议明确这些管理上下文允许、其他题面/库/AGENTS/skill来源拒绝。不得说“只有prompt，无任何Host上下文”。在每次请求前验证有效工具及上下文面；对应可信插件不得在门禁后扩权。恶意Host插件不在本框架防御范围。

真实依赖与mock模型集成测试必须证明首请求前拦住own subagent、AGENTS或未知上下文，并成功取得structured_output。不能证明则能力探测失败，selftest未完成，禁止“全部unknown也算跑通”。这些是实现验收义务，目前仅静态机制确认。

### D6. 生命周期、预算与身份

私有账本持raw session/job/subagent-run ID及父关系，用于取消和恢复；公共registry仅哈希。Host创建事件写递归登记，不能等题目结束。

被测普通会话创建的disposer由官方controller持有，eval桥不能通过agents.get取得销毁能力。用户已于2026-10-27确认采用“归档静止，保留根对象”：仅对登记测试根调用 workspaceRegistry.archiveSession(id,{stopActivity:true})，再对 exact Agent cancel（不保留inbox）并 await whenIdle，禁止用归档/idle证明jobs释放。归档记录阻止后续模型步骤，但不是AgentHandle.dispose，也不是历史删除；日常会话不受影响。

在任何本轮资源创建前订阅 jobs.events（owners:all），按raw owner关联到本轮账本，记录Host进程generation。回调写入失败必须设置sticky unhealthy并停止轮次，不能依赖被框架吞掉的异常。jobs.list(owner)还返回unowned，必须再次filter exact owner，只取消真正本轮owned资源。kill仅requested，wait/terminal/空列表不证明释放。可信producer的done契约要求释放后resolve，因此只接受连续注册→completed/killed结算证据；所有failed（含producer拒绝或teardown强制failed）、缺事件、未证明已removed、跨Host generation均停止并给raw身份。不解析detail字符串推断释放。

先证明逐owner jobs释放，再 await subagents.drainContinuableDescendants([exactRoot]) 关闭continuable admission并等待在途materialization/child-first dispose；drain及合法one-shot owner收尾都可能向parent.inject结算通知，因此二者均完成后必须再次对exactRoot cancel（不keepInbox）、await whenIdle，并最终复核inbox空、账本/jobs无未证明资源。在清退窗口中新建资源也须监测，静止核验前仍有未知资源则停止。

释放证明与registry记录删除分开：可信registered→completed/killed结算已经证明释放时，record仍listed不阻止继续，无需等待removed；如果record已经removed，必须保存其先前的连续释放证据，不能因记录消失放行。“未证明已removed”指缺乏释放证明却记录已消失，不是要求所有记录先删除。one-shot只能由其合法owner收尾，桥不冒领handle；无法证明即停。裁判由桥拥有run并finally dispose。旧路径永不复用，跨Host恢复无法证明资源释放则拒自动续跑。若未来要让failed job自动继续，需要core提供释放来源证明，当前不扩展core。

裁判由桥拥有AbortController、SubagentRun：每次时长和maxTokens固定上限，断连/超时/异常abort，finally await dispose（官方run返回后dispose；启动中异常依signal清理）；Host服务卸载取消所有active runs。清退失败停止轮次。不得把turn/end/idle作为jobs结束。

启动确认：3主条件+3对照+1裁判父；题3双条件追加2回合；按固定plan逐条件计算所有语义项最大调用，包括对照。例每条件2项就是12次。普通自发后代数未知、成本单列，预算是软监测上限而非硬屏障。CLI退出/重启检查未清退身份，不自动重发prompt或重试裁判。

### D7. 默认值只读告警

桥只调用 `agentDefaultModel.currentSelection()`；运行前保存；selectModel会写默认这个副作用在确认中披露。结束读取但不推断写入者，不写回；硬中断可能漏结束检查，下一次CLI从持久待确认记录提醒。用户手动通过日常模型选择恢复并明确确认后标记已处理；工具无restore endpoint。异步save可能尚未稳定，告警不声称原子snapshot或CAS保护。

### D8. 冻结、证据与报告

round/input保存规范化实际题目、gold、manifest、计划、模型、judge协议、版本；hash逐文件校验。之后report完全离线，用旧副本不读当前题目；输入损坏拒绝，版本升级不静默重判。

原始多帧zstd完整解码，seed按身份去重；只外发必要text/工具证据，不外发reasoning。后代事件按session+seq/callId定位，缺失即显式标注。成功write/update/archive事件与diff用于分类，不能仅凭工具被调用推断成功。

每评分项保留选段event定位、内容、hash和裁判响应，报告分别给采集范围、程序检查、裁判实收范围和人工复核范围。yes/no引文必须至少一条且trim后非空，逐字核对来源；unknown可无引文并给reason。存在性≠支持性，未校准LLM评分只供链路自检，任何人工/LLM争议回源仲裁，不能多数票。

### D9. 分支诊断，不再用漏斗绑架端到端结果

固定适用表：有记忆Know R→K；有记忆Act R→A；无记忆K或A；W是所有写回题独立观察。某层N/A跳过；层内no优先fail，其次unknown，全部yes pass，无适用N/A。R以事实到达为固定必要项，其余召回时机/补检索等首版只列诊断，不让模糊“意识”隐含决定层通过。

共同终点对所有计划条件给出，包括R失败但查代码答对。条件漏斗仅诊断前驱pass子集，另外列所有未入分母与终点状态。写回按成功写入时刻，之前明确要求优先于提醒，否则主动，未来要求不追溯；无成功写入→未写回；成功与失败分开。

不做效果区间、主题聚合分数、总体净节省、显著性或门槛。配对成本给原始调用数及input/output/cached分类，不用任意20%定义高低区分度。缺token给unknown；相同结果保留。自检全部语义unknown/基础设施失败时非零退出并标未完成。

### D10. 消费端过滤

公共 eval-registry.ndjson存round/role/scope/sessionHash/parentHash/status，算法复用telemetry/snapshot。recall-report按登记或eval- scope过滤；report.sh跳过eval-库；insights在归根与cache前按登记及cwd run-root识别并扩展后代。坏行/缺文件警告一次，采用后备规则，未知条目不谎报剔除。报告命令仍只读，无网络/写入。

## 方法论迁移映射

本轮不再维护额外JSON映射/“脚本验证语义等价”的基础设施。此表是人工可复核的去向记录；后续开放正式评估时重新逐条建规范。

| 原原则 | 去向与理由 |
|---|---|
| §1 两类方法互补、非总体效果 | implemented-selftest：强制结论边界 |
| §2.1 调用主账/seed去重 | implemented-selftest：递归事件去重，遥测只排流量 |
| §2.2 相关≠贡献；2.3 未见≠失败 | implemented-selftest：诊断与端到端分开；unknown与执行错误分开 |
| §2.4 区分度 | deferred：自检只给共同终点与成本原数，不删相同结果控制 |
| §2.5 分歧按源仲裁 | implemented-selftest：保留原原则，不把人工默认当真相 |
| §2.6 验证深度 | implemented-selftest：实际选段/检查/人工覆盖，不把采集当阅读 |
| §2.7 不回填历史 | implemented-selftest：保存实际冻结副本；历史审计另行 |
| §3.1 workspace/跨库/抗串仓/保持设置 | 单库顶层implemented-selftest；跨库等deferred，无泛化主张 |
| §3.2 独立出题/禁用词/五题型/四状态/固定源码gold/检测点 | deferred：固定可信自检数据不是人审业务题库 |
| §3.3 漏斗 | corrected：适用分支及条件诊断与全计划端到端并列，避免后选择分母 |
| §3.3 事实到达 | corrected：链接仅证明链接文本到达，非目标事实；替代卡可以提供事实 |
| §3.3 写入隔离库 | implemented-selftest：独立test库，不宣称OS隔离 |
| §3.4 先验/似然/后验 | corrected：只是调查策略类比，非数学身份；过期题核验源码 |
| §4 程序/裁判分工 | implemented-selftest：事件机械判，语义由未校准裁判自检；正式语义质量deferred |
| §4 裁判unknown/引用/不同模型/粗粒度 | implemented-selftest：可选不同模型、冻结路线、yes/no/unknown；引用只校来源 |
| §4 20–30校准、每轮3–5复核 | deferred：本轮3题不假装校准完成 |
| §4 程序证明阅读/内容合格 | corrected：只能核对消费片段与引文存在，不证明实际理解 |
| §5 矩阵/总分/主题/区间/门槛 | deferred：无总分保留，正式推断后续建模主题聚类/异质性；不是主题数唯一有效N |
| §5 区间重叠判改善 | corrected：重叠与否不能替代配对/聚类变化检验；本轮无改善结论 |
| §5 历史场景先验权重 | corrected/deferred：是事后分层加权，不是贝叶斯先验；偏置历史样本不能代表真实流行度 |
| §6.1 内容修复分开；6.2 留出；6.3 持续补题；6.4 分层抽题 | deferred：保留人工流程义务，不把记录数字当履行；不以留出单次不变证明过拟合 |
| §6.5 真实使用复核 | deferred：历史审计独立工作 |
| §7 不改真实库/副本无同步 | implemented-selftest：可信源白名单重建，不复制git/sync；宿主权限未隔离 |
| §7 业务库同等/声明服务商 | deferred：本轮拒业务；普通委派事后审计只披露，不作为外发限制 |
| §7 固定模型/干净输入/流量排除 | implemented-selftest：逐请求核验、永久唯一路径、消费端过滤；gold真正隔离deferred |
| §8 撤回结论 | 保留，不重引 |

方法论文档在本 change 不删除长期原则；归档前把corrected理由链接回本设计，正式迁移在后续change完成。

## Risks / Trade-offs

- 普通会话仍可读真实文件或gold：显著风险确认、已知越界事后停止，仅受信固定自检；不是安全沙箱。
- 普通委派可能外发其他路线：接受首版事后审计限制，不把配置不符当预防；业务运行延期。
- Host扩展可能增工具/上下文：每次装配门禁+工具执行guard，实际依赖集成和live验收；恶意宿主插件不在边界内。
- 永久路径留存占空间：三题串行优先安全，不自动清理；清理需另行证明所有关联资源静止。
- 资源服务不支持恢复某job：停止自动化，给raw身份，由人工处理；不自行绕过disposer所有权。
- 默认模型改变不可自动恢复：运行前确认、持久原值、结束及下次提示，不覆盖用户选择。

## Migration Plan

规划阶段不构建/部署。后续apply先做真实依赖mock模型测试与3题夹具；受管manifest增加最小preset、目录声明和skill，按现有流程build两遍验幂等，live运行需用户授权。部署前不得改日常3080或起替代Host。回滚撤桥/preset/skill/声明并恢复pin，测试目录保留不自动删；默认值由用户手动确认，流量登记保留以免历史污染。

## Open Questions

无作为默认成功前提的未决选择。首次请求门禁、裁判真实工具面与owner/jobs恢复属于明确实现验收门槛：不能完成就自检失败，回到设计评审，不以日志参数正确冒充通过。
