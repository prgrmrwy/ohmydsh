# Backlog · 功能待办池

随时想到的功能都记在这里。条目按状态分组,状态流转:`想法 → 讨论中 → 已设计 → 实施中 → 已完成 / 已放弃`(任意状态可加「(暂停)」标记)。优先级在条目内用 P0 / P1 / P2 标注。

## 条目格式

```markdown
### [ID] 一句话标题
- **状态**: 想法 / 讨论中 / 已设计 / 实施中 / 已完成 / 已放弃
- **优先级**: P0 / P1 / P2(可选)
- **背景 / 动机**: 为什么要做
- **要点**: 方案要点、约束、开放问题
- **更新**: YYYY-MM-DD 一句话进展
```

---

## 讨论中

### [B001] 多角色 agent 协作流水线(架构师 / anti 审查 / QA)
- **状态**: 讨论中(暂停)
- **背景 / 动机**: 希望 DSH 接任务后按阶段自主分配角色:需求设计 → 架构师;coding 完成 → anti 代码审查;最后 → QA 黑白盒验收。
- **要点**(2026-08 讨论结论):
  - 符合 DSH 设计理念:DSH 是组合式 + 委派式架构,角色 = **subagent**(persona + 工具范围 + 可选独立模型),不是多个 preset 手动切换。
  - 编排者 = 一个 **tech-lead preset**,自带 subagent / workflow / goal 工具,负责阶段流转与门禁。
  - 角色定义:起步内嵌在 tech-lead 提示词;进阶注册进 host composition 的 subagent registry 跨会话复用。
  - 阶段交接物 = workspace 文件(design.md、AC 清单、review 报告);subagent 不继承父对话,workspace 是共享记忆。
  - 工具选型:常规串行用 subagent 工具;大规模 fan-out(QA 多 AC 并行)用 workflow;跨轮长任务用 goal;Ralph 不适合。
  - QA 阶段可复用 `verifying-acceptance` skill(黑盒自测 + AC 证据)。
  - 参考实现标记(2026-08-14):社区插件 [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 已实现自然语言驱动的多角色团队(captain/members + 任务依赖 + 树形监控),做 B001 时优先评估复用,而非从零写。
- **开放问题**:
  1. 门禁强度:全程自主 vs 关键节点(设计定稿 / review 通过 / 验收通过)人工确认
  2. 是否需要独立 coder 角色,还是 tech-lead 自己写代码
  3. QA 以 AC 自动化证据为准,还是角色主观判断
  4. 是否给某些角色(如 anti)配不同模型
- **更新**: 2026-08-14 完成方案讨论,讨论进度已归档(要点 + 4 个开放问题);暂停跟进,待开放问题确认后进入设计。

### [B014] Worktree Session 隔离度分层与 build/runtime home 解耦
- **状态**: 讨论中
- **优先级**: P1
- **背景 / 动机**: Worktree Session 当前把任务专属 `DSH_HOME` 写入 worktree `.env.local`，可正确防止候选 build/sync 污染真实 `~/.dsh`；但同一个 `bin/dsh` 同时承担 build、preview、start、restart，用户从 task worktree 执行 restart 时会把整个 Host 切到空白隔离 home，表现为插件、Workspace/Session、provider 配置和凭据全部“消失”并要求重新输入 API Key。原数据未丢失，但当前边界非常容易误用。
- **五层隔离模型**:
  1. **源码隔离**：每个任务使用独立 branch/worktree，Agent 本地工具只访问 managed root；默认必须。
  2. **依赖隔离**：默认 lean、同 fingerprint 共享 cache；依赖变更前 promote，之后使用 worktree-local mutable dependencies。
  3. **部署隔离**：task `DSH_HOME=<git-common-dir>/ws/dsh-home/<operationId>` 只用于 `dsh build`、bundle composition、隔离安装与独立 preview，不读取真实用户配置。
  4. **真实配置验收**：显式 opt-in 使用 `DSH_HOME=$HOME/.dsh` 部署/加载候选 bundle，以真实 Workspace/Session/provider 验收；属于影响日常 profile 的部署动作，必须可识别、可回滚。
  5. **日常运行**：实现合入 main 后，由 main launcher 对真实 `~/.dsh` build/restart；不得依赖 task worktree 路径。
- **设计原则**:
  - 完全隔离本身符合预期，不应通过共享凭据/Session 来削弱第 3 层；应解决 build home 与 runtime home 粗粒度耦合及 launcher UX。
  - `DSH_HOME` 是进程级总根，当前同时承载 bundle/profile、Workspace/Session、provider 凭据、storage、skills 和日志，不能再把它描述成单纯“构建输出目录”。
  - 隔离 preview 与真实 profile acceptance 必须是两种显式模式；不得把 task launcher 的 restart 当作真实 GUI 无副作用重启。
- **优化候选**:
  - 拆分 `DSH_BUILD_HOME` / `DSH_RUNTIME_HOME`，或由命令显式选择目标 home，而不是在 task `.env.local` 中无条件覆盖进程级 `DSH_HOME`。
  - 命令边界建议：`dsh build --isolated`、`dsh preview --isolated --port <port>`、`dsh deploy --profile web`、`dsh restart`；其中 restart 只重启既有真实 profile。
  - launcher 每次启动打印绝对 `DSH_HOME` / profile；检测到 `.git/ws/dsh-home/` 时显示醒目的“隔离预览环境”，start/restart 默认拒绝或要求明确确认。
  - Worktree Session 运行上下文应明确：worktree 的 `bin/dsh build` 默认是隔离构建，不代表当前日常 GUI 已更新；真实部署需独立授权步骤。
- **验收标准**:
  - task build 不写真实 `~/.dsh`，两个并行任务仍拥有不同部署根；
  - task preview 不读取或复制真实凭据/Session，且使用独立端口并显著标识隔离环境；
  - 日常 restart 不会因 cwd/worktree `.env.local` 改变 runtime home；
  - 真实 profile deploy 前后可展示目标、差异与回滚路径，restart 后保留原 Workspace/Session/provider；
  - 自动化验收能分别声明 isolated preview 与 real-profile acceptance，且不会混用。
- **关联记录**: `openspec/changes/restore-cleaned-session-as-ordinary/WORKTREE-ISOLATION-NOTE.md`（2026-08-21 误用复盘与详细现象）。
- **更新**: 2026-08-21 记录五层隔离模型；确认“完全隔离”适合作为开发 build/preview，但现有 `DSH_HOME` + 通用 launcher 造成运行边界不清，后续需专项 OpenSpec 优化。


---

## 想法

### [B002] 飞书助手:任务中 @ 助手,在飞书群发消息
- **状态**: 想法
- **背景 / 动机**: 理想情况是能在任务中 @ 助手,然后在飞书群里发消息,把 DSH 任务与飞书 IM 打通。
- **要点**:
  - 至少先做单向:任务节点/结果 → 飞书群消息推送;
  - 理想双向:飞书群里 @ 助手 → 触发或查询 DSH 任务;
  - 可复用现有 `lark-im`(收发消息)、`lark-event`(事件订阅)能力;需定义交互入口与鉴权(群→会话映射)。
- **更新**: 2026-08-14 新增


### [B008] 会话(任务)看板视图
- **状态**: 想法
- **背景 / 动机**: 支持会话(任务)以看板形式呈现,可在 todo / doing / reviewing / done / canceled / blocked 几个状态间切换,多任务并行时一眼看清整体进度。
- **要点**:
  - 形态:会话/任务列表的看板视图,列 = 状态,支持拖动或按钮切换;
  - 数据模型:状态字段挂在会话/任务上,与现有 session / goal / todo 机制衔接(参考 `dsh-tool-goal` 的 blocked、`dsh-tool-todo`);
  - 联动:reviewing 可与 B001 的 anti 审查阶段衔接;blocked 与 goal 阻塞语义呼应;canceled 对应会话终止;
  - 落点预估:client UI 插件(看板渲染 + 交互)+ host 侧状态持久化/API;
  - 待设计:状态与会话生命周期事件的映射、看板入口位置、与现有 sidebar/会话列表共存方式。
- **更新**: 2026-08-14 新增

### [B011] 输入框 @ 唤起 subagent 选择并指派任务 + subagent 管理面板
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: B004 落地后 subagent 会变多(claude-code / codex / 多机实例),希望用户能在输入框直接 `@` 唤起 subagent 选择器、显式指派任务给某个 subagent,而不是只能靠主 agent 自主决定委派;同时需要一个管理面板统一查看/配置这些 subagent。
- **要点**:
  - 前置条件:先验证 B004 单机 subagent 好用(openspec 4.4),「好用」再决定本条优先级;
  - 入口形态:复用 `dsh-client-ui-input-trigger` 的 trigger 机制(现有 `/` slash-menu 即由它注册,支持 lexicon 候选 + `ReferenceInsert` / `ConsumeTokenRequest` 等契约),新增 `@` trigger 大概率不动会话主链路;UI 参考 `dsh-client-ui-model-selection` 的两级菜单;
  - 数据源:subagent 注册表 = host 侧 subagent registry / tool 清单(`subagent-claude-code` 每实例一条 tool 行,天然可按 providerName / toolName 列出);也可混入当前会话树里的活跃 subagent(类似 `list_agents` 的 children 视图);
  - 指派语义(待设计):选中后把输入内容作为委派请求直接发给该 subagent(用户显式选目标,等价于主 agent 调 subagent 工具但由人指定),还是生成一条指令让主 agent 转发;结果如何回流展示;
  - 管理面板:subagent 列表(名称 / provider / 模型 / 机器 / 状态 / 任务数),配置(增删、默认模型、persona 提示词),任务历史;落点 = client UI(设置页 Tab 或侧栏面板)+ host 侧配置持久化;
  - 与 B001 关系:B001 是 agent 自主编排(tech-lead 派活),本条是用户手动指派,互补;面板可复用一个 subagent registry 设计,避免两处各建一套;
  - 与 B008 可联动:面板里 subagent 的任务状态可进会话看板。
- **更新**: 2026-08-19 新增;2026-08-24 B004 归档后前置更新:subagent-codex 一次性委派已移除(订阅 provider 为主形态),显式委派走内置 subagent/fork 工具,「subagent 变多」前提不再成立,本条动机与数据源描述待重定(可并入 dsh-sidechain 的 /side 子代理面板评估)。

### [B012] 类似 Codex 的 session 内容关键字搜索
- **状态**: 想法
- **背景 / 动机**: session 多起来后，仅靠标题和时间难以找回历史上下文；希望像 Codex 一样按关键字检索 session 的消息内容，快速定位相关会话和原文。
- **要点**:
  - 搜索范围:支持跨全部 session 搜索，后续可增加当前 workspace / 当前 session 等范围筛选；
  - 结果展示:显示命中的 session 标题、时间、消息片段并高亮关键字，点击后跳转到对应 session 的命中位置；
  - 基础筛选:可按时间、workspace、角色(user / assistant / tool)过滤，并明确是否包含已归档 session；
  - 实现关注:优先调研现有 session 持久化与查询 API；数据量大时考虑全文索引、增量更新，以及本地会话内容的隐私边界；
  - 待确认:首版仅做普通关键字匹配，还是同时支持短语、大小写、正则或语义搜索。
- **更新**: 2026-08-20 新增


---


### [B016] 成本分级:子代理按任务类型挂不同模型/档位
- **状态**: 想法
- **优先级**: P1
- **背景 / 动机**: DSH 是组合式 + 委派式架构,子代理默认继承父会话模型(fork 继承父模型,spawn 用部署默认 `agent-default-model`),fan-out(QA 并行、检索、摘要、格式化)因此全用旗舰模型。实测账单(2026-08-24 cost-meter):codex 单日 2921 calls ¥445、claude-opus-5 205 calls ¥163,而 opencode-go deepseek-v4-flash 整天 ¥0.28——同量级任务用便宜档可省一个数量级。官方 subagent capability seam 已支持 persona / toolFilter / outputSchema / depthLimit,唯独 per-call model 覆盖不在官方 tool 层([官方 Agent Note 2026-06-21-subagent-capability-seam](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md))。
- **要点**:
  - 社区已有实现参考:[dsh-routed-subagent](https://github.com/bpc-oss/dsh-routed-subagent)(bpc-oss:one-shot subagent 挂任意 preset + per-call model/provider 覆盖 + 模型可用性预检),推进时优先评估复用而非从零写(与 B001 同口径)。
  - 设计问题:
    1. 模型选择规则:按子任务类型(检索/摘要→flash 档,代码生成→旗舰)/上下文体积/预算上限,还是显式 per-call 参数;
    2. fork(继承父) vs 显式覆盖 的优先级语义;
    3. 与 B011 subagent 管理面板的协同(面板上可视化每个子代理的模型与成本);
    4. 省钱效果的可验证性:cost-meter 已按 byProviderModel 拆分记账,可直接对比分级前后成本。
  - 与 B001 开放问题 4(anti 角色配不同模型)是同一问题的两个切片,可合并设计。
- **更新**: 2026-08-24 新增,源自 claude/codex 订阅成本复盘(上游 #17/#24 缓存缺陷修复后,成本分级是下一个杠杆)。

---

## 缺陷备忘

### [D001] core 缺陷:sandbox_permissions 静态广告导致 "not strictly wider" 报错
- **状态**: 已绕过(上游 open)
- **现象**: 会话处于 danger-full-access 模式时,任何携带 `sandbox_permissions` 参数的工具调用(bash/write/edit)都报 `sandbox escalation to "X" is not strictly wider than this call's current "X" mode`,且报错不提示修正方法,agent 会反复踩坑(2026-08-19 commit push 时连踩 10+ 次)。
- **根因**: DSH core 的工具 schema 静态广告 `sandbox_permissions` 枚举,不随会话当前模式变化;拒绝逻辑也不自我纠正。
- **绕过**: 工具调用默认不带 `sandbox_permissions` 参数;仅在被真实拒绝(`[sandbox: file access denied ...]`)时带最窄的足够权限重试一次;遇到 "not strictly wider" 报错直接移除参数重试。细节与铁律见 skill `dsh-sandbox-notes`。
- **部署侧缓解(2026-08-19)**: 自研插件 `subscriptions-sandbox-shim`(manifest 条目,packages/subscriptions-sandbox-shim)在适配器边界为订阅 provider(codex/grok)自动剥离升级字段(schema 出站 + arguments 入站),GPT 会话不再触发该报错;仅适用 danger-full-access + approval: never 部署,受限部署必须禁用。设计见 openspec change `subscriptions-sandbox-shim`。
- **移除条件**: 上游修复(deepseek-harness 静态 schema 感知会话模式 / 拒绝文案自纠)或 DSH 升级消除缺陷后,删除 manifest 条目 + sync + restart。

### [D002] core/subscriptions 交界缺陷:subagent settlement notice 产生孤立 Responses function_call
- **状态**: 已定位并在 shim 0.1.1 绕过(待上游修复)
- **现象**: Codex 会话运行一段时间后稳定报 HTTP 400 `No tool output found for function call call_...`;同一坏会话后续请求重复失败,切 DeepSeek 可继续。
- **根因**: 中断 continuable subagent 时,DSH `AssistantOutputFold` 选取子会话最后一条非空 assistant content(可含尚未收口的 `tool-call`),`notifySettlement` 又把整段 content 作为父会话的 user message 注入;`dsh-plugin-subscriptions` 的 Responses 翻译器不校验 block 所在角色,把 user message 内的 copied `tool-call` 也序列化成父请求 `function_call`,但父会话没有对应 `function_call_output`,Codex 后端遂返回 400。
- **实证**: 主会话 `session-77e49055-...` 的 seq 10591 含 user-role `call_00_PmW7x...`,紧接 seq 10592 即相同 call id 的 400;源 call/result 实际成对存在于子会话 `e34d5d2b-...` seq 50330/50332,证明是跨会话复制污染而非工具执行漏结果。
- **部署侧缓解(2026-08-19)**: `subscriptions-sandbox-shim` 0.1.1 在 codex/grok adapter 请求边界按角色和 call id 清理孤立 tool-call/tool-result;正常 assistant call + user result 配对保持不变,非目标 provider 零影响。
- **上游修复建议**: core settlement notice 只传播 text/image(至少剥离 tool-call/tool-result);subscriptions `toResponsesInput` 仅允许 assistant→function_call、user tool-result→function_call_output,并做最终配对校验。

---

## 已完成
### [B015] 跨机器访问 DSH:局域网访问(secure context)
- **状态**: 已完成(SSH 隧道方案;HTTPS 直连形态未采用,见下)
- **优先级**: P1(2026-08-24 用户明确要推进:`dsh web` 支持 192.168 内网 IP 访问 + HTTPS)
- **终选方案(2026-08-24)**: **SSH 隧道**——`ssh -N -L 3080:127.0.0.1:3080 user@192.168.64.3`,浏览器开 `http://127.0.0.1:3080`。用户诉求「有没有类似 ssh 那种免登方案」直接命中:一条路同时解决三件事——公钥免登(`authorized_keys`,强于密码)、SSH 自带传输加密(强于自签 TLS 且无证书告警)、**浏览器侧回环即天然 secure context**(`randomUUID` 原生可用,无需 HTTPS/证书/polyfill,绕过本条最初的闸门);且 DSH 保持 `127.0.0.1` 绑定,局域网**零端口暴露 agent**,暴露面小于任何直连方案。使用说明与验证记录见 `docs/notes/lan-access-ssh-tunnel.md`。
- **端到端验证(2026-08-24,本机临时密钥自连,测试后已撤销)**: 隧道建立成功;GUI 首页 HTTP 200(含 `__DSH_BOOT__`);`/api/respond` 响应与直连 3080 完全一致(官方信任围栏对回环 Host 天然放行);`/api/events.mux` WebSocket **101 Switching Protocols**;直连 `192.168.64.3:3080` 连接失败(符合预期)。
- **部署现状(2026-08-24 最终)**: 用户选择**直连形态**为日常默认(免起隧道、手机/平板亦可用),`lan-gate` 重新 `enabled: true` 并入 bundles;`web.lan` 保持 **false**(lan-gate 自带 patch 已绑 `0.0.0.0`,两者等价不叠加);未安装任何代理插件。SSH 隧道作为更安全的备选保留(零端口暴露、公钥免登、天然 secure context),文档 `docs/notes/lan-access-ssh-tunnel.md`,把 `lan-gate` 改回 `enabled: false` 即切换。
- **直连形态的残余风险(已知并接受)**: 明文 HTTP,同网可嗅探密码与 cookie;防线为 scrypt 密码 + 私网 CIDR 白名单 + 登录限流;`ui-archive-manager` 的归档恢复路由在 LAN 下会被其硬编码 `TRUSTED_HOSTS = []` 挡掉(本机 loopback 不受影响)。仅可信网络使用。
- **背景 / 动机**: 本机启动 DSH 后,希望在同局域网的另一台机器上使用。现有 `web.lan`(dsh.yaml `web.lan` / `DSH_LAN`)已能绑 `0.0.0.0` 并打印局域网地址,但访问走的是明文 **http://192.168.x.x:3080**,浏览器判为**非安全上下文**。真正的问题不是地址栏「不安全」标记,而是 secure-context-only API 直接不可用——DSH 的 RPC id 生成路径在用 `crypto.randomUUID()`(`dsh-client-connection/lib/client.js:6179` `RpcId(crypto.randomUUID())`,同包 `:242`、`dsh-client-ui-conversation/lib/client.js:63` 各一处),非 localhost 明文 HTTP 下 GUI 大概率整体不可用,而非「能用但有警告」。
- **上游态度**: `@deepseek-ai/dsh-host-webserver` 用 `node:http`,README 明确「No TLS, auth, or origin policy」,并把 TLS 归为 dev-facing v1 范围外、建议**前置真正的反向代理**;host 配置 schema 只接受 `127.0.0.1` / `0.0.0.0`。核心不会提供 HTTPS,方案必须在插件或代理层解。
- **社区选型(2026-08-24 调研,npm)**:
  - **polyfill 派**(仍明文 HTTP,补 randomUUID 使 GUI 可用,警告仍在):`dsh-lan-access` 0.1.3(MIT)、`@woyeshishen/dsh-lan-access` 1.0.4、`dsh-lan-bridge` 0.2.1、`@huxy/dsh-lan`。
  - **TLS 代理派(首选)**:`@wingsky-1/dsh-lan-proxy` 0.1.12(MIT,repo wingsky-1/dsh-plugin-hub)——`0.0.0.0` 上 HTTP(3081)+ **HTTPS(3443)** 并存,转发到回环 3080;重写 Host/Origin 以过 `/api` 浏览器信任围栏,只接受 IP 字面量或 localhost 的 Host 头(DNS 重绑定防护);证书自动自签名或走 `tlsCertFile`/`tlsKeyFile`;另含 events.mux/events.host 的 permessage-deflate(自述省 75~79% 流量)。⚠ 安装即在 3081/3443 开监听。
  - **门禁派**(正交,补上游缺失的 auth):`dsh-lan-gate` 0.1.2(MIT)、`dsh-lan-pass`、`dsh-lan-gateway` 0.2.1(**无 license 字段,慎用**)。
  - **隧道 / 远程派**(走公网 HTTPS 域名,证书天然可信):`dsh-remote-plugin` 0.6.13、`dsh-remote-desktop` 1.6.1、`@polaris-l/dsh-mobile-remote` 2.4.1、`@xgone/dsh-remote`(登录门禁 + TOTP + 签名 cookie)。
- **倾向方案**: `@wingsky-1/dsh-lan-proxy` + **mkcert 自签 CA**(证书经 `tlsCertFile`/`tlsKeyFile` 注入)。理由:拿到真正的 secure context(randomUUID 等 API 原生可用,不靠 polyfill 绕过),另一台机器装一次 root CA 后**地址栏零警告**;不装 CA 时用其自签名证书也能跑,仅首次需手动放行。
- **前置条件(两条,立项即须处理)**:
  1. **暴露面**:局域网开放的是完整 agent 面(bash / 文件读写),`dsh.yaml` `web.lan` 注释已标注「仅可信网络开启」。长期开启须叠加门禁派插件,不裸奔。
  2. **与已装插件的已知冲突**:`ui-archive-manager` 的 `TRUSTED_HOSTS` 默认空 → 仅限 loopback(127.0.0.1/localhost),**开启 web.lan 需源码加 trustedHosts**(见 dsh.yaml 该条目 note),否则局域网下其路由会被信任防护挡掉。
- **开放问题**:
  1. 证书方案:mkcert 自签 CA(需在每台访问设备装 root CA) vs 内网 CA 签发 vs 直接走隧道派用公网证书;
  2. 是否把 HTTPS 能力纳入 `dsh.yaml` `web` 段(如 `web.https`)由 sync 统一渲染,还是仅作为 remote 定制条目接入;
  3. 门禁强度:密码 / CIDR 白名单 / TOTP,以及与 `web.lan` 开关的组合语义;
  4. 是否顺带评估隧道派以覆盖「不在同一局域网」的场景(与 B004 轴 B 的多机委派正交)。
- **本机现状核实(2026-08-24,推进前实测)**:
  - `dsh.yaml` `web.lan` 当前 **false**(默认关);`scripts/sync.mjs` 的 `LAN_FRAGMENT` 在开启时渲染 `webserver.config.host = ctx.webStartup.host ?? '0.0.0.0'`,manifest 校验只接受布尔,`DSH_LAN` env 优先级高于 manifest;
  - 本机 LAN 地址 = **192.168.64.3**(en0,网关 192.168.64.1),与用户诉求的 192 段一致;
  - secure-context 闸门**已核实存在**:当前部署的 client bundle 中 `crypto.randomUUID()` 共 9 处调用,其中浏览器侧关键路径 3 处(`dsh-client-connection/lib/client.js:242`、`:6181`,`dsh-client-ui-conversation/lib/client.js:62`),非安全上下文下该 API 为 `undefined`([MDN:randomUUID 仅安全上下文可用](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID));上游已有两条同题讨论确认 GUI 直接不可用而非仅告警([#4209 mintRpcId 报错](https://github.com/deepseek-ai/deepseek-harness/discussions/4209)、[#2396 LAN 绑定不可用](https://github.com/deepseek-ai/deepseek-harness/discussions/2396));
  - `dsh-web-app` 侧已内建 LAN 信任推导:`resolveLanTrust()` 在 bind 为 `0.0.0.0` 时枚举非内部 IPv4 作为 `trustedHosts`(**无端口的 IP 字面量**,注释说明 DNS 重绑定需攻击者可控域名故 IP 字面量安全),另有 `--trusted-host` CLI 可追加 → **官方 `/api` 围栏本身不阻挡局域网 IP 访问**,阻挡点只在 secure context 与第三方插件各自的围栏;
  - `ui-archive-manager` 冲突**已核实**:`lib/index.js:38` `const TRUSTED_HOSTS = []` 硬编码空数组(非配置项),`:104` 处非 loopback 且不在该数组即拒绝 → 局域网下其 unarchive 路由必被挡,需 patch 源码或接受该功能在 LAN 下不可用;
  - `@wingsky-1/dsh-lan-proxy` **npm 核实**:0.1.12,MIT,2026-08-23 更新(活跃),`dsh.bundle` + `dsh.client`(platform web)双面,运行依赖仅 `schemastery`,peer 仅 react;
  - 工具链:本机 **mkcert 未安装**(brew 可装),`openssl` 可用(`/usr/bin/openssl`)。
- **关键否决:TLS 代理与密码门禁不可叠加(2026-08-24 源码审查实证)**:
  - `dsh-lan-gate` 的准入判定基于 **`socket.remoteAddress`**(`lib/admit.js`,`SECURITY.md` 明写「uses socket.remoteAddress, not Host / X-Forwarded-For」);
  - `@wingsky-1/dsh-lan-proxy` 在 `0.0.0.0` 终结连接后**自己作为客户端**转发到回环,故到达 gate 的对端地址恒为 `127.0.0.1` → 命中 `loopbackBypassAuth`(默认 true)→ **门禁被完全旁路,局域网任何人免密获得完整 agent**;
  - 反向也不通:gate 的 `rejectProxyHeaders` 默认 true,代理若补 `X-Forwarded-*` 则请求被 403 全拒。两条路均不可用,**故否决「代理 + 门禁」组合**;
  - 附:lan-proxy 本身代码质量良好(targetHost 强制回环否则拒启、Host 仅收 IP 字面量/localhost 防 DNS 重绑定、自签证书 0600/825 天/SAN 含本机 LAN IP、无 child_process/无外联),但**不含任何认证**,且 HTTPS 失败会静默降级为明文 HTTP(仅 warn),留待 HTTPS 阶段重新评估。
- **中间态(已回退)**: 曾接入 `dsh-lan-gate@0.1.2` 拿到「内网 IP 访问 + 密码/CIDR 门禁」,但仍是明文 HTTP(同网可嗅探密码与 cookie,gate README 自述「not a TLS terminator」)。改用隧道后该条目 `enabled: false`,包已从 bundles 卸载。
- **未采用的 HTTPS 直连路线(留作移动端场景备选)**: 自研薄层在 `dsh.yaml` 加 `web.https`,用 `https.createServer` **包裹同一个 server**(而非代理转发)以保留真实 `socket.remoteAddress`,从而与门禁兼容;进阶可加 mTLS 客户端证书实现浏览器原生公钥免登。仅当需要手机/平板访问(隧道不便)时才值得投入。
- **更新**: 2026-08-24 新增;完成 backlog 选型调研与前置条件梳理,未立项、未安装任何插件;2026-08-24 用户明确要求推进(内网 IP + HTTPS),升 P1 并进入讨论中,完成本机现状核实(web.lan 现状 / LAN IP / secure-context 闸门与上游讨论 / 官方 trustedHosts 推导机制 / archive-manager 硬编码冲突 / lan-proxy npm 元数据 / mkcert 缺失),仍未安装任何插件;2026-08-24 审查 lan-proxy 与 lan-gate 源码后**否决代理+门禁组合**(代理使对端 IP 恒为回环,门禁被 loopback 旁路),改为先只装 `dsh-lan-gate@0.1.2` 拿到「内网 IP 访问 + 密码/CIDR 门禁」,HTTPS 留作下一步(倾向自研 TLS 包裹同一 server 以保留真实对端 IP);2026-08-24 用户提出「有没有类似 ssh 那种免登方案」后终选 **SSH 隧道**——公钥免登 + SSH 加密 + 回环天然 secure context,一举满足全部诉求且暴露面最小,`lan-gate` 随之禁用回退,HTTPS 直连路线转为移动端场景的备选,本条归档为已完成。

### [B007] 类似 Claude 的 /btw 沟通模式
- **状态**: 已完成
- **背景 / 动机**: 增加类似 Claude Code `/btw`(by the way)的沟通方式:发一条消息让 agent 只记录、不立即处理,不打断当前任务。
- **要点**:
  - 入口形态:slash 命令或输入触发;先查 DSH 现有 command/input-trigger 机制(`dsh-client-ui-commands`、`dsh-client-ui-input-trigger`)的扩展点;
  - 语义:低优先级侧注,不触发即时行动,写入持久记忆;
  - 存储位置待设计:会话内记忆 vs workspace 文件(如 NOTES.md)vs 任务级;
  - 消费时机:当前任务完成后回顾,或后续任务开始时带上;
  - 待设计:多任务并行时 btw 的归属(属于哪个任务/会话)、与 goal/todo 列表的交互;
  - 社区调研(2026-08-24):同类实现已有**三家**,核心语义一致 = fork 独立子会话 / 独立会话,不打断主线程:
    - **[dsh-sidechain](https://github.com/omdsh-dev/dsh-sidechain)**(omdsh-dev,GitHub 源,**npm 未发布**):`/btw <问题>` 一次性侧问(后台单轮,只读不可续问)+ `/side <问题>` 可持续侧会话 + `/side list`;fork 当前会话,侧会话日志/工具活动不写主历史,默认只读 persona;适配声明至 `0.1.1-rc.1`(当前 pin rc.2 待验证);README 安装示例指向 `Buyi-wsgzg` org,与现仓库不一致,接入前确认来源;
    - **[dsh-air](https://github.com/kaieye/dsh-AIR)@0.1.2**(npm,MIT):`/btw [问题]` 打开停靠式侧边对话(`/side` **等价别名,可持续追问**,区别于 sidechain 的只读一次性 /btw)+ 侧边栏内嵌问答;顺带 ↑/↓ 历史发送记录召回 + Ctrl+R 搜索(localStorage,上限 500 可调 10–5000);输入框历史与侧问打包,键盘党顺带收益;实现 = 纯 client(input-trigger 劫持 `/btw` 提交 → 官方 `sessions.fork`(已完成 turn 前缀,主会话进行中 fallback `create`+快照) → 首条 prompt 注入隐藏 boundary 信封(继承历史仅参考/禁工具改动/禁子代理) → 抽屉渲染子会话原生树,主会话不产生模型回合、历史与视口不动),语义对齐 Codex TUI side conversation(源码注释逐条对照 `codex-rs/tui/src/app/side.rs`);**模型选择 = 零干预**:无 selectModel 调用,面板无模型 UI——fork 子会话模型继承父会话当前模型(fork 契约仅 sessionId/atSeq/increaseTitle,host 端按 boundary 复制含 request/header 的事件日志,ModelDirectory current 随之恢复),fallback create 空会话用部署默认 `agent-default-model`(本机 = codex/gpt-5.6-sol/high);**上下文感知分路径**:fork = 完整感知(全量已完成事件含工具调用,仅以 boundary 标记为参考),fallback = 文本级部分感知(`<parent-thread-snapshot>` 可见节点序列化:user/assistant 文本 + tool-result 参数输出 + 在途 partial/runningCalls,reasoning 块故意排除);
    - **[dsh-sidebar-qa](https://github.com/ChenRuoT/dsh-sidebar-qa)@0.4.0**(npm,MIT):划选任意文本 → 「提问」浮层 → 侧边栏内嵌问答(独立会话 `❓<主题>`,可继续/归档);三种上下文策略 = `sessions.fork` 全量继承(前缀缓存命中)/ 压缩 / 机械裁切;嵌套追问 + 追问记录树(归档/删除置灰);**功能最全但依赖第三方 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) ≥0.14.0**(对应 DSH 0.1.0-rc.8 起,rc.2 peer 解析待验证),多一件依赖、信任面更大;
    - 旁类(非侧问,记录备查):[dsh-session-fork](https://github.com/Jason-skd/dsh-session-fork)(npm,「会话 = 分支」范式:并行分支 + squash 回主 + 内置 branch 图,Wiki 宣称与 git worktree 搭配——与 worktree 会话精神同向,关联 B014)、dsh-routed-subagent(bpc-oss:one-shot subagent 挂任意 preset + per-call 模型覆盖);
  - 匹配度:三家均覆盖「/btw 不打断主会话」核心诉求;「只记录、不立即处理」的纯记忆形态(写 NOTES.md 待回顾)三家均未覆盖,如需可叠加;
  - 选型结论:语义最贴 = sidechain;顺带历史召回 = dsh-air;功能最全 = sidebar-qa(代价:better-sidebar 依赖链)。**终选 sidebar-qa**,已按 add-dsh-plugin 流程接入并确认 DSH 0.1.1-rc.2 兼容;
  - 落地形态:`better-sidebar` 0.15.2 + `dsh-sidebar-qa` 0.4.0(manifest 均已启用),划选任意文本 → 「提问」浮层 → 侧边栏内嵌问答(独立会话,可继续/归档),默认 compressed 上下文策略省 token;
  - 未覆盖项(如需另立项):「只记录、不立即处理」的纯记忆形态(写 NOTES.md 待回顾)三家均未提供;侧问上下文看不到主会话**进行中**的 tool call / 流式输出(实现所限,完整性与省 token 不可兼得)。
- **更新**: 2026-08-14 新增;2026-08-24 完成两轮社区调研:首轮发现 dsh-sidechain,二轮确认同类共三家(sidechain / dsh-air / dsh-sidebar-qa)并拉齐对比,诉求核心普遍被覆盖,推进为讨论中,待选型试用;2026-08-24 试装 dsh-air 后弃用(=/btw fork 子会话全量继承父历史,每轮重复计费,主模型 codex 订阅无前缀缓存保障,侧问会话堆积),终选 sidebar-qa(better-sidebar 0.15.2 + dsh-sidebar-qa 0.4.0 已入 manifest 并合入 main,默认 compressed 策略省 token),待实测归档;2026-08-24 sidebar-qa 实现审查结论(源码核实):侧问发起零阻塞——create/fork 独立会话、prompt 走 queue,主对话进行中 inherit 自动降级 compressed(fork 需已完成 turn);host 仅对主会话只读 readSurface + 快速模型 160 token 摘要,不改主会话;侧问上下文只含已完成落盘内容,**看不到进行中 tool call/流式输出**(与 dsh-air 的 interrupted snapshot 携带在途状态相反,完整性/省 token 不可兼得);2026-08-24 日常使用确认 sidebar-qa 已满足诉求,归档为已完成。


### [B009] 仓库结构定稿:总配置 + 可插拔定制(monorepo)
- **状态**: 已完成
- **优先级**: P0
- **背景 / 动机**: zydsh 预期承载大量 DSH 定制(preset、插件包、skill、profile patch 等),期望一个总配置统一管理,各项定制可插拔开关、各自独立发布维护,但都放在同一仓库内。
- **要点**:
  - 目标形态:monorepo;根级"总配置"(manifest)声明启用哪些定制;每项定制独立目录(或包),可单独启用/禁用;
  - 定制类型盘点:agent preset、host 插件包(llm provider / subagent 接线 / 工具)、skill、cordis.patch 片段、启动脚本(`scripts/dsh.fish` 已有);
  - 发布/维护:每项定制独立版本(各自 package.json 或独立版本记录),总配置按版本引用;
  - 部署同步:总配置 → `~/.dsh` 落点(`.agent-presets/`、`profiles/web/cordis.patch.yml`、profile node_modules)的同步工具(`dsh plugin add` / 脚本);
  - 结合此前草案:`plugins/`、`presets/`、`profile/`、`skills/` 布局;与 openspec 工作流、BACKLOG.md 配合;
  - 待设计:目录布局、总配置格式(JSON/YAML)、开关粒度(全局 vs per-session)、多定制间依赖关系。
  - 方向定稿(2026-08-14):定制单元采用社区 `dsh.bundle` 标准(package.json 声明 bundle + 自带 cordis.patch.yml + src/),patch 跟包走;presets 走官方 `.agent-presets` 机制;skills 跟包或 project 源;总配置 manifest + sync 为自研薄层。
  - 结构定稿文档位置(2026-08-19):`README.md`(目录结构 + 真相源约定 + sync 用法)、`dsh.yaml`(manifest 契约:customizations / 顶层 `dependencies` / 字段约定)、`packages/README.md` / `presets/README.md` / `patches/README.md` / `skills/README.md`(各类定制单元规范);设计过程见 openspec change `repo-layout`(design D7/D8 定稿,归档后移入 `openspec/changes/archive/`)。
- **更新**: 2026-08-14 新增,即定 P0;同日方向定稿,进入 openspec 设计(change: repo-layout);设计定稿 + 实施完成(骨架 / `dsh.yaml` / `scripts/sync.mjs` / 迁移,spike 与 spec 场景验收通过),首个 remote 定制 cost-meter 纳入,首个按新结构落地的定制 subagent-codex(remote 包 + 顶层 dependencies + patches 接线)落地(2026-08-19);4.6 重启验收通过(cost-meter host+client 加载、subagent 两行激活、`dsh restart` 子命令补充);2026-08-19 openspec 归档完成(`2026-08-19-repo-layout`,主 specs 8 需求/16 场景),B004 codex 委派端到端验收通过,本条目完成。

### [B003] IDE 集成:打开当前项目目录
- **状态**: 已完成
- **背景 / 动机**: 增加用 IDE 打开当前项目目录的能力,暂时只支持 VSCode。
- **要点**:
  - 方案定稿(2026-08-19):复用社区插件 [dsh-open-in-vscode](https://github.com/omdsh-dev/dsh-open-in-vscode) v0.1.6——workspace 行 `…` 菜单「在 VSCode 中打开」,host 侧 spawn `code <path>`(进程分离);MIT,源码已审,无模型可见面;
  - npm 0.2.0 已 unpublished,按官方 README 用 tag v0.1.6 tarball 直装(manifest id: `open-in-vscode`,非 npm spec 显式 `name` 字段);sync 为此支持非 npm spec;
  - 未来扩展:JetBrains 等——插件 config 的 `command`/`args` 可配任意编辑器 CLI。
- **更新**: 2026-08-14 新增;2026-08-19 落地社区插件方案,重启验收通过(菜单打开 VSCode 正常),本条目完成。

### [B013] 侧边栏会话列表每个 session 前显示当前模型 icon（provider logo）
- **状态**: 已完成
- **优先级**: P2
- **背景 / 动机**: 多模型混用(DeepSeek / Codex / Claude / Grok 订阅等)后,不进入会话看不出各会话正在用哪个模型;希望在侧边栏会话列表**每个 session 标题前**放一个类似 icon 的模型标识(provider logo / 缩写徽标),一眼区分。
- **要点**:
  - 落地形态:session 行**前置** provider logo SVG,以该会话输入框**当前选中的下一次请求模型**为基准,选择器切换成功即立即切换 logo;官方 model-selection 的 per-session `ModelDirectory.store` 为真相源,host projection 仅作未打开历史会话的冷启动 fallback;
  - 实现路线:**轻量 DOM 注入 + 独立 `row-locator` 模块**(role="treeitem" + 标题反查,避免 hashed class),不重写官方浏览器;官方 session 行无 per-row slot,升级只修 row-locator 一处;
  - 边界:不触碰官方 StateDot / 时间 / 菜单 / 拖拽,保持官方原样;
  - logo:品牌 SVG 下载随包固定保存(DeepSeek/OpenAI/Anthropic/Grok/OpenCode 等),不手绘;未知/兼容 route 按 model fallback,再未知取首字母;
  - 设计过程、替代方案对比(影子替换 browser 被否、dsh-sentinel 依赖不存在契约)见 openspec change `sidebar-session-provider-icon`(已归档)。
- **更新**: 2026-08-20 新增并明确形态,社区调研确认无现成同款需自研;2026-08-21 初版落地 + 实机反馈修订(provider 基准改输入框当前选择、替换为真实品牌 SVG、补 OpenCode 映射);openspec 归档完成(主 spec 入 `openspec/specs/sidebar-session-provider-icon/`,manifest 条目已启用),2026-08-24 回填本条目为已完成。

### [B010] 任意页面查看 API 使用量
- **状态**: 已完成
- **优先级**: P2
- **背景 / 动机**: 希望不切换到专门页面,在 Web GUI 任意页面(会话、设置等)都能随时看到 API 用量(请求数 / token / 费用 / 余额 / 配额)。
- **要点**:
  - 调研结论(2026-08-18):社区已有大量现成产品,npm 均已发布,无需从零自研,优先评估复用;完整候选清单(全局可见类 / 专用页类 / 通用方案)见本条历史记录(git history 可复核);
  - 采纳路径:按调研结论启用功能最全的 [dsh-cost-meter](https://www.npmjs.com/package/dsh-cost-meter)(任意页面常驻展示本会话费用 / 当日费用 / 官方余额等,侧边栏 / 输入区 / dock 多位置可配),满足即用,不启动自研;
  - 落地版本:1.5.35(rc.2 适配修复费用展示缺失、内置 DeepSeek-V4-Flash-Vision-Exp 计价、修正未命中模型列表口径),manifest 条目已启用,重启验收 host + web client 加载正常;
  - 试用心得:日常使用确认满足「任意页面常驻看用量」诉求;若后续对指标范围 / 多厂商聚合有新要求,可回到本条重新评估候选(如 @kenz1117/dsh-ui-usage-billing)或自研。
- **更新**: 2026-08-18 新增;完成社区调研,结论「评估复用优先」;2026-08-21 cost-meter 1.5.35 启用并重启验收;2026-08-24 试用确认满意,归档为已完成。

### [B004] AI provider 订阅制认证(单机)
- **状态**: 已完成
- **优先级**: P0
- **背景 / 动机**: 希望 Codex / Claude 等不填 api-key,直接用订阅账号授权(OAuth / 本机 CLI 登录态)接入。
- **要点**:
  - 实现形态 = **provider 级订阅**(V1ki `dsh-plugin-subscriptions`,manifest id `llm-subscriptions`,当前 0.5.0):codex / claude / grok 订阅登录后出现在输入框模型选择器,claude 复用本机 Claude Code 凭据(keychain 导入秒登录);选型与重评估触发条件见 change `2026-08-20-llm-subscriptions-upgrade`(ADR-0001);
  - 形态演进:官方 CLI-as-subagent 路线(subagent-codex 接线)2026-08-19 落地后,于 2026-08-21(`7bf394e`)移除——主对话已被订阅制 provider 覆盖,委派能力经内置 spawn/fork 子代理保留,modlens 独立走 codex CLI 不受影响;
  - 单机验收:codex 订阅(2026-08-19 委派端到端 + 主对话)通过;claude 本机 CLI 2.1.221 可用、凭据导入登录可用(2026-08-24 确认);
  - 范围边界:多机派发 / 分布式(轴 B:官方 subagent/ACP 平面)暂缓,另行立项。
- **更新**: 2026-08-14 新增 P0 并定单机范围;2026-08-19 codex 落地验收;2026-08-21 subagent-codex 移除、订阅制定为主形态;2026-08-24 claude 本机可用确认,单机目标达成,归档为已完成。

### [B005] 新任务自动建 worktree,再 cwd 进入开始 agent 交互
- **状态**: 已完成
- **背景 / 动机**: 创建新任务时自动进入独立 git worktree,保证任务间文件隔离、并行任务互不干扰。
- **要点**:
  - 落地实现 = 自研 **Worktree Session**(`packages/worktree-session` + `ws` / `sw` skill + `scripts/ws-*.mjs`,manifest 已启用):首页空白会话首次普通发送时从 base 创建唯一 `ws/*` branch 与 `.worktrees/*` checkout,Agent 托管执行目录即该 worktree;npm lean 依赖复用、隔离开发 DSH_HOME、status/promote/clean 收尾,不切换主 checkout;
  - 首版适配当前 ohmydsh 仓;zydsh 嵌套仓库 / 多项目结构的泛化仍需单独评估;
  - 隔离层次的进一步讨论见 B014(未完成,需另行立项)。
- **更新**: 2026-08-14 新增;2026-08-24 确认当前 ws 机制已达成诉求(会话级隔离 worktree + 独立执行目录),归档为已完成;嵌套仓库泛化如需另立项。

### [B006] DeepSeek 模型下支持图片能力
- **状态**: 已完成
- **优先级**: P0
- **背景 / 动机**: 希望用 deepseek / 订阅模型时也能处理图片输入(截图理解、读图等)。
- **要点**:
  - 能力现状(2026-08-24):DeepSeek 官方已发布 **DeepSeek-V4-Flash-Vision-Exp**(多模态,vision at text prices,cost-meter 已内置计价)→ DeepSeek 原生图片能力已成,无需适配器改造;原闸门定位(apiproxy `inputModalities` 拒图 + `assertTextOnly` 抛错)随视觉模型加入而失效;
  - 生态兜底(已退场):`modlens` 曾作为「粘贴即视觉」兜底启用(走 codex CLI,实测读图成功);DeepSeek 原生视觉可用后于 2026-08-24 从 manifest 移除并卸载(`92368d0`),本条不再依赖任何第三方视觉插件;如需重新引入按 add-dsh-plugin 流程接入;
  - 遗留观察:**opencode-go 路由暂无可靠原生 vision**(社区网关 OmniRoute PR #2740 显示其声明过度、需 vision-bridge 强制),待上游支持即可,无本仓动作;
  - 历史调研细节见本条 git history。
- **更新**: 2026-08-14 新增 P0 并完成闸门定位;2026-08-24 确认 DeepSeek Vision-Exp 已发布、modlens 兜底已启用、opencode-go 待上游,归档为已完成;2026-08-24 收尾:原生视觉已足够,modlens 兜底移除(manifest 条目删除 + 卸载),本条收敛为纯原生能力。
