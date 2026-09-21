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

## 关键对照:本机正常,devbox 不正常

| | 本机 | devbox |
|---|---|---|
| 运行体 | 0.1.5-rc.2 | 0.1.5-rc.2 |
| `guard/lib/client.js` sha256 | `59c688b1adc1ea1f…` | `59c688b1adc1ea1f…`(**逐字节相同**) |
| `guard/lib/index.js` sha256 | `137084fe79c19998…` | `137084fe79c19998…`(**逐字节相同**) |
| `guard/lib/client.js` | 同上 | 同上 |
| `POST /dsh-home-network-model-guard/check` | **成功**(唯一非 2xx 是无关的 codex 404) | **405 ×5** |
| console 警告 | 无 | 有 |

`dsh-system-clock` 两个半区的 sha256 同样逐字节相同。

**所以不是插件代码差异,也不是运行体版本差异**,而是组合/环境差异。

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

根因**尚未确定**,不做推测性结论。已知的差异面只有组合:

- devbox 启用了 `@byted/dsh-traex-bridge@0.1.15`(本机未启用);
- devbox 是新的插件批次,本机仍是旧批次(且仍带着已移除的三件套);
- 其余官方 `connection` 相关条目两边相同。

下一步建议按组合二分:从 devbox 当前组合里逐个禁用 devbox 独有/新升级的插件
(优先 `dsh-cockpit-bridge@0.4.0`、`dsh-opencode-session-header`、
`@byted/dsh-traex-bridge`),复现一次 `POST /dsh-home-network-model-guard/check`
是否恢复 2xx。

## 影响评估(不要夸大)

- 受影响的是**浏览器侧**:出口守卫的设置页配置显示与模型选择告警、系统时钟显示。
- **host 侧的出口门禁不受影响** —— 它在 Host 内直接解析 Geo 并独立地对
  `blocked`/`unknown` fail closed,不依赖这条 RPC。
- Pet、worktree-session、subscriptions 各自注册 HTTP 路由,均正常(见
  `plugin-batch-acceptance.md`)。
- 因此这是**功能退化**,不是数据安全或 Pet 可用性问题;但它是一处**真实缺陷**,
  且在 devbox(即目标运行环境)上稳定复现。
