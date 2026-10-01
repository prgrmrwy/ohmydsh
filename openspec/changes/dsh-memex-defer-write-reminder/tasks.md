## 1. 先写失败的测试

- [x] 1.1 修改 `packages/dsh-memex/test/lifecycle-runtime.test.ts`：把 `adds at most one reminder step after recall` 改写为「召回后回合结束，同一回合只发出 1 次请求；用户下一回合的首个请求包含 `Memex write reminder`，且只出现一次」。验证：在旧实现上跑 `pnpm --filter dsh-memex test`，该用例失败。
- [x] 1.2 在同一文件新增两个用例：「安排提醒后没有新输入，就不产生新请求」；「安排提醒后、下一回合之前写了卡，提醒不送达」。验证：在旧实现上至少第二条失败或不可达。
- [x] 1.3 调整 `packages/dsh-memex/test/lifecycle.test.ts` 的 fixture，同时模拟 `agent/turn-stopping` 与 `agent/pre-step`（带 `turn`、`next`）。覆盖以下断言：未召回不提醒；同一回合的 pre-step 不追加；下一回合的 pre-step 追加且只追加一次；写卡后不追加；记忆关闭不追加。验证：断言在旧实现上失败。

## 2. 实现

- [x] 2.1 在 `packages/dsh-memex/src/lifecycle/index.ts` 中，把 `turn-stopping` 改成只记录 `pendingSinceTurn`，再新增 `agent/pre-step` 监听器，按 design.md 的决策 1 和决策 2 追加或放弃提醒。`mark` 和 `session-start` 需要清掉 pending。验证：`pnpm --filter dsh-memex test` 全部通过。
- [x] 2.2 运行 dsh-memex 包的 typecheck 和 build（以包内 `package.json` 脚本为准）。验证：命令退出码为 0。

## 3. 文档与部署

- [x] 3.1 更新 `docs/notes/dsh-memex-integration.md` 中关于 `agent/turn-stopping` 的描述，说明 `inject` 会让同一回合多跑一步，因此改为在下一回合的 pre-step 追加；如有必要，同步更新 `packages/dsh-memex/README.md`。验证：在两份文档里 grep `turn-stopping`，确认措辞与新行为一致。
- [x] 3.2 在 `docs/notes/dsh-plugin-integration-pitfalls.md` 增加一条：在 `turn-stopping` 中 `inject`/`steer` 会延长当前回合，并抢走最终回复的位置。验证：该条目存在，并引用了本 change。
- [ ] 3.3 运行仓库级检查 `npm test`、`npm run check:artifacts`、`node scripts/sync.mjs`，然后再跑一次 `node scripts/sync.mjs`，确认没有新的变化。验证：各命令退出码为 0，第二次 sync 无变更。
  - 已完成：`npm run check:artifacts` 通过；dsh-memex 包内 vitest 355/355、typecheck、`check:descriptions` 通过；`npm test` 为 252 通过 / 1 失败，**同一个失败用例（`scoped package metadata goes through npm with profile auth`）在未改动代码的 main 基线上同样失败**，单独运行该文件则通过，属于既有的整套运行时问题，与本变更无关。
  - 未完成（刻意留给用户）：对真实 `~/.dsh` 执行 `node scripts/sync.mjs` 及第二次幂等验证——这会改动线上部署，需要在用户的 DSH 空闲时进行。
- [ ] 3.4 重启 DSH 后在 Web GUI 实测：召回后提一个问题，回合的最后一条消息是正式回答；再发一条消息，模型才收到写卡提醒。验证：截图或会话记录中能看到上述顺序（只在报告里描述，不提交截图）。
- [x] 3.5 运行 `openspec validate dsh-memex-defer-write-reminder --strict`。验证：命令通过。
