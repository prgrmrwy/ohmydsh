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

## 排查这类问题的通用顺序

1. **先证伪最省事的假设**：换个值、去掉这个字段——如果结果完全不变，
   说明该路径压根没在起作用，继续在它上面调参毫无意义。
2. **找一个已知正常的对照**：同 workspace 下用户自己的会话、另一个插件的
   同类调用。差异出现的地方就是问题所在。
3. **读依赖包的源码与注释**，尤其是包内对"该由谁调用、何时调用"的说明。
   本文两个主要条目的答案都直接写在依赖包的注释里。
4. **不要相信"看起来对"的字段名**：`agentPreset`、`stdio`、`data` 都很像
   那个意思，但语义与预期不同。
