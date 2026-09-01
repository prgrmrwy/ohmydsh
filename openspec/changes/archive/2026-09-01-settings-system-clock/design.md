# settings-system-clock 设计

## 目标与关键约束

用户在**多台设备、不同时区**下通过 SSH 隧道访问运行 DSH 的主机时，需要一眼看到「DSH 主机系统现在几点」，与浏览器所在设备无关：

- 时间真相源必须来自 **host 进程**（`Date.now()` epoch + 主机 IANA 时区），不能取浏览器本地时间。
- 24 小时制（无 AM/PM）、带时区名与当前 UTC 偏移。
- 实时走秒；秒级刷新不能每秒打一次网络。
- 落点：设置面板**底部**（设置导航列表最后一个条目，官方 `settings.section` 槽）。官方没有持久 footer 槽，页脚式常驻需 DOM 注入（脆弱、升级易碎）；置于导航底部是官方槽内对「底部」最稳健的解释。

## 架构

### Host 半区（`src/index.ts` + `src/host-time.ts`）

复用 dsh-plugin-subscriptions 已在生产验证的通用 RPC 通道接线：

```ts
ctx.inject(['connection'], (ctx) => {
  const connection = ctx.get('connection')
  ctx.effect(() => connection.rpc.handle(
    CHANNEL, /* '/dsh-system-clock' */
    async (endpoint, payload, signal) => dispatch(endpoint),
    { authority: 'loopback' },
  ), 'dsh-system-clock: /dsh-system-clock rpc channel')
})
```

- `connection` 不进插件 `inject` 数组（headless 组合无此服务），启动顺序不加约束。
- endpoint `now`：忽略 payload，返回
  ```ts
  { now: number; timeZone: string; utcOffsetMinutes: number; hostname: string }
  ```
  全部业务结果走 `RpcResult` 成功形状，handler 不 throw。
- 主机时区解析：`Intl.DateTimeFormat().resolvedOptions().timeZone`（Node 取 OS 时区）；为空/无法解析时退化为 `'UTC±HH:MM'` 形状。`utcOffsetMinutes` 用主机侧 `new Date(now).getTimezoneOffset()`（早于 UTC 为负数）；`hostname` 用 `os.hostname()`。

### Client 半区（`src/client/*`）

- 注册设置章节：
  ```ts
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'system-clock', order: 300,
    label: () => t('nav'), inject: injected,
  }, SystemClockSection))
  ```
  order 300 > 官方通用(0)/模型(10)/插件(15)与订阅(90)，保证出现在导航最底部。
- `inject = ['slots', 'connection', 'locale']`；`connection.rpc.call(CHANNEL, 'now', {})` 取采样。
- **skew 时钟引擎**（`src/client/clock-engine.ts`，纯函数可测）：
  - `skew = sample.now - Date.now()`（首次成功调用时计算）。
  - 每秒 tick：`renderTime = new Date(Date.now() + skew)`。
  - 用 `Intl.DateTimeFormat(locale, { timeZone: hostTZ, hour12: false, ... })` 在**主机时区**内渲染时分秒与日期；`Intl` 对命名时区即输出 DST 校正后的墙钟时间，客户端不需要知道 DST 规则。
  - 引擎在每 60s 与 `visibilitychange`→visible 时重采样一次（重新 `rpc.call('now')`、重算 skew），覆盖时钟漂移与主机 DST 切换；重采样失败保留旧 skew，不打断显示。
- 展示（`src/client/section.tsx`）：
  - 粗体 `HH:MM:SS`（24h、零填充）；
  - 日期行 `YYYY-MM-DD 周X`；
  - 时区行：`<IANA 名> (UTC±HH:MM)`；IANA 缺失时只显示 `UTC±HH:MM`；
  - 小字 captio：`DSH 主机 · <hostname>`；
  - 未取到采样时渲染「主机时钟不可用」降级态并在下个 tick 重试，不显示浏览器时间。
- 样式：注入带 `data-plugin` 的 `<style>` 标签（同 subscriptions 做法），只作用于设置面板内容列；不触碰官方 class。

### 依赖与构建

- 与 session-title-copy 同构：tsdown（`window.__ModuleLoader__.load` banner）+ tsc host + vitest；client tsconfig `jsx: react-jsx`。
- tsdown external：`@deepseek-ai/dsh-*`、`@deepseek-ai/cordis`、`react`、`react/jsx-runtime`。
- `dsh.client` 声明 `platform: web`，`inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-connection']`。

## 关键取舍

1. **通道 vs Typert Remote vs webServer HTTP**：选通用 RPC channel——已被 subscriptions 生产验证、头尾两行接入、自带 `authority` 信任门、无需 manifest/codec 与 `reflect.get`。Typert 适合「服务化类型面」，此处一个只读采样不值得；HTTP 路由需额外 host webServer 信任织网，且同样要轮询。
2. **skew 引擎 vs 每秒 RPC**：秒级刷新走本地 tick，网络只在 60s/可见性变化时发生；跨时区正确性来自 Intl 的命名时区渲染而非服务端推送偏移。
3. **失败不静默回退浏览器时间**：多机场景下「浏览器时间」是最容易误导的值，降级态必须显式。
4. **hostname 属加量**：用户说「多台设备」，展示主机名用于区分机器（低成本、无隐私风险——仅主机名）。
5. **不引入配置项**：本节始终显示、无开关；保持最小面。

## 可测性

- `clock-engine.ts` 纯函数单测：skew 计算、24h 零填充格式化、`Intl timeZone` 下时刻渲染、IANA 缺失回退、`UTC±HH:MM` 标签。
- host 端 `parseSystemClockSample` 纯函数单测：timeZone 解析 + utcOffsetMinutes 计算 + hostname 提取（注入固定时间/时区桩）。
- wiring 用注入的 `rpc` face 做单测：成功采样 → 状态机进入 ready；失败 → unavailable 与重试计数。
