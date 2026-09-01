# settings-system-clock

## Why

用户在多台设备（可能处于不同时区）通过 SSH 隧道访问同一台运行 DSH 的主机。浏览器本地时间 ≠ DSH 主机时间，设置页里没有地方能一眼看到「当前 DSH 到底运行在哪个机器、现在几点」。希望设置面板底部（或侧边）有一个 24 小时制、带时区标识的时钟，显示的是 **DSH 主机系统** 的时间，而不是浏览器所在设备的时间。

## What Changes

- 新增本地 Host+Web 包 `dsh-system-clock`（目录 `packages/system-clock/`）：
  - **Host 半区**：通过通用 Connection RPC channel `/dsh-system-clock` 暴露端到端 `now` 采样，返回主机的 epoch 毫秒、主机 IANA 时区（`Intl.DateTimeFormat().resolvedOptions().timeZone`）、主机当前 UTC 偏移（分钟）与主机 hostname。采用与 dsh-plugin-subscriptions `/subscriptions-auth` 完全相同的通道接线（`connection.rpc.handle(..., { authority: 'loopback' })`），headless 无 `connection` 时静默跳过。
  - **Web client 半区**：注册官方 `settings.section` 槽（id `system-clock`，高 order 使其出现在设置导航**最底部**），渲染一个实时主机时钟页：粗体 24h `HH:MM:SS`、日期（星期几）、时区行（`Asia/Shanghai (UTC+08:00)`）与一行小字「DSH 主机 · <hostname>」。
- 时钟引擎：客户端拿到一次 `now` 采样后与 `Date.now()` 求 skew，本地每秒 tick 渲染；通过 `Intl.DateTimeFormat(..., { timeZone: 主机时区, hour12: false })` 在**主机的** IANA 时区内呈现，秒级跨时区正确。每 60s 与页面重新可见时重同步 skew（覆盖漂移与主机时区 DST 切换）。
- 降级：RPC 不可用（未走 web profile、channel 未注册等）时显示明确「主机时钟不可用」状态并周期重试，**不**静默回退到浏览器本地时间（那会误导多机场景）。主机没有 IANA 时区名时回退为 `UTC±HH:MM` 标签。
- **BREAKING**：无。不修改 DSH core；走官方 settings.section 槽与通用 connection RPC 通道，只读、无网络外呼、无凭据面。

## Capabilities

### New Capabilities
- `settings-system-clock`: Web 设置面板底部新增 DSH 主机系统时钟章节——24 小时制时刻（按主机 IANA 时区解析，覆盖 DST）、日期/星期、时区名与当前 UTC 偏移、主机 hostname；数据来自 host 半区的一次性时间采样经本地 skew 引擎实时滚动。

### Modified Capabilities
<!-- 无。 -->

## Impact

- 新增 `packages/system-clock/`（host 入口 + Web client bundle）；`dsh.yaml` 增加 local customization 条目；需 `dsh build` 物化并重启 DSH 后由 client-modules scanner 加载。
- peer/dev 依赖在 rc.2 基线内：`@deepseek-ai/cordis`、`dsh-client-runtime`、`dsh-client-connection`、`dsh-client-ui-settings`、`dsh-client-locale`、`dsh-client-ui-slots`、react。
- 信任面：host 暴露的仅是「当前时间/时区/hostname」这类无害主机事实，channel 以 `authority: 'loopback'` 注册（SSH 隧道下回环访问也满足）；无文件/命令/模型能力。
