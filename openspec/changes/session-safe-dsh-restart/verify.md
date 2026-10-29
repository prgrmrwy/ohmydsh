# Verify — session-safe-dsh-restart

日期 2026-10-29；WSL2 Linux，systemd 255.4，Node 24.20，DSH 0.2.0-rc.2；分支 `ws/dsh-restart-dsh-session-cancel-work`（base `628f24c5`）。

## 自动化

- `npm test`（worktree 已 promote）：650 项，645 通过，4 skipped，1 失败。失败项 `tests/jev-readiness.test.mjs` 的 "readiness prefers v4 session file…" 依赖本机未安装的 `zstd` CLI，与本变更无关，且该文件未改动。
- 新增 `tests/launcher-session-restart.test.mjs` 12 项、`tests/launcher-session-restart-detach.test.mjs` 2 项（真实 systemd scope 被 SIGKILL、POSIX 进程组被杀），全部通过。
- 负向核验：临时去掉 `systemd-run` 分支后，Linux detach 用例以 "orchestrator died with the range" 失败；恢复后通过。
- `npm run check:artifacts` 通过；`openspec validate session-safe-dsh-restart --strict` 通过。

## 隔离预览验收（端口 3245，隔离 home `.git/ws/dsh-home/43620056-…`）

1. 准备：worktree `dsh build` 两次（第二次 no changes）→ `ws prepare-preview` → 在独立 user scope 中启动预览 Host。预览 Host 环境中没有会话标记（启动者是带标记的会话 shell），验证了 Host spawn 剥离。
2. **会话内（真实 E2E）**：通过预览 Host 的 `/api` 建会话，由该会话的 bash 工具执行 `node bin/dsh.mjs restart --no-open`。
   - 判定证据 `dsh-subprocess-58166-….scope`，即调用者位于被重启的 Host（58166）自己的管理范围。
   - bash 工具拿到"已排程…"输出，turn 以 `completed` 结束，之后 Host 才被停止。
   - receipt：scheduling 14:24:12.727 → orchestrator-ready .786 → stopping 14:24:19.566 → stopped .732 → starting .737 → ready 14:24:21.970；新 Host 116353 就绪，旧 58166 已退出。`dsh history` 正确展示该 run。
3. 会话语境但调用者不在被重启 Host 的范围内（本会话 shell 位于日常 Host 范围）：命令 0.15s 返回，返回时旧预览 Host 仍存活，约 9s 后新 Host 就绪，状态目录被清理。
4. **外部路径非回归**：在非 Host 管理的 user scope 中、去掉会话标记后执行 `restart`：同步完成（4.7s，输出 `dsh 已启动`），未写 receipt。
5. 日常 3080 Host（PID 28450）在整个验收过程中未变化。

验收辅助：预览 home 缺少 `plugins/dsh-magpie-connector/settings.json`（prepare-preview 白名单之外），经用户同意临时复制，验收后已删除。另发现 connector 0.3.0 只注册按 owner 的 route（`dsh-magpie-connector-claude` 等），而日常与预览的 `agent-default-model` 仍指向裸 id `dsh-magpie-connector`，新会话会报 `NO_ADAPTER`；验收中改用 `session/selectModel` 选择 owner route。该问题与本变更无关，另行处理。

## 未覆盖

- macOS 真机（tasks 4.3）：POSIX 进程组用例在 Linux 上覆盖了同一机制，但未在 macOS 上跑。
- 合入后的生产部署与日常 Host 首次外部重启（tasks 4.4），待用户批准。
