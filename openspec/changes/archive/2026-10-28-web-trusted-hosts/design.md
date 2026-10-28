## Context

官方 `dsh web` 的 `/api` Host/Origin fence 只认回环、LAN IP 字面量和 `--trusted-host`。经外部认证层用域名访问本机 DSH 时，必须每次启动都带上该参数；ohmydsh 启动器是唯一启动入口（含 `dsh restart`），由它负责最稳。

## Decisions

- **用本机环境变量 `DSH_TRUSTED_HOSTS`，不放公开 `dsh.yaml`。** 域名与入口拓扑是单台机器的部署事实；本仓库公开，写进 manifest、备注或 OpenSpec 即公开。最初实现过 `web.trustedHosts`，在提交前撤回。
- **不放私有 overlay。** `dsh.yaml.local` 只允许追加 customization，`web` 段被明确拒绝（见 private-overlay 文档）；为一个启动参数放宽 overlay 边界不值得。`.env.local` 已由启动器加载且 gitignored。
- **只校验形状，规范形式交给官方。** 启动器拒绝 URL、路径、userinfo、空端口等明显错误，避免 restart 停掉健康 Host 后官方再报错起不来；更细的 canonical 判定仍由官方 connection 负责，不复制其规则。
- **不经 sync 物化。** 参数只影响 Host 进程 argv，不改 `$DSH_HOME` 文件，因此 `dsh build` 幂等性不受影响，改动只需 `dsh restart`。

## Risks / Trade-offs

- 设置后所有 Connection RPC channel 都可经所列域名访问；前面必须另有认证层，DSH 自身浏览器 cookie 仍生效。两条依赖回环边界的插件备注已注明。
- 变量只在本机，换机器或重装需重新配置；这是有意为之。
