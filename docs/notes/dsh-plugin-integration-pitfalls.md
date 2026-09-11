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

## 排查这类问题的通用顺序

1. **先证伪最省事的假设**：换个值、去掉这个字段——如果结果完全不变，
   说明该路径压根没在起作用，继续在它上面调参毫无意义。
2. **找一个已知正常的对照**：同 workspace 下用户自己的会话、另一个插件的
   同类调用。差异出现的地方就是问题所在。
3. **读依赖包的源码与注释**，尤其是包内对"该由谁调用、何时调用"的说明。
   本文两个主要条目的答案都直接写在依赖包的注释里。
4. **不要相信"看起来对"的字段名**：`agentPreset`、`stdio`、`data` 都很像
   那个意思，但语义与预期不同。
