# Design

## Context

Pet 的每条管理路由都有两层校验（`packages/dsh-pet/src/index.ts` 的注册循环，以及 `host/http.ts`）：

1. `withBrowserAuth` 调用官方 `ctx.connection.requestRejection`。它校验 `Host` 是回环或在官方 `trustedHosts` 内、`Sec-Fetch-Site` 不是 cross-site、`Origin` 与 `Host` 同源，最后校验浏览器 cookie。
2. `petRoute` 内的 `isTrustedRequest`：`Host` 必须是回环，`Origin` 存在时必须同源。

第 2 层是纵深防御：即使官方 fence 配置放宽，Pet 也不会跟着放宽。DSH 0.2.0-rc.2 的 `HostConnectionService.trustedHosts` 在类型上是 private，Pet 拿不到官方列表。启动器会把 `.env.local` 的全部变量带进 Host 进程环境。

## Goals / Non-Goals

**Goals:**
- 部署方能只为 Pet 显式放行指定域名，并且不削弱第 1 层。
- 拒绝原因能在 Pet 界面上看到。

**Non-Goals:**
- 不让设置页在非回环页面上可保存（core 客户端按 `location.hostname` 判定，见 proposal）。
- 不改启动器：不新增启动器侧校验，也不把变量转成参数。
- 不改官方 fence 拒绝时的纯文本 `forbidden` 响应。

## Decisions

- **独立变量 `DSH_PET_TRUSTED_HOSTS`，不复用 `DSH_TRUSTED_HOSTS`。** 仓库已有先例（settings-system-clock spec）：配置 trustedHosts 不得默认放宽依赖回环的 channel，必须单独做安全决策。复用官方变量会让"开放公网入口"自动等于"开放 Pet 管理面"。代价是公网部署要多写一行。另一个方案是读取官方 private 字段 `trustedHosts`，但这依赖非公开 API，升级时会静默失效，所以不采用。
- **读取时机：首次需要时从 `process.env` 解析一次并缓存；Host apply 时主动触发一次，非法值在启动日志里立刻可见。** 修改变量需要重启 Host，与官方 trusted host 一致。解析函数接受注入的 env，供测试使用。
- **格式与匹配沿用官方语义。** 逗号或空白分隔；每项是 bare `host[:port]`（主机名、IPv4、带方括号的 IPv6），大小写不敏感。带端口的项匹配完整 `host:port`；不带端口的项只按主机名匹配，任意端口都算。
- **非法项让整个变量失效（只认回环），而不是跳过该项。** 这里是安全边界：写错时宁可 Pet 不可用、日志里报错，也不能部分生效、让人误以为配置正确。不进入 degraded，因为回环访问仍然完整可用。
- **Origin 规则：** 回环保持现状（回环名之间互认）。受信任域名要求 `new URL(origin).host` 与 `Host` 完全一致（含端口），与第 1 层相同。缺少 `Origin` 时保持现状放行：浏览器的 POST 总会带 `Origin`，第 1 层还另有 cookie 与 `Sec-Fetch-Site` 校验。
- **403 信封：** 在现有响应体里加 `ok: false`，保留 `error: 'INVALID_REQUEST'` 以兼容；`message` 说明允许的来源。客户端解析逻辑不用改，现有 `ok === false` 分支会显示 `message`。

## Risks / Trade-offs

- [放行后 Pet 管理面（导入 Skill、改配置、驱动 Invocation）对该域名开放] → 前提是前面另有认证层（本机部署是 Cloudflare Access 加代理自行校验 JWT），第 1 层 cookie 仍生效。README 写明这一前提，变量默认不设置。
- [变量只在本机，换机器需要重新配置] → 有意为之。域名属于部署事实，公开仓库不承载具体值。
- [只配了 Pet 变量、没配官方变量] → 请求会先被第 1 层拒绝，表现与现在一样。README 写明两者都需要。

## Migration Plan

1. 实现并通过测试后执行 `dsh build`，连续第二次应无变化。
2. 需要公网访问 Pet 的机器在 `.env.local` 加 `DSH_PET_TRUSTED_HOSTS=<域名>`，执行 `dsh restart`。
3. 回滚：删除该行并重启，Pet 恢复只认回环。代码回滚就是 revert 本 change。
