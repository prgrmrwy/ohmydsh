# 三端原生命令流程验收（2026-10-30）

**命令流程验收通过。** 三端最终验收同一提交 `93f01405d434c0bf758dfe8a85f25b2f0ca69834`，DSH pin 为 `0.2.0-rc.2`。此结论覆盖下表流程，不等于所有插件、真实终端关闭或桌面 UI 的全面认证。

| 环境 | 实际 Node | 全流程 | 原生启动器合同 |
|---|---|---|---|
| Linux 本机 | 24.20.0 | 通过 | 118/118，0 失败、0 跳过 |
| corp-mac-vm 原生 macOS | 24.16.0 | 通过 | 118/118，0 失败、0 跳过 |
| Windows PC（KEN）原生 Win32 | 临时 24.20.0 | 通过 | 118/118，0 失败、0 跳过 |

完整 POSIX 仓库回归在同一最终提交上为 **705 项、700 通过、0 失败、5 个既有跳过**。不得把局部零跳过扩写为全仓零跳过。

## 执行和复核范围

三端均使用独立 checkout、DSH_HOME、XDG 数据/配置/缓存、npm prefix 和非 3080 的测试端口。Windows 源码和依赖在 NTFS 上，由原生 Node、Git、PowerShell 和系统工具执行；验收驱动通过当前 WSL 通道调用原生工具，不把 WSL 执行结果作为 Windows 结果。完整 Windows 流程的 PATH 不含 Bash/sh，仅保留临时工具、Node、Git cmd、PowerShell 和临时 prefix。

最终提交通过以下检查：

1. 根锁定依赖初始化（强制 bootstrap 实际执行 npm ci），再次 bootstrap 健康跳过。
2. 在临时 prefix 中 npm link；从仓库外 cwd 调用已注册命令 help。完整 build/doctor/Host 流程执行的是该 bin 对应的同一 Node 入口。
3. 完整公开 manifest build 两次；第二次必须包含 `[sync] no changes — deployment already matches manifest`，且没有 applied-change 报告。没有删减 manifest 或禁用失败包。
4. `doctor --check` 和 `--profile web --dump-config` 均退出 0。
5. 在确认空闲的测试端口真实启动，查询归属为 owned；未认证请求为 401，使用该临时 Host 自己生成的认证链接后页面为 200，含 `__DSH_BOOT__`。认证值不写入本报告或记忆。
6. 真实 restart 后 PID 改变，认证页面再次通过；stop 后端口为空。Linux 在独立 systemd scope 内验证外部终端语义；不是重启当前会话所在 Host。
7. 独立 helper argv/cwd/exit 合同和完整原生启动器合同均通过，包括 Git 长路径回归。
8. 最后撤销各自临时 prefix 中的 link。独立审计再次验证最终 Git HEAD、受跟踪源码干净、成功阶段均位于最终快照之后、PID 变化、端口为空、临时 link 已移除和合同计数。

临时 Node、Git/Node 默认设置和普通 profile 没有替用户切换或覆盖；没有由本次验收 stop/restart 现役 3080，未让测试 Host 发起真实模型生成请求。临时 checkout/日志仍保留为本机恢复资料，不提交 raw 日志、生成产物、认证数据或完整驱动。

## 实际失败及对应修复

以下均为真实失败，最终通过不改写早期结果：

- **macOS fixture 的逻辑路径比较**：`/var` 与实际 cwd `/private/var` 导致最初 helper 4/8。临时根 realpath 后 8/8；采用并行远端已提供的等价修复，没有放宽 cwd/argv 断言。
- **隔离准备遗漏**：仅 DSH_HOME 不能隔离 OpenSpec schema 的 XDG 目标，最初命中了普通目录的未托管保护。补上独立 XDG；保护报错拒绝覆盖，不能据此宣称检查过所有外部文件。更换 XDG 后 pnpm store 不一致，明确重装测试 profile 的链接修复，未修改用户 store 配置。
- **非交互与脚本策略**：CI 模式用于隔离自动化。测试 profile 明确 false：`@google/genai@1.52.0`、`@google/genai@2.21.0`、`protobufjs@7.6.6`。没有新增 true 或 approve-all；Host builder 原有精确脚本策略及 verifier 保留。
- **Windows Node 24.12.0 Unicode 删除**：独立 ASCII/中文对照中，rmSync 在中文 cwd 返回成功却保留文件/目录，之后 rename 为 EPERM；异步删除正常。官方 SHA256 校验的便携 24.20.0 对照两种路径均正常，完整 build 也回绿。仅验证了这些具体版本，不推断所有版本；全局 NVM/Node 仍未切换。仓库推荐版本调整为 24.20.0。
- **Windows Git 长路径**：真实缓存清理报 Filename too long。新增真实 Git、超过 300 字符忽略路径的回归：旧实现 5 通过/1 失败，新实现 6/6。仅本次 `git clean` 使用 `-c core.longpaths=true`；测试确认本地 Git 配置仍为 false、受跟踪源码保留。该合同已加入 Windows 通道。
- **Windows Vitest glob**：原始反斜杠模式实际匹配 0 文件，真实 Vitest list 超时；转正斜杠后 list 列出预期 4 文件，完整执行 24/24。保留全部合同和断言。原来冷启动在这一步超时，未回退官方运行体。
- **验收驱动问题**：dump 补显式 profile；Windows 原生工具白名单补系统 tar.exe；外层验收上限留出内层生产 builder 600 秒超时及回收时间，未扩大生产超时。页面 401 按认证协议处理，未关闭认证。
- **会话执行器中断**：systemd-run ENOENT 持续三个自动继续轮次，曾标记受阻。用户报告重启并核验 WSL 后，最小命令恢复，目标恢复执行。未确定其底层原因，不把它归为三端实现缺陷。

最终 Windows 冷启动约 459 秒、重启约 18 秒，均为本次环境观察值，不是性能承诺。之前的冷启动超时、Git 清理失败和 Vitest 收集失败保留为失败快照。

## 剩余边界

- 真实物理终端关闭/原生 console-close 尚未完成新验收；不能以 detached 模式、进程退出或普通 restart 代替。
- 使用 `--no-open`。macOS 另选支持的整浏览器 app 名以防退出已安装 PWA；closeUi 仍会调用同测试端口 Chrome 标签清理的 AppleScript，实际桌面/标签效果未核验。不能宣称完全没有桌面调用。
- 未做真实浏览器交互、PWA 安装、模型生成或全部第三方插件功能验收。cockpit/PWA 的后续工作属于兄弟仓库，不在此创建第二套。
- 本次没有生产 build、切换 Windows 全局 Node、自动归档本 change 或清理 worktree。后续提交的报告/任务/README 状态修订不改变上述已验收实现字节。

## 审查与来源

审查基线为已记录的 `6911c253`，实现候选为 `93f01405`，覆盖两个修复提交及其完整文档/测试变更；不以 HEAD~1 缩小范围。逐文件本地复核确认缓存 stamp、跟踪文件保留、argv 数组、脚本许可、发布锁及失败不回退规则没有削弱。早期基于摘要且 Windows 实测未完的 Jev 评分给出低置信度升级、未返回具体代码缺陷；该评分不被当作完成证明。最终以原生 RED/GREEN、完整 diff 和三端独立审计为依据。

轻量复核入口：[中文启动步骤](../../../../README.zh.md#快速开始)、[当前跨平台规范](../../../specs/cross-platform-launcher/spec.md)。raw receipts、audit JSON、临时源码和 bundle 在忽略的验收目录及各平台临时目录，长期版本控制只保留此摘要与必要规范/报告。

交付时正常推送遇到远端并发更新，保留并整合 `813af28f` 的 AUTO 0.5.4 与 memex 修改后补跑完整仓库回归：**707 项、702 通过、0 失败、5 个既有跳过**，artifact/strict/diff 均通过。以远端提交为基线复核了本任务的完整 11 文件差异，并逐字比较确认原生验收过的 Node 推荐、两个兼容修复、测试 driver 和回归文件仍与 `93f01405` 一致。此处 707 项是整合验证；上面的三端完整命令流程严格对应 `93f01405`，不把并发修改扩写为已做过三端重验。
