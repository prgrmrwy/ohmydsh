# 2026-10-29 live 首题完成后故障调查

## 五分钟传输中断（round-d7d3c34c）

17:08:29.221开始的整轮请求在17:13:30.238失败；前四条件及八裁判outcome均yes/checked。第五条件约73秒时第二回合被aborted user，controller.js55因signal aborted失败，不是120秒普通预算。host-client原生fetch默认等待整个runRound结果，而Node24.20内建Undici headersTimeout=300000ms；Host监听请求断连取消所有权内工作，时间吻合。未重试旧轮次。

客户端改用Node标准库http/https request：仅loopback、无redirect/retry、单次提交、caller signal与整请求deadline合并，完整body保持deadline，4MiB响应上限，agent:false。runRound/resumeRound截止1小时，其它30秒，认证依旧10秒及303/同authority/cookie检查。未改Host API或服务监听，不需为这项客户端更新重启Host；每条件/裁判预算保持不变，1小时只为传输保险，不是新的模型预算。

真实临时loopback测试覆盖延迟headers、官方认证交换、取消、断流不重试、redirect不跟随；另独立运行310秒延迟headers真实回归。静态no-listener检查原先把node:http客户端import误判监听，改查createServer/listen/WebSocketServer，客户端仍禁止server/listen。实机全轮仍待用户新一轮确认，不复用已有评分轮次。

## 当前结论

最新诊断轮次round-b14afd72-1ecc-45d2-814c-3736c12967a2已定位并离线复现清退根因：Memex插件fiber只注入tools/skills，host-retirement.ts:16直接访问ctx.agents触发Cordis的cannot get property "agents" without inject。已改为ctx.get('agents')并保留exact Agent比较；预算取消同类访问也已修复。真实受限插件上下文六条件/八回合/十二裁判闭环通过，全包119files/797tests、typecheck、受管部署和第二次no changes通过。**源码根因修复已验证；修复后的GPT实机整轮尚未运行，不称live验收已通过。** 早期round-d85e0346的原始异常正文已丢失，未补造；其跨Host resume不可用与这个执行故障分别记录。

## 全局上下文故障（round-d1efa1ef）

- Team兼容已实际生效：child 06c3753a日志仅structured_output，但turn/end仍Invalid judge system text。系统文本含宿主模型/MCP/GUI/path贡献；runtime-context含sandbox/approval/delegation，另有time-context。未据request/header落盘推断成功外发。
- 使用官方systemPrompt.section complete:true固定整个裁判系统文本，suppressRuntimeContext仅抑制动态文字、不改变服务权限/执行门禁；都只注册到exact裁判child scope，随Agent生命周期卸载。最后实际llm/stream门禁继续严格核对固定系统文本/route/schema/tools。
- 独立time-context通过pre-step注入，不受runtime suppress影响；按既有设计D5允许管理时间快照，新增固定fresh turn1/step1、无浏览器zone/前消息时间的完整文本格式及source.sections精确对照，额外正文/role/block/source拒绝。不是按source.kind盲放行。
- 真实runtime默认加载Team与官方time插件，并提供全局system/context贡献，RED稳定首评分失败；修复后六条件/八回合/十二裁判通过。系统注入反例改为冲突complete贡献：严格官方assembly拒绝，无门禁对照可达adapter；原先纯assembly文本变更会被complete恢复，不能再把它当应到最终门禁的输入。新增时间伪造/正文/多block反例。
- 无旧评分重试、无门禁放宽、无Host重启；实机新轮次验收仍待用户官方认证。

## 下午评分故障（round-4cfb5af9）

- 新轮次已通过普通根清退及采集，judge-protocols/0-started后phase=score失败。登记child 6be0306d-1c6d-446a-9604-c255353ffb1b完整物理日志turn/end为AUTO“创建没有官方工具身份绑定”，无request/header。
- auto-model-routing policy-host.ts:107–112拒绝AUTO普通祖先下未绑定工具的内部spawn；被测根已设MANUAL，但裁判父遗漏。
- judge-runner现每次spawn前通过既有服务setMode(MANUAL)+state回读；缺服务/ack/state不匹配拒绝，不spawn、不claim预算。不改变全局AUTO、冻结route或schema/tool/request身份门禁。
- 生产runtime添加已核对的ordinary-root AUTO准入夹具（不冒充完整AUTO算法），RED在score稳定失败；修复后六条件八回合十二裁判完整通过。另3个反例覆盖缺服务、ack/state失败的无spawn/claim。测试初版遗漏pre-step next导致evidence-missing、裸Promise缺dispose覆盖原异常，均已修正测试夹具，未放宽生产断言。
- 最终全包120files/800tests、Host/client typecheck、受管构建/部署与连续第二次no changes通过。未重启Host，未重发旧评分。旧0-started保持不可重试，后续实机应新轮次，用户自行重启及官方隐藏认证。

## 现有证据

- 冻结被测与裁判路线均codex/gpt-6.1-sol、high。
- 首题普通根session-97c1328a-9bb7-4b76-9e07-dc12917463f0。官方decoder完整解析53个事件：实际request/header为codex/gpt-6.1-sol high，turn/end为completed。成功调用Memex召回/读取、glob、bash、read和write。没有注册裁判子会话。
- bash-11有同generation的registered→settled(completed)→removed，不能把removed单独当释放证明。归档集合包含首题根；这仍不足以证明exact root/后代/收件箱的全套退休检查通过。
- 01:29:47注册，01:29:49 prompt accepted，01:30:00作业结算，01:30:37 unhealthy。失败不吻合120秒软时限。
- 对真实失败轨迹只读解码，在独立临时目录运行实际collectItemEvidence：audit valid，boundary/tool/program/selection五类产物均生成；原轮次没有被修改。故不能把问题归结为采集器无法解析这份轨迹，但仍未排除Host retirement或Host persistence checkpoint/metadata读取。
- 原目录没有execution-audit、selection或judge-protocols；只有通用unhealthy。02:00前的Host桥不保存原异常，CLI把所有失败RPC与rpcId不匹配合为同一句。当前Host日志未找到这轮错误栈。原始异常已经缺失，不能以猜测补造。
- 后续resume request c7a6e6f0-24cb-4009-a992-7762290899ae于01:37:41落盘，无result，未见新attempt或裁判身份。02:30只读核验发现当前Host PID83290启动于01:36:40，已不同于首轮01:29使用的PID67891。因此续跑时连续Host所有权已经失效：host-plugin.ts:79在per-round execution map缺失时明确拒绝（这不是首轮01:30失败的解释，也不声称恢复了旧RPC异常原文）。此前检查PID发生在用户随后重启之前，不能用那次快照证明续跑时未重启。
- 诊断映射补齐上述生产前置拒绝为resume-owner-missing，并允许保留host-plugin白名单源码位置；纯离线新增回归验证，不启动模型。保留原请求，不重复请求、不改旧冻结计划、不消除unhealthy。

## 观测修复

1. runHostItem标注execute/retire/collect/score。执行失败后成功退休仍归因execute；双失败保持AggregateError各cause。
2. 接受的run/judge/resume请求失败时保存独立failure-<requestId>.json。只记录枚举阶段、固定原因代码、白名单系统错误码、限定eval文件名和行号、深度/数量有界的cause树；不保存原message/任意stack路径/模型内容/凭据。
3. status严格验证诊断结构后返回；缺失诊断的旧请求继续显示unknown，不伪造历史原因。
4. CLI区分RPC身份不匹配与合法Host拒绝；仅将已知拒绝映射到固定原因代码，任意服务端文字一律unknown，不直接回显。
5. 门禁保持：失败无result、原unhealthy保留、普通run不再准入、未知提交/评分不自动重试。补丁不会创建轮次或证明旧资源已释放。

## 回归与限制

- RED：新增Host诊断测试缺少status.failures；新增client测试预期原因码但只收到通用文字。
- GREEN：针对性Host/client/item/resume/真实runtime 48通过；随后补阶段归因测试。
- 补丁主体最后一次全量 `npm test --workspace dsh-memex && npm run typecheck --workspace dsh-memex && dsh build && dsh build && git diff --check`：119files/796tests、Host/client类型检查、Host/client构建与部署通过，第二次no changes。随后只补齐Host重启生产拒绝的静态映射/源码白名单与一个回归；定向failure/client/managed-resume共37tests、typecheck与两次受管构建通过，第二次no changes，没有声称这新增用例已包含在上述全量796中。先前一次TS exactOptionalPropertyTypes错误已修复，未放宽类型或安全断言。
- 独立GPT源级评审发现reasons普通对象继承键碰撞；已用Object.hasOwn限定自身键并增加constructor/toString/__proto__/hasOwnProperty四项回归。诊断写失败时unhealthy仍先持久化；异常正文含伪造eval栈帧也被完整剥离。最终独立评审no blocking findings，仅限观测补丁，不证明原live故障已修。
- 摘要级Jev review因正确性证据置信不足escalate，未当作自动通过；已用实际源码独立复核与最终回归补齐。OpenSpec普通validate通过，strict因三条既有requirement长度警告返回1，未改specs消警告。
- 发布前本地整批复核诊断schema、cause深度/数量、白名单字段、RPC identity先验、写失败处理与续跑门禁。没有当前SSF执行状态，不生成虚构receipt。
- 追加只读实机旧轮次报告核验：部署版eval-report --root ... --round round-d85e0346...返回预期exit1，六条件均unknown、完整裁判成本unknown、资源释放未核验；未将普通根turn completed或归档误当完整通过。执行前后递归清单/每文件SHA256完全一致，未调用Host、未启动模型或改写原现场。
- 凌晨阶段曾仅修观测、尚未查明运行根因；该阶段结论由下述新证据更新，不覆写旧轮次原始证据。

## 白天诊断轮次：已复现并修复插件上下文错误

- b14轮次failure-99fe50c7-3b97-4188-a0d1-1ff234550856.json明确phase=retire，cause指向部署JS host-retirement:8 → release:71/74，即首次身份检查的ctx.agents.get。不是模型或裁判阶段错误。
- 实际index.ts在ctx.inject(['tools','skills'], child=>...)内创建eval dispatch；普通ctx.agents属性访问必须满足fiber注入。getter在Cordis reflect handler中抛cannot get property "agents" without inject，而ctx.get('agents')遵循公开可选服务发现接口。
- RED：将真实生产runtime测试的dispatch从根Context移入仅注入tools的插件fiber，确认直接agents访问被拒而get可解析；六条件测试稳定在首题retire复现同一路径和原异常。保留独立失败夹具，不修改真实轮次。
- 修复仅两处服务访问：host-retirement current改ctx.get('agents')?.get(root.id)，服务消失仍使exact identity检查失败；tested-budget取消改用同接口，仍只取消根及登记后代。
- 测试遗漏另有一层：预算单测曾在根ctx.provide agents，根fiber.store使后代可继承属性，不能模拟兄弟服务插件。现将agents提供者与预算owner设为兄弟plugin fiber，确认owner.agents确实抛错；软请求和墙钟取消均通过。
- 最终全量119files/797tests、Host/client typecheck、Host/client构建、受管部署及连续第二次no changes通过；真实闭环六条件/八回合/十二裁判通过。没有重启日常Host、没有真实模型重发、未删除unhealthy或放宽任何所有权/评分门禁。
- 需用户重启加载根因修复，再由官方CLI隐藏认证启动显式GPT/high新轮次验收。旧轮次与默认模型提醒保留；不建议再resume失败轮次。
