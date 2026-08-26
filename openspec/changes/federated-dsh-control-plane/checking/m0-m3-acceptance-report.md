# M0–M3 验收报告（任务 10.8，仓库侧部分）

本报告覆盖 10.8 中**不需要操作者环境**的部分：安全/兼容审查与实施完整性核对。
真实付费 model turn（10.2）、对真实 `~/.dsh` 的启用（10.6）与 GUI 验收（10.7）
仍待操作者执行，**本报告不代替这三项**。

## 1. 里程碑状态

| 里程碑 | 状态 | 证据 |
| --- | --- | --- |
| M0 可行性 gate | 完成 | `rc2-live-conformance-report.md`、`rc2-matrix.json`（13/13 seam gate） |
| M1 headless core | 完成 | Core/registry/tunnel/adapter 全部实现并有 mutation 覆盖；host `apply()` 已真实接线 |
| M2 联邦 UI | 完成（含一处已批准的范围限制） | `client-bridge-report.md`；实时增量流按用户决策保持 baseline 快照 |
| M3 多节点验收 | **部分** | 自动化三节点/目录流/断线恢复已通过；真实 model turn 与真实启用待操作者 |

任务计数 **78/82**；未完成的 4 项全部依赖操作者凭据或启用决定。

## 2. 禁止面静态审查

对 `packages/dsh-federation/src` 全量检索，逐条确认命中项性质：

| 禁止面 | 结论 |
| --- | --- |
| `host.openPath` | 仅出现在①禁止清单②`uplink` 中显式 `reject(..., 403)`，无路由路径 |
| `host.pickDirectory` | 仅出现在 `RC2_FORBIDDEN_METHODS` |
| `settings.*` / `credentials.*` / `llm.*` | 仅出现在禁止清单与注释；无调用点 |
| `session.export` | 仅出现在禁止清单 |
| `subscriptions` | 0 命中 |
| 文件同步（`copyFile`/`cpSync`） | 0 命中 |
| 路径映射 | 唯一命中是注释「never rewritten or mapped centrally」 |
| 自动下载 | 0 命中 |

`boundaries.test.ts` 另有静态守卫：所有 `this.#call(` 必须传字面量方法名、仅
`probeOptional` 可传动态名、且每个字面量都在 allowlist 内、不在禁止清单内——
引入动态方法名会使测试失败（已用变异验证）。

## 3. 关键不变量的 mutation 覆盖

累计 24 项安全/正确性不变量做过变异验证。其中值得单列的三类：

- **检出**：ledger 不重放 `OUTCOME_UNKNOWN`、id 未知节点/kind 校验、router capability 与
  authority 门、registry symlink/权限、SSH readiness 证明与 stderr 脱敏、adapter
  allowlist（静态）、projection 归档隔离、拖拽跨 workspace、远端路径不交给本地编辑器、
  inventory 不回落 native、`rpcId` 回显、跨节点帧隔离、Hero 占位回退。
- **纵深防御（单点变异存活、多点同时变异检出）**：event-stream generation 守卫（3 处）、
  client 就绪门（2 处）。已如实记录，未伪造覆盖。
- **round 20 新增**：跨进程提交锁——移除后 12 轮竞争失败 3 次，保留则 0 次。

## 4. round 20 修复的真实缺陷

自 round 17 起间歇出现 `1 failed`，但默认 reporter 不打印失败用例名。本轮新增
`npm run test:tap` 后第 9 轮捕获：两个并发进程**都**提交了 generation 1（lost update）。

根因是 CAS 复检与 `rename` 之间的 TOCTOU 窗口，同进程检查无法跨进程互斥。修复为
`O_EXCL` 跨进程提交锁，把「复检 + rename + fsync」纳入临界区；30s 过期锁自动回收。

同时更正了 round 13 报告中「pre-commit 复检关闭了跨进程窗口」这一**错误结论**
（已标注为被推翻，原文保留以便追溯），并在运维文档补充锁文件说明。

## 5. 已知限制（明确不声称）

1. **远端实时增量流未接**：rc.2 `connection.start()` 契约为单消费者且已被官方运行时占用，
   `ConnectionHandle` 无 tap/observe 旁路。已暂停上报，**用户定案保持 baseline 快照**。
2. inventory 的 `runningSessionCount`/`pendingInteractionCount` 恒为 0；
   `baseline.archivedSessionIds` 恒为空——需节点生命周期发布运行时计数。
3. `runtime-bridge.ts` 存在较多 `as unknown as` 适配转换（rc.2 运行时形状不应泄漏进 Core）。
4. `dsh-better-sidebar` 在联邦多节点树下的布局行为**未验证**。
5. 真实付费 model turn 未驱动（10.2）。

## 6. 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm test`（根） | **99 passed, 0 failed**；修复后连续 6 轮 0 失败（此前约每 9 轮 1 次） |
| `npm run test:tap` | 同上，且失败时保留用例名 |
| `npm test --workspace dsh-federation` | **135 passed** |
| `npm run typecheck --workspace dsh-federation` | 0 error |
| `npm run build --workspace dsh-federation` | 幂等（`workspace embed reused <sha256>`） |
| `tests/federation-artifact-load.test.mjs` | 重建后 host entry 与 client bundle 均可加载 |
| `npm run check:artifacts` | 追踪产物与 fixture 隐私策略均通过 |
| `openspec validate --strict` | valid |

## 7. 启用前状态

`dsh.yaml` 保持 `dsh-federation: enabled: false`；`~/.dsh/plugins` 仅有
`subscriptions`；部署 profile 中无 `dsh-federation`；未重启 DSH，未启动替代 server。
