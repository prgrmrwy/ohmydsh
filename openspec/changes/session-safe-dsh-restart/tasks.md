# Implementation Tasks

范围按 proposal 的「2026-10-29 收窄范围」。原 130 项任务见 commit `5546687b`。

## 1. 实现

- [x] 1.1 新增 `scripts/launcher/session-restart.mjs`：会话判定、标记剥离、脱离命令、排程/编排握手、receipt、history
- [x] 1.2 `scripts/launcher/main.mjs`：编排入口、restart 分流（含 `--foreground` 与 Windows 拒绝）、`onPhase`、Host spawn 剥离标记、`dsh history` 扩展
- [x] 1.3 现有 launcher 测试显式声明外部语境（`tests/helpers/launcher-fixture.mjs` 的 node harness、`tests/launcher-lifecycle.test.mjs`）

## 2. 测试

- [x] 2.1 `tests/launcher-session-restart.test.mjs`：判定矩阵、override 门控、环境剥离、脱离 argv、成功序列与返回先于 stop、未 ack、编排进程早退、伪造 handoff、abort 优先、停止后的失败、`runLauncher` 分流、orchestrated 只接受 restart
- [x] 2.2 `tests/launcher-session-restart-detach.test.mjs`：真实 systemd scope 被 SIGKILL 后编排进程存活并进入 `dsh-restart-*` cgroup；POSIX 进程组被杀后编排进程存活
- [x] 2.3 负向核验：去掉 systemd-run 时 2.2 的 Linux 用例失败
- [x] 2.4 worktree 依赖补全后 `npm test`（唯一失败为缺 zstd CLI 的无关用例，见 verify.md）；`npm run check:artifacts`；`openspec validate session-safe-dsh-restart --strict`

## 3. 指令与文档

- [x] 3.1 `instructions/dsh-home.md` 新增"重启与断线"规则，并改写预览验收段里"由用户执行日常 Host 重启"的表述
- [x] 3.2 `skills/add-dsh-plugin/SKILL.md`、`skills/remove-dsh-plugin/SKILL.md` 的重启步骤
- [x] 3.3 `README.md`、`README.zh.md` 的 `dsh restart` 说明与 `[ASK-RESTART]`
- [x] 3.4 指令断言测试：生成的 `AGENTS.md` 含规则 token、不含旧指引

## 4. 验收

- [x] 4.1 隔离预览验收：在 worktree 预览 Host 内创建会话，由该会话的 bash 工具执行 `dsh restart`，确认会话断开、新预览 Host 起来、`dsh history` 显示 `ready`；日常 3080 不受影响
- [x] 4.2 外部终端 `dsh restart` 非回归（预览 home）
- [ ] 4.3 macOS 真机会话内 restart（后续；当前无 macOS 环境）
- [ ] 4.4 合入后在主 checkout `dsh build` 两次（第二次无变更），由用户从外部重启一次日常 Host 使新 launcher 生效
