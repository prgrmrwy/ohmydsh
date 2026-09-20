# DSH 插件集成陷阱：声明与装配是两回事

本文收录本仓在集成 DSH 时**真实踩过、且从类型签名或参数名看不出来**的坑。

共同特征：调用完全成功、类型检查通过、日志无异常，但**该生效的东西没生效**。
这类失败不会自己暴露——只有当某个依赖它的功能"莫名其妙不工作"时才被发现，
而排查往往从错误的方向开始（怀疑权限、怀疑配置、怀疑名字写错）。

判据先行：**如果一个字段只是被"记下来"，那它多半没有"做"任何事。**
凡是期望产生运行时效果的集成点，都要问一句「谁来执行它、什么时候执行」。

---

## 1. `meta.agentPreset` 只记录名字，不装配组合

### 现象

Pet 创建 executor session 时传了 `meta.agentPreset`，session header 上也确实
记录了该 preset 名，DSH 原生界面能显示"标准模式"。但 executor 实际只有 5 个
工具（各插件全局注册的那些），**没有 `bash`、没有文件与搜索工具**——而同一个
workspace 下用户自己的会话有 29 个。

排查中被这些假象带偏过：

- 以为 preset 名字写错 → 换名字，工具数不变
- 以为 preset 没被 profile 装配 → 确认 `standard` 是 shipped preset，存在
- 以为是权限问题 → agent 自己也如此判断，说"需要给我开放 shell 权限"
- 以为不传 preset 会走默认 → 不传同样是 5 个

**传什么都一样**，正是"这条路径根本没在起作用"的信号。

### 根因

`@deepseek-ai/dsh-agent-presets` 里两件事是分开的：

| | 作用 |
| --- | --- |
| `meta.agentPreset` | 写进 session header。供**显示**与**会话重建**读取（`agentPresetProjectionDefinition.init` 读的就是它） |
| `agentPresets.mount(agentCtx, id)` | **真正把 preset 组合挂上去**：bash / fs / search / jobs 等插件在此刻才存在 |

包内注释写得明确：

> Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
> the agent creation back, so a broken preset never yields a half-composed
> session.

也就是说 preset 的装配**必须由创建方在 `setup` 回调里显式发起**。只填 `meta`
得到的是一个"声称自己是 standard、实际什么都没组合"的 session。

### 规则

1. 通过 `agents.create()` 创建 session 时，若期望 preset 生效，**必须**在
   `setup(agentCtx)` 里 `await ctx.agentPresets.mount(agentCtx, presetId)`。
2. `meta.agentPreset` 与实际 mount 的 id **应由同一处算出**，避免"header 说 A、
   实际跑 B"的静默漂移。
3. `setup` 里的其它注册（如 scoped skill provider）应在 mount **之后**执行。
4. 验证方式不是看 header，而是看会话事件里 `request/header` 的
   `data.header.tools` 长度——与同 workspace 的普通会话对比即可。

### 影响范围

该缺陷在 Pet 一期就存在，但当时 Pet 能力都是自带工具的 Skill（`ws`、`send-cr`），
executor 不需要 bash，因此长期无人察觉。直到二期出现"agent 自己去读飞书、看代码"
的场景才致命。

**这是这类 bug 的典型形态：错误的集成方式可以长期正常工作，直到某个新用法
恰好依赖那个从未真正生效的部分。**

---

## 2. `stdio: 'ignore'` 会让长驻子进程立刻退出

### 现象

Pet 用 `spawn()` 拉起 `lark-cli event consume` 订阅飞书消息。子进程启动、
打印就绪标记、随即以**退出码 0** 结束；监督器判定为意外退出并重启，如此循环。

状态一度显示 `connected`，而 `lark-cli event status` 显示
`Active consumers: 0`——因为每个 consumer 只活几百毫秒。

### 根因

`lark-cli event consume` 的帮助文本里写着：

> Bounded runs ignore stdin EOF.

反过来说：**无界运行会因 stdin EOF 而退出**。而 `stdio: ['ignore', ...]` 使
子进程 stdin 立即 EOF，于是它认为收到了关闭信号，"正常"退出。

手动在终端跑不会复现——终端的 stdin 是 TTY，不会 EOF。

### 规则

1. 拉起**长驻**子进程时，stdin 用 `'pipe'` 并**不写不关**，而不是 `'ignore'`。
2. 退出码 0 不等于健康：对长驻进程而言，**任何**退出都是异常。
3. 终端手测通过不能证明 spawn 场景可用——两者的 stdin 语义不同。
4. 回收用 `SIGTERM` 而非 `SIGKILL`：lark-cli 明确警告硬杀会跳过清理并可能
   泄漏服务端订阅。

---

## 3. 部分 lark-cli 命令的结果不在 `data` 信封里

### 现象

按统一约定读取 `{ ok, data }` 的 `data` 字段，对某些命令永远取到空值，
但命令本身 `ok: true`。

### 根因

至少 `auth status` 与 `bot/v3/info` 把结果放在**响应顶层**（如 `identities`、
`bot`）而非 `data` 内。lark-cli 的 `api` 命令也只提取 `data`，因此通过它调用
这类端点同样取不到。

### 规则

1. 新接一个 lark-cli 命令时，先跑一次看**完整**输出，不要假定信封形状。
2. 对这类命令保留一个读取整个响应的通道，并在代码中注明原因。

---

## 4. 事件日志的结构必须实测，不能推断

### 现象

从 executor session 提取"最后一条 assistant 回复"用于回传飞书，取到的永远是
`undefined`，因此单聊始终收不到回复。

### 根因

按常识写的三处判断全错：

| | 推断 | 实际 |
| --- | --- | --- |
| 事件类型 | `message` | `assistant/message` |
| 角色位置 | `data.role` | `data.message.role` |
| 文本位置 | `data.text` | `data.message.content[]` 中 `type: 'text'` 的项 |

而且 `content[]` 里还混有 `reasoning`（模型的内心独白）与 `tool-call`，
**直接拼接会把思考过程发到聊天里**。

### 规则

1. 解析会话事件前，先解出一份真实日志看结构。会话日志是多帧 zstd，
   需逐帧解压（单次 `zstdDecompressSync` 只解第一帧，会误以为只有一行）。
2. 只取 `type === 'text'` 的部分；`reasoning` 与 `tool-call` 不得外发。
3. 这类"结构推断"必须用真实样本写测试，否则测试只是把错误假设固化一遍。

---

## 5. `agent/inbox/claimed` 里混着 Host 自注入的上下文

### 现象

Locus 子会话收到飞书消息后执行完全正常——正确解析、正确调用回复工具、
`turn/end` 为 `completed`——但 `pet_locus_reply` 报错：

```
This turn has no exact Feishu Delivery reply target; GUI and stale turns cannot send.
```

飞书侧只看到一个失败表情，一个字都发不出去。而且**只有每个子会话的第一条
消息会这样，第二条开始就正常**。

### 根因

`agent/inbox/claimed` 对**进入这一步的每条 inbox 消息**都会触发，而 DSH 在
每个会话的**首轮**都会注入三条标准上下文：

| `source.kind` | 内容 |
| --- | --- |
| `agent-instructions` | AGENTS.md / CLAUDE.md 注入 |
| `plugin` | runtime context 快照（sandbox / approval 等）|
| `skill-catalog` | 可用 skill 目录 |

turn-observer 拿到这些 claim 后去 Delivery 表里查，查不到 → 归入
`unresolved` / `foreign` → 把该轮标记为 **`mixed`** → `currentForChild()`
返回 `undefined` → `currentDelivery` 解析不出来 → 回复工具拒绝发送。

`mixed` 判据本身是对的（防止 GUI 输入或父会话 steer 混入飞书轮次，把业务
正文发到错误目标），错在**没区分两类非 Delivery 消息**：

- **真危险**：`user` 来源但不在 Delivery 表里 = GUI 提问、父会话 steer，
  可能指向别的目标，必须继续 fail closed；
- **无害**：Host 自注入的上下文，根本不是谁发的消息，没有任何 reply target，
  也永远不可能变成 Delivery。

### 规则

1. 消费 `agent/inbox/claimed` 时，**必须读 `payload.message.source.kind`**，
   不能假设 claim 都是参与者发来的消息。事件里带的是完整 `UserMessage`。
2. 按来源区分豁免，而不是按「查不到就当污染」一刀切；豁免名单只放 Host
   自注入的类型，`user` 永远不在其中。
3. 来源缺失时按参与者流量处理（fail closed），不能因为读不到来源就放行。
4. 这类「首轮才复现」的缺陷，测试必须**照抄真实首轮的完整 claim 序列**
   （1 条 Delivery + 3 条注入）。只测单条 claim 会全绿，但真机必挂。

---

## 6. 入队即唤醒：claim 结构性地先于持久绑定到达

### 现象

修掉第 5 节的注入污染后，同一子会话的**每一条**飞书消息仍然回不出去，
`pet_locus_reply` 报同一错误。这次 turn 的 inbox 里只有 1 条消息、
delivery 记录完美匹配、工具调用时 delivery 正处于 `running`——
一切看起来都对，仍然失败。

### 根因

调用链的固有顺序决定了竞态**必然发生**，而不是小概率：

```
Host:  queueChild()          ← followup 进 inbox，driver 立刻被唤醒
         (await 返回 messageId)
       bindQueued()          ← inboxMessageId 此时才写入持久层
       deliveryAvailable()   ← 唤醒 observer 重查

Agent: turn/start → inbox.claim → agent/inbox/claimed → observer 查表
```

claim 触发时 `bindQueued` 还没落库，observer 查不到 → 挂 `unresolved`。
这本身没问题——`deliveryAvailable` 的唤醒补救是完整的，绑定最终会成功。

**真正的 bug 是一行提前置位**：`handleClaim` 在挂 `unresolved` 的同时把
该轮标记 `mixed`（sticky，永不清除）。补救链条随后全部成功，但
`currentForChild()` 第一条判据 `if (mixed) return undefined` 让回复授权
**永久丢失**。防「混入」的标记把「暂时查不到」也当成了「已证实混入」。

### 规则

1. 「入队」和「持久绑定」之间必然有窗口；**消费 inbox claim 的一侧必须把
   「暂时查不到」和「证实不是」当作两种状态**，不能在前者上做不可逆决定。
2. 永久性标记（fuse）只能由**已证实的事实**置位：第二条 Delivery、lookup
   基础设施失败、确认为外部流量。安全边界交给「未决即拒绝」
   （`unresolved.size !== 0`）承担，它天然随解析结果收敛。
3. 测试必须复现**真实时序**：claim 先到 → `deliveryAvailable` 后到 →
   断言授权恢复；并配对照（GUI 混入 / 双 Delivery / lookup 失败）断言
   永不恢复。只测「查得到」的顺路径会全绿，真机必挂。
4. 诊断日志走 `console.log` 时要确认 Host 的 stdout 实际落盘——本次排查中
   Host stdout 指向 `/dev/null`，运行时诊断全部丢失，只能靠持久层时间戳
   与代码结构反推。

---

## 7. 字段取值必须实测：`tokenStatus` 是 `valid` 不是 `ready`

### 现象

`lark-cli --profile dsh-pet auth status --verify` 明明显示用户身份 `ready`、
openId 正确且在 allowlist 中，Pet 轮盘点「答疑群」仍报：

```
无法核验当前飞书用户身份，不能创建默认 Q&A 群：
The Pet user identity is not ready or verified.
```

### 根因

判据里有一个字面量猜错了：

```js
identity['status']      !== 'ready' ||   // ✅ 实际就是 'ready'
identity['available']   !== true    ||   // ✅
identity['tokenStatus'] !== 'ready' ||   // ❌ 实际是 'valid'
record['verified']      !== true         // ✅
```

因为 `status` 用的是 `ready`，就想当然认为同一对象里的 `tokenStatus` 也是
`ready`。实测 lark-cli 对可用 token 返回的是 **`valid`**，所以这个闸门
**永远不可能通过**，默认 Q&A 在任何情况下都建不出来。

更糟的是**测试替身也写了 `tokenStatus: 'ready'`**，与错误实现犯同一个错，
于是测试长期全绿却掩盖了真机必挂。

### 规则

1. **字段取值域必须从真实输出读出来**，不能因为同一对象里另一个字段是某值就
   类推。同一响应里 `status: 'ready'` 与 `tokenStatus: 'valid'` 并存。
2. 取值域**没有文档时不要 pin 单一字面量**。这里改为依据 `status`
   （过期时为 `needs_refresh`）与 `--verify` 的 `verified`——这两个的取值可观察
   且语义明确；`tokenStatus` 不再参与判定。
3. **替身必须照抄真实响应**，包括那些当前判据用不到的字段。凡是替身里出现
   而真实系统不会产生的值，都是一个正在被掩盖的缺陷。本轮同类问题已出现三次
   （`sessionController.inspect` 的假形状、context anchor 的
   `authorization: 'authorized'`、以及本节的 `tokenStatus`）。
4. 这类「判据要求的值真实系统从不产生」的缺陷，表现是**功能在任何情况下都
   失败**而非偶发。遇到「从来没成功过」的能力，优先怀疑判据而不是环境。

---

## 8. 引用消息的字段形态必须实测：`root_id`/`parent_id` 不是 thread 证据

### 现象

群里「引用一条消息 + @bot」提问完全没有反应：飞书侧不打表情、不回复，
`dsh.log` 只有一行 `admission-rejected:ambiguous-thread`（该原因在
`channel/service.ts` 的低基数词表里归入 `other`，所以旧日志只显示
`inbound ignored: other`）。同一个群里直接在话题里 @bot 则一切正常。

### 根因

准入把**消息级引用事实**当成了**入口身份证据**：
`extractLocusEndpoint` 见到 `root_id`/`reply_to` 而没有 `thread_id` 就拒绝。
实测（2026-09-16，真实租户，bot 身份读原始消息字段）：

| 场景 | `thread_id` | `root_id` | `parent_id` |
| --- | --- | --- | --- |
| 群时间线普通发言 | 无 | 无 | 无 |
| **群时间线引用某条消息发言** | **无** | **= 被引用消息** | **= 被引用消息** |
| 群时间线回复引用链中的第二条 | 无 | 引用链根 | 直接父消息 |
| 话题内发言 / 话题根 | `omt_*` | 无或话题根 | 无或直接父 |

也就是说：**普通群（`chat_mode: group`）里引用别人的消息，平台固定给
`root_id`/`parent_id` 而不给 `thread_id`**；只有话题内消息才带 `thread_id`。
按「有 root 无 thread 就是丢了字段的话题消息」推断，会把最常见的提问方式
全部判成畸形事件。

### 规则

1. **入口身份只认平台规范字段**。`thread_id` 是入口级稳定身份；
   `root_id`/`parent_id` 是消息级引用关系，二者不可互换。用 messageId 去
   否决入口，等于把它提升为入口键（`design.md` 早已写明 messageId 属于投递）。
2. **区分身份事实与可选事实的失败方式**。身份事实（`chat_id`、`thread_id`）
   不可归一化时 fail closed；可选上下文事实（`root_id`、`reply_to`）不可用时
   只丢该事实，**不得**因此丢掉整条消息——本次故障正是「可选事实有否决权」。
3. **反证要在同一租户上用平台事实做**。本轮判定「它不是话题消息」靠的不是
   推理，而是话题消息列表里没有它、且列表内每条都带 `thread_id`。
4. **替身必须照抄消费端契约**。`lark-cli event consume` 对
   `im.message.receive_v1` 做了扁平化与预处理：字段在顶层、发送者是
   `sender_id`（仅 open_id）、`mentions[].id` 是 open_id 字符串、`.content`
   对 `text`/`post` 是**已渲染文本**（不是原始 OAPI JSON）。原先的样例写的是
   原始 payload（`sender_open_id`、`mentions[].id.open_id`、JSON 字符串
   content），能通过前缀校验却描述了一个消费端从不发出的事件。

---

## 9. 闸门要求的事实必须有可达的生产者（否则 UI 会自我封死）

### 现象

飞书里 `-s write` 回「控制命令执行失败，请稍后重试。」，同一步在 Pet 设置页
显示「缺少所有者已确认的 execution root；请先确认上下文锚点再提权。 已维持原
effective/read，未扩大权限。」。子会话日志给出机制：

```
00:58:57.857 sandbox/mode workspace-write   ← 宿主确实应用了
00:58:57.925 sandbox/mode read-only         ← 68ms 后回滚
```

即：应用成功 → 核验拒绝 → 回滚。重试多少次结果都一样。

### 根因（两层，第二层才是致命的）

1. **控制面把确定性拒绝折叠成重试提示**：`safeControlError` 只认少数几个
   错误码，`WRITE_UNSUPPORTED` 落进兜底分支，真实原因（含「需先确认执行根」
   的指引）被丢掉。同一个失败，管理面说真话、飞书说假话。
2. **闸门要求的事实没有生产者**：写授权要求「所有者已确认执行根」+「live
   sandbox 回读一致」。`executionRoot` 的唯一写入点是管理面的
   `confirm-anchor`，而管理面唯一的调用点（「确认执行根」按钮）**从不发送
   `executionRoot`**，投影里的候选根也从不被填充（workspace resolver 只返回
   title/path）。更糟的是该调用仍把锚点置 `status: 'confirmed'`（两个空数组
   就满足了 `hasFacts`），而按钮可见性按 `status !== 'confirmed'` 判断——**第
   一次误点就把唯一入口收走了**。

### 规则

1. **写完判据先找生产者**。一个 gate 的每个必需事实，都要能指出「谁写它、
   在哪个界面/命令里写」。指不出来就是「判据要求的值真实系统从不产生」
   （第 7 节），功能会 100% 失败而不是偶发。
2. **确定性拒绝不得返回重试类文案**。忙、并发冲突可以「稍后重试」；缺前置
   事实、范围不匹配不行——用户会照着重试，然后得到一模一样的结果。错误映射
   要么透出可行动原因，要么明确分类，别无脑兜底。
3. **检查第二次点击后的状态**。只测「第一次能不能点」会漏掉这一类：动作成功
   写入了一个不完整的状态，随后按该状态隐藏自己。回归用例必须覆盖「第一次
   点击后仍能补上缺的那一半」。
4. **候选值由宿主解析、由所有者确认**。需要人类确认的路径类事实，应从权威
   来源解析出候选再让人确认（本例：DSH 的 session cwd 就是 `workspace-write`
   边界，即 `sandboxPolicy.resolve()` 回读的 `workspaceRoot`），而不是让人
   手输或由服务端静默补齐——手输在「唯一能通过的取值」上没有额外安全性，只
   多出 typo 与跨机器路径混淆。

---

## 10. 同一平台两个方向的契约可能不对称（入站预渲染 vs 出站标记）

### 现象

群里 bot 回复开头的「@赵鸿珂」是纯文本：对方收不到提醒、名字也不可点。而
`dsh.log`、Delivery 终态、表情全部正常——发送明明成功了。

### 根因

`lark-cli` 对 `im.message.receive_v1` 做了预处理，把 mention **渲染成显示名**：

```
入站：@小小芒果 hi           <- event.content 已经是给人看的文本
出站：必须写 <at user_id="ou_…">名字</at>，否则只是纯文本
```

模型看到入站样例，出站照抄同一写法，于是发出的是纯文本；而平台不会因此报错，
所以没有任何反馈渠道能暴露它。`im/v1/messages` 的差别是可判定的：真提醒有
`mentions[]` 且正文里是占位符 `@_user_1`，纯文本则是 `mentions: null`。
本轮实测两条消息正好一真一假，说明「能不能 @ 到」取决于模型这次有没有手写标记。

### 规则

1. **别把入站样例当成出站模板**。同一平台读/写两侧的契约要分别实测；`--dry-run`
   可以直接打印将要发送的 JSON（本例证明标记不被转义，问题只在正文内容）。
2. **契约要写进注入**。模型的唯一输入是提示与工具说明；平台语法不在那里，就只能靠猜。
   本例把「直接写显示名即可、Host 会渲染」与「别名不一致时手写 `<at user_id=…>`」
   同时写进投递提示与 `pet_locus_finish` 说明。
3. **能机械翻译的就别指望模型记住**。出站通道在发送前用群成员表把整词
   `@显示名` 翻成标记：映射来自权威来源（bot 身份读当前 chat 成员），无法唯一确定
   （重名/非成员/已是标记/邮箱内 `@`）时保持原文——**宁可纯文本，也不通知错人**。
4. **失败必须 fail-soft 且可诊断**。成员表读不到就按原文发，只记一条低基数日志
   （次数 + 原因分类），不含姓名、open_id 或正文。

---

## 11. 手写规范化会丢掉新闸门依赖的字段（类型允许，运行时必挂）

### 现象

真机验收时，在一个全新飞书群里首次 @ 机器人：locus **创建成功**（`source: auto`、
`state: active`、`childComposition: "safe-v1"` 全部正确），但**投递被拒**，群里没有
任何回复，Delivery 表 0 条记录。Host 日志只有两行，且没有任何原因：

```
[dsh-pet] dsh-pet locus channel: child-unavailable
[dsh-pet] dsh-pet channel: inbound unroutable: child-unavailable
```

看起来像「冷启动竞态」或「子会话还没建好」，但父会话与子会话在磁盘上都存在，
父会话甚至已跑完种子轮次，子会话日志也是完整的 `safe-v1` 组合（工具白名单只有
`read/read_image/glob/grep/web_search`）。排查方向一开始完全是错的。

### 根因（两层，都是「声明了但没接通」）

1. **规范化函数逐字段重建对象，漏拷新闸门要求的那一个字段**：

   ```ts
   // child-delivery.ts —— 本次改动新增的闸门
   if (locus.childComposition !== LOCUS_SAFE_CHILD_COMPOSITION) {
     ports.log?.('safe-composition-unproven')
     throw new Error(`Locus child is unavailable (safe-composition-unproven)`)
   }
   ```

   ```ts
   // locus-controller.ts —— 同一个 commit，手写返回字面量
   return {
     ...(id !== undefined ? { id } : {}),
     endpoint: locusEndpoint,
     generation,
     parentSessionId: raw.parentSessionId.trim(),
     childSessionId: raw.childSessionId.trim(),
     workspaceId: raw.workspaceId.trim(),
     state: 'active',
     permission: permission as unknown as LocusPermission,
   }                                  // ← childComposition 从未被拷回
   ```

   该字段在类型上是**可选**的（`readonly childComposition?: LocusChildComposition`），
   所以漏拷**编译通过、类型检查通过**。闸门检查它，规范化丢弃它，于是闸门**恒真**
   ——任何 locus、任何群、任何投递都会失败，不是偶发也不是冷启动。

   同仓库其它地方都忠实透传该字段（`resolution.ts`、`controller-persistence-adapter.ts`），
   git 里也能看到闸门与规范化是在**同一个 commit** 里分别改的：加了判据，没加生产者。

2. **诊断端口没接线，真实原因被静默丢弃**：

   ```ts
   // index.ts —— 生产接线
   createLocusChildDelivery({
     createAdapter: () => createLocusChildAdapter(locusChildProbe.ports),
     // ← 没有传 log
   })
   ```

   `child-delivery.ts` 在每个失败分支都调了 `ports.log?.(…)`，代码写得很规范；
   但 `ports.log` 是 `undefined`，于是 `safe-composition-unproven` 被吞掉，只剩
   控制器的 `catch { return this.refuse('child-unavailable') }`。仓库里同族端口
   （reconcile / provisioning / resolve / turn / channel）**全都接了** `log`，
   唯独 child delivery 漏接——是不一致，不是设计。

### 为什么单测全绿

两半各自被测过，但**从不在同一条路径上拼接**：

| 测试 | 覆盖 | 漏洞 |
| --- | --- | --- |
| 频道控制器测试 | 全部 stub `deps.child` | 闸门根本不执行 |
| child-delivery 测试 | 手写字面量 locus，**自带** `childComposition: 'safe-v1'` | 不经过规范化 |
| locus 记录 fixture | 类型上该字段可选，fixture 直接不写 | 永不携带证明 |

### 规则

1. **给「可选字段」加闸门前，先找它的生产者**。判据要求的事实必须有可达的写入点；
   类型可选意味着「缺失」是合法状态，编译器不会替你发现规范化把它丢了。在本例中
   「缺失」恰好触发 fail-closed，于是表现为 100% 失败而不是偶发。
2. **逐字段重建对象的规范化函数是危险区**。凡是下游要读的字段，都要么显式列出并配
   测试，要么改成结构化拷贝。改动新增字段时，`grep` 该字段在全仓的引用，逐个确认
   透传链完整——本例只需一条 `grep` 就能发现控制器从不引用它。
3. **诊断要接到底**。声明了 `log`/`onError` 这类端口就要在生产接线里接上，否则等于
   没有。判据：`grep` 该端口的可选调用点，确认每处调用都有非 `undefined` 的实现。
4. **拒绝码不能只有兜底分类**。`catch { refuse('generic-code') }` 让每个失败长得一样；
   要么在源头保留封闭的稳定子码（本例按 `admission-rejected:${reason}` 的既有先例），
   要么让底层端口自己记日志。
5. **回归测试必须跨层拼接**。只测单层会得到一个「两层都绿、合起来必挂」的系统。
   有效形式：真实下层的端口 + 假适配器 + 由真实上层规范化流出的数据，断言端到端
   被接受（本例：真实 `createLocusChildDelivery` + 假 adapter + 经
   `normalizeActiveLocus` 的记录）。验证方式是**临时回退实现**，确认测试真的失败
   ——本例回退后精确复现了线上症状（`refused` 而非 `accepted`）。

---

## 12. `toolFilter` 不覆盖 agent 自有 scope（白名单挡不住 own 层注册的工具）

### 现象

Pet 用 `LOCUS_SAFE_TOOL_FILTER` 把 Locus 子会话的继承工具限制为
`['read','read_image','glob','grep','web_search']`，真机核对 child 工具面确实**没有**
`bash`/`write`/`edit`/`run_code`/`send_message`/`workflow`/`ralph`——看起来白名单生效了。

但 `subagent` **在列表里**。它派生出的孙代理工具面 **30 个**（含 `bash`），实测孙代理能用
`bash` 跑通 `lark-cli --profile dsh-pet auth status --json`，返回 token `valid` 且 scope
含 `im:message`。于是「群内业务正文只能经 `pet_locus_finish` 发出」这条唯一出口不变量，
可被 child → subagent → 孙代理 bash → `lark-cli --as bot im +messages-send` 绕过，
且不经 Delivery 账本、不留审计痕迹。

### 根因（三层）

1. **`toolFilter` 只约束继承面，own 层注册在过滤之外**：

   ```ts
   // packages/core/tools/src/index.ts
   for (const [name, definition] of inherited) {
     if (layers.every(layer => layer.admits(name))) visible.set(name, definition)
   }
   // The scope's own registrations last, shadowing an inherited name and
   // outside the filter above.
   if (own !== undefined) {
     for (const [name, definition] of own.tools.entries()) visible.set(name, definition)
   }
   ```

   所以 allow/deny 都动不了 own 层；把 `subagent` 写进 `deny` 也没用——它不在
   `restrictableNames` 里，写入会直接抛错。

2. **哪个工具落 own 层由注册方的 config 决定**：`@deepseek-ai/dsh-tool-subagent` 在
   `config.modelSelectionSettings === true` 时按 agent 逐个 `inject` 后注册（own 层），
   否则走普通安装（standing/祖先层，受 filter 约束）。标准 preset 的 `subagent` 行带
   这个开关，同包的 `subagent_fork` 行没有——**这正是一份工具面里 `subagent_fork` 被挡住、
   `subagent` 却漏进来的原因**。

3. **后代不在同一链上**：子代理组合来自**委派请求**而非父 agent 的 restriction；子代经
   `composeFrom` 绑到 preset 的 standing key，结构上不在父 child 的 own 层链上，所以
   「把 toolFilter 传给后代」没有载体。

### 规则

1. **核对工具面要问「它注册在哪一层」**。名字不在列表里不足以证明被挡住；同包内两个同类
   工具一个被挡一个漏，差别可能只是一个 config 开关。
2. **给 child 选组合时不要继承 Host 默认或用户可改的 preset**。修复把 locus 主会话固定为
   Pet 自有的 `dsh-pet-executor`（其委派行没有该开关），不再取 Host 默认；固定值本身也要
   由测试钉住（断言该 preset 的委派行不得携带 `modelSelectionSettings`，并断言上游 standard
   仍然携带，说明该固定值是 load-bearing）。
3. **委派是一等逃逸面**。child 只要能派生后代，白名单就必须覆盖后代——而机制上做不到，
   所以正确做法是让 child **根本拿不到委派工具**，不要靠 prompt 禁止（prompt 从不是边界）。
4. **单测要把被禁工具注册在正确的层**。既有用例把 forbidden 工具全注册在 global 层，
   于是永远抓不到 own 层豁免——那种绿色是假的。

---

## `ctx.inject()` 的回调是异步的，不能紧跟同步断言

### 现象

轮盘执行任何能力（`send-cr`、答疑群）都抛
`Pet scoped surface dependencies were not installed`（`src/index.ts`）。

### 真相

`installPetScope()` 用 `scoped.inject(['tools'], cb)` 注册作用域工具，并在
`cb` 里把该 agent 记进 `contextToolAgents`；紧接着**同步**检查这个集合，
没命中就抛错。

但 `inject()` 并不同步执行回调。cordis 里它直接委托给 `plugin()`：

```js
inject(inject, callback) {
  return this.plugin({ inject, apply: callback, name: callback.name })
}
```

返回的是 **fiber**，包内注释写明 "awaiting it settles once loading finished"。
用真实 cordis 实测（非 mock）：

| 时机 | 回调是否已执行 |
|---|---|
| `inject()` 返回后立即检查 | 否 |
| 等待一个 tick | 否 |
| `await fiber` 之后 | 否（fiber `state=0`） |

也就是说"注册后立刻断言注册已完成"这个模式本身不成立。

### 为什么测试全绿却真机失败

`test/executor-scope.test.ts` 对这段逻辑只做**源码字符串匹配**
（`expect(install).toContain("scoped.inject(['tools']")`），从未真正执行过
`installPetScope`。断言的是"代码长这样"，不是"代码能工作"。

### 规则

1. `ctx.inject()` / `ctx.plugin()` 的回调是异步的。**不要**在其后同步检查
   回调内设置的状态；要么把校验挪进回调，要么改由消费方在使用时判定。
2. 涉及授权边界的组合逻辑，必须有**真正执行它**的测试。源码字符串匹配可以
   钉住写法，但对"是否生效"零覆盖——本条目就是这样漏出去的。
3. 判断依赖包的同步性时，以实测为准：写一个最小 harness 跑真实依赖，
   而不是依赖 mock 的行为（mock 通常是同步的，正好掩盖这类缺陷）。

---

## 声明 `dsh.client` 与部署 client bundle 必须在同一次 sync 里落地

**症状**：改了 local package 的 `package.json` 加入 `dsh.client`（或任何会新增启动期要求的字段）后，
下次启动整个 profile **起不来**：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry modules (@deepseek-ai/dsh-client-modules):
  client-modules: 1 client package failed to compose:
  client bundles not found; run `pnpm run build` before launch:
    - package: dsh-memex
      path: ~/.dsh/profiles/web/node_modules/dsh-memex/lib/client.js
```

**机制**（2026-09-20 change `dsh-memex-settings-ui` 实机踩到）：profile 把 local package 装成 pnpm 的
`file:` 依赖，**部署副本与仓库源是硬链接**（同一 inode，`stat -f %l` 显示 links≥3）。于是：

1. 在仓库里编辑该包的 `package.json` → **部署副本的 manifest 立刻同步变化**（同一个 inode）；
2. 运行体的 loader 在**启动时**读部署副本的 `dsh.client`，要求 `lib/<entry>` 存在；
3. 而构建产物还没部署（`lib/client.js` 尚未生成或 sync 还没跑/失败）→ 启动期硬错误，
   **不是降级**：整个 plugin tree 加载失败，实例起不来。

**与"部署副本不一致"检查的关系**：sync 的 `missingDeployedFiles()` 确实能检出"声明了却没有产物"，
但检出发生在**下一次 sync**，而 manifest 的变化对运行体是**立刻**生效的 —— 顺序上救不了。

**规则**：

1. **新增启动期要求（`dsh.client`、`exports` 新入口、新的 patch 行）时，必须让声明与满足它的文件在同一次
   `dsh build` 里落地**；不要让"改 manifest"和"部署产物"跨两次 sync（中间任何一次重启都会崩）。
2. 若 sync 因故无法完成部署（例如 pnpm 解析失败），**先把声明撤回去**让实例能启动，再排查部署，
   而不是留着半截状态。
3. 排查时先确认两件事：`stat -f %i` 看部署副本与源是否同一 inode（是否硬链接），
   以及部署副本里那个被声明的入口文件是否真的存在（`ls ~/.dsh/profiles/<p>/node_modules/<pkg>/lib/`）。
4. 手工编辑任何**已部署** local package 的 `package.json` 都等于直接改线上 manifest —— 没有"只改仓库"这回事。

见 `BACKLOG.md` D005（用 `package-import-method=copy` 把部署副本与仓库解耦的候选修复）。

---

## 排查这类问题的通用顺序

1. **先证伪最省事的假设**：换个值、去掉这个字段——如果结果完全不变，
   说明该路径压根没在起作用，继续在它上面调参毫无意义。
2. **找一个已知正常的对照**：同 workspace 下用户自己的会话、另一个插件的
   同类调用。差异出现的地方就是问题所在。
3. **读依赖包的源码与注释**，尤其是包内对"该由谁调用、何时调用"的说明。
   本文两个主要条目的答案都直接写在依赖包的注释里。
4. **不要相信"看起来对"的字段名**：`agentPreset`、`stdio`、`data` 都很像
   那个意思，但语义与预期不同。
