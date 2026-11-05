# Changelog

## 0.1.0 — 2026-11-05

- 首次独立发布：npm 包 `dsh-cockpit-worktree-open-shim`，独立镜像 `prgrmrwy/dsh-cockpit-worktree-open-shim`。运行时行为与 ohmydsh 内的 local 0.1.0 相同。
- 把 `dsh-cockpit-bridge`（>=0.4.0）的 `cockpitBridge.editorOpen` 注册给 Worktree Session 的 `worktreeSession.openHandler`；任一端缺失时静默无效，Worktree Session 回落 `vscode://file`。
- 补齐发布元数据、`prepare`/`prepack`、CHANGELOG 与包内 `release.yml`（npm Trusted Publishing + GitHub Release 附 npm 同版 tgz）。
