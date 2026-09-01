# Changelog

## 0.1.0 — 2026-09-01

- 首个版本：Web 设置面板最底部新增「系统时钟」章节，实时显示 **DSH 主机系统** 的 24 小时制时钟与主机时区（IANA 名 + UTC 偏移）+ 主机 hostname。
- 数据链路：host 半区经通用 Connection RPC 通道 `/dsh-system-clock`（`authority: loopback`，接线方式同 dsh-plugin-subscriptions `/subscriptions-auth`）暴露只读 `now` 采样（主机 epoch / IANA 时区 / UTC 偏移 / hostname）；web 半区一次采样 + skew 引擎本地每秒 tick，`Intl.DateTimeFormat({ timeZone: 主机时区, hour12: false })` 渲染，DST 正确；60s 周期 + 页面可见性变化时重采样校准。
- 边界：时间真相源为主机而不回退浏览器时间；采样不可达显示「主机时钟不可用」降级态；只读、零配置、无外部网络外呼、不改官方 DOM/class；channel 只回传时间/时区/hostname 无害事实。
- 工程：`clock-engine.ts` 纯 skew 引擎（可注入 fetch/now/locale/timers 单测）、`host-time.ts` 纯主机事实解析、zh/en 词典走官方 locale 服务、设置章节走官方 `settings.section` 槽（id `system-clock`、order 300）。
- 对应 openspec change `settings-system-clock`、backlog B019。
