# Host 停机握手

[English](README.md) · 简体中文

受管 `dsh web` 启动会通过 [no-pet-stop-profile.mjs](./no-pet-stop-profile.mjs) 生成的官方 `--patch` overlay 加载 [no-pet-stop-plugin.mjs](./no-pet-stop-plugin.mjs)。该插件只导出普通 Cordis 的 `name`、`inject`、`apply`，不启动应用、不 import Pet。显式 `DSH_BIN` 运行体须自行提供带鉴权的停机协议。

官方 `appReady` 之后，插件等待 Loader 收敛，再对真实完整树出具证明。它检查每个条目，包括 disabled、failed 和无 fiber 的条目；展开后的 group/include 必须与实际条目一一对应。固定版本官方 preset registry 的公开 `livePresetMounts(rootFiber)` 会补上不出现在 `loader.entries()` 下的常驻与保留 revision；同时检查当前 preset 声明，preset 清单损坏即拒绝证明。官方 Host runner 可在 Loader 之外挂载原始子 fiber，其公开 `dynamicCordisRunner.inventory()` 中的任何条目都视为未知载体，其 package/retract 事件阻止之后降级。只接受已识别的静态官方模块和上述已理解的载体；任何已配置的 Pet、未解析载体、失败的启用条目、未知模块或不支持的 DSH 版本，都会阻止发布 descriptor 和注册路由。

[no-pet-known-modules.json](./no-pet-known-modules.json) 记录 0.2.1-rc.5 的精确模块清单：来自官方 base/Web bundle patch、其四个 preset patch，以及 directory-picker-auto 固定的 native/browse 对。这是兼容名册，不是按包名前缀推断。更换 DSH pin 时须对照官方源码重新审查并重跑完整 profile 验收。任意第三方插件和未知载体在完整性可证明之前，有意要求显式 legacy 维护。

可证明无 Pet 的 Host 不拥有 Pet 资源，因此准备阶段记录的是“当前确实不存在”，而不是声称排空了资源。它发布同样的私有 descriptor `run/dsh-pet-stop/<port>.json`（目录 0700、文件 0600），使用 `connection.authenticatedUrl()` 与新的 boot 身份。精确路由 `/dsh-pet/api/prepare-stop` 使用 Connection 的签名 cookie 围栏，并精确校验回环 Host 与 Origin。`prepare`、`status`、`resume` 使用共享的 v1 nonce/PID/boot/deadline 协议，每次请求都重新读取真实树。Loader 拓扑变化会在 Pet 认领前撤下 noPet 路由；fiber phase、插件和 volatile 更新会使旧票据失效。dispose 只删除本 producer 的 descriptor inode 与路由。只有当前 Host 从未暴露过 Pet 或未知模块时，重新加载 producer 才能证明新的完整树；一旦观察到，该状态在 Host 生命周期内保持：Cordis 先从 registry 移除正在 dispose 的 fiber、再等待卸载，所以删除 Loader 行不能证明其资源已释放。这样的 Host 需要重新启动或显式 legacy 维护；旧票据不会跨越 producer 的 boot 身份。

[pet-stop.mjs](./pet-stop.mjs) 用私有 URL 换取 cookie，执行 prepare，并在每次发信号前立即重新鉴权查询 `status`。status 必须仍为 `prepared`，且操作 nonce、PID、boot 身份、prepared 时间与过期时间全部一致；HTTP 前后都复核完整 OS 进程身份。旧的未生产的 `dsh-host-launch` 快照读取器已删除。显式 legacy 参数只在协议 descriptor 不存在时允许维护；descriptor 格式错误或鉴权交换失败绝不回退到 legacy。带该参数重启后，必须成功读到新 descriptor 并通过鉴权的 `active` status，才报告协议已加载；这次维护停止不算排空证据。

## 验证

常规源码回归包括私有 overlay 检查与带鉴权的消费者测试：

```sh
node --test tests/launcher-no-pet-profile.test.mjs tests/launcher-pet-stop.test.mjs
```

真实 profile 验收是独立的构建产物通道 [launcher-no-pet.official.mjs](../../tests/launcher-no-pet.official.mjs)。它需要一个完整构建的官方 0.2.1-rc.5 运行体目录，其包解析须包含 `@deepseek-ai/dsh`。缺少依赖图会明确失败，所有负对照都不跳过。它使用真实官方 `runProfile`、profile patch、Loader、appReady、WebServer、Connection 与 preset 代际，只替换进程探测与信号；不停止真实 Host，不发模型请求或飞书消息。

```sh
DSH_TEST_OFFICIAL_RUNTIME=/absolute/path/to/built/launcher \
  node --test tests/launcher-no-pet.official.mjs
```

覆盖范围包括：完整发行的 base+Web profile 与 presets 无需 legacy 即可停止、成功展开的 group/include 树、Pet 导入失败、Pet 声明被禁用、活跃的未知载体、保留的旧 preset revision、cookie/Host/Origin/nonce/PID/boot 拒绝、resume 使票据失效以及拓扑变化。它不能替代 Pet producer 的 H2 真机排空验收或 Windows 运行体验证。

## 受管非 web profile Host

`DSH_PROFILE=<profile> dsh -p <port>` 受管启动 `web` 以外的 profile Host（例如 `DSH_PROFILE=superagent dsh -p 3082 --foreground`），与 `dsh web` 共用精确 pin、Host 运行体解析、归属探测和启动历史。Host 参数为 `<profile> --port <port> --no-open …`，归属判定按该 profile 精确匹配：web 探测不会认领非 web 监听者，反之亦然。不设置 `DSH_PROFILE` 时，`web` 行为不变。

限制：

- 必须显式 `-p/--port`，默认端口属于 web Host；`$DSH_HOME/profiles/<profile>/cordis.yml` 必须已存在。
- 只托管启动。不加载 no-pet-stop patch（自定义 profile bundle 过不了其静态模块认证），因此不发布停机 descriptor，`dsh stop/restart` 在发出任何信号前拒绝。请用该 Host 自己的管理脚本停止；明确的人工维护可用 `--allow-legacy-restart`，此时没有 Pet drain 保证。
- `build`、`-b`、`reset`、`plugin-update`、`doctor` 一律拒绝，启动路径也跳过 `autoUpdate`：它们都会按 `DSH_PROFILE` 运行 sync 或插件维护，把 ohmydsh 定制写进另一个 profile。worktree 预览只支持 `web`。`history` 仍可用，每条记录都带 `profile=<profile>`。
- 进程 scope 隔离由调用方负责，launcher 不加 detach 逻辑。在 DSH 会话内启动的 Host 属于该会话 Host 的子进程 scope；调用方需自行包一层，例如 `systemd-run --user --scope … dsh -p 3082 --foreground`。后台模式与 web Host 共用 `$DSH_HOME/dsh.log`。

```sh
node --test tests/launcher-managed-profile.test.mjs
```
