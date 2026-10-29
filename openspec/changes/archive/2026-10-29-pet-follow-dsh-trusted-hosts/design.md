# Design

## Context

见 proposal.md。官方 `HostConnectionService.trustedHosts` 在类型上是 private，Pet 读不到官方列表；但 Pet 的每条管理路由都经 `withBrowserAuth` 调用公开的 `requestRejection`，它的放行结论本身就是"这个 Host 被 DSH 信任且已认证"。

## Decisions

- **用 fence 的放行结论，不读官方列表。** `authorizeBrowserRequest` 放行时把该 `IncomingMessage` 记入模块内 `WeakSet`；`isTrustedRequest` 对非回环 Host 只在请求在集合里时受理。不依赖 private 字段，也不依赖 ohmydsh 启动器的环境变量，单独安装 Pet 并直接传 `--trusted-host` 同样可用。WeakSet 随请求对象回收，不泄漏。
- **备选：Pet 层只做同源检查、Host 完全交给 fence。** 不采用：一旦某条路由漏包 fence，Pet 就对任意 Host 放行。现方案在漏包时退回只认回环，不需要额外的"每条路由都包了 fence"测试来兜底。
- **备选：读 `DSH_TRUSTED_HOSTS` 环境变量。** 不采用：那是 ohmydsh 启动器约定，直接传 `--trusted-host` 的部署会失效。
- 回环规则、Origin 规则、403 信封结构不变。

## Risks / Trade-offs

- [`--trusted-host` 一开，Pet 管理面随之开放] → 与会话、shell 等更大的能力同一道门，前面必须另有认证层；README 写明。
