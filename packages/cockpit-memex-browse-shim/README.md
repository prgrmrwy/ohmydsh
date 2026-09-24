# dsh-cockpit-memex-browse-shim

部署侧专用适配器：把 `dsh-cockpit-bridge` 暴露的端口发布能力注册给 `dsh-memex` 的通用浏览地址扩展点，使 DSH 跑在 VM/devbox 上时，卡片浏览能从宿主机浏览器访问。

```text
dsh-cockpit-bridge ──provide──▶ shim ──register──▶ dsh-memex
      不知道 memex                              不知道 cockpit
```

## 为什么独立成包

dsh-memex 是通用记忆插件，不应知道 dsh-cockpit；dsh-cockpit-bridge 也不应知道具体消费方。两端的全部耦合只存在于本 shim，便于独立升级和彻底移除。

一个约定的服务名同样属于提供方，因此即使"只认一个字符串"也不放进 dsh-memex。

## 行为

- 无顶层 `inject`，运行时监听两端服务出现/消失，支持任意加载顺序。
- 以完整 dotted name `ctx.get('cockpitBridge.portForward')` 读取 bridge 服务，禁止 `ctx.get('cockpitBridge').portForward`（会被 traceable proxy 重新路由并强制 inject）。
- 每个库一个 channel（`memex-browse-<库名>`）：内核一进程一库，共用 channel 会发布错库。
- 先 `register(channelId, port)` 声明可发布，再 `publish(channelId)` 取地址；失败原样上抛，由 dsh-memex 呈现原因。
- 不校验、不改写地址、不重试、不持状态、不缓存。

## 前置

- `dsh-cockpit-bridge` 需提供 `cockpitBridge.portForward`（cockpit 仓 change `device-port-forward-seam`）。
- 该能力发布前，本 shim 安全无效：dsh-memex 回落本机地址，本机直连场景不受影响。

## 移除

删除 `dsh.yaml` 中本条目 → `dsh build` → 重启。两端均无需迁移。
