# Verification Results — sync-build-inputs-dirs

## Task Completion

- [x] 实现任务 1.1–4.3 与验证任务 5.1–5.2 已按实际测试证据完成。
- [ ] 5.3 未整体勾选：delta 已同步；归档、提交、合入和清理没有用户授权，未执行。不是实现功能缺失。
- 仅使用合成 overlay / 临时 DSH_HOME / fake CLI；没有物化到日常 DSH。

## TDD Integrity

- [x] 47 个场景（35 继承 + 12 新增）均映射到真实测试；六组额外边界矩阵存在。
- [x] 47 行均为绿色。继承场景不伪造 RED；I03 同时核查启动清单与升级检查，I06 补强缺字段和版本围栏，I09 用污染反例证明断言有效。
- [x] 新增目录行为先在旧实现捕获 12 个实际失败，再扩展预检与哈希；初次 RED 无 import/语法错误。
- [x] change 定向完整套件 68 passed / 0 failed / 0 skipped / 0 todo。
- [ ] **全仓零 skipped 条件未满足**：最终根测试有 2 项既有真实 MCP bridge 探针跳过；未安装该确切 bridge，未把跳过冒充通过。
- [x] 未删除或削弱既有规格断言。新增继承围栏夹具曾误要求错误包含 overlay 路径，核对规范后只去除无规范依据的额外要求；保留非零、身份/版本围栏诊断、home 不变及零 CLI 调用。详见实施日志。

## Evidence

最终代码快照验证（2026-10-17，本受管 worktree，Node v24.20.0）：

1. `DSH_LOCAL_MANIFEST=/nonexistent/ohmydsh-test-isolation/dsh.yaml.local node --test tests/sync-build-inputs-dirs.test.mjs tests/sync-local-manifest-overlay.test.mjs tests/sync-overlay-root.test.mjs tests/sync-preflight.test.mjs tests/plugin-update-overlay.test.mjs tests/sync-build-freshness.test.mjs` → **68 passed、0 failed/cancelled/skipped/todo**，exit 0；主代理独立重跑与评审者独立重跑一致。
2. 根 `npm test` → **445 total、443 passed、0 failed、2 skipped、0 cancelled/todo**，exit 0。跳过来源为现有 `tests/dsh-mcp-client-seam.test.mjs` 的两个真实 bridge 探针；本 change 不修改这些测试及宿主集成。
3. `npm run check:artifacts`、`git diff --check` → exit 0。
4. 官方受管 `openspec validate sync-build-inputs-dirs --type change --strict --json` → `valid:true`、`issues:[]`，exit 0。`openspec validate --specs` → **38 passed、0 failed**。同步子代理曾报告其 CLI 对长正文发 warning/exit 1；主代理以显式类型的官方命令直接核验并保留不同结果，不修改已批准 delta 来规避校验。
5. 机械账本核验：47 个 scenario 标题、真实测试文件和真实可执行名称全部对应；无红行。哈希旧文件编码有冻结旧算法 oracle；目录 oracle 使用明确期望文件集；构建 fixture 实际读取外部当前源码，不读取旧 lib。

## Review Integrity

- [x] 规划第 2 轮 `VERDICT: APPROVE`，无 Required Changes；批准 proposal/design/delta 未因实施而修改。
- [x] 独立实现评审 `code-review.md`：**REVIEW PASS，零发现**；评审者独立执行相同六 suite 68/68。规划批准未冒充实现验收。
- [x] 仅三处产品扩展（+19/-6）：buildInputs file-or-dir、保留 strict kind 的预检、目录摘要分支。复用默认 collectFiles，不新增黑名单、manifest 字段或重建框架。

## Main Specs Synced

- 主规范 repo-layout 由 24 requirements / 115 scenarios 变为 **25 / 127**。
- 仅 1 个 MODIFIED requirement 的两段预检文字 + 1 个 ADDED requirement；原 overlay 35 场景、其他 23 requirements、Purpose 和顺序均逐字节保留。
- 无 delta 操作头、无重复；二次语义合并结果逐字节相同。
- 当前主规范 SHA256：`22d8da6c614c97cf1bbea9fb7171c0e0a22de330d4bc4851d86c16330d3f7bde`。

## Change Delivery

未提交的 worktree 交付：产品改动为 `scripts/sync.mjs`，测试为 `tests/sync-build-inputs-dirs.test.mjs`，另有主规范、测试账本与审查/验证记录。没有替用户 commit、merge、archive 或 cleanup。后续版本动作由用户明确批准后执行。

## Overall Decision

DECISION: FAIL

**实现与独立定向验证通过，但不能声明 Anvil 严格验收 PASS**：全仓零跳过要求仍不满足，且归档步骤未获授权。该结论不是目录功能测试失败；不降低门禁，也不为变绿而安装无关宿主桥、改跳过逻辑或擅自部署。保留本 change 活跃状态，等待用户决定是否补集成环境或接受已知验证限制后再做版本收尾。
