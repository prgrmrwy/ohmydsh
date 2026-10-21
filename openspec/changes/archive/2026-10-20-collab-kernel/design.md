## Context

动机见 proposal，本文说明实现方式。约束事实：

- **同机多 session 实测**（2026-10-12 至 10-16）验证过的协议：每个文件只有一个写入方、条款按 draft/ack/agreed 推进、DECISION-NEEDED 交给人、同一话题最多 3 轮。暴露的问题：监听要 agent 自己挂、STATUS 泛滥、单文件收件箱、计数游标、人的决定没有可验证来源。
- **官方 `dsh-experimental-agent-team` 0.2.0-rc.2** 可借鉴的做法：按 root 串行的 `transact`、append+flush 之后才报成功、`expectedRevision` CAS、消息入队即成功且不重发。不复用它：真源在 Lead 日志、只支持单进程、依赖 internal API。
- **飞书平台事实**（为后续 provider 记录）：open_id 按应用隔离；长连接是集群模式、不广播；一次点击由 `header.event_id` 标识。本期只用到"幂等键要带 provider 命名空间"这一条。
- **仓库约束**：`lib/` 不进版本控制；包要能独立构建和测试，以便将来 `git subtree split`。`packages/` 下的每个目录都受治理测试约束（`ohmydsh.docTier`、中英双语 README、`tests/repo-docs-governance.test.mjs` 中的等级表，以及 `tests/local-package-peers.test.mjs` 的 DSH 版本范围检查）。
- **DSH 0.2.0-rc.2 宿主事实**（2026-10-16 源码调研，供 `dsh-collab` 使用，内核只用来决定 SPI 语义）：
  - `agent.followup` 进入 next-turn 队列：对运行中的 agent，消息总是在当前 turn 结束后另开一个新 turn，不会并入当前 turn；对空闲 agent 会立即开 turn。
  - 冷恢复必须走 `sessionController.resolveAgent`，否则不挂 preset、没有工具。冷恢复会读完整份日志，**不可取消、耗时没有上界**。
  - 收到 SIGTERM/SIGINT 时，宿主会 await 插件 dispose，但总共只有 5 秒；第二次信号会立即退出；本仓库的 `dsh restart` 约 10 秒后发 SIGKILL。
  - `source.kind` 可以是自定义的 `plugin:<id>`，但模型仍把它当 user 消息，source 不发给模型，所以正文必须写明来源。
  - 没有单一的 presence API，需要组合 `agents.get(id)?.status`、`sessionQuery.listSessions()`、`archivedSessionIds`。
  - 这些事实对内核的影响只有一条：**投递不设超时**（见 D10）。

术语：**协作服务**（协作内核）指服务本体，**协作空间**指一次协作的实例，**协作约定**指附带的规则与用法。

### 评审历史与范围收缩

第 1 轮 REVISE（8C/5M/1S），第 2 轮 REVISE（7C/5M）。第 2 轮的阻断项大多出在几个可选机制的组合上：多个并存的决策请求 × 复议、扇出确认 × 熔断、redeliver × 回执、markRead × 纯读。按 anvil 规则，连续两轮 REVISE 后交给用户决定；用户选择**先收缩范围再修**。本版去掉了以下机制：

| 去掉 | 本期替代 | 后续由谁加回 |
|---|---|---|
| 复议 | `decided` 为终态，需要改就新建条目 | 单独 change |
| 每条目多个 open 决策请求 | 至多一个；新请求在同一提交里作废旧请求 | 不加回 |
| redeliver | 作废后重新发起请求 | 随飞书 provider |
| 一个成员多个绑定、跨 channel 身份合并 | 一个成员一个绑定，地址唯一 | 随飞书 provider |
| 服务端已读位置（markRead） | 调用方自己保存游标 | 不加回 |
| 两步转交 Leader、对外的 `recordDispatch`、定位符与 `describe`、可配置上限、字符串命令分发、request `blocked` 与多余条目类型 | 见 ponytail-review 精简（第 5 轮前） | 按需 |

## Goals / Non-Goals

**Goals:**

- 提供一个不依赖宿主的协作内核库，覆盖 spec 的全部规则，并用纯单元测试与故障注入测试验证。
- 支撑首个消费者 `dsh-collab` 的最小调用路径：创建、邀请、加入、条目协商、消息、决策请求与确认、唤醒、读取、投影。

**Non-Goals:**

- 上表中去掉的机制。
- 不承诺后续 provider 或宿主接入时完全不改内核。
- 外部事件摄入、事件订阅、refs、网络传输、鉴权令牌、独立服务进程、跨实例复制、自动接管锁、GUI。

## Decisions

### D1. 包结构与依赖边界

```
packages/collab-kernel/src/
  model/        类型、事件、错误码、ESCALATE_AFTER / BREAKER_LIMIT 常量（纯数据）
  domain/       decide(state, cmd, ctx) → events | error；reduce(state, events)（纯函数）
  auth/         principal 受信构造、反查、授权表
  service/      CollabService：串行事务、处理顺序、收据、调度执行
  spi/          ChannelProvider 接口与注册表
  store/        CollabStore 接口 + FileStore
  projection/   project(state, presence) → markdown（含转义）
  convention/   v1.md + 读取
```

运行时零依赖，只用 Node 内置模块；`package.json` 不声明任何 `@deepseek-ai/*` 依赖，也不声明 `dsh.bundle`。这是一个库，不是可部署的插件：`ohmydsh.docTier` 为 `C`，README 写明它由 `dsh-collab` 构建时内联、本身不单独部署，并给出移除条件；治理测试的等级表同步加入 `collab-kernel: 'C'`。`dsh-collab` 将以 devDependency 引用它，并用 tsdown 内联，部署产物不依赖本地包；`sync-build-inputs-dirs` 只是 `dsh-collab` 集成/部署前置，不阻塞内核的独立开发、构建或测试。消费者的构建须解析内核当前源码（而不是未重建的旧 `lib/`），并把内核 `src/` 目录、`package.json` 及实际使用的编译/打包配置列入构建输入；新增源码文件无需逐个登记。测试使用 vitest；投影安全测试用 `markdown-it` 或 `mdast-util-from-markdown`（devDependency）解析 AST。依赖边界扫描器仅放在 `test/support/`，既检查真实 `src/`，也检查违规夹具；不进入 `src/` 或包的公开 exports。若需要语法解析，使用已有开发依赖 TypeScript，不新增运行时扫描能力。

*备选：拆成多个包。* 否决。只有一个消费者，目录边界已经足够。

### D2. 事件溯源与状态转换表

`decide` 是纯函数，输入状态、命令和上下文（actor、presence 快照），输出事件列表或错误。`reduce` 负责重放。条目状态转换用一张显式表实现：`decide` 先查表，查不到的组合直接返回表中的错误。`decided` 是终态，表里没有任何离开 `decided` 的路径。这两点合起来，消除了第 1、2 轮所有"绕过锁"类问题的根源。

每个条目至多一个 open 决策请求：`requestDecision` 在同一批事件里先产出 `decision/superseded(old)`，再产出 `decision/requested(new)`。

### D3. 处理顺序：三个分支

命令按 spec 分成三个分支，每个分支内部的顺序是固定的：

- **普通成员命令**：principal 稳定校验 → 协作空间存在 → 按地址反查成员（只看身份，不看状态）→ cmdId 收据 → 协作空间未关闭 → 授权表前置条件 → 命令专属幂等键 → 业务校验。
- **createSpace**：principal 稳定校验 → 以创建者地址为 scope 查收据 → spaceId 尚不存在 → 认领首成员，且认领到的地址必须等于 principal 的地址 → 业务校验。
- **internal**（本期只有 `resetBreaker`）：principal 稳定校验 → 协作空间存在 → 以 purpose 为 scope 查收据 → 协作空间未关闭 → purpose 与命令匹配 → 业务校验。这个分支不做成员反查，actor 记为 `internal:<purpose>`。

上述流水线仅用于写命令。读取只做稳定身份、托管空间和读取授权检查；业务 closed 不阻止读取，internal 唯一合法 purpose `breaker-reset` 可读；不执行写收据、写 purpose 匹配或命令专属幂等键检查。分支中的成员、创建者地址及 purpose scope 均采用幂等 requirement 定义的带类型标签编码。

上一版只有一条流水线，"先反查成员"使 createSpace（调用方还不是成员）和 internal（没有地址）都无法执行（第 3 轮 R3-C1）。拆成三个分支后，每个分支只需校验它真正具备的身份。

收据查找排在所有可变条件之前，所以 `join` 之后的重放、协作空间关闭后的历史重放都会返回原结果。可变条件包括成员状态、Leader 和空间是否关闭。

`confirmDecision` 的前置条件要求反查到的成员**当前**仍是 active 的人类成员，然后才查 actionId（第 3 轮 R3-C2）。这样，已离开的决定人即使手里还有一条成功投递，也不能写入新的决定。actionId 命中时，追加一条只含收据的提交。


### D4. 原子提交：一行就是一次提交

提交分两种：**公开写命令提交**和**投递完成提交**（第 5 轮 R5-C1）。前者把一个命令的全部领域事件、收据、`dispatch/intended`、`breaker/reset` 写在同一行；后者只含一条 `dispatch/completed`，由调度器针对已持久化的 `deliveryId` 产生，没有 cmdId 和收据，因为它不来自外部调用，不需要幂等重放。两者共用同一 seq、校验、写入流程和串行队列。每一行都带 sha256，以 `\n` 结尾。写入时循环调用 `write`，直到整行字节全部写出（第 2 轮 N-C5 指出的短写问题）；然后 `fsync` 文件，首次创建文件时再 `fsync` 目录。全部完成后才应用到内存、返回成功。

加载规则只有两条：
- **末尾不以 `\n` 结尾的残片**：说明写入没有完成，截断它并 `fsync`；
- **任何以 `\n` 结尾的完整行**，只要解析失败或校验不符：报 `COLLAB_STORE_CORRUPT`，不动文件。

这样就区分开了"未提交的尾巴"和"已提交但损坏"。

写入、`fsync`、应用到内存这三步任一失败，协作空间都进入 `failed` 状态。恢复步骤是 `close` → `open`。如果失败的是公开写命令提交，就用同一个 `cmdId` 重试；如果失败的是投递完成提交，不重试，也不重新投递，以重新加载后的日志为准：有完整的 completed 记录就采用它，没有就保持结果未知（第 6 轮 R6-M1）。`close` 的过程：`close` 先停止接纳新命令、等待在途的存储操作结束，之后该实例对这个协作空间的任何提交都会被拒绝，最后核对实例 id 并删除锁（第 3 轮 R3-M2）。重试由收据给出确定答案。fsync 失败时整行可能已经落盘，这种情况下重试会命中收据，返回已提交的结果。

*备选：SQLite 事务。* 能直接得到原子性，但原生依赖会破坏零依赖和可拆仓的目标。单写入方加"一行即提交"已经足够。以后有需要时，可以作为另一个 `CollabStore` 实现。

### D5. 单写入方：排他锁；内核不判断存活，宿主负责证明

`open` 以 `wx` 方式创建 `<spaceId>.lock`，写入实例 id 与 pid。锁已存在时报 `COLLAB_STORE_LOCKED`，错误中带上锁的内容。内核自己从不判断原持有者是否还活着。`close` 先核对锁里的实例 id 与自己一致，才删除锁。`expectedLastSeq` 不符说明有人绕过了锁，此时进入 `failed`。

DSH 会频繁重启（`dsh build`、自动更新、崩溃），只要重启时没有走 `close`，就会留下残留锁（ponytail-review #1）。为此内核提供 `breakLock(spaceId, expectedInstanceId)`：只有锁中的实例 id 与传入值一致时才删除。**由宿主负责证明原持有者已不存在**。宿主调研表明：DSH 会 await 插件 dispose，但总预算只有 5 秒，并且要和中止运行中的 turn 共享；第二个信号会立刻退出，`dsh restart` 大约 10 秒后发 SIGKILL。所以**正常重启也可能留下残留锁**，不只是崩溃（第 7 轮 R7-M1）。任何恢复都必须先证明持有者已经不存在：未来宿主包装器须先核实单 Host 前提，并证明锁中的 pid 所属进程已不存在，才能调用 `breakLock`；pid 仍存在、权限不足或状态未知时一律保持 `COLLAB_STORE_LOCKED`。本期锁只包含实例 id 与 pid，不假设额外的 Host 启动标识，也不把实例 id 不同当作死亡证明。`dsh-collab` 的前置实验会验证：dispose 时是否真的调用了 `close`，以及预算耗尽或被强制退出时锁会怎样残留。把判断留给宿主，是因为只有宿主知道"同一时刻只有一个 Host"这个事实。

### D6. Principal 与授权

principal 只能用 `principals.agent / provider / internal(purpose)` 创建，带模块私有的 brand，内核会拒绝不带 brand 的对象。这不是安全边界，作用是让"把模型参数当身份"这种写法在类型和运行时两层都写不出来。认证由宿主负责，内核只负责授权和推导 actor。

授权表实现为声明式映射。命令以具名方法暴露，不提供字符串分发入口，传错命令名在编译期就会报错（ponytail-review #6）。不导出也不手工维护第二份 `COMMANDS` 清单。授权覆盖测试用已有 TypeScript 编译器 API 读取真实 `CollabService` 公开类型的可调用成员，排除本 spec 列出的四个纯读方法；若实现确有不承载业务写入的生命周期方法，只能逐个显式列明并核对，不能用名称前缀忽略。将余下的真实写方法集合与授权表键比较，并对每条命令测试允许和拒绝两侧。测试还在夹具中增加一个未登记的新公开方法，证明即使授权表未变，覆盖检查也失败；检查工具只在测试内，不生成产品 API 或分发框架。

### D7. 成员与地址

一个成员一个绑定，`{channel, address}` 在协作空间内全局唯一，并且永不复用（第 2 轮 N-C3）。`createSpace` 的首成员和 `invite` 走同一套 `claim` 认领流程；agent principal 创建的空间，首成员必须是 agent。

### D8. Leader

`transferLeader(target)` 由 Leader 一步完成，不需要对方确认（ponytail-review #2）。Leader 只管成员和关闭，没有业务决定权，接手的一方本来就是 active 成员，所以两步握手换来的保护几乎没有价值。自动接手和关闭空间都在触发它们的那一次提交里完成。Leader 不能对自己 `markGone`，要离开只能 `leave`。

### D9. 人类决策

`confirmDecision` 走普通成员命令分支：前置条件（active 的人类成员）→ actionId 幂等键 → 4 项业务校验。证据中的 `deliveryId` 必须同时满足：属于这个请求；投递对象就是确认人（第 3 轮 R3-M6）；记账时持久化的 providerId 与调用方一致；结果是 `succeeded` 且带有 `messageRef`。provider 收到人类回调的时间可能早于回执记账；这时内核返回 `COLLAB_DELIVERY_UNKNOWN`，provider 等回执记账后再重试即可。

*信任边界：* provider 有能力伪造证据。内核信任已注册的 provider，和信任宿主对 session 身份的担保是同一个道理。证据的价值在于审计、防重放，以及从结构上堵死"agent 以人的名义写入"这条路径。

### D10. 调度：事务内记账，事务外执行，Service 自己写回执

1. 命令进入事务前，Service 对相关成员采样一次 presence，作为 `decide` 的输入。
2. `decide` 按唤醒表算出受影响成员：剔除发起者本人和非 active 成员，去重。邀请事件是唯一的例外：被邀请者此时是 `invited`，也会收到唤醒，指针里带 `invited:true`，但这不改变它的读写权限；再按熔断规则和绑定能力，生成 `dispatch/intended` 事件，与业务事件放在**同一行**。
3. 提交成功后，Service 在事务外调用 SPI，**不设超时**。宿主调研表明：冷恢复一个 session 要读完整份日志并逐个执行 `agent/created` 监听，耗时没有上界，而且 `resolveAgent` 不能取消。如果超时就判 failed，恢复其实仍会完成，消息照样送达，结果却被记成失败，导致人后来点的确认被拒绝。
4. SPI 返回或抛错后，Service 在同一串行队列中自己写入 `dispatch/completed`（actor 为 `system:dispatch`）。这不是公开命令，宿主和 provider 都不能写（ponytail-review #3）。每个 `deliveryId` 只写一次结果。还没结束的投递会在总览的 `inFlightDeliveries` 里列出来。

熔断只统计 `wake` 类投递，按"已尝试"计数，因此计数完全由日志推导，串行事务保证不会超发（第 2 轮 N-C7）。`confirm` 类投递不计入熔断：每个请求、每位决定人恰好一条，数量本身就有上限。崩溃后，只有意图没有结果的投递会被视为"结果未知"，不自动重发。

### D11. 读取是纯操作

`readSince` 不改变任何状态，内核也不保存已读位置。游标由调用方保存；`dsh-collab` 会为每个 session 维护一份。这样读取就不可能触发新的写入。presence 作为 `project` 的参数传入。

### D12. 投影转义

对成员提供的文本，依次处理：控制字符和换行替换为空格 → 去掉首尾空白 → 对全部 CommonMark ASCII 标点各做一次反斜杠转义。之后作为普通文本，接在投影模板固定的非空白前缀后面输出（例如 `- 标题：`）。

上一版先做 HTML 实体转义，再做反斜杠转义，可见文本会变成 `&lt;`；而且行首的四个空格可能被解析成代码块（第 3 轮 R3-M3）。现在只转义一次，并去掉首尾空白，测试会断言成员文本片段解析后的可见文本，与控制字符及换行替换为空格并去除首尾空白后的归一化文本一致（不包含模板前缀）。

投影和指针都只是带来源的协作数据。这条约束写进协作约定，也写进 `dsh-collab` 的接入要求：宿主不得把它们提升为指令。

### D13. 协作约定；定位符推迟

`v1.md` 随包发布，启动时计算 sha256，协作空间创建时记录所用版本。定位符和 `describe` 推迟到出现第二种接入方式时再加：本期只有嵌入式这一种接入方式，描述文件只能返回常量，不会有调用方根据它做分支（ponytail-review #4）。`serviceId` 仍然写进协作空间，留给以后迁移用。

## Risks / Trade-offs

- [provider 可以伪造人类证据] → 这是明确的信任边界：只注册经过审查的 provider，证据完整写入日志供审计。
- [Host 重启或崩溃留下残留锁] → 等待 dispose 的时间有上限，正常重启也可能残留锁。内核提供 `breakLock`，宿主要先核实单 Host 前提并证明 pid 所属进程已不存在，才能调用；pid 存在或状态未知时不得解锁，不依赖锁中并未定义的启动标识。`dsh-collab` 的前置实验会验证 close 是否接入，以及预算耗尽、强制退出两条路径。
- [结果未知的投递不会重发，可能漏叫醒] → 漏叫醒的代价是需要人推一下；重复叫醒的代价是空转。两害相权，选择不重发。总览中会列出这些投递。
- [decided 为终态，改主意只能新建条目] → 用户已确认这一收缩。总览中保留旧条目及其决定，便于追溯。
- [jsonl 只追加，会持续增长] → 协作空间生命周期有限，规模在几百到几千条提交，可以接受；需要时再加快照。
- [本期没有真实的人类确认入口] → 请求保持 `awaitingChannel:true`。这是已知缺口，已写入 proposal。

## Migration Plan

新增一个包，不改变任何现有行为，不在 `dsh.yaml` 登记。回滚即删除包目录。后续由 `dsh-collab` change 首次引入。

## Open Questions

- 协作约定 v1 的正文以 `doubao-buddy-offline-collab` 的 README.md、LOOP.md 为蓝本整理，在 tasks 阶段细化。
- `ESCALATE_AFTER`（3）和 `BREAKER_LIMIT`（6）是代码常量，不可配置（ponytail-review #5）。`dsh-collab` 上线后观察效果，需要时直接改常量。
