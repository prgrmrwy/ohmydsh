# dsh-system-clock

在 Web 设置面板**最底部**显示 **DSH 主机系统**的实时时钟：24 小时制、按主机时区（含 DST）渲染，并带上主机时区名、当前 UTC 偏移和主机 hostname。解决「多台设备、不同时区、经 SSH 隧道访问同一台 DSH」时，浏览器本地时间 ≠ 主机时间的问题——这里的时钟永远显示 DSH 跑在哪台机器、现在几点。

## 为什么

浏览器 `new Date()` 取的是**浏览器所在设备**的时间。通过 SSH 隧道从另一时区的机器访问 GUI 时，这东西毫无意义。官方设置页没有能一眼看到「DSH 主机墙钟时间」的位置。本插件让 host 半区采样主机时钟（epoch + IANA 时区 + UTC 偏移 + hostname），web 半区按主机时区渲染成走秒的 24h 时钟。

## 行为

- 设置面板 → 导航最底部「系统时钟」：粗体 `HH:MM:SS`（24h、零填充、无 AM/PM）、日期（`YYYY-MM-DD 周X`，星期随界面语言）、时区行（`Asia/Shanghai (UTC+08:00)`）、小字 `DSH 主机 · <hostname>`。
- 时间真相源 = **host 进程**采样（`/dsh-system-clock` Connection RPC channel，`authority: loopback`），客户端只做一次采样 + skew 引擎本地每秒 tick，用 `Intl.DateTimeFormat(..., { timeZone: 主机时区, hour12: false })` 渲染——DST 切换天然正确，无需客户端理解时区规则。
- 每 60s 与页面重新可见时重采样校准（覆盖时钟漂移与主机 DST 切换）；重采样失败保留旧值继续走时。
- 采样不可达时显示「主机时钟不可用」降级态并周期重试，**绝不**静默回退到浏览器本地时间（那在多机场景会误导）。
- 只读、零配置：不发起外部网络请求、不读写凭据/会话/文件、不改官方 DOM/class，channel 只返回时间/时区/hostname 这类无害主机事实。

## 机制（升级后需回归）

- Host：`src/index.ts` 复用 dsh-plugin-subscriptions `/subscriptions-auth` 的通道接线——`ctx.inject(['connection'])` 内 `connection.rpc.handle('/dsh-system-clock', ..., { authority: 'loopback' })`；headless 无 `connection` 时静默不注册，插件照常加载。
- Client：`src/client/index.ts` 注册官方 `settings.section`（id `system-clock`、order 300 → 导航末尾）；`src/client/clock-engine.ts` 是纯 skew 引擎（可注入 fetch/now/locale/timers，可单测）；`src/client/section.tsx` 只做 React 接线与渲染；`src/client/clock-locales.ts` 是 zh/en 词典。
- 构建形态与 dsh-session-title-copy 一致：tsdown 产出单文件 client bundle（`window.__ModuleLoader__.load` 手卷），host 半区 tsc 产出 ESM。

## 安装

经 ohmydsh manifest（`system-clock`，source: local）启用，`dsh build` 物化；重启 DSH 后生效。卸载/禁用：manifest `enabled: false` + sync，无持久化数据。

## 开发

```bash
npm run typecheck   # host + client 双项目
npm run build       # tsc(host) + tsdown(client bundle)
npm test            # vitest（formatter / engine / host-time / wiring，无浏览器）
```

peer 依赖：`@deepseek-ai/cordis`、`dsh-client-runtime`、`dsh-client-connection`、`dsh-client-locale`、`dsh-client-ui-settings`、`react`。
