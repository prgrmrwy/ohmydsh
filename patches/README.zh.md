# patches/ — 纯 composition 片段与覆盖

[English](README.md) · 简体中文

<!-- problem -->
有些 DSH 调整完全不需要代码，只需要改 composition：启用某工具行、调整某项配置，或绕过某个运行体缺陷。这个目录存放这类 loader patch 片段，让这些调整保持声明式、可审查、可移除。

文件名 `<id>.yml`，内容为 loader patch 行（patch-list YAML，`!!js` 允许）。

两种用途：

1. **纯调优片段**：无代码、只改 composition（如启用某工具行、调整配置）；
2. **对 remote 包的覆盖**：个人配置覆盖片段，按 id 与 remote 定制对应（如 `cost-meter.yml` 会覆盖 cost-meter 的配置行）。

sync 按 manifest 顺序将 enabled 的片段应用到 profile 的 `cordis.patch.yml`，维护自身生成区段和显式所有的键，保留其他运行时配置。`connection-webserver.yml` 用纯 composition 修复 DSH 0.1.5 的 Connection RPC channel 注册缺陷；其退休条件记录在对应的 manifest 条目中。

`websocket-heartbeat.yml` 将官方 DSH gateway 的心跳间隔设为 5000ms；连续漏响应阈值仍为原厂两次，约 10–15 秒后断开。manifest 使用 `mergeConfig: true` 保留其他配置；禁用该条目后执行 `dsh build`，由 sync 撤回其所有的键。它不改变 SSH 保活或 Cockpit 健康检查。
