# Implementation Log — dsh-collab

## Apply entry / prerequisite check — 2026-10-17

- 显式用户apply请求选择dsh-collab。官方openspec list返回本托管执行根；status为spec-driven，instructions apply为ready，初始0/22。
- 已重读CLI返回的proposal/spec/design/tasks，以及test-plan与最终review。review Round2/3 APPROVE满足1.1，因此只将该项勾选；未追认任何实现任务。
- CLI本版返回task id/description/done，没有sourcePath/line；直接read确认tasks.md第3行描述完全匹配后targeted edit。每次后续完成仍须重新核对原文并刷新apply。
- 前置只读Node解析检查：@deepseek-ai/dsh与@deepseek-ai/dsh-cordis-host-runner均MODULE_NOT_FOUND；这是捕获并报告的可用性结果，检查命令本身exit0。
- 可解析：Cordis4.0.4；dsh-agent-loop、dsh-api-session-controller、dsh-session-persistence-jsonl、dsh-agent-preset-registry、dsh-sandbox-policy、dsh-user-approval均0.2.0-rc.2。
- 因design D8/tasks1.3明确禁止静默安装、借日常profile或用自写signal handler替代发行Host，此处暂停并请求用户决定是否准备隔离发行运行体。未启动1.2真实组件harness，未完成1.3；没有任何真实Host验收结果，不能标记GREEN或skip通过。
- 未修改产品代码/manifest/依赖；未安装、部署、创建会话或运行外部模型；未改上轮Anvil验收、提交、合并、归档或清理。

## 现有组件测试 — 用户明确同意后

用户明确只做现有组件接入测试，不安装完整DSH、不动日常环境。新增两个测试文件，不新增package.json/依赖/manifest或插件实现：

- packages/dsh-collab/test/component-seams.test.mjs：真实Cordis/AgentLoop/ToolRuntime/LLM scripted adapter，三项探针。
- packages/dsh-collab/test/run-components.mjs：独立子进程，环境仅PATH与临时HOME/DSH_HOME标识，不继承凭据；受控绝对临时目录核验后清理。

实际结果：`node packages/dsh-collab/test/run-components.mjs` => 3 tests / 3 pass / 0 fail / 0 skip / 0 cancelled / 0 todo，exit0；git diff --check exit0。

1. component-identity：模型提交forged callerSessionId，真实工具execute取得的exec.agent.id/session.id仍为component-b，cwd仍为其workspace。
2. component-idle：idle followup返回void、新请求真实包含指针；持久内存事件user/message保留创建时的message.id与plugin:dsh-collab来源。
3. component-busy：脚本模型barrier挂起当前回合时提交followup，当前request不含指针；释放后第二request出现，真实inbox claim的turn不同且只admit一次。

最初测试有3个harness错误（非产品RED）：defineTool.output误沿旧接口而非当前schema/render；user/message数据误认data.message（当前是data本身）；turn应取真实inbox claim。读当前d.ts与AgentLoop源码后修正，未改产品，不将这些失败算TDD行为RED。随后审查改为busy主体finally释放barrier，防失败时dispose卡死；环境恢复/临时case清理亦在finally执行。早期仅隔离DSH_HOME的试跑未安装配置/persistence、只用ScriptedAdapter；最终runner加强为启动前清空环境并同时隔离HOME/DSH_HOME。早期空fixture经绝对路径核验后仅删除空目录，无raw session保留。

## 独立测试评审与修正

独立只读评审dd796501确认3个probe触达真实语义，但指出两项测试可靠性问题：busy after先dispose后release可能死等；AgentLoop吞driver错误导致仅whenIdle/seen断言可能假绿。已将busy gate释放放主体finally、清理放finally；harness收集agent/error并在每case断言为空、预期request数量、script消费完、turn/end全部completed。修正后重新执行runner：3/3 pass、0 fail/skip/cancelled/todo，exit0；diffcheck exit0。评审没有独立复跑，不把Lead重跑冒充独立执行。task1.2仍未完成。

## 冷恢复组件前提缺口

只读调研并用require.resolve复核：当前根缺`@deepseek-ai/dsh-fs-local`、`dsh-fs-sandbox`、`dsh-attachment-local`、`dsh-credentials-local`（均MODULE_NOT_FOUND）。已有dsh-fs/dsh-attachment/dsh-credentials为抽象服务接口，不可冒充concrete backend。SessionController还依赖FileUploads→Connection→Credentials，Connection激活立即需modifyRecord；不因只测文本就免除装配要求。

因此没有启动官方SessionController，不曾执行P1→P2冷恢复或sandbox/approval/worktree权限矩阵；task1.2仍未勾选。这3个probe只是该任务的部分组件证据，不标绿30个consumer验收场景，不替代task1.3发行Host启停链。

## 后续现有组件进展：JSONL checkpoint/reopen

新增component-persistence：真实JSONL persistence（compression:none）写入插件来源消息，显式sessions.flush返回true；释放handle并dispose旧Context，新Context通过官方persistence.open/read重读物理日志，断言同message.id只出现一次、source/content完全保留且没有激活live session。不是低层agents.resume替代SessionController，也不宣称preset/权限冷恢复。

最终runner：4 tests / 4 pass / 0 fail / 0 skip / 0 cancelled / 0 todo，exit0。该新增probe测试已有DSH功能，没有产品实现修改或TDD RED声称。

## 用户授权后的隔离具体组件与冷恢复

用户在问答中明确选择“允许补齐测试组件”，只在隔离目录准备精确官方组件、不安装完整DSH。已先ws promote确认mutable，再安装到忽略目录spike/collab-components；未修改根package.json/lock或日常profile。官方dsh-base@0.2.0-rc.2依赖元数据用于核对具体包名称，不安装base或dsh本体。

初次解析发现registry最新patch导致loader/include/group与Cordis4.0.4 peer冲突（ERESOLVE/ELSPROBLEMS）；没有force/legacy忽略。按当前仓库实际已用版本限定loader1.0.5/include1.0.9/group1.0.4，核验精确fixture依赖绝对路径后仅重建其node_modules/lock。最终npm install与npm ls --all均exit0，无invalid peer。可复核配方保存在非忽略的test/support/component-dependencies.json（待随源码加入版本控制，未声称已commit），README记录手动安装步骤及传递依赖不完全锁定的边界。

controller-seams.test.mjs全runtime从该单一隔离graph导入，避免与根Cordis/scope私有符号混用。真实fs-sandbox、attachment-local、credentials-local、SessionController全部inject、preset loader、JSONL、workspace/SQLite以及Bash sandbox等均是真实现，未空stub：

- controller-assembly：真实全部Controller服务激活，不启动webserver/完整DSH进程。
- controller-cold：官方create(P1)→select(P2)→flush true→销毁writer→全新reader官方resolveAgent。header仍P1，真实request/header工具面P2有/P1无。read-only/approval never从日志恢复；真实file write拒绝且字节不变/read允许；root和B同名不同内容文件的相对read命中B；无workdir Bash pwd命中B。Bash写入返回foreground、read-only、full enforcement、denied true、非零整数exit且无timeout/abort/signal/runnerFailed，不接受SANDBOX_UNAVAILABLE假绿；同agent只读Bash成功。实际turn内approval.request即使有允许answerer仍rejected，answerer未调用且拒绝audit存在；driver errors为空、turn completed。
- controller-worktree：独立临时真实git repo/worktree和schema2 operation，编译真实wire/containment/guard/recovery源码闭包，在agent/created用真实recoverBindingSync/installGuard；新Context官方coldresolve观测source=resume。danger-full-access下worktree内read成功、源repo read/write被guard拒绝且字节不变，不同cwd unbound会话同源read成功，隔离worktree归因。这是worktree recovery/guard组件hook，不冒充完整worktree plugin的HTTP/archive/reconciliation编排。

最终实际运行（Node v24.20.0 / npm11.19.0 / TS5.9.3）：controller runner 3/3、basic runner4/4，共7tests、0fail/skip/cancelled/todo；全部exit0。npm ls --all与diffcheck exit0。初步Bash过宽字符串oracle经独立review指出后已收紧结构化拒绝和允许对照；cwd行为与可保存recipe缺口亦修正。没有用新增产品代码制造GREEN，也没有声称这些已有组件探针具备产品TDD RED。

## 历史状态（task1.2时点，非当前进度）

独立只读复核90fd590b PASS；Lead已收齐最新3+4全部exit0结果后勾选task1.2，当前2/22。独立评审未独立复跑，不混淆执行来源。task1.3发行Host启停门仍未验证；30个consumer产品验收场景仍未实现。本阶段没有日常部署、用户凭据或真实模型调用。

## 用户授权提交并持续实施

用户随后明确要求先提交、再无问题持续推进完成。提交前重跑kernel38files/205tests及typecheck通过；目录相关68tests通过；组件4+3通过；根445tests中443pass、2既有MCP skip，无fail。新文件入index后治理测试首次发现历史review报告含机器绝对链接和错误根相对链接（此前未受git-index扫描覆盖），仅规范化这些引用为文档相对链接，未改评审结论；补test README中文对照、去末尾多空行后治理30/30通过，artifact/cached diffcheck通过。kernel build、三个change严格校验亦通过。提交bbf89108包含协作相关119文件；无关README Ponytail索引和.archify治理改动保留未提交，未擅自混入。旧verify的TDD历史偏差/skip/严格FAIL保持原状，提交不等于免除验收条件。

继续1.3只读查执行根没有官方dsh/lib/bin.js或dsh-host-runner。已依D8询问，用户明确选择“允许隔离准备并继续”。再次ws promote（mutable/prepared）后在忽略目录spike/collab-host准备官方@deepseek-ai/dsh@0.2.0-rc.2；仅测试运行体、不修改根依赖/profile、不重启当前GUI、不连接真实模型。安装及Host运行结论需后续真实结果，不提前勾选1.3。

## 官方CLI真实关闭接缝完成

隔离安装成功（538packages，exit0）；官方@deepseek-ai/dsh@0.2.0-rc.2的bin/lib profile-boot自带进程关闭控制器，不存在此前假定名为dsh-host-runner的独立信号包。bin→runProfile→SIGTERM interrupt(0)→root fiber.dispose→proxy清理，实际总预算5000ms（profile-boot-BZ2ZjNWi.js:12,46–68,230–254）。app-boot fatal-release2000ms与dynamicCordisRunner VM执行预算不是正常关闭预算。

新增released-host-seams.mjs直接启动原版bin、自定义空bundle profile、临时HOME/DSH_HOME及空cwd，不启动webserver、不读日常.env。native fixture仅挂真实FileStore及Cordis disposer，不定义signal/终止timer；budget注入真实append handle.sync barrier，在接纳commit后关停。外15s deadline仅失败清理，不算通过。首次ready事件hook未触发导致自然exit0，改awaited async apply后完成真实装配；这是测试fixture错误，不声称产品RED。

最终执行normal=4ms/code0/close标记存在/锁消失，budget=5011ms/code0/close未完成/原锁保留，kill=2ms/SIGKILL/原锁保留；残锁默认reopen LOCKED，只有收齐child退出且kill(pid,0)返回ESRCH后才exactID解锁。三项均核对新FileStore重放一条记录与物理日志字节不变；budget计时要求4900–7000ms，排除错误更长预算。完整runner exit0，diffcheck exit0。bin SHA256=1a03dee18683483ff6a1b27b2a1e650230da6bcca9a0f55f7d81b3308c3f307f；profile-boot chunk SHA256=c394b2aa2ce08a3b1fcc8c544257c7d689dd4d0b1cfaf8602687e65eeaba5aa1。

独立只读review e77fe8f6确认真实链与收紧oracle PASS（运行由Lead执行），勾选task1.3，当前3/22。该项仅kernel/官方Host接缝先验，未来consumer wrapper的完整acceptance-01/最终Host门仍未实现；不能把这些标识预先用于宣称产品完成。恢复旧Anvil历史偏差、日常部署/合并/归档仍不在此次提交授权内。

## 消费者实现进行中（尚未全量验收）

已新增Host ESM bundle/decl/types、源码alias与原字节Markdown复制、薄维护CLI；产物测试故意令kernel/lib抛错、改src约定版本/正文，复制后用Node权限限制禁读源码，证明当前源码与最终资源URL可达，漏Markdown副本确实加载失败。最初缺包构建契约assertion RED，后续误导入未公开defaultConvention、默认.mjs产物命名等构建错误单列，不追认成产品行为RED；使用直接内核src约定适配，不扩大kernel公开API。

配置先放无校验骨架，3个真实允许不该输入RED后实现canonical workspace/node_modules围栏、0700和稳定serviceId。provider工具先骨架真实行为RED（身份/发现/来源、20工具空集合、维护未拒绝）；晚恢复骨架测试原轮询超时属harness缺陷，改bounded调度与显式controlled resolve，不算产品RED。现初步unit15tests+artifact1全部通过，typecheck/build通过；精确20名称/19具名方法principal参数映射/原生错误剥离、归档与换代handle竞态均有回归。独立早期代码review1d49312d提出post-await归档/旧handle与caller异常漏出，已修正并加断言，尚待最终整体复核。

实际打包consumer已在真实Controller graph通过A/B不同cwd创建→邀请→join→条目ack→NO_DECIDER→dispose撤销工具保留日志→新Context重放serviceId/ack一致。首次SERVICE_NOT_READY暴露普通function apply被Cordis当constructor（忽略返回Promise）的真实装配问题；改async function apply，等待真实fiber.inertia后闭环通过。错误码COLLAB_NOT_ACTIVE的错误测试预期改为既有内核COLLAB_MEMBER_INACTIVE，不削弱身份拒绝。新增consumer冷发现/冷投递实验进行中，未提前勾场景。

默认禁用manifest、buildInputs、双语说明/MIT/docTier C已写，根lock更新workspace，但尚未产品全量验收/pack/sync幂等/最终Host wrapper门；tasks2–6保留未完成，后续逐项证据齐才勾选。用户授权持续实施，不改日常profile、不外部模型、不合并归档。

## 2026-10-18 当前进度同步与恢复检查

用户要求先处理进度同步再判断继续。恢复已有goal，仍使用spec-driven；官方status的isComplete只代表规划工件齐备，apply原为3/22，不能拿它当产品完成。重读实际实现/测试后，test-plan改成30场景实际文件/标题及分层证据，不再将有证据的实现一概写成未实现。tasks完成2.1/2.2（源码内联与独立copy产物）、4.2（具名工具实现）、5.2（受信离线维护实现），现7/22；其它任务因额外矩阵、真实模型工具链、pack/sync或最终Host门不齐仍不勾。2.3源码/文档已写但新文件治理复核仍待完成。

本次首次复跑17单元中16通过1失败：上一轮最后新增的checkCurrentLocation断言把COLLAB_BAD_CONFIG业务code误当Error.message，实际已正确抛Invalid collaboration Host configuration；修断言匹配code后17/17。随后产物1/1、基础真实组件4/4、Controller6/6均通过，无skip；typecheck/build/diffcheck exit0。未重跑的官方CLI三门保留上一轮结果，不谎称本次新跑。

补齐上一轮尚未写账的事实：consumer-cold-delivery现已观察官方resolve恢复P2真实request/header、插件来源指针；consumer-busy已观察卡住的当前request无指针，接受入队不等模型，释放后下一request一次及两turn完成。该busy测试曾超时，临时追踪定位为初始createUserMessage夹具漏source，触发官方Session-list projection访问event.data.source.kind抛错；补source:{kind:'user'}后通过，已去全部临时诊断，没有绕过官方resolve或削弱registry校验。这是夹具修复，不虚称生产忙碌策略bug。

只读复核abb99f3c提出3点：caller须exact live registry handle、close须allSettled排完所有空间、动态workspace新增须重新检查路径；源码均已修，但针对性完整回归仍未齐。本次继续顺序为先补这三项回归，再pack/CLI与最终consumer Host/部署幂等。现无依赖缺失或新增产品决策阻断，可继续已授权的隔离实施；不触碰日常profile/GUI、不真实模型、不合并归档。

### 同步后继续的首批验证

补session-registry未注册/已移除/同ID替换handle、修origin/depth/ownership夹具确实进入相应gate；host-close-drain控制一个store.close拒绝另一个真实store停在barrier，Host须等全部再AggregateError，健康锁释放/失败锁保留。该项是close边界回归，不夸称fsync barrier；实际在途commit排空仍需最终Host验收。consumer-workspace经官方WorkspaceRegistry运行时新增不相交目录允许，新增覆盖dataDir目录后读/写/创建全部拒绝且无新日志/锁；canonical符号链接围栏unit通过。新旧caller跨真实ToolRuntime异步gate仍待最终矩阵。未知枚举缺失/throw/null/wrongID全部不恢复，维护probe期间锁被换字节拒绝已补。

产物测试增加真实npm pack --offline/ignore-scripts负载检查（JS/types/Markdown/CLI/patch/license齐，source/test不发布），解包副本在源码不可读权限下import，约定字节一致；packed维护CLI livePID/未确认停机拒绝、已退出自有child的ESRCH+exactID恢复、保留日志。--help最初实际exit1行为RED，补显式成功帮助分支后全部通过，不涉及安装或真实profile。构建仍先单独验证再pack，ignore-scripts不被用来掩盖构建失败。

最后consumer20单元+产物1通过；真实基础组件4+Controller7通过；kernel38files/205tests及typecheck通过；consumer类型/build通过；根445tests=443pass/2既有MCP skip/0fail，artifact与cached diffcheck通过，strict change校验通过。新增NO_DECIDER日志oracle首次把异步dispatch/completed当成业务命令新增，实际差异是合法completion，按record.kind过滤completion比较业务记录后通过，同时明确assert requests/decisions为空且只有真实agent成员；不改变生产代码或降低NO_DECIDER业务约束。新文件已定向stage供索引治理扫描，无关Ponytail/.archify文件未stage；尚未第二批commit。2.3文档/manifest治理复核完成，现8/22；剩余14项仍有最终Host/同步/历史human/在途提交等证据缺口。

## goal round 1：继续补真实消费者验收

本轮unit从20增至24：host-human-history用受信fixture FileStore预载合法历史human（consumer只装agent provider，不生成human principal），实际request保持open/awaitingChannel且无confirm dispatch/decided；host-fsync-failure在真实append handle.sync抛错，拒绝且后续failed，重开同cmd返回原收据/仅一条记录；host-fsync-drain真实append sync barrier证明close等待存储且封禁新读；host-pending-replay证未完成意图只列pending不重发。原allSettled close边界回归保持通过。

Controller从7增至10：consumer-model-identity通过真实ScriptedAdapter发工具调用，B创建绑定自身、保留principal/actor/sessionId/providerId均无日志，真实同Host未许可C写拒绝，request/header恰20工具；consumer-stale-exec用真实tools/pre-execute挂起，owner dispose后旧exec放行仍拒且无锁/日志；consumer-owned构造真实parentAgent所有权，官方Controller和consumer均拒绝，普通fork lineage可创建空间。补真实短前缀invite不增成员/意图、同invite/cmdId重试原收据不二次通知、consumer冷恢复read-only实际write拒绝/read允许，保留P2来源与never投影。组件工作树/Bash/approval行为原回归继续通过。

提取共享controller-harness供官方Host probe使用时首次漏保留worktree用例createRequire import，出现ReferenceError；恢复import后通过，这是重构夹具故障而非产品RED。只读review f239a383另指出preset-sentinel硬编码旧组件图，已改共用moduleOf；consumer部署与harness关键模块canonical URL比对确保单图。未以版本相同代替模块身份。

官方发行consumer探针现在由官方root装native probe，probe持有相同真实Controller graph并等待production plugin.dispose/runtime.dispose。它是真实官方信号/预算包裹生产teardown，不是直接把consumer挂生产profile组合，未宣称后者。budget仅在真实append FileHandle的sync调用入口停住，不谎称实测OS fsync挂死。最新normal10ms/code0/锁消失、budget5005ms/code0/残锁、kill3ms/SIGKILL/残锁；默认重开LOCKED/ESRCH后调用部署consumer recoverLock恢复，再为每项启动第二个官方进程，用同consumer真实工具同cmdId重试返回seq1、核serviceId/绑定/日志字节不变。每child都收退出、仅临时HOME与本地脚本模型。官方bin/chunk摘要与先验一致，未额外下载校验发布tgz；不把现算摘要当独立上游完整性证明。

sync-artifact用仓库复制installer fixture，但真实consumer+kernel源/tsdown构建与部署副本import：首sync/第二次空操作、改src version与Markdown后部署新字节/再空操作全部通过；npm pack与权限隔离import/CLI维护保留台账也通过。该门不声称真实包管理器profile安装。test说明双语同步，test:host默认consumer，旧先验保留test:host:kernel。

24单元+2产物/sync、基础组件4+Controller10、consumer官方Host三种关闭及各自重启、typecheck/build均通过。tasks3.2/4.5/5.3现齐，累计11/22；余下保留测试顺序历史、完整额外矩阵、直接profile组合及最终review/根回归等门，不自动接受旧Anvil严格FAIL。

## goal round 2：直接profile组合与最终review修复

新增official-composition：官方profile中具体服务/consumer/本地会话夹具/检查工具为同级composition行，经官方loader与真实inject/Config装配，appReady后工具create/overview，两进程正常SIGTERM/重启核原receipt/serviceId/锁释放。初版试图在async apply内嵌依赖图启动，官方loader生命周期等待致code13 unsettled await；改服务本身直接profile rows。首次bare package行dsh-storage-sqlite导入失败（官方包通过exports映射而非同名物理目录），改统一createRequire解析canonical entry URL后通过。均为fixture装配错误，不追认为产品RED。保留budget/kill是probe-owned独立Context、direct只测normal/restart的证据边界。

只读whole-change review59afe提出3个Important，Lead逐项核实：cold枚举await后live从ordinary变managed仍可claim；samplePresence期间workspace变更后旧命令仍commit；startup async apply期间Cordis卸载effect等inertia，关闭不够早。前两项新回归真实RED：返回binding非null、旧setStatus成功seq2；修header与claim同步重验live，store.open/commit准入重验。Host启动onCreated早暴露可close handle、独立ready、逐空间closing/check、异常close；prod apply监听真实internal/plugin本fiber.uid=null同步stop/provider/tools/host，不依赖晚unload effect。真实consumer-startup-dispose在第一次读取barrier时dispose后无b.lock打开且无残锁；host-startup-location变更围栏后不恢复下个空间，host-startup-close同样通过。已进入底层I/O不能撤销：明确design仅禁止后续准入，已接纳open/commit安全排空，不声称workspace更新后零写字节。单个caller dispose只封之后工具准入，不承诺撤销已接纳事务。

focused复核47727确认上述3项已修复、无有证据剩余Important，检查stop/started/closingHost依赖无环；是静态复核，测试由Lead执行。另新consumer CAS测试最初误猜错误码REVISION_CONFLICT，实际既有kernel/convention为STALE_REVISION，纠正预期并确认currentRevision保留，不改产品码。测试typecheck扩到tsconfig.test，极窄Agent unit double在夹具工厂显式any，真实完整Agent另由controller覆盖。

最新31单元+2产物/sync、基础4+Controller12均通过；Controller新增真实坏header物理日志，consumer发现不泄露、invite拒绝不冷恢复、原坏字节不动；模型actor/cwd/preset/父关系断言通过。host-late-delivery晚回调无completion、冷presence未知、无caller body读写拒绝、startup/commit race回归齐。官方consumer normal10ms/budget5004ms/kill3ms及各自官方重启；direct profile额外通过。根最终445=443pass/2既有MCP skip，artifact/strict/diffcheck通过；sync禁用物理部署移除而持久台账保留通过（后补独立复跑）。最终流程TDD历史仍不修饰，剩任务未勾部分含先写测试顺序要求，不以绿色追认。
