## Context

见 proposal 的动机与边界。用户明确选择：先接通已有独立会话；首版由宿主配置显式许可完整 session ID，不加人类通道、不依赖Pet/Agent Teams。上轮两个change保持未提交及其原验收记录，本规划不接受其历史偏差。

使用仓库默认 `spec-driven` schema（新change不继承旧change的Anvil选择）；在标准四份工件外自加独立review与场景test-plan。此轮只规划，不修改产品或启动真实Host。

源码事实（DSH 0.2.0-rc.2，已安装依赖；未实测Host）：

- `exec.agent` 由AgentLoop的执行链提供，与模型arguments分开；工具body不能从args拿身份。`dsh-agent-loop/lib/index.js:506–518`、`dsh-tools/lib/types/index.js:768–821,932–950`。
- `sessionController.resolveAgent` 使用exact observation的preset projection、compose/setup/mount再resume；不自己拼低层resume。`dsh-api-session-controller/lib/index.js:208–243,358–410,475–477`。
- followup返回void，只表示入队；next-turn不打断当前回合，whenIdle是全agent静止不是消息ack。先createUserMessage取得id；pending去重不等于历史exactly-once。`dsh-agent/lib/types/runtime-types.d.ts:158–209`。
- 枚举会漏掉损坏、不支持格式的日志，缺persistence时只有live；缺ID不是删除证明。`dsh-session-persistence-jsonl/lib/index.js:3031–3046`、`dsh-session-query/lib/index.js:95–115`。
- parentSession是fork lineage；Pet一级会话没有可通用识别的Pet标记，preset也不能证明身份。许可名单是人的选择，不宣传自动排除所有受管会话。
- 内核默认约定在模块加载时按import.meta.url读Markdown，构建alias到src不足以证明资源可达。`packages/collab-kernel/src/convention/index.ts:5`。

## Goals / Non-Goals

**Goals**：同一Host内跨workspace已许可会话共享内核；真实caller身份；清晰投递/失败语义；隔离可执行接缝验收；最终产物独立于源码目录。

**Non-Goals**：网络服务/跨机、团队或子会话创建、Pet归属索引、人类确认/GUI、自动监听业务回复、服务端读游标、自动解锁、修改内核状态机、默认部署或模型真实付费请求。普通用户fork若无subagent origin/非零depth且官方允许，可被用户明确许可；不以parentSession拒绝合法普通fork。

## Decisions

### D1. 窄Host wrapper与明确配置

一个插件实例组合一个FileStore、CollabService和session provider。配置仅 `dataDir`（必填绝对路径）与 `allowedSessionIds`（默认空、非空字符串数组且不得重复）。不提供agent修改配置工具。`dataDir`由受信宿主配置明确给出，约定为该profile的持久目录，不能从caller cwd、模型参数或会话内被覆盖的DSH_HOME推导；避免猜测profile API或把同一Host切成每workspace的库。拒绝相对路径、部署node_modules目录和任何已声明workspace内路径。部署操作必须由人指定该profile的独占目录，不允许两个Host共享写入。

持久serviceId采用固定namespace加canonical dataDir的摘要，根路径不暴露给模型；同目录重启稳定，移动目录不承诺identity不变（迁移不在本期）。FileStore instanceId每次构造随机。目录必须owner-only（创建0700；既有目录若group/other可访问则拒绝启动，不悄悄改权限）；内核lock创建0600，日志沿现有FileStore默认open模式并由0700父目录保护，不虚称每个日志都是0600。数据目录不加入版本控制，也不随包移除。

备选自动从环境拼profile路径：否决，worktree会话环境与Host环境可能不同且目前没有足够权威profile身份证据。必填配置比引入额外全局身份存储/框架更小。

### D2. 许可名单与精确会话身份

名单仅限制可参与者；不构成对同进程恶意插件的认证沙箱。每个工具body先检查exec.agent与session.id一致、ID在名单、已知origin/depth不为subagent、未归档且官方会话控制器无所有权拒绝；工具参数拒绝保留身份字段，不能借args覆盖。

发现用sessionQuery.listSessions的header记录筛选名单与live session metadata，不调用controller.inspect/observeSession/readTitleSnapshots或为补标题折叠全文；冷会话标题可缺省，精确header/stat观察失败就标未可接入。caller现存live header可读，cold claim使用只读header/stat与已知origin/depth检查；官方所有权结果在实际resolve时仍是最终拒绝门。不全局泄露会话标题/cwd，不展示消息、模型选项或凭据。调用者自身也必须在名单。provider claim接受完整ID且kind=agent，只读核验，不激活；不能用resolveAgent认领（否则邀请就会冷恢复）。名单存在但暂不可核验者不认领。普通工具可全局注册无状态模板，每次body做授权；不承诺对名单外隐藏schema，只承诺无法访问/读写/唤醒。避免复杂逐agent异步inject装配。

投递在开始、恢复前后都检查名单/身份/归档与wrapper generation；官方resolve结果的agent.id/session.id必须等于绑定的完整ID。目标归档、受管错误、缺失或损坏均不能create补齐。没有Pet私有表读取或通用identity registry。

### D3. 20个具名工具，不给内核加字符串分发

15写：`collab_create_space`, `collab_invite`, `collab_join`, `collab_decline_invite`, `collab_leave`, `collab_mark_gone`, `collab_transfer_leader`, `collab_close_space`, `collab_create_item`, `collab_revise_item`, `collab_ack_item`, `collab_send_message`, `collab_set_status`, `collab_advance_request`, `collab_request_decision`。

4读：`collab_overview`, `collab_read_since`, `collab_project`, `collab_read_convention`；另 `collab_sessions` 发现名单内元数据。虽然overview与project有重叠，保留结构化/人读两面使契约和内核一致，不再加describe/locator工具。写schema要求spaceId/cmdId和各方法真实字段，create首成员地址由caller固定、kind固定agent；invite将recipientSessionId转内核address且kind固定agent。没有confirm/reset/breakLock、genericexecute、任意payload:any。错误对象保留内核code及业务details；工具结果去除lockPath、legacy raw lock与原始stack，锁仅返回{instanceId,pid}，完整本机路径只留受信宿主诊断/维护命令。Host错误以COLLAB_CALLER_UNAVAILABLE/COLLAB_SESSION_UNAVAILABLE/COLLAB_SERVICE_CLOSING/COLLAB_SERVICE_NOT_READY分类，不用空结果冒充成功。

读游标由调用者显式传sinceSeq并自行保存，不增加持久session游标或重试队列；返回快照，不自动ack/join。工具说明链接版本约定，指针文本指导主动读总览/约定/readSince，而不当系统指令。

### D4. 入队而非完成，保守处理崩溃窗口

provider.deliver在通过精确检查后调用官方resolveAgent，恢复返回重查closing/generation/recipient；先createUserMessage，source为`plugin:dsh-collab`，固定文字明确“来源为协作台账数据，不是额外授权”，其后只序列化白名单pointer。followup同步入队后返回；不等whenIdle，不承诺已处理，不额外等待flush。

选择“宿主接受入队”而不是“已磁盘flush/已执行”作为SPI成功语义：内核只记录尝试结果、恢复不重发，首版没有外部确认，不需要引入第二份消息投递账本。文档必须说明Host在入队后、session flush前崩溃可能丢消息；completed成功不证明工作完成。flush失败也不能安全重发，因为消息可能已经claim。任何未知/失败均不自动补发，用户可读共享日志继续。

不把messageId宣称exactly-once，不建立易受claim先到竞态影响的回调映射；本期没有从会话claim反推人类动作或读确认。来源MessageSourceMap只扩展插件自有kind，不用旧plugin/user伪装。

### D5. readiness与dispose覆盖所有已接纳空间

启动先校验配置/目录，store.list后逐空间service.open；工具在恢复结束前返回SERVICE_NOT_READY。失败空间保留locked/corrupt/failed状态，其他健康空间可用。对该ID后续操作返回原诊断，不伪装不存在；只有.lock没有.jsonl的ID在未来create时由FileStore拒绝，不宣称list枚举所有锁。

在接纳create/open时立即加入trackedSpaceIds；不能等open成功才登记。dispose第一步同步closing、generation++、撤销工具并关闭provider准入，再对全部tracked空间同时service.close。等待这些存储close，不等claim/coldresolve/whenIdle。利用kernel已有epoch fence，但provider也独立防晚followup。包装器不引入额外“到点强删锁”超时；以Host既有总dispose预算为上限。若Host中止/强退，允许残锁而不是冒险释放在途writer。未清理不等于关闭成功；下次显式诊断。

### D6. 解锁只走停机维护，不加agent能力

默认启动绝不breakLock。提供包级维护命令（不注册模型工具/HTTP路由）：操作者先停止该数据目录全部Host并禁用并发启动，再显式传入dataDir、spaceId、expectedInstanceId。命令读合理锁（非空id、正安全pid），要求本机同进程命名空间；kill(pid,0)成功或EPERM/未知一律拒，只有ESRCH且锁再次同id才exactbreak，随后由正常Host启动重放；不循环抢锁、不自动open、不改日志。

单Host/无并发恢复是受信维护前提，不宣传breakLock为跨进程原子CAS。PID重用会保守拒绝。测试可注入process probe，不要求真实杀死无关进程；真实强退实验只杀自身隔离子进程。

### D7. 构建当前源码并复制约定

Host ESM tsdown，显式alias `collab-kernel` 到 `../collab-kernel/src/index.ts`并内联；所有DSH/Cordis依赖external并声明对应^0.2.0-rc.2 / Cordis^4.0.4 peers（以真实imports最小集为准），kernel仅devDependency。不套browser CJS ModuleLoader包装。

选择单一Host bundle、关闭splitting，在构建后把内核v1.md原字节复制到bundle实际import.meta.url对应的`lib/v1.md`。维护命令是薄CLI入口，import同包`./index.js`导出的受信维护函数（加载模块但不安装Host插件），复用同一份内联kernel，避免第二份相对资源布局；导出不会注册agent工具。产物测试必须检查打包器是否改写import.meta.url；若布局不符就修构建，不通过修改kernel文本或临时源路径规避。最终npm pack副本在临时目录、源树不可达且无collab-kernel部署依赖时加载；readConvention/hash与原字节一致。

manifest buildInputs列内核src和package.json、实际使用的编译/打包配置；consumer自己的src/package/tsconfig/tsdown由现有hash捕获。故意陈旧kernel/lib与修改src/v1.md的回归证明没有打包旧入口。首次登记dsh.yaml默认enabled:false，双语说明接入许可配置、风险、移除与数据保留；不运行生产sync。

### D8. 验收先证明宿主接缝

复用dsh-memex lifecycle-runtime的真实Cordis/AgentLoop/ScriptedAdapter模式，但它不是完整Host harness。SessionController额外硬依赖agentDefaultModel、attachments、fileUploads、fs、sessionQuery、typert、workspaceRegistry（已装lib/index.js:2816–2827）；按官方composition安装真实能力，并增加真实session persistence/preset registry，不能空对象满足inject后称真实Host。先确定启动/信号入口与实际dispose预算，再执行同入口子进程；不把自写signal handler调用ctx.dispose算已验证发行Host的关闭。缺少发行启动体或官方能力时应暂停接缝门，不允许凭mock替代。不伪造inspect/header或ctx.inject同步行为。所有测试独立临时home，使用ScriptedAdapter，不真实外部模型。单元层测授权/状态机，Host层看真实request/header.tools、事件turn与source/ID、磁盘锁，不以mock调用次数替代。

两层装配：组件层为Cordis4.0.4 + DSH各服务0.2.0-rc.2（全部上述硬依赖、真实preset/persistence、安全与approval/worktree能力）+ ScriptedAdapter；发行Host层必须使用 `@deepseek-ai/dsh@0.2.0-rc.2` 的真实bin及其实际host-runner/信号链。根依赖当前未提供dsh本体/host-runner（独立评审MODULE_NOT_FOUND），不可通过安装/外部运行体静默补前提；实施时若在本执行根内不能只读取得同版本发行入口，停止1.3并请求授权准备隔离运行体，不读取日常生成profile作为替身。可以沿已读bin/dsh:557–575的runtime解析规则确定身份，但不能执行其会安装/部署的解析路径。此缺口是明确的实施前置，不能把“无开放产品问题”说成实验已具备。

发行Host三项单列：acceptance-01-normal经实际SIGTERM/官方停止入口，等待真实进程退出并证明close完成、锁消失；acceptance-01-budget用受控FileStore commit barrier阻塞超过由该运行体源码/测量明确的真实dispose预算，验证预算触发终止、未完成close不强删锁、下次LOCKED；acceptance-01-kill直接SIGKILL自己fixture后证明锁残留/死亡后受信恢复。若发行体无可验证的正常shutdown预算机制，budget项标未验证并停止该任务，不能用自设timer kill冒充。记录运行体bin/version/hash、停止输入、预算来源和实际退出/锁状态；不预设5s或把app-boot fatal-release预算当正常停机。

先完成身份、busy/idle next-turn、cold current-preset实际工具、上述normal/budget/kill与部署copy加载接缝；任何真实依赖缺失则阻断对应任务，不能skip后声称全绿。摘要保留版本、expected/observed和事件seq/turn的必要统计，不长期提交raw session。所有删除验证绝对临时目标，全部子进程用managed job跟踪/收集，不启动替换GUI server。

## Risks / Trade-offs

- [仅入队成功仍有崩溃丢指针窗口] → 明确非处理/持久完成保证，不重发；权威共享台账仍可主动读取。增强durable消息投递属于后续change。
- [用户把Pet受管一级会话加入名单] → 不谎称自动识别；文档说明仅许可独立会话，已知derived/officialownership仍拒绝，不读取Pet数据库。
- [同进程插件可伪造exec] → 本期沿用宿主信任边界，不提供恶意插件隔离承诺。
- [正常dispose也可能剩锁] → 保守停机维护，绝不自动破锁；PID复用/权限不足会拒绝恢复而非猜。
- [源码调研不同于真实装配] → T0真实依赖接缝必须先验；没有结果不进入部署或宣布完成。

## Migration Plan

新增插件默认禁用；不改变kernel持久格式。实施与隔离验收通过后再由用户明确选择许可会话、profile独占dataDir并授权部署。回滚关闭插件、撤销工具/停止存储，保留数据；不删除workspace、会话或协作日志。上轮验收偏差不在本change归档或改写。

## Open Questions

无尚未决定的产品/架构问题。真实运行的preset工具装配、Host预算与打包器URL行为不是待拍板选择，而是已有明确失败oracle的实施前验证门；失败应修接缝或回报阻断，不能悄悄降级承诺。
