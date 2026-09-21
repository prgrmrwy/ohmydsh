# devbox 上 Connection RPC 通道未注册(浏览器验收新发现)

## 结论

**devbox 的 Host 没有为 Connection RPC 通道注册路由**,导致所有走
`connection.rpc` 的插件的浏览器端 RPC 全部失败:

| 插件 | 用户可见后果 | 证据 |
|---|---|---|
| `dsh-home-network-model-guard`(出口守卫) | 拿不到出口判定,设置页配置字段为空 | console 警告 `verdict RPC failed: transport failure for /dsh-home-network-model-guard/check: HTTP 405`,同页 5 次全 405 |
| `dsh-system-clock`(系统时钟) | 设置页显示"不可用"而非主机时间 | 截图:日期条渲染为 `- -- -`,下方告警框(其 `section.tsx` 约定的 unavailable 态) |

两者都是**本仓库自研 package**,且都用官方 `connection.rpc.handle()` 注册。

## 传输机制(已从官方代码读出)

`@deepseek-ai/dsh-client-connection/lib/client.js`:

```js
const response = await send(new URL(`${channel}/${endpoint}`, resolveBase()), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(message),
})
if (!response.ok) throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`)
```

**是普通 HTTP POST,不是 WebSocket**。所以 405 的含义是"该路径没有 POST 路由"。

对照实验确认 405 就是"无此 POST 路由"的通用响应:

```
POST /definitely-not-a-real-path-xyz   -> 405
GET  /definitely-not-a-real-path-xyz   -> 404
POST /dsh-home-network-model-guard/check -> 405
POST /dsh-pet/api/status               -> 200   (Pet 自己注册的 HTTP 路由,正常)
```

## 关键对照:四组配置,同一个探针

被质疑"升级前没问题、升级后也没有对应 breakchange,凭什么算问题"之后,
用**同一个探针**(POST + `content-type: application/json` + 同一信封体)
逐组实测,而不是靠推理:

| 配置 | `guard` `/check` | `clock` `/now` | `session-links` `/links` | `memex` `/stores` | 不存在的路径 |
|---|---|---|---|---|---|
| 0.1.2-rc.1 + 升级前 home(devbox 备份 + npx 装回的旧运行体) | **200** | **200** | **200** | 405 | 405 |
| 0.1.2-rc.1 + 旧插件集(**本机**当前进程,pid 84619) | **200** | **200** | **200** | **200** | 405 |
| **0.1.5-rc.2 + 同一个升级前 home**(实验 A) | **405** | **405** | **405** | **405** | 405 |
| 0.1.5-rc.2 + 新插件集(devbox 现在) | **405** | **405** | **405** | **405** | 405 |

200 的响应体是合法的 RPC 信封:`{"type":"server-response","rpcId":"probe","result":{"ok":false,…}}`。

⚠ **先更正一处早前的错误结论。** 我曾把第 2 行写成"0.1.5-rc.2 + 旧插件集",据此得出
"运行体升级不是原因、原因在插件批次"。**那是错的**:本机那个 Host 是 2026-09-20
15:45 启动的,运行体实际是 **0.1.2-rc.1**:

```
$ ps -o command= -p 84619 → …/.launcher/node_modules/@deepseek-ai/dsh/lib/bin.js
  runtime version: 0.1.2-rc.1
$ tail -1 ~/.dsh/dsh-startup.log → dshVersion=0.1.2-rc.1
```

本机 `dsh.yaml` 虽写 `0.1.5-rc.2`,但本机一直没重建。所以第 1、2 行本质是同一组配置。

由此得到的硬结论(与早前相反):

1. **运行体升级就是原因。** 第 3 行用**同一个升级前 home**、只把运行体从 0.1.2-rc.1
   换成 0.1.5-rc.2,四个通道就从 200 变成 405 —— 唯一的变量是运行体。
2. **与插件批次无关。** 第 1/3 行插件完全一致,结论照样翻转。

补充:`memex` 在 0.1.2-rc.1 的升级前 home 上本来就是 405(该 home 尚未注册),
在本机那份 home 上是 200 —— 属另一独立现象,不与本缺陷混谈。

另附:`guard`/`clock` 两个半区的构建在本机与 devbox **逐字节相同**
(`client.js` sha256 `59c688b1adc1ea1f…`、`index.js` `137084fe79c19998…`),
所以也不是插件代码差异。

## 已排除的原因(每条都实测过,不要重复假设)

1. **隧道/Origin 伪造** —— 不成立。在本机经 loopback tunnel 访问时确实出现 405,
   但在 **devbox 本机**用现代 Chromium 直连 `http://127.0.0.1:3080`(真实 origin)
   **同样复现**。另建了一个改写 `Host`/`Origin` 为 `127.0.0.1:3080` 的本地反代,
   405 不变。
2. **Host fence 拒绝** —— 不成立。Connection fence 是基于 Host 头的
   DNS-rebinding 防护(`isTrustedAuthority`),放行 loopback、部署派生 LAN IP 字面量
   与声明的 `trustedHosts`。浏览器访问的就是 loopback,且 fence 拒绝的表现应是
   403 而非 405。
   ⚠ 更正:我早前在对话里说过"伪造 Host 被拒(401)"——那是把**未带 token 的
   401** 误读成 fence。实测带有效 token 时
   `Host: 127.0.0.1:3080` / 默认 Host / `Host: evil.example.com` **都返回 303**,
   即 Host 头并不门禁页面访问。该旧结论作废。
3. **插件构建过期** —— 不成立,sha256 与本机逐字节相同(见上表)。
4. **host 半区加载抛错** —— 不成立。当前 boot 段(最后一次 `dsh web:` 标记之后)
   除 Pet 正常消息外**没有任何 loader 错误**;`dsh.log` 里的
   `CallId` / `plugin tree failed to load` 等都在 0.1.2-rc.1 时代的旧段落里。
5. **浏览器太老** —— 曾一度误判。`/usr/bin/chromium` 是 **Chromium 90**,
   跑不动应用(`Promise.withResolvers is not a function`,`nodes: 22` 空白页),
   由此得出的"devbox 无错误"是**无效结论**。改用缓存里的
   Chrome for Testing 148(`~/.cache/ms-playwright/chromium_headless_shell-1223`)
   后才拿到有效结果。

## 静态配置也相同

`--dump-config` 中两条相关条目在本机与 devbox **完全一致**:

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  inject: [webRuntime]
  config:
    trustedHosts: !!js ctx.webRuntime.trustedHosts
```

`dsh-home-network-model-guard` 与 `dsh-system-clock` 的 loader 条目都是无
`inject`、无 `config` 的裸条目。两边 loader 总数 20/21 的差别只来自 Trae。

## 根因已确定:这是 DSH 0.1.5 自身的缺陷

`connection.rpc.handle()` 在本仓库四个包上**直接抛错**。devbox 实机诊断输出:

```
[guard-diag] inject fired connection=true webServer=true                       ← 注入没问题
[guard-diag] manual webServer.register returned function                       ← 我们自己注册路由没问题
[guard-diag] rpc.handle probe THREW: cannot get property "webServer" without inject   ← 元凶
```

`rpc-host.ts` 里 `register()` 的实现(0.1.2 与 0.1.5 **逐字节相同**):

```js
register(owner, channel, handler) {
  assertChannel(channel)
  const fetchHandler = rpcFetchHandler(channel, handler)
  const route = { kind: 'prefix', path: channel, handler: async (req, res) => { … } }
  return owner.effect(() => owner.webServer.register(route), `client-connection: ${channel} rpc channel`)
}
```

而 `get rpc() { const owner = this.ctx; … }` —— **`owner` 是 connection 服务自己的上下文**
(`new HostConnectionService(ctx, …)` 里那个 ctx),**不是调用方**。该上下文从未注入
`webServer`,cordis 因此在 effect 回调里抛
`cannot get property "webServer" without inject`;错误被吞,路由从未挂上,
客户端拿到与"路径不存在"无法区分的通用 **405**。

### 为什么 0.1.5 才坏:DSH 修了自己的路由,漏了这一条

同一个包里,`/api` 路由的注册方式在两版之间**变了**:

```js
// 0.1.2 —— 直接在插件上下文注册
ctx.effect(() => ctx.webServer.register(route), …)

// 0.1.5 —— 先注入 webServer,再在其子上下文注册
ctx.inject(['webServer'], (webCtx) => {
  …
  webCtx.effect(() => webCtx.webServer.register(route), 'client-connection: /api route')
})
```

即 0.1.5 已经发现"访问 `ctx.webServer` 必须先注入",并**按此修好了自己的 `/api` 路由**,
但 `register()`(供所有插件使用的 channel 注册入口)被漏掉了。
cordis 版本两版相同(4.0.1/4.0.2),所以不是 cordis 侧变化 —— 是 DSH 自己的适配不完整。

**因此这不是本仓库的缺陷,而是影响所有插件作者的运行体缺陷**:
远端 `dsh-plugin-subscriptions@0.9.2`(专为 0.1.5 构建)的 `/subscriptions-auth` 同样 405。

### 已实测证伪的中间假设(不要重复)

| 假设 | 结论 |
|---|---|
| 隧道 / Origin 伪造导致 | 否 —— devbox 本机原生直连(现代 Chromium,真实 origin)同样复现 |
| Host fence 拒绝 | 否 —— fence 放行 loopback,且拒绝应为 403 |
| 插件构建过期 | 否 —— 与本机 sha256 逐字节相同 |
| 插件批次引入 | 否 —— 0.1.5 + **升级前旧插件 home** 同样全 405(实验 A) |
| host 半区加载抛错 | 否 —— 当前 boot 段无 loader 错误 |
| 插件需注入 `webServer` | **否** —— 四个包改成 `inject(['connection','webServer'])` 并真实部署后**仍全 405**;因为出错的是**服务自己的**上下文,调用方注入无法影响 |

### 修复方案(二选一,尚未实施)

1. **打运行体补丁(推荐)。** 本仓库已有成熟机制:Pet compat 层对 DSH 源码打补丁
   (`.upstream/packages/client/connection/src/rpc-host.ts`),已有
   `dsh-agent` / `dsh-agent-loop` 按路径覆盖的先例,补丁带 sha256 闸门。
   改动就是把 `register()` 的注册也包进 `ctx.inject(['webServer'], …)`,
   与 DSH 自己 `/api` 的写法一致。
   代价:补丁进入"升级必须重新推导"的维护面;上游修复后即可删除。
2. **各包自行实现 channel 注册(绕过)。** 用实测可用的
   `child.webServer.register({kind:'prefix', path: channel, handler})` 自己挂路由,
   配合 `connection.requestRejection(req)` 施加同一套 fence,自行实现
   `{type:'client-request'|'server-response', rpcId}` 信封。
   代价:在 4 个包(或一个共享包)里分叉一份线上协议,长期偏离官方 API。

无论选哪个,**都应同时上报上游** —— 该缺陷影响所有注册 Connection RPC channel 的插件。

## 影响评估(已按代码更正,不要夸大)

⚠ **本节前一版写错了,已作废。** 原文断言 `文档/资料` 面板"会把取不到数据渲染成
正常空态,真正有链接的会话会被误报成没有链接"。用户用 devbox 实机截图直接证伪:
该面板**正常显示 16 条链接**。

### 为什么会错

`dsh-session-links` 是**双数据源**设计,我误读了主次。host 半区的模块注释写得很清楚:

> whose single `links` endpoint reads a session's **complete** durable event log …
> (the **"whole session" baseline the browser window cannot see**).
> **The web half keeps its live snapshot for new-message increments.**

即:

- **浏览器半区(主源)**:从官方 runtime conversation snapshot 按消息 seq 水位
  **增量采集**,**不依赖 RPC**,面板照常出数据;
- **host 半区(`/dsh-session-links/links`,辅源)**:整份日志的**基线**,
  用于补上**窗口截断与 compaction 丢掉的部分**
  (客户端注释原文:"Whole-log baseline from the host (window-truncation and compaction …)")。

而且客户端**本来就预期**这条 RPC 可能不可用 —— `Panel.tsx` 里有专门的告警分支:

```js
if (attempt === 0) console.warn('[dsh-session-links] baseline NOT fetched: connection RPC unavailable on tab context')
… .catch(error => console.warn('[dsh-session-links] baseline fetch failed:', …))
```

### 更正后的影响表

| 插件 | 有降级路径吗 | 真实影响 |
|---|---|---|
| `dsh-session-links` | **有,且是设计内的** | 面板正常;仅**长会话在窗口截断/compaction 之后,较早的链接可能缺**。不是"误报无链接" |
| `dsh-system-clock` | 有(显示 unavailable,注释明说"never fabricate") | 设置 section 显示"不可用"而非主机时间 —— **视觉退化,无数据错误** |
| `dsh-home-network-model-guard` | 有(客户端 `'unknown' while unavailable → fail open`) | 不阻塞任何模型;**设置页诊断字段为空**;模型选择告警不出现 |
| `dsh-memex` | 未知 | `/dsh-memex/stores` = 405,同上机制,**未逐项点开验证** |

**结论修正:四处全部是"优雅降级",没有一处给出错误结论。** 唯一的数据损失是
session-links 的整份日志基线(窗口截断场景下的较早链接),唯一的视觉断点是
系统时钟显示"不可用"和出口守卫设置页字段为空。

因此严重度**低于**前一版措辞:它是"四个诊断/显示面失效",不是"数据正确性问题"。

## 仍然成立的部分

- Connection RPC 通道在 devbox 上确实**整体未注册**(四个自研通道 + 远端
  `/subscriptions-auth` 全部 405,而升级前 devbox 与本机现在均为 200)。
- 原因已定位到**插件批次**,不是运行体(三组对照见上)。
- 这仍然是**真实回归**,只是**影响面小且各面都有降级**。

### 我在本轮犯的同类错误(记录以免重复)

两次都是**过度解读观测**:

1. 把 subscriptions 设置页渲染完整当成"subscriptions 正常"—— 其实卡片来自客户端常量;
2. 把新会话上"当前会话暂无文档/资料"当成 RPC 失效的证据 —— 那只是**空会话的正常空态**,
   我因为同一时刻看到了 console 告警就把两者因果连起来。

教训:**面板显示"空"不等于数据源坏了**;要判定失效,必须用能区分"空"与"取不到"的探针
(本次的 HTTP 探针就是),而不是看 UI 文案。
