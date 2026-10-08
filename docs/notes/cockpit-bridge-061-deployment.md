# Bridge 0.6.1 正式发布与部署（2026-10-08）

DSH 0.2 的原生工作台在认证成功后仍可能整页显示 `Failed to load plugins`。本次真实浏览器捕获了 bridge 0.5.2 访问已删除的 `uiSession.pendingInteractions.subscribe` 的异常，以及 TraeX 0.1.15 等待已删除的 `settingsScope`。HTTP 200 不是 client boot 的验收证据。

正式发布：https://github.com/prgrmrwy/dsh-cockpit/releases/tag/dsh-cockpit-bridge-v0.6.1

发布源码 main/tag：`6c7ffbaaab0b05f2f2483d498a68a04abf7ea3a7`。包名 `dsh-cockpit-bridge-0.6.1.tgz`，大小 34704 bytes，SHA256 `097be558ec03248e27b08b6a336b91262a83f47d73039f317e1c125b105c8fbf`。公开下载字节与验收包一致；不再依赖临时 file: 验收包。Cockpit build/typecheck/lint/test 与 GitHub CI 均通过。

本仓正式 manifest 精确 pin 0.6.1。Mac 和 devbox 的私有 overlay 使用已审查的 TraeX 0.1.16；内部包来源仍仅存于私有 overlay。四台设备（Mac、devbox、WSL、VM）的 bridge 均安装 0.6.1，各自连续 sync 的第二次均为 no changes。未改浏览器执行真实页面启动：四台均无插件启动失败页；Mac 的 SSH/认证/聚合状态 READY。

WSL 与 VM 仍保留 DSH 0.1.5；本轮不因更新 bridge 隐式迁移 core 或会话格式。VM 的 TraeX 0.1.15 是明确保留的兼容例外，升级到 0.1.16 需要先将 DSH 迁到 0.2，已请求用户确认。它不属于已经完成的 0.2 部署。旧版本的历史审查、回滚说明与测试 fixture 不代表当前安装 pin。

0.6.1 继承 0.6 的 `cockpitBridge.forwards`，没有恢复旧 `cockpitBridge.portForward`。旧消费者的独立迁移不在本轮插件启动与发布验收范围，不能将页面启动成功解释为旧消费者功能通过。

ohmydsh 根测试在 Mac 首轮因执行环境 PATH 缺 `/usr/sbin` 而有四个 lsof/停止路径失败；补齐 PATH 后重跑相关两文件全部 19 tests 通过，其余首轮 315 pass/2 skip。源码未为环境问题修改停止逻辑。部署均保留配置备份；临时回环下载代理和 SSH 转发在验收后清理。
