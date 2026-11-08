# dsh-memex-evaluation Specification

## Purpose
提供受控的 Memex 固定自检与独立检索评测：冻结真实输入和身份、核验来源与文件系统边界、记录可追溯观察和成本，支持保守恢复与离线重算，并区分工具自检与总体记忆有效性结论。

## Requirements

### Requirement: 固定自检范围与风险确认

首版 SHALL 只运行随受信包发布的固定三题自检（Know 有效知识、Act 过期知识、写回），每题运行有记忆和无记忆条件。CLI MUST NOT 接受自定义 suite、仓库、记忆库、题面或证据路径。

启动确认与报告 SHALL 写明“工具自检，不能用于有效性评估”；说明普通被测会话没有文件或 shell 隔离，宿主真实资产和 gold 仍可能可达；固定虚构输入不等于安全沙箱。用户未确认时 MUST NOT 创建模型会话。发现已知真实库、套件答案或其他题路径被访问时 SHALL 终止并标为“环境污染”，不声称能检测全部隐蔽访问。

#### Scenario: 用户确认后运行六个条件
- **WHEN** 用户确认固定自检计划
- **THEN** 计划包含三题各两个条件，报告含自检和宿主可达限制声明

#### Scenario: 自定义输入被拒绝
- **WHEN** CLI 收到 `--suite /tmp/private-suite` 或其他自定义输入路径
- **THEN** 参数校验非零退出，未读取该路径内容且未创建会话

#### Scenario: 用户取消时无会话
- **WHEN** 用户取消启动确认
- **THEN** 没有创建被测、父或裁判会话

#### Scenario: 观察到越界访问即污染
- **GIVEN** 被测日志含成功读取已知真实库路径
- **WHEN** 监测器收到该事件
- **THEN** 请求取消该题，结果为环境污染，不进入判定；报告说明该防线是事后检测

### Requirement: 固定夹具来源校验与独立物化

夹具树 SHALL 由随包发布的受信清单约束相对路径、普通文件类型、尺寸和 SHA-256。系统 SHALL 在读取源文件内容前，以 lstat 检查全部路径组成部分：拒绝软链接、非普通文件、文件链接数大于 1、非白名单条目及 gitdir/同步元数据；随后逐字节校验内容哈希。不能通过目录名推断内容虚构；程序与清单同时被篡改不在防御范围。

物化顺序 SHALL 为：验证源树 → 验证全新目标及父目录身份 → 以独占创建写入验证后的普通文件 → 在独立目标初始化 Git → 最终检查。MUST NOT clone、复制源 `.git`、remote、同步配置或共享对象库。被测仓库和卡片目录均按同样顺序创建。目标已存在时 MUST 拒绝且保持原内容。

#### Scenario: 固定资源成功物化
- **GIVEN** 包内资源路径和哈希全部一致
- **WHEN** 物化一个尝试
- **THEN** 目标文件内容等于清单，Git 无 remote、commondir、alternates 或 include，源树未变

#### Scenario: 根合法但叶子链接被拒绝
- **GIVEN** 夹具根为普通目录，但 cards/x.md 为指向真实文件的软链接
- **WHEN** 校验资源
- **THEN** 在读取链接目标内容前失败，没有创建测试会话

#### Scenario: 替换为真实副本被拒绝
- **GIVEN** 固定资源被替换为普通文件形式的业务卡片，路径名不变
- **WHEN** 校验哈希
- **THEN** 哈希不匹配导致拒绝，没有创建会话

#### Scenario: 已有目标不被清理
- **GIVEN** 尝试路径已有文件
- **WHEN** 物化
- **THEN** 非零退出，该文件逐字节不变

### Requirement: 永久唯一执行路径与路由预检

每个 round × question × condition × attempt SHALL 分配永久唯一且不重用的 cwd 与库路径；MUST NOT 使用固定槽位、共享挂载点、目录轮换或别名链接。每次重试 SHALL 分配新 attempt。

首版只支持单库。cwd SHALL 形如 `<run-root>/<mem|nomem>/eval-<unique>/repo`，无 origin；scope 由现有 local-path 规则派生，home 位于 `~/.dsh-memex/eval-*`。受管 workspace 声明 SHALL 在 run-root 关闭 fallback，在 nomem 与 judge 子目录关闭 memory。预检 SHALL 核实实际 Host scope 解析结果：有记忆仅当前副本可读写；无记忆关闭；personal 不可达；不支持拓扑时拒绝而不是降级。

#### Scenario: 两次尝试路由到不同库
- **WHEN** 解析 eval-a1/repo 和 eval-a2/repo 两个已分配 cwd
- **THEN** 两者 home 不同且都以 eval- 开头，read/write 都仅当前 scope，fallback 为 false

#### Scenario: personal 可达时拒绝
- **GIVEN** Host 生效配置缺少目录 fallback 关闭声明
- **WHEN** 路由预检发现 personal 可达
- **THEN** 未提交题面，结果为隔离失败

#### Scenario: 旧身份不会重新指向新题
- **GIVEN** 题 A 已结束，其旧会话再次被外部唤醒
- **WHEN** 题 B 已建立新尝试
- **THEN** A 与 B 的 cwd/home 仍不同，B 的路径未覆盖或替换 A 的路径

### Requirement: 轮次冻结实际输入

创建轮次 SHALL 保存固定题目、gold、夹具清单、模型配置、评分提示/schema、判定项适用表、预算、成本判据和工具版本的规范化实际副本及哈希。report SHALL 只读取本轮冻结数据与本轮证据；不得重新请求模型生成报告。

续跑时冻结副本哈希损坏或执行版本不符 SHALL 拒绝；当前包发生升级时仍允许从未损坏的旧轮次证据重建报告，MUST NOT 静默用新评分协议重判。

#### Scenario: 原输入删除后仍可复现
- **GIVEN** 一轮完成后包内题目被修改或卸载
- **WHEN** 使用兼容 report 读取轮次
- **THEN** 从冻结副本生成相同报告内容，不读取新题目

#### Scenario: 冻结数据被改时拒绝续跑
- **GIVEN** 冻结 gold 的字节被改变
- **WHEN** 续跑
- **THEN** 哈希校验失败，没有创建会话

### Requirement: 顶层模型配置与委派事后审计

被测者 SHALL 是普通顶层会话；首次 prompt 前显式 MANUAL 并回读，核验选定模型。主会话每次实际 request/header SHALL 与冻结 provider/model/effort 比较。无法确认时不发题面；事后发现不匹配则该题为配置不符。

首版接受普通委派无法在首次请求前限制的缺陷。系统 SHALL 递归采集后代身份、实际请求配置、调查/写入事件与成本；后代模型路线不同或证据不完整时整题为配置不符或证据缺失，不得只核对主会话。**此处是事后检测，不承诺只向声明服务商外发**，不得用于业务输入；被测发出普通显式委派时 MAY 已向其他服务商发送虚构内容。

#### Scenario: 默认 AUTO 被显式关闭
- **GIVEN** Host defaultMode 为 AUTO
- **WHEN** 创建被测会话并回读 MANUAL
- **THEN** 首个 prompt 只在 MANUAL 确认后提交；所有实际请求配置匹配才进入判定

#### Scenario: 后代走其他模型
- **GIVEN** 主会话路线匹配，但显式子 Agent 用其他模型
- **WHEN** 递归审计
- **THEN** 该题为配置不符，报告列出实际后代路线及已发生外发，不把事后拒绝表述为预防

#### Scenario: 后代成本合并不重计继承
- **GIVEN** 主会话工具调用 2 次、子代实际调用 3 次，子日志另含 2 条 seed 继承调用
- **WHEN** 计算被测成本
- **THEN** 工具调用数为 5，裁判调用单列，seed 两条不重计

### Requirement: 首次题面前固定标题以关闭辅助请求

六个被测顶层条件 SHALL 在首个 prompt 前通过 session/rename 写入固定非题面标题，并回读 user-pinned 状态；失败 MUST NOT 提交题面。系统 MUST NOT 为此全局禁用日常自动标题服务。真实默认 first-prompt 标题 provider 共装时，六个条件的 purpose=session-title 请求数 SHALL 为 0；裁判最小 preset 本身不被视为关闭 Host 标题服务。

#### Scenario: 六条件无标题辅助调用
- **GIVEN** 默认自动标题 provider 与 mock LLM 共装
- **WHEN** 六个顶层先固定标题再提交首题
- **THEN** 自检 session-title 请求数为 0，未登记日常会话仍可正常自动生成标题

#### Scenario: 固定标题失败不发题
- **GIVEN** rename 失败或无法回读 user-pinned
- **WHEN** 准备首个 prompt
- **THEN** 不发送题面，记录预检失败，没有该题主模型请求

### Requirement: 默认模型副作用披露但不自动恢复

运行前 SHALL 读取并持久保存日常默认模型，告知 `selectModel` 可能修改它并取得确认。运行结束、出错返回及下次启动时 SHALL 展示未确认轮次的原值、最近已见值和手动恢复方式。MUST NOT 调用 saveSelection 或提供恢复写端点；不得通过值相等推断谁做了选择。相同值也不能排除用户主动选择。

硬中断可能令结束检查未执行，下次启动 SHALL 从先前的持久记录提示。提示不保证异步保存已稳定，也不自动清除待确认状态；用户明确确认后才标为已处理。

#### Scenario: 检测后只提示不写回
- **GIVEN** 运行前 A，运行后读到 B
- **WHEN** 检测结束
- **THEN** 输出 A/B 与手动恢复说明，Host 默认模型仍为 B，没有默认值写操作

#### Scenario: 硬中断下次提醒
- **GIVEN** 轮次记录已保存原值后 CLI 被强杀
- **WHEN** 下一次启动 CLI
- **THEN** 在创建新会话前展示该轮次待确认提示，不自动恢复

### Requirement: 身份先登记与中断保守恢复

Host eval 桥 SHALL 持久记录 raw session/job/run 身份到私有运行账本，公共流量登记使用相同哈希算法。顶层会话 SHALL 使用预先保存的 sessionId 创建；创建响应丢失时按相同 ID 查询，不生成另一 ID 重发题面。后代须在 Host 创建事件中依 lineage 登记，不依赖 CLI 最后收集。

正常换题、取消和续跑前 SHALL 将本轮登记的测试根会话归档以禁止后续模型步骤，对精确 Agent cancel 清空 inbox 并等待 whenIdle；MUST NOT 归档日常会话，也不把归档静止说成根 Agent 已 dispose。对后代使用正式 drain 接口；drain 及合法 one-shot owner 收尾均完成后再次对精确测试根 cancel 清空可能注入的结算通知、await whenIdle，并最终核验 inbox 为空及全部资源证据。裁判 run 由桥持有并 await dispose。

系统 SHALL 在首个资源创建前订阅 jobs 事件并持久记录 Host generation、exact owner、注册与结算事件；list(owner) 后必须过滤 job.owner===owner，MUST NOT 取消 unowned 或其他会话作业。只有连续证据下可信 producer 契约所证明的 completed/killed 结算才允许继续。所有 failed、事件缺口、未证明先 removed、Host 换代身份不明、账本写失败都 SHALL 停止本轮并保留 raw ID。kill/interrupt accepted、terminal、空列表、idle/turn-end 均不是资源释放证明。可信结算记录仍 listed 不阻止继续；record 已 removed 时需持有此前释放证明，不要求资源记录先删除。旧路径不自动删除或再利用。

#### Scenario: 创建响应丢失不重复派发
- **GIVEN** 已写入指定 sessionId，Host 创建成功但响应丢失
- **WHEN** 恢复
- **THEN** 按该 ID 查询确认，未创建第二个会话或重复发送原 prompt

#### Scenario: turn-end 但 job 仍运行
- **GIVEN** 主回合结束但后台 bash job 未结束
- **WHEN** 准备进入下一题
- **THEN** 先取消并等待该 job；无法证明停止时本轮停止，下一题未启动

#### Scenario: 后代在 CLI 崩溃前已登记
- **GIVEN** Host 已发布一个测试后代身份
- **WHEN** CLI 立即崩溃
- **THEN** Host 账本和流量登记仍含该后代，能恢复其 raw ID

#### Scenario: failed 或丢证据不能当资源释放
- **GIVEN** 作业被强制标记 failed 后从列表移除，或结算事件缺失
- **WHEN** 尝试进入下一题
- **THEN** 本轮停止并保留 raw ID，不以 terminal 或空列表放行

#### Scenario: 归档测试根但不销毁日常对象
- **GIVEN** 一测试根和一日常会话同时存在
- **WHEN** 测试根收尾
- **THEN** 仅测试根归档并清空队列、等待静止；日常会话不变，报告不声称测试根已 dispose

#### Scenario: 作业按精确 owner 清退
- **GIVEN** list(testOwner) 返回本轮 owned job 与 unowned job
- **WHEN** 收尾
- **THEN** 只取消本轮 owned job，并在连续 completed/killed 释放证据及后代 drain 完成后继续

#### Scenario: 后代结算通知在最终清队列时清除
- **GIVEN** drain 成功及合法 one-shot owner 收尾时分别向已 idle 的测试根 inject 结算消息
- **WHEN** 等待二者收尾均完成
- **THEN** 在二者之后执行末次 cancel 并 await whenIdle，最终 inbox 为空，日常会话不变；任一 owner 收尾未完成不得进入最终核验或下一题

#### Scenario: 可信结算记录保留不阻止继续
- **GIVEN** 作业有完整 registered 到 completed 的释放证据，记录仍在 jobs.list 中
- **WHEN** 最终收尾核验
- **THEN** 可以继续，不要求先 remove 记录；若记录无证明地消失则停止

### Requirement: 受限裁判组合和首次请求前门禁

裁判父会话 SHALL 使用专用最小 preset，不挂载标准 coding preset、文件、shell、网络、skill、AGENTS 加载或委派插件；其 cwd memory:false。父会话不得收到 prompt，不调用 selectModel。

裁判 SHALL 使用 fresh spawn，继承上述最小组合，以 explicit agentOptions 指定冻结 judge provider/model/effort、outputSchema；depth=0 父的创建上限 SHALL 为 1。该上限只限制本次创建，不当作后代授权控制。

实际裁判工具面 SHALL 仅包含 structured_output（以及经核验只传输此结果、不增加能力的必要外壳），没有文件/命令/外部网络/委派能力。全局 allow:[] 不覆盖 own 工具，故 SHALL 在最终装配完成、首个模型请求前核验有效工具面与请求上下文；不符时拒绝发送。MUST NOT 在 await start 返回后才核验（start 可能已发出模型请求）。门禁不可实现时该裁判能力为未通过，不能以全 unknown 代替成功。

最终门禁 SHALL 在 Host/root LlmRuntime 的 `llm/stream` 入口，对即将交给 next 的冻结 loop request 执行；按 options.sessionId 绑定创建窗口登记的精确 child 对象，核验 agents.get(id) 等于该对象且 agents.isOwnedBy(id, registeredParent)。仅持久 lineage、cwd、重新 assemble 快照或事后 header 不构成证明。门禁 SHALL 只影响绑定的裁判，其他日常会话不受影响；首版可信下游中间件不得改写或旁发。

#### Scenario: 裁判成功提交结构化结果
- **GIVEN** 最小父 preset 完成装配，工具面只有 structured_output
- **WHEN** 从 depth0 父以 maxDepth1 启动裁判
- **THEN** 首次请求前门禁通过，返回 schema 合法的结构化结果，日常默认模型不变

#### Scenario: own subagent 导致首请求前拒绝
- **GIVEN** 组合意外加入 own subagent 工具
- **WHEN** 裁判首次模型请求即将执行
- **THEN** 门禁阻断，模型调用计数为 0，裁判自检为失败

#### Scenario: 证据指令不能扩大能力
- **GIVEN** 固定测试证据含读取 /tmp/answers.json、调用 bash 或委派的指令
- **WHEN** 受限裁判处理
- **THEN** 无文件、bash 或委派工具可成功执行，仅可提交结构化结果

#### Scenario: 后置装配注入被最终请求门禁拒绝
- **GIVEN** 后置 assemble listener 在已有快照检查之后加入 subagent 工具或 AGENTS 消息
- **WHEN** 最终请求进入 root llm/stream
- **THEN** 门禁拒绝，mock adapter 调用数为 0

#### Scenario: 持久 lineage 相同但 live owner 错误
- **GIVEN** 请求 sessionId 的 durable parentSession 匹配，但精确对象或 isOwnedBy 校验不符
- **WHEN** 请求进入裁判门禁
- **THEN** 在 adapter 调用前拒绝，不冒认裁判

#### Scenario: 日常会话不受裁判门禁影响
- **GIVEN** 一个未登记为裁判的普通日常会话
- **WHEN** 发送其正常模型请求
- **THEN** 请求按原链路到达 mock adapter，不要求 structured_output

### Requirement: Eval 桥绑定冻结轮次与生命周期

桥 SHALL 沿用 Host Connection 的 Host authority、Origin 和 cookie 校验，明确这是已认证 Host operator 可调用的接口，不宣称能识别调用者必为 CLI 或从 cookie 证明 socket 来自本机。Connection 可允许 trustedHosts，未检查 remoteAddress；首版沿用既有部署认证边界，不新增逐请求本机来源保证。桥仅接收已登记 round/item 的标识，不接受任意 prompt、schema、模型、父 ID 或文件路径；从受信固定资源及已冻结的轮次计划取得它们。轮次注册须验证固定夹具版本和路径。

裁判父会话的 raw ID 由桥持有，首用与每次复用前核查从未收到 prompt。调用方不得放宽工具面。请求超出计划、Host authority/Origin 校验失败、无 cookie、未知 round、协议不符或父已用过均拒绝。

Host SHALL 为每次裁判拥有 AbortController、时长与输出 token 上限；断连、超时、异常均取消，finally await dispose。失败的判定项为 unknown，资源清退失败停止轮次。

#### Scenario: 冻结项成功评分并清退
- **WHEN** 已认证客户端请求已登记的 item
- **THEN** 桥用冻结 judge 协议评分，最终 dispose 完成，无活跃裁判作业

#### Scenario: 伪造路线或任意证据被拒绝
- **WHEN** 请求附加 provider、schema、evidencePath 等未允许字段
- **THEN** 参数校验拒绝，未启动子 Agent

#### Scenario: 未鉴权或跨源请求被拒绝
- **WHEN** 裁判请求无 Host cookie 或 Origin 不合法
- **THEN** 返回鉴权拒绝，未启动裁判

#### Scenario: 父会话已收到 prompt 被拒绝
- **GIVEN** 裁判父会话被 GUI 提交过 prompt
- **WHEN** 桥准备下一次评分
- **THEN** 拒绝该父身份，未发送裁判请求，轮次停止并提示污染

#### Scenario: 裁判超时或客户端断开
- **GIVEN** 裁判仍未返回
- **WHEN** 达到时长上限或 CLI 断开
- **THEN** Host abort 并 await dispose，该项 unknown；清退失败则不继续下一项

### Requirement: 全文证据、实际阅读覆盖与引文核对

系统 SHALL 完整解码多帧 zstd，保留主会话及递归后代的调用/返回、回答、实际输入、请求配置、回合边界与成功写入事件；seed 继承按身份去重。原始证据不可截断；缺帧/日志缺失则该题证据缺失。

裁判只接收评分项所需片段，并带精确 session/event 定位、选取规则与内容哈希；报告区分“已采集全文”“程序检查范围”“裁判实际收到片段”“人工已复核范围”，不得从已采集推断已阅读。

yes/no 输出 SHALL 有至少一条非空、非纯空白引文，定位和文本逐字匹配；否则 unknown。unknown MAY 无引文但必须有原因。存在性校验只证明出处，不保证支持结论；首版未校准评分必须显著标“未校准”，人工 spot-check 不冒充 gold。

#### Scenario: 成功结果保留全文
- **GIVEN** memex_read 成功返回长卡片
- **WHEN** 提取证据
- **THEN** 返回全文字节未截断，裁判只读选定片段时覆盖标签不写为全文语义已验证

#### Scenario: 日志损坏不判失败
- **WHEN** 末帧解码失败
- **THEN** 该题为证据缺失，不计为行为失败

#### Scenario: 非空列表含空引文
- **GIVEN** yes 结果 quotes=[{event:"e1",text:" "}]
- **WHEN** 引文核对
- **THEN** 结果 unknown，原因为空引文

### Requirement: 共同终点与可重算的分支漏斗

首版 SHALL 同时报每个计划条件的端到端终点（必答事实、过期事实误导、写回正确性）和独立的条件诊断，不以检索失败阻止终点判定。执行失败/证据缺失/unknown 单独列出，不能从端到端计划分母静默消失。

诊断路径固定为：有记忆 Know 为 Retrieval→Know；有记忆 Act 为 Retrieval→Act；无记忆直接 Know/Act。写回作为独立观测从所有写回题开始，不要求 Know/Act 已通过。N/A 跳过，前驱为上一适用层。层内仅聚合冻结适用表的必需项：任一 no 优先 fail；无 no 且有 unknown 为 unknown；全部 yes 为 pass；无适用项为 N/A。条件漏斗下一适用层只统计前驱 pass 的题，未入分母的项仍保留原始终点结果。

排名是诊断而非成功阈值；仅链接不代表链接目标事实已经到达；确切事实经替代卡到达可通过。

#### Scenario: Act 跳过 Know 层
- **GIVEN** 三道有记忆 Act，Retrieval 分别 pass/fail/unknown，终点结果分别 yes/yes/unknown
- **WHEN** 汇总
- **THEN** 条件 Act 分母为 1，端到端计划分母仍为 3，另列终点 yes=2、unknown=1

#### Scenario: 层内 no 优先于 unknown
- **GIVEN** 一层两个适用必需项分别 no 与 unknown
- **WHEN** 聚合
- **THEN** 层结果为 fail；若两者改为 yes 与 unknown 则为 unknown

#### Scenario: 写回不被不适用层挡住
- **GIVEN** 写回题的 Act 为 N/A
- **WHEN** 判定写回
- **THEN** 仍进入写回观察分母，不因 Act N/A 而排除

### Requirement: 按成功写入时序分类

普通题只观察一个自然回合；写回题按固定后续输入观察第二回合。每次成功写入 SHALL 按先前实际送入的明确写入要求、写卡提醒顺序分类：明确要求后、提醒后、或主动。未来消息不得追溯改类。无成功写入则未写回；只见失败调用则记录失败但不算写入；证据不足则 unknown。内容新增/更新/归档及目标库正确性另项记录。

#### Scenario: 先主动后要求不追溯改类
- **GIVEN** 首回合成功写卡，第二回合才明确要求写卡
- **WHEN** 分类首回合写入
- **THEN** 该次为主动写回

#### Scenario: 明确要求后未写
- **GIVEN** 明确要求已送入但只有失败写调用
- **WHEN** 观察结束
- **THEN** 为未写回且记录调用失败，不归为明确要求后写回

### Requirement: 计划预算与保守续跑

启动前 SHALL 从冻结计划分列顶层被测数、对照数、裁判父会话数、追加回合数和逐条件裁判调用上限，已知部分精确计数，普通自发后代成本为未知并另列。无记忆共同终点的裁判也计入。所有预算记录具体限值，观察到软步数/时长超出即取消，披露可能超出而不保证恰好第 N 步截止。

续跑只为未完成题创建新 attempt，保留前次结果，不自动重复失败裁判或未知提交。默认值未确认警告与资源未清退要在继续前呈现；资源未清退必须拒绝。

#### Scenario: 配对裁判预算不漏计
- **GIVEN** 3题双条件，每条件2语义项，1题每条件加第二回合，1个父会话
- **WHEN** 显示计划
- **THEN** 顶层3、对照3、父1、追加回合2、裁判最多12次，自发后代预算标未知

#### Scenario: 活资源阻止续跑
- **GIVEN** 前次已知后台 job 取消失败
- **WHEN** 续跑
- **THEN** 拒绝并列 raw job/session ID，没有新尝试

### Requirement: 自检报告而非效果排名

report SHALL 是离线确定性的 Markdown，含冻结版本/模型、所有计划条件与状态、事件证据链接、实际覆盖、裁判未校准提示、配对共同终点与工具/token 原始计数（主代合计、裁判单列）、默认值待确认和宿主隔离限制。token 拆 input/output/cached（不把 cached 再加到 input），缺失时记 unknown。

自检 MUST NOT 输出总分、贝叶斯区间、总体有效率、净节省、改善或“已达优化门槛”；单次配对差异只描述本次观测。相同结果的题保留为控制，不删除。三题不能替代人审校准和 topic-held-out 验证。

#### Scenario: 配对相同保留控制
- **GIVEN** 一题有/无记忆答案与工具数相同
- **WHEN** 生成报告
- **THEN** 保留两个条件和“本次观测相同”，不从自检中筛除该题

#### Scenario: 全部语义 unknown
- **GIVEN** 裁判均未取得可用结果
- **WHEN** 报告
- **THEN** 标自检未完成，不输出区间或有效性结论，CLI 返回非零状态

### Requirement: 测试流量登记与消费端排除

Host 桥 SHALL 把本轮父、被测及全部递归后代登记在 `$DSH_HOME/plugins/dsh-memex/eval-registry.ndjson`，仅含 round/role/scope/session哈希/父哈希/状态等元数据，无题面/card/gold。raw ID 存私有运行账本，不从哈希反解。

recall-report 默认排除登记会话或 eval- scope（见既有能力 delta）；包装脚本跳过 eval- 库；weekly-insights 在归根、汇总、缓存使用前按登记与测试 cwd 前缀排除，并传播到后代。登记损坏/缺失输出一次提示并采用 scope/cwd 后备识别，不因缺文件失败；不知道的条目不得谎称已排除。

#### Scenario: 三消费端排除
- **GIVEN** 日常与测试会话/库混合
- **WHEN** 运行三个报告入口
- **THEN** recall-report不计测试召回，包装脚本不枚举eval库，insights不汇总测试根或后代，均报告排除数

#### Scenario: 登记损坏使用后备规则
- **GIVEN** 登记一行无法解析，但测试cwd前缀可识别
- **WHEN** insights汇总
- **THEN** 提示一行损坏，排除该测试cwd及后代，正常退出

### Requirement: 长期方法论保留且纠正迁移声明

本 change 的方法论映射 SHALL 区分 implemented-selftest、deferred 和 corrected；不得将固定自检说成人工校准、阅读验证或防过拟合已经实现。业务评估、出题/留出、20–30校准+每轮3–5复核、主题统计/阈值、跨库与稳定性 SHALL 明确留在后续工作，未迁移原文不得删除。

纠正项 SHALL 记录理由：相关不等于贡献；链接不等于目标事实到达；引文存在不等于语义支持或已读全文；历史权重不是贝叶斯先验；区间重叠不能作为配对改善检验；主题聚类要建模而非把主题数称为唯一有效样本量。首版不执行这些效果推断。

#### Scenario: 逐原则保留去向
- **WHEN** 审查方法论映射
- **THEN** 每个原原则有明确 implemented-selftest/deferred/corrected 与理由，校准/留出/稳定性不是 implemented-selftest

#### Scenario: 未迁移原文不被删除
- **GIVEN** 某原则在映射中为 deferred
- **WHEN** 比较本次方法论文档改动
- **THEN** 该原则仍被保留；若删除则规划检查失败

### Requirement: 检索评测的文件系统边界

系统 SHALL 提供命令 `dsh-memex-eval-retrieval`，分两个阶段运行：制作快照和冻结运行。威胁模型与 `dsh-memex-memory`「检索后端的来源边界与更换条件」一致：防范误配置和误操作，不防范能在运行期间改动本机目录的人。

本要求的完整约束列于首个场景末尾，对本要求的全部适用情形均有效。

#### Scenario: 普通库制作快照且原库不变
- **GIVEN** 一个含 5 张普通卡的夹具库，并加入 1 张新 slug 的干扰卡；记录原库每个文件的 mtime 与内容
- **WHEN** 运行检索评测
- **THEN** 命令退出码为 0；快照含 6 张卡，目录权限 0700、文件权限 0600；原库每个文件的 mtime 与内容不变，原库目录下的文件集合不变

**本要求的完整约束（适用于全部场景）：**

系统 SHALL 提供命令 `dsh-memex-eval-retrieval`，分两个阶段运行：制作快照和冻结运行。威胁模型与 `dsh-memex-memory`「检索后端的来源边界与更换条件」一致：防范误配置和误操作，不防范能在运行期间改动本机目录的人。

**写入域**：快照、报告与冻结观测目录统称写入域。

- 写入域 SHALL 固定在评测根 `~/.dsh-memex-eval/retrieval/` 之下，每次运行新建一个带运行 id 的子目录。命令行 MUST NOT 提供自定义输出路径。
- 从 `$HOME` 到运行目录的每一级路径 SHALL 是真实目录，不得是软链接或其他文件类型，用 lstat 逐级确认；评测根不存在时以 0700 新建。任何一级是软链接时 SHALL 拒绝，且不创建任何文件。这保证评测根不能通过别名指向其他位置，包括尚未初始化的库目录。
- 创建之前，系统 SHALL 取该运行目录已存在的最近祖先的真实路径，从它开始逐级向上检查直到文件系统根：任何一级目录含名为 `cards` 的子目录（记忆库的标志），或与输入原库的真实路径相等，都拒绝，且不创建任何文件。写入域是新建的空目录，其中不可能含有库，因此这一检查覆盖「写入域位于某个库之内或与之相等」的全部情形，不依赖库清单。
- 写入域 SHALL 独占新建，目录权限 0700，文件权限 0600，已存在的路径 MUST NOT 被复用或覆盖。

**读取**：制作阶段只读原库 `cards/` 下的普通文件。

- 打开文件前，SHALL 对路径链逐级 lstat；遇到软链接、特殊文件、相对路径含 `..` 或为绝对路径时拒绝。
- 打开时使用不跟随软链接的方式；打开后 SHALL 用 fstat 再次确认它是普通文件且链接数为 1，否则拒绝。
- 任一文件被拒绝，整次运行即拒绝。

**干扰卡**：SHALL 使用快照中不存在的新 slug；与原卡或任一题的目标卡同名时拒绝。

**冻结运行**：SHALL 以快照目录作为内核的 `MEMEX_HOME`，MUST NOT 读写原库目录。

#### Scenario: 软链接卡片在打开前被拒绝
- **GIVEN** 夹具库的 `cards/x.md` 是指向库外文件的软链接，文件操作被替身记录
- **WHEN** 运行评测
- **THEN** 命令以非零退出，输出含 `cards/x.md` 与「symlink」；替身记录中没有对该路径或其目标的 open 调用；快照目录未创建

#### Scenario: 硬链接与特殊文件被拒绝
- **GIVEN** 分别构造：某卡的链接数为 2；`cards/` 下有一个名为 `p.md` 的命名管道
- **WHEN** 分别运行评测
- **THEN** 每次都以非零退出，输出分别含「hard link」与「not a regular file」及对应路径

#### Scenario: 评测根经别名落入某个库时被拒绝
- **GIVEN** 测试把 HOME 指向临时目录，并令 `~/.dsh-memex-eval` 是指向某个含 `cards/` 目录的库（不在 `~/.dsh-memex/` 下）的软链接
- **WHEN** 运行评测
- **THEN** 命令以非零退出，输出含该库的真实路径；该库下的文件集合不变，没有新建任何目录

#### Scenario: 评测根是指向未初始化库的软链接时被拒绝
- **GIVEN** 测试把 HOME 指向临时目录，`~/.dsh-memex-eval` 是软链接，指向一个已存在、但不含 `cards/` 的空目录
- **WHEN** 运行评测
- **THEN** 命令以非零退出，输出含「symlink」与该路径；被指向的目录仍然为空

#### Scenario: 祖先中只有名字相近的目录时通过
- **GIVEN** 评测根的某一级祖先含名为 `cards-old` 的目录，但不含 `cards`
- **WHEN** 运行评测
- **THEN** 检查通过，命令退出码为 0

#### Scenario: 已存在的运行目录不被覆盖
- **GIVEN** 替身让运行 id 生成器返回一个已存在、并含一个文件的目录名
- **WHEN** 运行评测
- **THEN** 命令以非零退出，该文件内容不变

#### Scenario: 干扰卡与已有 slug 同名被拒绝
- **GIVEN** 一张干扰卡的 slug 与原库中已有卡相同
- **WHEN** 运行评测
- **THEN** 命令以非零退出，输出列出冲突的 slug，没有任何内核调用

### Requirement: 快照不可变输入清单与元卡排除

快照的不可变输入清单 SHALL 由两部分组成：排除元卡、加入干扰卡之后 `cards/` 下的全部文件，以及快照 `.memexrc`。`.memexrc` 只含从原库复制的白名单字段 `nestedSlugs`，其他字段 MUST NOT 复制。

整体哈希的计算方式：对清单中每个文件取 sha256，按相对路径字典序拼接成 `path\0hash\n`，再对整体取 sha256。逐文件哈希、整体哈希与被排除的 slug 列表 SHALL 写入报告。

排除规则由 category 集合和 slug 前缀集合组成，可在运行时追加。默认 category 为 `handoff` 与 `eval`，默认前缀为 `probe-`、`handoff-`、`memex-retrieval-probe-`。`research`、`decision` 等类别只在显式追加时排除。

系统 SHALL 在冻结运行开始前和结束后各核验一次：清单中的文件哈希都不变，快照中没有清单之外的文件。任一不符时，整轮标为 invalid。命令行声明的期望哈希与实际不一致时，SHALL 在运行任何检索之前拒绝。

#### Scenario: 默认规则排除元卡并列出
- **GIVEN** 夹具库含一张 category 为 `handoff` 的卡、一张 slug 以 `probe-` 开头的卡、一张 category 为 `decision` 的卡
- **WHEN** 以默认排除规则运行
- **THEN** 快照中不含前两张卡、保留 `decision` 卡，报告的排除列表恰为前两个 slug

#### Scenario: 非白名单配置不进入快照
- **GIVEN** 原库 `.memexrc` 含 `openaiApiKey` 与 `nestedSlugs: true`
- **WHEN** 制作快照
- **THEN** 快照 `.memexrc` 的 JSON 键集合恰为 `["nestedSlugs"]`

#### Scenario: 声明哈希不符拒绝运行
- **GIVEN** 命令行声明的整体哈希与实际不同
- **WHEN** 运行评测
- **THEN** 命令以非零退出，输出含声明哈希与实际哈希，没有任何内核调用，报告文件未生成

#### Scenario: 运行中改卡或多出文件则整轮无效
- **GIVEN** 分别构造：替身在第 2 题之后修改快照中一张卡；替身在第 2 题之后向快照 `cards/` 新增一个文件
- **WHEN** 运行结束
- **THEN** 两次的报告状态都是 invalid，并列出变化的路径，汇总行不给出任何命中率

### Requirement: gold set 契约与选集

gold set SHALL 是 UTF-8 JSON 数组，文件不超过 1 MiB，题数为 1 到 500。每题的字段如下，出现未知字段即拒绝：

- `id`：非空字符串，在文件内唯一；
- `query`：非空字符串，不超过 500 个字符；
- `targets`：1 到 10 个互不重复的 slug，每个都匹配内核的 slug 模式，不含 `..`，不以 `/` 开头；
- `type`：`single-hop` 或 `multi-hop`，只是人工题型标签，不度量证据是否完整；
- `topic`：非空字符串；
- `origin`：非空字符串；
- `set`：`dev` 或 `holdout`。

本要求的完整约束列于首个场景末尾，对本要求的全部适用情形均有效。

#### Scenario: 混合集合文件按选集运行
- **GIVEN** 一个文件含 3 题 `dev`、2 题 `holdout`，topic 不跨集合，targets 都存在
- **WHEN** 以 `--set dev` 运行
- **THEN** 命令退出码为 0，报告恰含 3 题，报告文件名不含 `holdout`

**本要求的完整约束（适用于全部场景）：**

gold set SHALL 是 UTF-8 JSON 数组，文件不超过 1 MiB，题数为 1 到 500。每题的字段如下，出现未知字段即拒绝：

- `id`：非空字符串，在文件内唯一；
- `query`：非空字符串，不超过 500 个字符；
- `targets`：1 到 10 个互不重复的 slug，每个都匹配内核的 slug 模式，不含 `..`，不以 `/` 开头；
- `type`：`single-hop` 或 `multi-hop`，只是人工题型标签，不度量证据是否完整；
- `topic`：非空字符串；
- `origin`：非空字符串；
- `set`：`dev` 或 `holdout`。

`targets` 是 OR 集合：返回其中任意一张即算命中，不分主次。

系统 SHALL 按以下顺序处理，且全部在任何检索与输出物化之前完成：

1. 对整个文件校验结构、唯一性，以及「同一 topic 不跨 set」；
2. 按必填参数 `--set` 选出一个集合，选出的题为空时拒绝；
3. 确认被选题的每个 target 都在快照中存在。

错误定位规则：文件级错误（无法解析、不是数组、空数组、超过大小）报文件路径与根路径 `$`；题级错误报题的 `id`（缺 `id` 时报数组下标）和字段名。

`holdout` 的报告 SHALL 写入带 `holdout` 标记的独立文件名。

#### Scenario: 同主题跨集合被拒绝
- **GIVEN** 两题 `topic` 相同而 `set` 不同
- **WHEN** 以任一 `--set` 运行
- **THEN** 命令以非零退出，输出指出该 `topic`，没有任何内核调用

#### Scenario: 文件级错误定位到根
- **GIVEN** 分别构造：空数组；内容不是合法 JSON
- **WHEN** 运行评测
- **THEN** 每次都以非零退出，输出含文件路径与 `$`，没有任何内核调用

#### Scenario: 题级错误定位到 id 与字段
- **GIVEN** 分别构造：两题 `id` 相同；某题 `targets` 为空；某题 `type` 为 `triple`；某题含未知字段 `note`；某个 target 为 `../x`
- **WHEN** 分别运行评测
- **THEN** 每次都以非零退出，输出含对应的题 `id` 与字段名，没有任何内核调用

#### Scenario: 目标卡不存在时报出 slug
- **GIVEN** 被选题的某个 target 不在快照中
- **WHEN** 运行评测
- **THEN** 命令以非零退出，输出列出该题 `id` 与缺失的 slug

#### Scenario: 未指定或选空集合被拒绝
- **GIVEN** 文件只含 `dev` 题
- **WHEN** 不带 `--set`，或带 `--set holdout` 运行
- **THEN** 命令以非零退出，输出说明需要显式选集，或所选集合为空

### Requirement: 评测检索与插件关键词路径一致

评测 SHALL 只使用关键词后端。它调用插件 `memex_search` 所用的同一个关键词参数构造函数；该函数是共享纯函数，不写遥测。一致性承诺只限于单库、带 query 的 `memex_search`，不涵盖无 query 的 recall 和多库归并。

评测 MUST NOT 向召回遥测文件追加记录。语义与混合后端不在本 change 内，命令行传入其他后端名时 SHALL 拒绝。

#### Scenario: 评测与插件工具的内核参数一致
- **GIVEN** 一组查询，覆盖纯中文、纯 ASCII、中英混合，以及 limit 为 1、10、50；两侧都使用记录参数的替身内核
- **WHEN** 分别经插件注册的 `memex_search` 和评测执行
- **THEN** 两侧传给内核的参数数组逐项相同

#### Scenario: nestedSlugs 库返回带前缀的 slug
- **GIVEN** 夹具库 `.memexrc` 为 `{"nestedSlugs": true}`，卡片位于 `cards/a/x.md`
- **WHEN** 用真实内核分别对原库经插件检索、对快照经评测检索
- **THEN** 两者返回的 slug 序列逐项相同，且含 `a/x`

#### Scenario: 未知后端被拒绝
- **GIVEN** 命令行传入 `--backend local-semantic`
- **WHEN** 运行评测
- **THEN** 命令以非零退出，输出说明本版本只支持 `lexical`，没有任何内核调用

#### Scenario: 评测不写遥测
- **GIVEN** 记录运行前召回遥测目录下所有文件的大小与哈希
- **WHEN** 完成一次评测
- **THEN** 遥测目录的文件集合、大小与哈希都不变

### Requirement: 冻结观测与离线重算

系统 MUST 满足「冻结观测与离线重算」规定的完整行为与边界。

本要求的完整约束列于首个场景末尾，对本要求的全部适用情形均有效。

#### Scenario: 删除快照并换环境后离线重算一致
- **GIVEN** 一份已生成的报告及其冻结观测
- **WHEN** 删除快照、把内核安装目录改名后执行离线重算
- **THEN** 没有内核调用，重算的汇总与成本列都和原报告逐项相等，原报告文件未被修改

**本要求的完整约束（适用于全部场景）：**

每次运行 SHALL 在报告目录冻结以下内容：

- 运行协议版本与内核版本；
- 快照白名单配置、查询预处理版本、截断值与排除规则；
- 被选的 gold 题；
- 干扰卡的 slug 与内容哈希、不可变输入清单的整体哈希、运行前后完整性核验的结果与差异路径、最终状态（`ok`、`incomplete`、`invalid`）；
- 逐题观测：有序返回 slug、返回字符数、状态（`ok`、`empty`、`error`）、错误类别、耗时（毫秒）。返回字符数按计数协议 `chars-v1` 计算：对插件检索输出解析器得到的每个 hit，取 `title + "\n" + summary` 的 Unicode 码点数（summary 包含解析后保留的附加行），逐题求和；`empty` 记 0，`error` 记 unknown；
- 成本观测：内核安装大小、快照大小、分位数算法版本、字符计数协议版本。

冻结内容 SHALL 带有自身的完整性哈希。

冻结文件 SHALL 独占创建，MUST NOT 原地改写。

离线重算 SHALL 只读取冻结观测，不调用内核、不读卡片、不读安装环境，结果写入新文件。协议版本不是本工具支持的版本时，SHALL 拒绝重算。

所有被选题 SHALL 保留在分母中。任何一题为 `error`（内核超时、非零退出、输出无法解析）时，报告状态 SHALL 为 `incomplete`，列出出错的题，并且 MUST NOT 被当作有效基线。`error` MUST NOT 计为空结果。

#### Scenario: 中途出错的题保留在分母
- **GIVEN** 5 题中第 3 题的替身内核返回无法解析的输出
- **WHEN** 运行结束
- **THEN** 报告状态为 `incomplete`，分母为 5，第 3 题状态为 `error`，空结果数不含该题

#### Scenario: 返回字符数按协议计算
- **GIVEN** 一题返回两个 hit：`{title: "ab", summary: "中文"}` 与 `{title: "c", summary: ""}`；另一题状态为 `error`
- **WHEN** 生成报告
- **THEN** 第一题返回字符数为 7（`ab\n中文` 共 5 个码点，`c\n` 共 2 个码点），第二题为 unknown，中位数为 7，参与题数为 1

#### Scenario: invalid 轮次删除快照后重算仍为 invalid
- **GIVEN** 一个状态为 `invalid` 的已冻结轮次，并已删除其快照
- **WHEN** 执行离线重算
- **THEN** 重算结果的状态仍为 `invalid`，差异路径与原报告相同，不给出任何命中率

#### Scenario: 干扰卡计数可离线重算
- **GIVEN** 两个轮次的返回 slug 序列完全相同，但其中一轮把首位 slug 登记为干扰卡
- **WHEN** 删除快照后分别离线重算
- **THEN** 两轮的误选率相同，「首位为干扰卡」的计数分别为 1 和 0，与原报告一致

#### Scenario: 冻结观测被篡改则拒绝重算
- **GIVEN** 冻结观测文件的内容与记录的哈希不一致
- **WHEN** 执行离线重算
- **THEN** 命令以非零退出，没有生成新的汇总

#### Scenario: 未知协议版本拒绝重算
- **GIVEN** 冻结观测的协议版本为 `retrieval-v999`
- **WHEN** 执行离线重算
- **THEN** 命令以非零退出，输出含该版本号

### Requirement: 指标定义

截断值 K 为 10。每题的名次取返回列表前 K 项中第一个属于 `targets` 的位置，未出现记为 0。汇总的分母为被选题数，按 `type` 与整体分别给出。

- 首位、前三、前十命中率：名次分别在 1、1 到 3、1 到 10 之内的题所占比例；
- MRR：各题名次倒数的平均，名次为 0 记 0；
- 空结果率：返回为空的题所占比例；
- 误选率：返回非空且首位不属于 `targets` 的题所占比例；
- 子计数「首位为干扰卡」：误选的题中，首位是干扰卡的题数。

题数少于 30 时，汇总行 SHALL 标注「样本不足，只看趋势」。

#### Scenario: 已知返回列表得到预期指标
- **GIVEN** 4 道单目标题：
  - 返回 `[A, …]`，目标 A；
  - 返回 `[X, B]`，目标 B；
  - 返回 `[D, …]`，D 为干扰卡，目标不在列表内；
  - 返回 `[C]`，目标 C
- **WHEN** 运行评测
- **THEN** 首位命中率 0.5，前三命中率 0.75，前十命中率 0.75，MRR 0.625，空结果率 0，误选率 0.5，首位为干扰卡 1，汇总行带「样本不足」标注

#### Scenario: 多个可接受目标任一命中
- **GIVEN** 一题的 targets 为 `[E, F]`，返回 `[F, E]`
- **WHEN** 计算指标
- **THEN** 该题名次为 1，不计入误选；把 targets 改写为 `[F, E]` 后结果不变

#### Scenario: 空结果不计入误选
- **GIVEN** 一题返回空列表
- **WHEN** 计算指标
- **THEN** 该题名次为 0，计入空结果，不计入误选

### Requirement: 成本与指标同表报告

报告 SHALL 在同一张表中给出成本列：

- 每题端到端耗时的跨题 p50 与 p95，每题采样一次，每次都包含内核进程启动；不足 2 题时记 unknown；
- 按 `chars-v1` 计算的每题返回字符数的跨题中位数，只对非 unknown 的观测计算，并披露参与的题数。这是返回文本预算的代理，MUST NOT 称为 Host 实际注入的 token；
- 内核安装大小与快照大小；
- 是否使用了内核之外的排序逻辑（本版本恒为否）。

无法测得的项 SHALL 记 unknown，不记 0。成本列 MUST NOT 产生任何 pass、fail 或 warning 状态。

#### Scenario: 成本列存在且不影响状态
- **GIVEN** 一次 5 题的完整运行
- **WHEN** 生成报告
- **THEN** 报告含 p50、p95、字符数中位数、安装大小与快照大小列；报告状态为 `ok`，只取决于运行是否完整、清单是否一致

#### Scenario: 单题套件的分位数为 unknown
- **GIVEN** 一次只有 1 题的运行
- **WHEN** 生成报告
- **THEN** p50 与 p95 均为 unknown，报告状态不受影响

### Requirement: 固定自检的目标卡召回名次诊断

离线报告 SHALL 从轮次已冻结的工具返回全文中，为每个有记忆条件给出目标卡召回诊断。解析在一个按版本区分的包装层中完成，SHALL 先校验返回是合法 JSON，且 `current` 的 scope 与 home 和本条件的库一致：

- `memex_search`：取 `hits` 中 scope 与本条件库一致的项的 slug 序列；
- `memex_recall`：只在 `mode` 为检索模式时解析。该版本已知的空结果哨兵 `No cards found.` 还原为空列表；其余内容用插件的检索输出解析器提取 slug 序列。返回为索引或列表时，不解释为排名。

本要求的完整约束列于首个场景末尾，对本要求的全部适用情形均有效。

#### Scenario: 目标卡在第二位被记录
- **GIVEN** 某题有记忆条件的一次 `memex_search` 返回中，目标卡在本库 hits 中排第 2，原判定为 pass
- **WHEN** 生成离线报告
- **THEN** 该题显示「已召回，最好名次 2」，各层与端到端判定和此前报告相同

**本要求的完整约束（适用于全部场景）：**

离线报告 SHALL 从轮次已冻结的工具返回全文中，为每个有记忆条件给出目标卡召回诊断。解析在一个按版本区分的包装层中完成，SHALL 先校验返回是合法 JSON，且 `current` 的 scope 与 home 和本条件的库一致：

- `memex_search`：取 `hits` 中 scope 与本条件库一致的项的 slug 序列；
- `memex_recall`：只在 `mode` 为检索模式时解析。该版本已知的空结果哨兵 `No cards found.` 还原为空列表；其余内容用插件的检索输出解析器提取 slug 序列。返回为索引或列表时，不解释为排名。

每题报告两项：目标卡是否出现在任一次检索结果中；出现时的最好名次。多次检索的聚合规则：任一次命中，记「已召回」并取最好名次；全部为已知结果但都没有目标卡，记「未召回」；没有命中且至少有一次无法解析，记 unknown。

目标卡与题的对应关系 SHALL 按协议版本 `selftest-v1` 固定在报告层，MUST NOT 修改随包夹具或其哈希清单。无记忆条件记 N/A。该诊断 MUST NOT 改变任何层或端到端判定，MUST NOT 改写已冻结的程序证据。

#### Scenario: 空 recall 记为未召回
- **GIVEN** 某题的有记忆条件只有一次带 query 的 `memex_recall`，返回 `{current: {scope, home}, mode: "search", content: "No cards found."}`，其中 `current` 与本条件的库一致
- **WHEN** 生成离线报告
- **THEN** 该题显示「未召回」，不是 unknown

#### Scenario: 空 recall 的 current 不符时为 unknown
- **GIVEN** 同上，但返回中缺少 `current`，或 `current.home` 指向另一个库
- **WHEN** 生成离线报告，且这是该题唯一的一次检索
- **THEN** 该题显示 unknown

#### Scenario: 其他库的同名卡不算召回
- **GIVEN** 一次 `memex_search` 的 hits 含目标 slug，但其 scope 不是本条件的库
- **WHEN** 生成离线报告
- **THEN** 该项不计入名次

#### Scenario: 索引正文中的标题与坏格式
- **GIVEN** 分别构造：一次无 query 的 `memex_recall` 返回索引正文，其中有一行 `## retry-limit`；一次 `memex_search` 返回无法解析的 JSON
- **WHEN** 生成离线报告，且这是该题唯一的检索
- **THEN** 两种情况都显示 unknown

#### Scenario: 旧轮次仅凭冻结产物补算
- **GIVEN** 一个本 change 之前冻结的 `selftest-v1` 轮次，Host 原日志已不可用
- **WHEN** 用新的报告命令生成报告
- **THEN** 报告含名次诊断；冻结的程序证据文件与夹具哈希清单都未变化

#### Scenario: 无记忆与证据缺失分别标注
- **GIVEN** 一个无记忆条件，以及一个冻结工具返回被删除的有记忆条件
- **WHEN** 生成离线报告
- **THEN** 前者显示 N/A，后者显示 unknown，两者的原判定都不变
