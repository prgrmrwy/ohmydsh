# Header 社区方案核验（2026-10-07）

> 最新结论：已找到正式cost-meter1.8.4可与原header0.1.0共存，候选pin已调整，暂不需要禁用任一插件。支持0.2且不改源码；真实Host/浏览器基础功能与sync幂等通过，完整账本/计费/实际OpenCode矩阵仍未放行。下方早期社区选型为调查历史。

## 结论

原 `beihzb/dsh-opencode-session-header` npm仍仅0.1.0，无新版可直接升级。相同递归已有社区issue，未关闭且无评论/PR。不是cost-meter独有缺陷，也不是0.2才出现。

最新已发布cost-meter为1.8.15。下载npm精确产物与原header0.1.0、不改源码，在devbox无网络stub组合复现：header-first→RangeError/transportCalls0；cost-first→transportCalls1。因此只升级cost-meter不能解决原header包装结构。

## 社区证据与候选

- [原header npm元数据](https://registry.npmjs.org/dsh-opencode-session-header)：latest0.1.0，唯一版本，发布时间2026-09-07。
- [原header issue #1](https://github.com/beihzb/dsh-opencode-session-header/issues/1)：2026-09-19，DSH0.1.5-rc.2，与vision-router2.2.0组合递归、启动阻断；描述相同mutable-underlying/accessor闭环。检查时open、0comments；[PR列表](https://api.github.com/repos/beihzb/dsh-opencode-session-header/pulls?state=all&per_page=30)为空。
- [cost-meter1.8.15发布](https://github.com/Han-1413141/dsh-cost-meter/releases/tag/v1.8.15)：新改动为费用明细布局/刷新；实际npm native-search-fetch仍捕获原fetch再赋值包装，本轮组合复現仍失败。
- [mathangler同名插件](https://github.com/mathangler/dsh-opencode-session-header)：GitHub源码package0.1.1，精确commit689306e63a84a6a84103833d80b644bf0dfa5071，不是原npm包升级/原作者新版本，无tag。只包装pi-ai adapter.streamWithSnapshot与models.streamSimple，在参数headers里加头，不写global fetch，不改安装文件。仅route key opencode-go*，不含opencode-zen及其它adapter，因而不是原来opencode域全覆盖的无损替换。
- mathangler原样19policy +11host/wiring测试在devbox通过；这些是单元/宿主fixture，不是完整真实Host验收。其真实adapter套件默认假设dsh/node_modules目录布局，在现有0.2安装中ERR_MODULE_NOT_FOUND；本轮未修改该套件或生产依赖、未宣称10项integration通过。只读查找确认官方0.2 PiAiAdapter仍具streamWithSnapshot和snapshot.models.streamSimple、传sessionId/headers、sendSessionAffinityHeaders仍withhold。存在相容形状不是实际出站证明。
- [lansi-ai替代](https://github.com/lansi-ai/dsh-llm-opencode-session)：仍包装全局fetch，ID按首条用户消息启发式，压缩后变ID、同首条消息会共用ID。非等价，不推荐作为本次稳态解决方案。
- [viztor dsh-opencode-patch](https://github.com/viztor/dsh-opencode-patch)：声明0.2.0-rc.2验证，覆盖Zen/Go，但包含全局fetch patch、UA/来源/项目/父会话头、tool fallback、模型发现及额度UI/凭据读取。比本次需求大，尚未源码全审/组合验证，不能为解决单一header冲突直接引入。

## 现役为什么正常（本轮只读核验）

本机与devbox生产实际安装的cost-meter均为**1.7.30**，header为0.1.0。devbox原cost-meter lib/index.js与npm1.7.30逐字节一致；整个发布包未找到globalThis.fetch/target.fetch赋值或observeSearchFetch，native-search-fetch.js不存在。生产header entry SHA256与原npm0.1.0一致。候选cost-meter1.8.11以及最新1.8.15新增native search的fetch observer，才与header形成互相调用环。

因此：header的潜在组合缺陷早已存在，但现役没有触发该缺陷的新版cost-meter包装。不能将“0.1.5社区也能复现”误写成“我们的现役已经在失败”；本轮确认的是现役与候选插件组合不同，而非已证明DSH0.2自身制造了该环。磁盘包核验不声称读取了进程内函数。

## 已找到无需二选一的正式中间版本

逐个下载并校验npm SHA512的22个0.2-compatible发布物：支持0.2的peer从1.7.44开始；1.7.44–1.7.49、1.8.0–1.8.4均无native-search-fetch/全局fetch赋值，1.8.5–1.8.15均有。因此取最后一个无该包装的**1.8.4**，不退回不兼容的1.7.30，不需要源码改动。

1.8.4两项peer含`>=0.2.0-rc.1 <0.3.0-0`；package明确列0.2.0-rc.2 compatible。integrity：`sha512-xtcidwjxRTchiKFTOci8z8UyNTxvabBzvWpRKCbVkOlqcl39fneEqyBPFrdVTEyioc88L45fZ8agoE509KTCAA==`。

本机dsh.yaml候选pin改为1.8.4，header继续原0.1.0。devbox原样官方plugin add通过、header entry与原npm逐字节一致；真实0.2 Host + Chromium验证费用RPC/getState及Settings→Cost正常，pageErrors=[]。通过只绑定loopback的Node inspector确认原header pipeline确实在Host进程安装，临时替换其下游transport做无网络探针、finally恢复，确认请求会加x-opencode-session；未改源码/安装生成文件。旧启动日志缺失header logger行导致首次断言失败，不能以日志缺失认定未装配，已改为实际进程效果证据。两次独立Host退出均正常。

本机 authored manifest候选在devbox sync×2第二次no changes，官方dump cost/header各一条且不disabled、原header仍逐字节一致。浏览器验证仍使用先前验收专用bridge0.5.2适配产物；这是header/cost选择的隔离门禁，**不是完整正式组合GO**，正式bridge发布/迁移 gate仍未放行。

数据边界：此前1.8.11已经写过的候选ledger包含旧版不识别的两个billingMode，1.8.4有codec降级告警；干净storages候选UI/RPC/header探针也通过。不能删除用户价表去获得PASS，真实现役1.7.30账本迁移、实际模型usage计费与OpenCode真实出站仍需完整矩阵验证。生产本机/devbox1.7.30未改。

## 现役费用副本兼容验证（继续执行批）

只读捕获devbox现役1.7.30账本，远端制作0600脱敏副本：20天/80会话；会话id散列、标题移除、配置仅保留计价字段并移除URL/凭据引用。副本留在devbox，不展示原始账本或金额。读取/写回/重新加载1.8.4发布物后，全部历史day/session数字结构保持一致。合成新调用经原发布billing-stream监听器进入Ledger（而非改history），仅入账一次，1000 input/200 output/300 cacheRead的固定USD价表计算为0.0029；原session值不变、副本hash不变。该金额仅为测试价表，不是用户真实费用。测试fixture补齐官方精确0.2 peers、不改发布物；首次单独import失败是peer解析布局与Host module-loader不同，不是账本错误。

原header与原cost计费stream listener按两种顺序组合、并发两会话，头id均独立且各计费一次。均为合成网络stub，**不宣称真实OpenCode出站/实际付费模型调用通过**。额外live inspector并发探针遇到Node Runtime.evaluate不支持动态import，未计作成功；既有live单请求头注入/Cost UI证据仍有效。

同批只读重新确认公开bridge tags仍止于0.6.0，精确0.6.0源码仍访问`uiSession.pendingInteractions`与`SessionListState.current`。用户随后明确选择“bridge是自研，允许单独适配”，故自研bridge例外成立，第三方cost/header仍只用原样发布物、不为此patch DSH。既有0.5.2本机源码适配在devbox重新test/typecheck/build，34tests通过；cost1.8.4+原header0.1.0+自研适配bridge重跑Memory页面保存/Host回读/sync×2/dump/刷新全部通过，原scopes恢复、Host code0退出。见checking/current-main-bridge-memory-ui.md。不自动发布、不把正式pin指向临时产物。不得将Cost通过概括成全升级无问题。

## 按用户新增约束的方案

用户明确：兼容性处理**不修改任何插件、不对DSH做patch**。历史源码修复仅保留为诊断证据，不再作为正式部署解决方案；不主动换入其它adapter hook实现。用户最新优先级已改为：若中间版本完整验收不通过，保留OpenCode/header，显式禁用cost-meter；不执行此前建议的header暂退。下面header禁用影响仅保留历史选型参考。

可考虑将原header在升级manifest里设enabled:false，保留源码来源/版本说明以便以后重新支持；部署通过正常sync并重启候选Host，而不是手改安装文件。其bundle只插入一行插件，功能为llm/stream会话上下文与opencode.ai及子域请求加x-opencode-session，不写Session或业务数据，不需要数据格式迁移。影响集中于OpenCode：依赖该头的Go/Zen模型可能400 MissingSessionID，无法继续保证其可用；其它provider不依赖此插件注入。未审计用户实际Go/Zen用量，不能把影响说成零。

插件内部JSON/config enabled:false仅关闭加头，仍安装fetch管线，**不足以解除闭环**；必须停止装配整个插件并重启进程。本轮尚未执行正式禁用或生产重启。完整升级保留能力约束中的OpenCode例外应在用户确认接受暂退后明确记入任务/规范，并在devbox验证无header组合。

早期仅调查、下载与测试；后续本机候选dsh.yaml pin已改1.8.4。全程未改第三方源码或为此修改DSH core；未发issue/PR、未发布或生产安装。所有本地文件在托管root，devbox仅接收原样公开源/产物并做验证。
