## Verification Report — pet-locus-isomorphic-entries

**Verdict:** PASS（自动化检查全部通过；独立实现评审未执行，见文末；真机验收待所有者）

### 范围

v19 → v20 break-change：同构入口（W↔M 1:1，同一群/文档的全部入口行共享群行上的 M），一入口一行，`accessMode` 单值，管理面「改绑到其他会话」，整 W 一次迁移，退役子会话拦截（D15），v20 离线迁移。决策依据 design.md D1–D17，规划评审三轮（round 3 APPROVE_WITH_CHANGES，CHANGES_APPLIED: yes）。

### 检查结果（2026-11-06 11:0x，主 checkout，未提交工作树）

| 检查 | 结果 |
|---|---|
| `packages/dsh-pet` `npm run typecheck`（host + client） | 0 错误 |
| `packages/dsh-pet` `npm run build` | 通过 |
| `packages/dsh-pet` `npx vitest run` | 222 文件通过 / 2 跳过；3119 通过 / 0 失败 / 4 跳过（含管理面筛选/改名追加改动后的重跑） |
| 根 `npm test` | 757：754 通过 / 0 失败 / 3 跳过 |
| `npm run check:artifacts` | 通过 |
| `openspec validate pet-locus-isomorphic-entries --strict` | valid |
| `node scripts/sync.mjs` 连跑两次 | 第一次 2 项变更；第二次 no changes；两次 deploy check `dsh-pet-migrate-state --self-check` 均通过 |
| test-plan | 334 行：🔴 0，⚪ 0，🟢 334（含 55 行沿用测试，均在本次全量运行中通过，并逐行核对了测试文件与测试名存在） |
| tasks.md 组 0–2 | 全部勾选 |

**基线对比（0.2）**：dsh-pet 由 207 文件 / 3061 测试变为 221 文件 / 3101 测试。删除与整体重写的测试逐条记录在 [deleted-tests.md](<deleted-tests.md>)（398 条），每条注明原因与替代测试，或注明被测行为已由本 change 删除。

### 线上数据预演（只读副本）

对线上库副本运行已安装的 `dsh-pet-migrate-state --dry-run --db <副本>`：19 → 20；6 个入口；丢弃历史代 3 行；投递 22 条全部保留并改写；`oc_bb0e…#omt_198f…` 话题行并入群行的 M（`session-1a300190`）并原地重建；跨配对群归并 0；默认 Q&A 标记 0（原库确无 `default-qa` 指针）；`locus_permission_audit` 不动。线上库未被修改。

### 偏离与如实记录

**TDD 未严格先红后绿的部分**（均以故意改坏实现确认测试会变红后恢复）：
- impl-b：`controller.ts` 先于测试编写；dual-creation / rebind / migrate-whole-w 首跑即绿，约 15 次反证全部变红。`index.ts` 接线由 tsc 驱动，端到端接线测试后写并做了反证。
- impl-a：集合不变量 6 个测试与生命周期测试与实现同时编写；集合不变量以反转断言验证，生命周期测试抓到一个真 bug（`reenableRow` 后仍为 stopped）。`beginProvisioning` 修复与测试同一步加入。21 行收尾时 18 次反证全部变红。
- inv-controller：`composition.ts` 先改实现，5 次反证全部变红。
- inv-management：测试与实现同步改写，6 次反证全部变红（首轮脚本只读 stdout 误报“无变红”，修正后重跑）。
- inv-persistence：installed self-check 行未先见红。
- contract：移植的旧测试多数首跑即绿（B 的源码已是 v20），属移植测试而非先红后绿。
- 无法被单一反证杀死的断言（等价变异体）：`refused-reply.ts` 与执行证明中的冗余检查；`locus-settlement-integration` 的 3 个场景（被拒后同轮改正、无关联或迟到旧执行不消费新请求、超时不重建会话）断言真实状态但未单独反证。

**实现阶段补充的设计细节**（已写入 design 与 spec，标注“实现阶段补充”）：
- 访问模式变更只对 `not-created` / `active` 行受理，`stopped` / `invalid` 为 `INVALID_REQUEST`。
- 文档入口完全访问的拒绝诊断统一为 `owner-only-tier`（原文本 `not-allowed-sender` 与“规则与群相同”矛盾）。
- 契约增补：`recordAccessVerified`（不推进 revision）、首次发布四个方法、`listMains`、启动对账端口。
- 启动时集合不变量门禁 `assertLocusSetValid`：违反时 Pet degraded、不注册路由（由 impl-a 在核对 spec 时发现原先未接线）。

**已知限制**：
- dsh-collab 没有关闭空间的操作。改绑/迁移在提交前失败时，新建的协作空间只能清除 Pet 内存状态并记日志泄漏；M id 永不复用，空间无害但会留存。
- `migrateMain` 由 `agent/created` 触发后不等待；触发它的投递按 B 类拒绝结算，派发器之后按新 `sessionId` 继续；拒绝被捕获并记诊断。
- 迁移只清空、不删除 `u_dsh_pet_locus_indexes`、`u_dsh_pet_locus_switch_notices`、`u_dsh_pet_locus_operations` 三张物理表。
- 管理面 `hasCurrentDelivery` 按群计算（同群所有入口同值）；只有改绑置灰读取它，且改绑本就按整群判断。

**部署状态**：集成验证中的 `node scripts/sync.mjs` 已把 v20 代码装入日常 profile（尚未重启，运行中的 Host 仍是旧代码）。在执行 v20 离线迁移之前重启 DSH，Pet 会因库版本为 19 而 degraded 并提示迁移；数据不受影响。

### 真机验收清单（交所有者）

1. `dsh stop` → `dsh-pet-migrate-state --dry-run` 核对（应与上文预演一致）→ `--yes` → `dsh`。
2. 管理面加载：含 `not-created` 入口的面板正常显示（修复现网 bug）。
3. 所有者确认后归档 auto W0（`session-17bd88a3`），在管理面对 `oc_bb0e…` 群执行「改绑到其他会话」→ `session-4437f422`；话题首 @ 后新子会话的首投前言包含 `reboundFrom` 说明。
4. 在新的话题群里话题首次 `/bind W`：只出现一个 M，群行与话题行都在其下，不再额外建 W0/M0。
5. 群已属其它 M 时话题内 `/bind W2` 被拒，回执提示管理面改绑。

### 独立实现评审

**未执行。** 实现阶段没有启动独立的跨模型实现评审（此前对话中称其“在后台运行”是错误表述，已更正）。本 change 的独立评审只覆盖规划阶段（三轮 anvil，round 3 APPROVE_WITH_CHANGES 且 CHANGES_APPLIED: yes）。实现正确性的证据仅为上表自动化检查、各负责人的反证记录，以及线上库副本 dry-run 与实际迁移后的副本核对。如需实现评审，可在合入/push 前另行发起。

### 验收后追加的改动（2026-11-06，所有者确认）

- 用户可见用语「干活会话 / 干活主会话」统一为「工作会话 / 工作主会话」（5 个 MODIFIED 场景名与 1 处引用的需求名受 OpenSpec 规则约束保留旧名，归档更新主 spec 时一并改）。
- 管理面筛选：浮层改为实底；三个平级选项「在服务（默认）/ 已停止·已失效 / 已归档」；工作会话已归档的入口只计入「已归档」，默认隐藏；未知状态值始终显示、不计入任何一项（已归档工作会话下计入「已归档」）。
- 已归档工作会话也显示标题；Host 侧从投影缓存取标题的解析放宽，无法解析时回退完整读取。locus 主会话显示「未命名」的根因尚未在运行中的 Host 上确认，待重启后核对。
