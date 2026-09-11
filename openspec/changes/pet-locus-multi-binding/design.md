# Pet 飞书关联模型 v2 — 系统架构设计

## 文档定位与阅读地图

本文描述本期完成后的**完整目标模型**，不是相对上一版的补丁清单。
“v2”指关联模型的第二版，不是 npm 版本，也不是存储域版本号。
尚未实现；当前行为仍以 `openspec/specs/` 与已部署代码为准。

| 阅读问题 | 本文入口 |
|---|---|
| 这个系统为什么这样组织？ | 核心理念与架构约束 |
| 系统边界在哪里，谁负责什么？ | 系统上下文、组件分层 |
| locus、binding、Task、session 到底有什么区别？ | 领域模型与关系 |
| 从绑定到处理消息再到退出如何工作？ | 端到端流程、生命周期 |
| 上下文与权限分别如何得到？ | 上下文架构、信任与权限边界 |
| 重启、并发、部分失败怎么办？ | 一致性与故障恢复 |
| 具体为什么拆表、为什么保留两套队列？ | Decisions |
| 如何从当前版本过渡？哪些还不能直接开工？ | Migration Plan、架构评审门槛 |

`proposal.md` 是入口摘要；本文是整体设计；delta specs 是可验收的行为契约；
`tasks.md` 是交付分解。图中的组件是职责边界，不要求一图框对应一个新 package。

## Context

### 现状与演进范围

Pet 是运行在 DSH 内的 Host + Web 插件，不是独立 Agent 宿主。现有系统有三种执行形态：

| 入口 | 执行会话 | 上下文来源 | 调度 |
|---|---|---|---|
| 普通 Pet 轮盘能力 | 专用 Pet workspace 中的 root executor | 每次调用的 Invocation + source snapshot | Pet Invocation 串行队列 |
| 飞书普通工作消息 | 路由目标 workspace 中的 root executor | 触发消息与 workspace 自身上下文；不要求存在源 session | Pet Invocation 串行队列 |
| Q&A / 绑定既有群 | 源 session 的 continuable fork child | fork 时保留的已完成上下文前缀 + child 后续历史 | DSH child inbox |

本期重设计飞书入口与执行会话之间的关系。第一行保留，第二、三行统一寻址与管理，
**不把三种执行形态强行改成一种**。目前 `chat_bindings` 同时承载 workspace 路由和
QA 绑定，`qa:<sourceSessionId>` 限制源会话只能服务一个群；v2 移除这两个结构性限制。

依据：当前 `pet-qa-group`、`pet-lark-channel`、`dsh-pet` specs；`dsh.yaml` 的
Pet 部署说明；`docs/notes/dsh-plugin-integration-pitfalls.md`。后者明确提醒：
**记录了字段、API 调用成功、类型通过，都不等于运行时能力已经生效。**

### 证据分级，而非“全部 spike 已通过”

| 接缝 | 已知证据 | 尚未证明 |
|---|---|---|
| fork cwd | 已检查的 in-process fork 接缝没有 cwd override | 不能据此证明所有宿主扩展路径都不可行 |
| sandbox roots | 契约表明 workspace-write 以 session cwd 及临时目录为可写范围 | 尚未完成隔离的实际文件写入矩阵测试 |
| 飞书话题 | 真正的话题群中，bot 读消息得到同话题稳定、不同话题不同的 thread ID；Pet 收到了对应消息 | 独立 consumer 未抓到原始事件，不等于已证明入站 thread_id 完整透传 |
| scoped context | 现有工具与 Skill provider 可独立注册 | 首轮 fork、持久化前创建事件、冷恢复的真实时序未验证 |
| fork 上下文 | 继承保留的已完成前缀，不持续同步 | 不保证目录事实一定存在，也不保证包含父的最新未完成工作 |
| child-parent 通信 | 原生相邻消息能力可用于补问父会话 | 接受不等于回答；无持久父信箱；宿主自动结算通知能否禁用须验证 |

历史 spike note 有过度结论，不能以其中“通过”字样替代上表边界。

## Goals / Non-Goals

**Goals**
- 用同一个入口模型覆盖开发群、Meego issue 群、群级 agent 与独立话题 agent。
- 放开源 session 的 fan-out，同时保留每个活跃入口的唯一执行归属。
- 将寻址、关联、执行、授权、上下文分开建模，但提供统一管理视图。
- 新绑定默认 read；allowlist 显式调整绑定档位，不以提问者身份逐条切换权限。
- 一次性描述目标体系，保留普通 Pet 能力、workspace fallback 和 QA 各自正确的机制。

**Non-Goals**
- 不实现新的 DSH session 引擎、全局消息总线或子代理树调度器。
- 不让 child 成为新的绑定源，不创建孙辈绑定。
- 不替换 ws/sw，不因绑定启动新的 worktree；child 共享父当前工作现场。
- 不自动汇总兄弟 child 的结论，不新增 Pet 自动向父报告的业务链路。
- 不把 read/write 宣称为飞书 API、凭据、网络和全部外部副作用的统一权限体系。

## 核心理念与架构约束

### 1. 把工作上下文分发到协作现场，而不是把所有现场塞进一个 Agent

源 session 是开发工作的上下文来源。每个协作入口 fork 独立 child，各自持续积累问题、
判断和进展。源会话与飞书 chat 从产品视角形成多对多，但不是“多人共用一个 child”的
任意多对多：**通过 locus 拆开后，每段活跃绑定仍具有唯一执行归属。**

### 2. 统一入口，不统一执行机器

群本体与话题使用同一个 locus 抽象。至于 agent 是从源会话 fork，还是在 workspace
从零建立，属于执行形态。统一的是寻址、管理、投递关联与观测，不是队列实现和历史来源。

### 3. 地址、关系、工作实例分离

locus 回答“消息来自哪里”；binding 回答“目前由谁服务”；Task 回答“这一段工作是否
仍有效”；session 保存执行历史。解绑结束的是关系与工作实例，不是删除飞书入口或历史。

### 4. 控制动作由 Host 裁定，工作请求由 Agent 处理

绑定、解绑、授权、占用判定是确定性控制面，不能委派给模型。提问、调查与工作执行
属于数据面。能提问不等于能改变授权；模型输出不构成权限变更的依据。

### 5. 上下文继承不是实时同步，目录锚定不是沙箱授权

child 继承一个时点的上下文，必要时可以问父。父当前执行根经任务书与确认建立锚点，
由 caller-bound context 按需读取。知道一个目录、目录存在、获准写入，是三个不同事实。

### 6. 故障不能扩大服务对象或伪造成功

失效 binding 不等于“没绑定”，不能静默换成另一个 agent；无法定位话题不能冒称安全
回退；入队不等于完成；数据库写了 read 不等于宿主已变只读。

## Architecture Overview

### A1. 系统上下文与部署边界

```text
飞书成员                  所有者（Web / 飞书 allowlist）
  | @bot 提问                  | Q&A / bind / scope / archive
  v                            v
+------------------- DSH Host 进程 ---------------------------+
| Pet Channel 接入          Pet 控制面                         |
|   | 规范化事件               | 关联与授权操作                |
|   +------------+-------------+                              |
|                v                                            |
|       Locus / Binding / Task 领域服务                       |
|                |                  |                          |
|       持久化与管理投影       执行适配层                      |
|       Pet SQLite                 |                          |
|                         DSH session / agent / sandbox       |
+----------------------------------+--------------------------+
                                   |
                     +-------------+-------------+
                     v                           v
               fork child                 workspace executor
                     |                           |
                     +------ 工作结果 / 结算 -----+
                                   |
                  Agent 文字回复 + Pet 表情反馈
                                   v
                                  飞书
```

- **飞书**拥有 chat、话题、成员与消息；Pet 不重新建立成员体系。
- **lark-cli**拥有 bot 凭据与平台 API 接入；Pet 使用专属 `dsh-pet` profile，不存 token。
- **Pet Host**拥有路由、关联、Task、授权意图、投递记录及状态投影。
- **DSH**拥有 session 历史、运行中的 Agent、fork/inbox、恢复与实际 sandbox enforcement。
- **Web**是控制与观测客户端，不是绑定状态真相源；关闭页面不结束服务。
- **workspace / 文件系统**是实际工作现场，不因多建一个 locus 自动复制或隔离。

### A2. 领域模型与关系

| 对象 | 回答的问题 | 身份 / 生命周期 | 不负责什么 |
|---|---|---|---|
| Chat / Thread | 飞书里的哪个容器 / 话题？ | 外部平台 ID | 不决定 DSH 执行者 |
| Locus | 哪个独立消息入口？ | `(chatId, threadId?)`；解绑后身份不变 | 不是 Agent，也不意味着已绑定 |
| ChatRoute | 未显式绑定时，在哪个 workspace 工作？ | chat 级配置 | 不覆盖 QA 绑定、不保存 child 历史 |
| AgentBinding | 这个入口当前交给谁？ | 一段关联，有来源、状态、执行引用 | 不等于所有历史 Task |
| Task | 这一段持续工作是否仍在服务？ | Task ID；归档结束这一代 | 单次回答完成不结束 Task |
| DSH Session / Agent | 历史在哪里，谁实际跑模型？ | session 持久，Agent 可卸载重建 | 运行实例消失不代表绑定已解除 |
| SourceSession | child 从哪里取得初始工作上下文？ | 仅 fork 形态必需 | workspace executor 不伪造来源 |
| Invocation | root executor 的这一次请求是什么？ | 每次请求；Task 内串行 | QA inbox 不因此新增 Invocation |
| Delivery | 哪条飞书消息对应哪次执行？ | 消息 ID + 执行关联 | 不把所有 child 结算都当飞书请求 |
| Permission / Context | 这一代绑定被授权什么、锚定何处？ | 随绑定代际管理 | 不是 locus 地址的一部分 |

```text
SourceSession S1 --fork--> child C1 <-- Task T1 <-- binding B1 -- locus(开发群)
                 --fork--> child C2 <-- Task T2 <-- binding B2 -- locus(issue群)
                 --fork--> child C3 <-- Task T3 <-- binding B3 -- locus(大群, A)
SourceSession S2 --fork--> child C4 <-- Task T4 <-- binding B4 -- locus(大群, B)

ChatRoute(大群) --> Workspace W
                      |
            locus(大群, C) 未显式绑定
                      |
                Task T5 --> root executor E5 --> Invocation I1, I2, ...
```

**基数必须带上活跃与代际限定：**
- 一个 chat 可以容纳群本体和多个话题 locus；无消息不必提前建行。
- 一个 source session 可以服务多个 locus；不同 source 可以进入同一个 chat 的不同话题。
- 一个 locus 在同一时刻至多一个活跃服务归属；活跃 QA binding、Task 与 child 一一对应。
- 一个 locus 在历史上可以有多代 binding/Task/child；不能把“活跃 1:1”写成“永久 1:1”。
- read/write 属于当前绑定的授权状态，不属于永久地址；重绑不能继承上一代 write。

### A3. 组件分层与职责

| 层 / 组件 | 输入 → 输出 | 拥有的职责 | 对应现有代码区域 |
|---|---|---|---|
| Channel Adapter | CLI event → 规范化消息 | bot 身份、接入状态、消息类型、原始标识 | `host/channel/*` |
| Admission & Command | 消息 → 丢弃 / 控制命令 / 工作请求 | mention、去重、水位、sender 准入、命令鉴权 | pipeline、`qa/command.ts` |
| Locus Resolver | 平台事实 → 入口身份 / 无法确定 | 保留 thread 语义，不由模型猜地址 | event / route / wire |
| Binding Controller | GUI / 命令 → 关联变更 | 占用、fork、初始化、归档、失效与补偿 | `qa/action.ts`、`bind.ts`、`occupancy.ts` |
| Router & Task Resolver | locus → 执行目标 | 精确绑定优先；无绑定时 workspace fallback | route、repository |
| Execution Adapters | 已确认目标 + 请求 → 执行接受 | QA inbox 与 root Invocation 分流、恢复 | `qa/delivery.ts`、subagents、dispatcher |
| Context & Permission | caller / 授权命令 → 上下文 / 生效策略 | caller 绑定、锚点、策略核验与授权审计 | context-tool、capture、scope integration |
| Settlement & Feedback | 执行结算 → 原消息状态 | delivery 关联、重复结算去重、表情 fail-soft | delivery / invocation channel |
| Repository & Projection | 状态变更 → 持久记录 / UI | 一致性、历史、诊断、管理查询 | spec、repository、routes、client |

依赖方向是入口 → 领域服务 → 执行/存储适配器。Web 和模型不能绕过 Controller
直接修改路由、授权或 executor 引用。Host 不读取 child 回复文本来猜绑定是否成功。

### A4. 控制面与数据面

```text
控制面                                  数据面
Q&A / -b / -s / /unbind / archive        @bot 工作请求
          |                                  |
     身份与前置校验                       事件防线与准入
          |                                  |
     关联 / 授权操作                    locus -> 路由 -> Task
          |                                  |
     提交状态、反馈结果                  执行队列 -> 结算 -> 反馈
          +---------- 共享领域真相 -----------+
```

命令类消息始终需要全局 allowlist；不能借群级提问豁免获得控制权。
GUI Q&A 是 create-or-open，不是每次 fan-out；群内 `-b` 是把当前入口接到指定源会话。
每条命令只操作当前入口，不接受任意外部 locus 作为目标。

### A5. 端到端流程

#### 流程一：建立关联与上下文初始化

```text
用户 -> Controller : Q&A 或当前 locus 的 -b <source-prefix>
Controller -> Repository : 验证源会话、检查占用；Q&A 先检查复用
Controller -> DSH : fork continuable child（初始化任务书，默认 read 目标）
Controller -> Lark : 仅 GUI 新建路径创建群，发起者为群主
Controller -> Repository : 关联 Task / binding / child，进入可跟踪的初始化状态
child -> parent : 必要时通过原生相邻消息问当前工作目录和约束
parent -> child : 当前工作现场（或报告无法确认）
Context 服务 : 记录经确认的锚点；检查 scoped context 与实际只读策略
Controller -> 用户 : 准备完成才报告可服务；失败报告原因与残留资源
```

初始化是内部工作，不是群成员的一次提问，不能消耗待反馈的 Delivery。
目录不要求在 fork 前已知；历史可提供线索，但父确认当前现场才解决历史陈旧问题。
父无法回答或回报不确定时保留未就绪状态，给出所有者确认路径，不让模型自行放宽权限。
外部建群和 DSH fork 不属于 SQLite 事务，失败用补偿处理，不声称跨系统原子提交。

#### 流程二：一条普通飞书消息的路由与执行

```text
入站消息
  |
事件防线 + 命令识别 + 对应准入
  |
确定 locus（无法确定时进入诊断，不把话题冒充群本体）
  |
精确绑定查找
  +-- 有效 fork binding --> 恢复 parent / child --> QA inbox --> child turn
  +-- 有效 workspace 服务归属 ------------------> Invocation queue
  +-- 已失效 / 未就绪 binding --> 停止、按状态反馈；不静默 fallback
  +-- 无显式 binding --> chat route --> default workspace
                                            |
                                    获取/创建 locus Task
                                            |
                                    workspace executor
                                            |
                                      Invocation queue
```

未绑定话题走 **chat 的 workspace fallback**，不进入群本体 QA child。
不同 locus 即使落在同一 workspace，也不共享 executor。workspace 服务归属可以复用，
但自动产生的 executor 指针不能被误判为一个不可被 `-b` 接管的显式 QA 绑定。

QA child 自行向触发话题/群回复；Host 维护表情而不重复代发正文。
root executor 保留 Invocation 的 waiting-user 与串行调度语义。

#### 流程三：调整权限

```text
allowlist -s read|write
  -> 定位当前活跃绑定
  -> 串行化控制变更、阻止新投递跨越未完成的策略切换
  -> 应用宿主策略并核验实际效果
  -> 持久化生效状态 + 操作者 + 时间
  -> 当前 locus 回执；pet_context 返回最新状态
```

这是目标协议，不意味着 `setSandboxMode()` 返回就证明执行后端已切换。
策略和数据库不能同事务时，需要可恢复的“变更中 / 已生效 / 失败”记录；不提前报告成功。
降权不会撤销已经发生的写入；运行中的 shell/turn 如何停顿、排空或拒绝切换必须实测。

#### 流程四：结算、直接私聊与重绑

Delivery 记录入口、消息、Task/绑定代际、执行 session 与调度关联。只处理能证明对应
飞书请求的结算。GUI 私聊、初始化、父子信息补问没有 Delivery，不产生飞书出站。
重绑时旧 child 的晚到结算仍属于旧请求，不能关联到新 child 或新一代消息。

### A6. 生命周期：分清三个状态机

**关联生命周期（下列状态是语义状态，不强制新增同名数据库枚举）：**

```text
unbound -> provisioning -> active -> invalidated -> archived
               |              |                         |
               +-> failed     +------ archive ----------+
                                                        |
                                              rebind -> 新一代 provisioning
```

- 归档 Task 是释放机制；删除某个投影行不是第二种退出方式。
- invalidated 表示不再服务，不意味着可以忽略它并切换身份回答；重绑先归档旧 Task。
- 继承现有退出约束：`/unbind` 只针对既有群 bind 来源，GUI 创建的群从面板归档；忙时不强杀。
- 历史保留在 Task/session；位点当前指针可更新，旧绑定代际的必要关联不能丢。

**权限状态：** active/read <-> active/write。它与 active/invalidated 正交，不把两组状态
揉成一个庞大枚举。新一代从 read 开始；失效后 GUI 可读历史不自动等于继续授予写能力。

**执行状态：** queued -> running -> settled，root 路径可进入 waiting-user。
一次 settled 不结束 binding；Agent 被卸载也不结束 Task。

### A7. 上下文架构与协作模型

```text
                  pet_context()（不接受目标 ID）
                              |
                       实际 caller session
                              |
                         唯一 Pet Task
                 +------------+-------------+
                 |                          |
             root executor               fork child
       当前 Invocation + Snapshot      当前 binding/locus context
       （既有数据源，保留）            （源会话、锚点、权限、状态）
```

上下文分三层：
1. **继承层**：fork 时保留的源会话前缀，一次性；不是源会话的实时镜像。
2. **锚点层**：当前工作根、约束、来源与确认状态；持久化以跨重启/压缩可取。
3. **请求层**：触发消息、发送者、话题、Delivery 引用；每次请求变化。

seed 说明职责与初始化协议，后续消息只携带必要请求事实与查询提示，不重复整段目录
说明。动态权限不能仅依赖 seed 中的旧文本。tool 只返回绑定事实，不替模型发明授权。

child 可按需问直接 parent，不通过另一个 child 转发，不自动同步兄弟历史。
用户可主动让 parent 查看 child；Pet 不新增自动总结链路。DSH 自带结算通知是另一条
宿主机制，能否满足“完全不自动回报”必须单独核验，不能只靠 prompt 承诺。

自然语言锚定只改 QA 的上下文获取路径；普通 Invocation snapshot 仍可能使用既有
worktree adapter，不能为 QA 解耦就全局删除共享模块。

### A8. 信任与权限边界

| 边界 | 裁定者 | 能保证 / 目标 | 不能据此宣称 |
|---|---|---|---|
| 消息身份与命令准入 | Host + 平台 sender ID | 只有 allowlist 能绑定/授权/解绑 | 任意群成员都可信 |
| 群级提问豁免 | Host | 有有效 QA 绑定的 chat 内成员可提问 | 豁免只影响某个话题；或成员可授权 |
| locus 路由 | Host + 持久状态 | 精确命中对应执行归属 | 一个群的所有话题都归群级 child |
| 默认 read | 宿主实际 enforcement | 新绑定不获得文件写入许可 | Pet 不写 mode 字段就必然只读 |
| write | 显式 allowlist 授权 + 宿主适配 | 对本绑定开放已说明的文件能力 | workspace-write 能写 cwd 之外的 sw 兄弟目录 |
| 执行根锚点 | 父/所有者确认 + context | 模型知道应在哪工作 | 路径存在就等于被授权；prompt 等于沙箱 |
| pet_context | caller-bound scoped tool | 不接受模型指定其它 Task/locus | 工具可读上下文就可阻止所有内容外泄 |
| 飞书外部操作 | bot scopes / 工具策略 | 由相应平台与工具控制 | 文件 read-only 禁止所有 API 副作用 |

授权是**位点共享档位**：allowlist 把一个位点提为 write 后，该 child 处理的后续群请求
使用同一档位，并非只有授权者本人的请求能写。群级豁免还会使未绑定话题进入 workspace
fallback；其 executor 的默认策略必须纳入验证，不能成为只读设计的旁路。

多个 child 共享父的同一工作目录，**会话隔离不等于文件隔离**。允许多个 write 位点时
存在并发修改冲突；本期不暗中引入新 worktree 或全局文件锁，管理面应明确展示共享根。

### A9. 持久化、一致性与故障恢复

持久真相分工：Pet SQLite 保存关联/路由/Task/Delivery/授权意图；DSH 保存 session
历史与生效策略；飞书保存消息与成员。UI 缓存、运行中 Agent 和模型推断均非真相源。

| 并发 / 故障 | 处理责任与目标 |
|---|---|
| 同 locus 两次 bind 并发 | Controller 串行化 + 仓储提交时复查；只发布一个服务归属，回收失败方 child |
| 同源多个不同 locus bind | 允许独立进行；不能恢复源 session 的全局占用锁 |
| GUI 重复点击 Q&A | source 维度 create-or-open 幂等；跨群 bind 不因它受阻 |
| fallback 已有活跃 Task 时 bind | 先核验忙闲并结束旧服务代际，再发布 QA；不能直接制造两个活跃 Task |
| 入队后进程崩溃 | 持久 Delivery 与宿主执行事实核对；结果不明时诊断，不盲目重放有副作用的工作 |
| 初始化 / 私聊结算混入 | 只匹配有明确投递关联的 turn，不按 child 最老消息盲猜 |
| 原绑定失效 | 停止投递，有限次提示；不冒充无绑定走 fallback |
| 权限切换部分成功 | 对账实际策略与授权记录；恢复一致前暂停新派发，不向用户报成功 |
| 空闲 Agent 被卸载 / Host 重启 | 从 session 恢复后重装对应 scoped context，核验策略与绑定代际后才派发 |
| 表情接口失败 | fail-soft；执行结果不被改成失败，也不重复业务执行 |

目标是明确的幂等与可恢复关联，而非未经证明的端到端 exactly-once。仅将查询从 chat
改成 child，不能解决初始化/GUI turn 与飞书 turn 混杂的结算问题。

### A10. 管理面与可观测性

管理面支持两个互补视角：
- **按源会话**：默认 Q&A 入口、其余群/话题、child、当前状态、共享工作根、权限与变更人。
- **按 chat**：独立 workspace fallback、群本体绑定、每个话题绑定；能看到未绑定话题的去向。

诊断链包含消息 ID → locus → binding/Task 代际 → session → execution/Delivery；不落
整段 raw history，不泄露凭据。群内回执使用短标识，不公开其它群或完整 session ID。
人数是 best-effort；多个话题属于同一群时不能简单相加冒称去重人数，未知要标未知。

### A11. 场景贯穿：一个开发 session，多个 issue，一个共享大群

1. 在开发 session S1 点 Q&A，创建默认答疑群与 child C1；再次点击打开已有入口。
2. Meego issue 群用 `-b S1`，创建 C2，不复用 C1，也不以 C1 为源继续 fork。
3. 大群话题 A 绑定 S1，话题 B 绑定另一开发 session S2，分别形成 C3、C4。
4. 大群的未绑定话题 C 走 workspace fallback，新建/复用 E5，不交给 C3、C4 或群级 child。
5. allowlist 只给 issue 位点 `-s write`，其它 QA 位点仍 read；该档位服务该 issue 全体提问者。
6. issue 结束归档其 Task；C2 历史保留，S1 及其它位点不受影响。
7. 下次重新绑定 issue 群形成新一代 child，回到 read，不继续使用旧授权。

## Decisions

### D1 统一 locus 地址，区分缺失与不确定

逻辑键为 `(chatId, threadId?)`，具体序列化可采用已约定的 `chatId` 或
`chatId + '\u0000' + threadId`。空 thread 不产生第三种身份。
不把 thread 单列成另一套绑定模型，也不把 root_id 无证据地当 thread_id。
**确认是群本体**才用 chat 键；话题身份因解析丢失而不确定不是正常群本体。
消息缺字段的处理仍需先闭合入站契约，不能称“缺失回退不会错投”。

### D2 chat_routes 与 agent_bindings 分离

`chat_routes[chatId]` 保存 workspace fallback；`agent_bindings[locusKey]` 保存当前
服务关联与执行形态。activeTaskId 是引用，不替代 Task 的归档状态。
拆表消除 `qaPriorWorkspaceId` 的临时备份/还原，不删除原有退出行为的验收场景。
workspace 自动服务归属和显式 QA binding 必须可区分，避免自动路由抢占 `-b`。
不采用“所有记录都按 thread 复制”的单表，因为 chat 级路由不应随话题重复。

### D3 活跃唯一性按 locus，历史按 Task 代际

scope 从 `qa:<sourceSessionId>` 转为位点 scope，普通非 channel session Task 保持独立。
`findActiveTaskByScope` 的查询断言用于诊断，不是并发写入的原子唯一约束；提交时要有
串行化/事务保证。Delivery 携带代际引用，旧结算不允许串到新绑定。

### D4 read/write 是产品档位，不预先等同于某个宿主枚举

产品要求已明确：新建 read，allowlist 显式提降权。适配器必须核验宿主生效策略，不能
依赖部署默认或 fork 不继承 write 的未经验证假设。
`workspace-write` 仍限制可写根，不是“解除全部硬边界”；sw 兄弟目录可能仍写不进。
若需要更广模式或宿主 root 扩展，属于待评审的安全决策，不在本文中暗中选择
`danger-full-access`。read 也仅覆盖实际实施策略的文件能力，不等于外部系统只读。

### D5 初始化任务书 + 按需问父 + caller-bound 锚点

child 可以在创建后问父当前工作目录，不要求历史中必有 `SW_WORKTREE=`。
父确认的目录可以是普通目录、ws 或 sw；不把“必须是 git worktree”作为通用校验。
校验结构与存在性不能证明来源授权，二者分开记录。锚定后按需获取，不每轮重复完整段落。
只解耦 QA 的发现路径，保留其它 snapshot 路径仍在使用的 adapter。

### D6 一个 pet_context 工具，两种数据源

共同部分是 caller 绑定与 fail-closed 查找，不是把数据结构强压成一个 Snapshot。
root 维持 Invocation + Snapshot；fork-child 返回 binding context。两者可用判别字段区分。
不向普通 session 全局发布工具，不接受模型传入任意 target ID。

### D7 组合按组件，生命周期按真实装配核验

fork-child 不覆盖父 preset/Skill，只增加 caller-bound context；root executor 按既有
形态安装自己的组合。创建、Pet resume、原生 DSH 加载都需覆盖。
第一轮可能早于 Task 写入，不能只依赖一次 `agent/created` 查询；发布绑定前核验就绪。
若宿主暂不能满足，停在集成门槛，不把“两个 register 分开”当作全链路验证完成。

### D8 GUI create-or-open 与 fan-out 分离

保留首次创建、以后打开，不因多个子会话变成每次建群。GUI 指定入口与所有绑定列表
是不同查询；本稿早先的“最近使用任意 locus”只是候选 UX，不等于用户已经确认。
`lastUsedAt` 可用于列表排序，不应悄悄让另一个 issue 群替代默认答疑群。
多绑定迁移时默认入口选择需在实施前确认并同步 delta。

### D9 绑定与授权是正交控制动作

`-b/--bind` 建关联，`-s/--scope read|write` 改当前档位；既有 `/bind`、`/unbind`
兼容性需要保留并在 delta 明述。控制动作确定性执行，不投递给 child 作裁决。
权限审计保存操作者，不把 sandbox 事件里的 delegation 来源误当作授权者。

## Risks / Trade-offs

- **上下文扩散** → 每个 child 持有源上下文；read 不能阻止内容披露，群级信任需要明确展示。
- **共享目录并发写冲突** → 展示共享根与 write 位点，不宣称兄弟会话隔离等于文件隔离。
- **源会话依赖与成本** → 冷恢复和按需问父会增加延迟；父不可用时显式失败，不改用另一来源。
- **旧稿推断成为实现前提** → 将证据分级与实测门槛作为开工条件，校验器通过不代表设计闭合。
- **跨系统部分提交** → binding 发布前核验、失败补偿、残留明示；没有跨 Lark/DSH/SQLite 事务。
- **数据与运行策略漂移** → 启动和变更时对账；未确认的 read 不显示为已强制只读。

## Migration Plan

存储域预期 v5 → v6，与本文模型 v2 区分。升级前停入站、处理在途工作并备份一致的数据库；
备份应覆盖 SQLite journal/WAL 的实际状态，不能在写入中仅复制一个文件名。

1. 在 storage domain 校验打开前执行版本感知迁移，按既有迁移入口完成事务与版本更新。
2. workspace 路由迁入 chat_routes；既有 QA 迁为无 thread 的群本体绑定；暂存的 prior
   workspace 恢复成独立 route。保留原有 child、Task、来源、失效原因与可用执行根事实。
3. 同事务换算 QA scope、workspace channel scope、executor/Task 引用与存量 Delivery
   的关联，不只迁 QA 行；普通 Pet Invocation scope 不变。
4. 冲突记录先诊断，不凭行顺序选一个删除。重跑迁移保持幂等。
5. 存量权限意图收紧为 read 后，还要在恢复执行前核验宿主实际 read；不靠无事件默认。
6. 核验 Task 唯一性、group/topic 寻址、冷恢复工具面、读写策略和端到端反馈后才恢复消费。
7. 回滚需要停消费并恢复匹配旧二进制的备份；升级后新增多位点数据不做有损自动降维。

## 架构评审门槛与待闭合事项

下面是**实施前门槛，不是可延后的 Open Questions**。架构总览可以完整，但不能因此
假称下面的宿主适配与行为选择已完成。早先 delta/task 中相反措辞须在相应门槛闭合时同步。

| ID | 需要闭合的问题 | 证据 / 决策产出 | 影响 |
|---|---|---|---|
| G1 | read 默认、fork 继承、恢复与 sw 写入的宿主映射 | 真实读写矩阵；确定 write 策略，不静默扩大权限 | D4、权限 delta、迁移 |
| G2 | 原始话题事件缺字段时如何判定入口 | 真实入站样本与解析测试；确定无法定位时策略 | D1、路由 delta |
| G3 | child 初始化、问父、context 安装与落库时序 | 首轮/冷恢复实测；确认锚点写回协议 | D5/D7、上下文 delta |
| G4 | 结算相关性与宿主自动父通知 | 初始化/GUI/飞书交错测试；宿主抑制通知可行性 | Delivery、无自动回报目标 |
| G5 | GUI 多绑定时复用哪个入口 | 确认保留指定默认 Q&A，还是用户选择其它策略 | D8；旧稿最近使用策略未获明确确认 |
| G6 | 共享授权与 fallback 的执行范围 | 明确 fallback 的 read 默认、是否可 -s，以及策略切换时在途工作行为 | 权限与准入全链路 |

其它兼容性核对：旧 delta 的“删除绑定行”与历史保留、“无字段直接落群”与失效不降级、
`dsh-pet` MODIFIED 的 requirement 标题与完整原文，均须在语义审查中核对。
这不是批准实施的替代品；本次仅补全架构描述及暴露已有缺口。

## Open Questions

可延后而不改变上述架构的细节：管理列表布局、状态文案、诊断字段的显示顺序。
人数读取失败显示未知；精确去重人数只有在具有相应证据时才展示，不影响路由设计。
