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

## 关键对照:三组配置,同一个探针

被质疑"升级前没问题、升级后也没有对应 breakchange,凭什么算问题"之后,
用**同一个探针**(POST + `content-type: application/json` + 同一信封体)
在三组配置上各跑一遍,而不是靠推理:

| 配置 | `guard` `/check` | `clock` `/now` | `session-links` `/links` | `memex` `/stores` | 不存在的路径 |
|---|---|---|---|---|---|
| **0.1.2-rc.1 + 升级前 home**(devbox 备份 + npx 装回的旧运行体) | **200** | **200** | **200** | 405 | 405 |
| **0.1.5-rc.2 + 旧插件集**(本机现在) | **200** | **200** | **200** | **200** | 405 |
| **0.1.5-rc.2 + 新插件集**(devbox 现在) | **405** | **405** | **405** | **405** | 405 |

200 的响应体是合法的 RPC 信封:`{"type":"server-response","rpcId":"probe","result":{"ok":false,…}}`。

由此得到两条硬结论:

1. **运行体升级本身不是原因。** 第 2 行证明 0.1.5-rc.2 配旧插件集时四个通道全部正常。
   这也解释了为什么"升级后看不到对应 breakchange"——**运行体侧确实没有这个 breakchange**。
2. **原因在插件批次里。** 第 2 行与第 3 行运行体同版本、插件构建 sha256 也相同,
   唯一差别是插件集合;集合一换,四个通道同时失效。

补充:`memex` 在 0.1.2-rc.1 上本来就是 405(旧运行体下未注册),升到 0.1.5 旧插件集
后才变 200 —— 属于另一个独立的既存现象,不要和本缺陷混为一谈。

另附硬件事实:`guard`/`clock` 两个半区的构建在本机与 devbox **逐字节相同**
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

## 未定根因与后续方向

原因已**定位到插件批次**,但批次内的具体元凶**尚未确定**,不做推测性结论。

下一步按组合二分:在 devbox 上逐个禁用本批次新升级/新启用的插件,每禁一个就用
同一个探针打一次 `POST /dsh-home-network-model-guard/check`,直到恢复 200。
优先顺序(按“最可能影响 Host 路由/服务装配”排):

1. `dsh-opencode-session-header`(在 Host 进程全局 patch `fetch`)
2. `@byted/dsh-traex-bridge@0.1.15`(devbox 独有启用,且带 bundle patch:
   插入 `llm-traex-bridge`、覆盖 `agent-default-model`、新增 `web.searchProvider`)
3. `dsh-cockpit-bridge@0.4.0`(新升级,自带上报路由)
4. `dsh-better-sidebar@0.19.1`

一个需要重点验证的假说:`connection` 服务的 loader 条目注入 `webRuntime`
且 channel 是**惰性注册**的,因此只要批次里有一个条目在装配阶段影响了
`connection`/`webRuntime` 的激活顺序或失败传播,后面所有插件的
`ctx.inject(['connection'], …)` 回调就**一次都不会执行,且不报错**——
这与"四个通道同时失效、日志无任何错误"的观测完全吻合。

## 影响评估(不要夸大)

- 受影响的是**浏览器侧**:出口守卫的设置页配置显示与模型选择告警、系统时钟显示;
  `dsh-memex` 与 `dsh-session-links` 用的是同一条通道,大概率同样拿到不到数据
  (未逐项点开验证,不在此断言)。
- **host 侧的出口门禁不受影响** —— 它在 Host 内直接解析 Geo 并独立地对
  `blocked`/`unknown` fail closed,不依赖这条 RPC。
- Pet 与 worktree-session 注册的是**自有 HTTP 路由**(不是 Connection RPC),
  实测正常。
- 远端 `subscriptions` 的 `/subscriptions-auth` 同样是 405,所以它的设置页里
  **卡片结构来自客户端常量而非 RPC**;此前把它当作"subscriptions 正常"的证据
  属过度解读,已更正。
- 因此这是**功能退化**,不是数据安全或 Pet 可用性问题;但它是一处**真实回归**
  (已用升级前基线证伪"本来就这样"),且在 devbox(目标运行环境)上稳定复现。
