# upgrade-dsh-0-2-2-runtime 验收汇总

本文件进入版本控制（`.gitignore` 只放行 `checking/summary.md` 与 `report.md`），用于保存各阶段的结论与证据位置。原始日志放在 `/tmp` 下，不入库，重启后会丢失。

## 1. 基线（现役 0.2.1-rc.5，2026-11-07）

- 根目录（worktree，依赖切换前）：`npm test` 771 项，通过 769，跳过 2，失败 0；`npm run check:artifacts` 合规。
- 各 local package：在隔离目录 `/tmp/ohmydsh-base021-9q2h` 执行（`git archive c38826ae` 后 `npm ci`），workspace 一律按路径传入。worktree 里的第一次运行做到一半时，`npm install` 把依赖换成了 0.2.2，结果作废、不计入基线。
  - build、typecheck 全部通过。
  - test 中有 3 项在基线上就已失败，0.2.2 之后不计为回归：
    - `dsh-auto-model-routing`：`usage-report.test.ts` 的「keeps incomplete ends inconclusive and legacy exposure unknown」「keeps complete frames when only the tail is incomplete」（313/315）。
    - `dsh-pet`：`locus-host-wiring.test.ts` 的「Pet is NOT ready when the stored loci set violates a v20 invariant: topic row without its group row」（3151/3156，另有 4 项 skip）。
  - 其余各包测试数：cockpit-memex-browse-shim 20、cockpit-worktree-open-shim 4、collab-kernel 293、dsh-collab 187、dsh-magpie-connector 538、dsh-memex 934（1 项 skip）、dsh-openspec 162、dsh-session-id-copy 27、dsh-sidebar-session-provider-icon 68、home-network-model-guard 96、sidebar-session-resources 59、subscriptions-sandbox-shim 29、system-clock 21、worktree-session 230，全部通过。
- 1.2 中没有自动化覆盖的人工项：只列出了清单，尚未在现役 3080 上逐项记录结果（见第 6 节）。

## 2. 实施提交（任务分支 ws/dsh-collab-session-88dc3e8d-…）

| 提交 | 内容 |
|---|---|
| 71f10f60 | `dshVersion` 与 provider pin/integrity 升到 0.2.2-rc.1；local package 的 dsh devDeps 与 peer 尾段同步；Cordis 4.1.0、Loader 1.1.0 devDeps（0.2.2 peer `~4.1.0` 的要求）；重建 lockfile，运行体包只保留一份并 hoist；`engines.node >=24.9.0`，`bin/dsh` 与 `bootstrap.sh` 的提示同步；Web Fetch 信任面说明 |
| f6c2dc50 | dsh-memex：删除过期的 tools 投影（D4）；`internal/config` 钩子换成新签名（旧写法在 0.2.2 下守卫会静默失效，变异验证确认现已生效）；`AUDITED_JSONL_VERSIONS` 加入 0.2.2-rc.1（附审计依据，未审计的版本仍被拒）；测试夹具迁移 |
| 9045d425 | sidebar-session-provider-icon：`await` 异步的 `sessionProjections.register` |
| 64ea656d | dsh-magpie-connector、worktree-session：测试夹具迁到 0.2.2 API 形状，源码不变 |
| 7e5d78d5 | fs-observation-policy patch 与 official 测试（D5）；connection-webserver 的 0.2.2 复核（保留）；noPet 名册 203→207；README 最小 manifest 版本号 |
| 072deaff | dsh-auto-model-routing：主会话在 pre-step 改写本步选择；子会话在 created 时 select、resume 时补写 route；`agent/request` 只核验；`engines.dsh >=0.2.2-rc.1` |
| 402aadb3 | dsh-pet：用 `sessionQuery.observeSession` 替换已移除的 `sessionController.inspect`，缺失时输出可诊断日志；测试夹具迁移 |
| daf66a09 | 为 0.2.2 测试夹具新 import 的运行体包补 devDependencies（auto-model-routing 11 个、dsh-pet 与 worktree-session 各 1 个），运行体包仍单实例 |

## 3. 规划之外发现的 0.2.2 破坏面

- **`sessionController.inspect` 被移除**（0.2.1-rc.5 `dsh-api-session-controller` types `index.d.ts:79` 有，0.2.2-rc.1 没有）。dsh-pet 的 Locus 开通与 Session 列表依赖它，缺失时会整体静默不装配。现在新增 `packages/dsh-pet/src/host/session-inspection.ts`，按旧契约复现：`observeSession(id, {projectionMode: 'none'})`，没有 cwd 时视为不存在，读完释放 lease。缺少该能力时启动日志会明确报错；Pet 仍然 ready，Locus 通道沿用原有的 unavailable 降级。全仓只有 dsh-pet 用到 `inspect`。
- **0.2.2 不再默认挂载工具执行器**：生产组合由 dsh-base 顶层的 `tool-executor-native` 全局提供（cordis.patch.yml:497-505；真实运行体 `--dump-config` :385-390），自研 preset 不用改；只有测试装配需要显式挂载。
- **`ctx.tools.execute` 改为批量形状**：入参 `{calls, agent, signal}`，返回 `{results}`。另外 `defineContentToolFixture` 和 `buildModelCatalog` 不再导出，`dsh-agent` 现在 `inject: ['sessionProjections']`。这些都只影响测试夹具。
- **memex 有假通过的测试**：「注入时首请求零调用」之前是因为抛 TypeError 才通过的。现已改成断言具体的拒绝原因。

## 4. 测试结果（0.2.2-rc.1）

- test-plan.md 的 72 行全部转绿。auto-model-routing 在真实 loop 与 subagent 链路上断言；fs-observation-policy 的 official 测试用 `DSH_TEST_OFFICIAL_RUNTIME=/tmp/fsp-runtime-0.2.2` 跑，5/5 通过（运行体重建方法见 dsh.yaml 条目 note 与测试头注释）。
- 各包结果见第 5 节终验。

## 5. 全仓终验（8.6）

2026-11-07，在 daf66a09 上运行，依赖为 0.2.2-rc.1（日志在 `/tmp/r022-final/`）：
- 根目录 `npm test`：777 项，通过 775，跳过 2，失败 0；`npm run check:artifacts` 合规。
- 各包 build 与 typecheck 全部通过。test 结果：cockpit-memex-browse-shim 20、cockpit-worktree-open-shim 4、collab-kernel 293、dsh-collab 187、dsh-magpie-connector 538、dsh-memex 935（跳过 1）、dsh-openspec 162、dsh-session-id-copy 27、dsh-sidebar-session-provider-icon 72、home-network-model-guard 96、sidebar-session-resources 59、subscriptions-sandbox-shim 29、system-clock 21、worktree-session 230，全部通过。
- 仅有的失败与第 1 节的基线失败完全相同，不是 0.2.2 回归：auto-model-routing usage-report 2 项（327/329），dsh-pet v20 invariant 1 项（3158/3163，跳过 4）。

## 6. 尚未完成

- 1.2：现役人工项的结果。
- 9：隔离候选验收（`dsh build` → `ws prepare-preview` → `dsh`），以及 devbox 清洁构建 gate。`tests/launcher-no-pet.official.mjs` 在 :18/:21 写死了 0.2.0-rc.2，需要在候选验收时决定如何处理。
- 10：备份与恢复演练，需要用户执行 `dsh stop`。
- 11：上游留言已于 2026-11-07 经用户确认发布：https://github.com/deepseek-ai/deepseek-harness/discussions/7179#discussioncomment-19453297 （待上游回应，不阻断合入）。
- 12：合入与生产切换，需要用户批准。

## 7. 后续项（不在本 change 内）

- `memex-eval-judge` preset 与 memex 测试夹具使用的 `@deepseek-ai/dsh-agent-tool-presentation` 在 0.2.2 已标为弃用，应改为直接挂载 `dsh-tool-executor-native`。
- 基线就已存在的未声明 devDependencies：dsh-collab（dsh-agent-loop、dsh-session-projection、dsh-session-persistence-jsonl、dsh-system-prompt），dsh-openspec（dsh-scope），dsh-pet（dsh-subagent、dsh-system-prompt、dsh-scope、dsh-session-persistence(-jsonl)、dsh-session-query、dsh-session-projection、dsh-subagent-spawn-in-process、dsh-fs-local、dsh-working-directory、dsh-tool-fs）。
- `packages/dsh-auto-model-routing/docs/architecture.dual.svg`/`.json`（README 没有引用的 v1 图）里仍写着 “agent/request hook”。
- 商店上的 AUTO 0.7.0 在 0.2.2 Host 上不可用，需走 publish 流程发布新的 minor 版本（建议 0.8.0）。
- 已知不稳定：机器高负载时 `locus-host-wiring` 偶尔出现 1s `waitFor` 超时，单独跑该文件稳定。
