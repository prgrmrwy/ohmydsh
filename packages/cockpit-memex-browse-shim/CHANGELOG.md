# Changelog

## 0.2.0 — 2026-11-05

- 首次独立发布：npm 包 `dsh-cockpit-memex-browse-shim`，独立镜像 `prgrmrwy/dsh-cockpit-memex-browse-shim`。运行时行为与 ohmydsh 内的 local 0.2.0 相同。
- 把 `dsh-cockpit-bridge`（>=0.6.1，生产 pin 0.6.4）的 `cockpitBridge.forwards` 接给 dsh-memex 的 `dshMemex.browseAddress`：按端口单飞 acquire，只交付 ready 的当前地址；只有 `CockpitForwardsError` 的 `local-device` 才回落 localhost，其它错误原样传播；已接线的 bridge 消失后保持 fail-closed。
- 不兼容旧 `portForward` 契约：不要把 shim 0.1.x 与 bridge 0.6.x 混用，回滚 shim 时要同时回滚 bridge。
- 补齐发布元数据、`prepare`/`prepack`、CHANGELOG 与包内 `release.yml`（npm Trusted Publishing + GitHub Release 附 npm 同版 tgz）。
