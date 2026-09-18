# dsh-cockpit-worktree-open-shim

部署侧专用适配器：把 `dsh-cockpit-bridge` 暴露的远程编辑器打开能力注册给 `dsh-worktree-session` 的通用打开行为扩展点。

```text
dsh-cockpit-bridge ──provide──▶ shim ──register──▶ dsh-worktree-session
        不知道 ws                              不知道 cockpit
```

## 为什么独立成包

Worktree Session 是通用插件，不应知道 dsh-cockpit；dsh-cockpit-bridge 也不应知道具体消费方。两端的全部耦合只存在于本 shim，便于独立升级和彻底移除。

## 行为

- 无顶层 `inject`，运行时监听两端服务出现/消失，支持任意加载顺序。
- 以完整 dotted name `ctx.get('cockpitBridge.editorOpen')` 读取 bridge 服务，禁止 `ctx.get('cockpitBridge').editorOpen`。
- 只把 worktree 绝对路径原样转交 bridge：不校验、不改写、不持状态、不重试。
- 任一端缺失或卸载时不生效；Worktree Session 自动回落 `vscode://file/` 默认行为。

## 前置条件与已知边界

- 需要 `dsh-cockpit-bridge >= 0.4.0`；旧版 bridge 不提供该服务，shim 会静默不生效。
- 宿主机需要安装 VS Code Remote-SSH，并能用 Cockpit 设备登记的 SSH config alias 连接目标设备。
- 未安装 Remote-SSH 时 URI 可能被静默丢弃；包含点号的目录名可能被 VS Code URI handler 判断为文件。

## 移除路径

从 `dsh.yaml` 删除或禁用 `cockpit-worktree-open-shim`，运行 `dsh build` 并重启 DSH web。移除后：

- Worktree Session 恢复默认 `vscode://file/` 行为；
- dsh-cockpit-bridge 的会话已读确认、pending snapshot 等既有功能不受影响；
- 两端无需任何源码或配置迁移。
