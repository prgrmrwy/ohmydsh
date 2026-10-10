# dsh-cockpit-worktree-open-shim

[English](README.md) · 简体中文

<!-- problem -->
没有这个 shim 时，远程机器上 Worktree Session 的「在编辑器中打开」会退回只能指向本机的 `vscode://file/` 链接，打不开那份 worktree。本 shim 把 worktree 路径交给 dsh-cockpit 的远程编辑器能力，让编辑器在正确的机器上打开。

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

- 需要 `dsh-cockpit-bridge >= 0.4.0`（本仓当前 pin 0.6.4）；旧版 bridge 不提供该服务，shim 会静默不生效。
- 宿主机需要安装 VS Code Remote-SSH，并能用 Cockpit 设备登记的 SSH config alias 连接目标设备。
- 未安装 Remote-SSH 时 URI 可能被静默丢弃；包含点号的目录名可能被 VS Code URI handler 判断为文件。

## 移除

<!-- section: removal -->
本 shim 连接两端：`dsh-cockpit-bridge` 的 **`cockpitBridge.editorOpen` 服务**，与 `dsh-worktree-session` 的**打开行为扩展点**（`worktreeSession.openHandler`）。两端互不引用，shim 是两者唯一的交汇点。

随时都可以移除；当你不再使用 dsh-cockpit 远程编辑器，或任一端原生提供该集成时，就应当移除。从 `dsh.yaml` 删除或禁用 `cockpit-worktree-open-shim`，运行 `dsh build` 并重启 DSH web。移除后：

- Worktree Session 恢复默认 `vscode://file/` 行为；
- dsh-cockpit-bridge 的会话已读确认、pending snapshot 等既有功能不受影响；
- 两端无需任何源码或配置迁移。
