# 实施整体验审

日期：2026-10-26。范围：ae8875ff 后本 change 的全部 hook、播种、launcher、测试、指令和验收报告。GPT 系当前执行器本地评审；不是独立第三方审计。沿用 standard OpenSpec，无 spec-superflow receipt。

## 结论

未发现尚未修复的阻断问题。可提交并完成规范收尾；不自动授权生产部署。

## 复核与修复

- 普通命令兼容：首次实现给所有命令加 Git 查询，造成三个 contract 测试失败。修复为 canonical home 含托管路径时才查询 common dir，普通 history 与自动更新保持原调用序列。contract 与全仓测试通过。
- 隔离不止 DSH_HOME：真实 build 被用户级 Anvil 非托管保护拒绝，证实 OpenSpec schema 会写 XDG。隔离 launcher 已将子进程 XDG_DATA_HOME 指向隔离 home 的 xdg-data；正式 build 复跑通过，普通 Host 无变化。
- 配置泄漏：只复制声明文件与 patch id，不执行 YAML !!js；credentials 解析错误只打印 reason，不打印带 buffer 的异常；auth 保持字节一致；真实 browser-session 不复制，本地已有值保留。
- 目标安全：首次写入前验证 operation identity、realpath、home 不等于 source、profile 已初始化、patch anchor 存在，逐层拒绝目标符号链接。teardown 删除凭据也复用该校验。
- patch 重复 id：旧目标重复白名单行可能覆盖新值，合并现保留源最新块并去掉重复目标块，生成区不动。
- 进程所有权：监听者 pid 必须为本次 child，记录 created；stop 先核对 pid/created，再把身份约束传入 stopServer 的每次 probe，防止 probe 与 signal 间换人。过期 record 不发信号；preview record 链接拒绝。
- 竞争失败分支：预览禁用普通 Host 的 racedOwner 复用，回收自己的 child 后下一个端口；普通行为保持。显式端口不退避，候选 20 个且回绕。
- 可观测性：DSH_PREVIEW 输出实际 URL；隔离 build 明示日常 GUI 未更新。build/history 不依赖 preview.json 的完整性。
- 验收 oracle：初版检查曾把 page 内提示词/请求头当作模型回答，已丢弃该次结论，改用独立 assistant/message、model source 和精确文本，实际观测 codex/gpt-6.1-sol 回答。

## 证据

- 根 npm test（mutable 健康依赖）：631 项，629 PASS、0 FAIL、2 SKIP（原有真实 MCP 集成依赖门槛）。
- launcher contract、preview、seed 聚焦用例全部通过；普通 lifecycle 17 项组合回归通过。
- check:artifacts、diff --check、严格 OpenSpec 校验通过。
- 真机：build → prepare（9 writes）→ 启动 3275 → 真实模型回答；重复 prepare 0 writes；来源白名单哈希与 3080 进程身份不变。
- 真机：restart --port 3080 拒绝；占位 3275 后实际启动 3276，占位仍活；身份停止后预览端口空，3080 不变。详情见 acceptance.md。

## 保留限制

- Windows 不作为本轮门槛；没有声明 Windows 完整支持。
- codex refresh 可能影响日常登录；memex 为共享真实库。这两项为已批准设计。
- 这是可信仓库脚本，不是安全沙箱；不能防止同用户恶意并发替换目录、手工伪造 operation 或进程身份记录。
- cleanup hook 失败时只告警继续，是用户选择，仍可能残留预览进程。
- 本轮真实模型只对 codex 发请求；claude 仅核验插件读取到一个有效账号。
