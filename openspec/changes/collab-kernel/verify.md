# Verification Results — collab-kernel

## Task Completion

- [x] tasks 的64项均已按实际实现/执行证据完成；108个规格场景都为绿色。
- 实现交付范围为独立零运行时依赖 TypeScript 库；未创建 dsh-collab 消费者、真实 provider、网络服务或 GUI，未改 Pet 与部署 manifest。
- 任务勾选表示当前实现/检查完成，不追认最初未遵守的测试先行历史。严格验收限制见下文。

## TDD Integrity

- [x] 108场景都有真实可执行测试映射，无 N/A；主代理逐行核对场景标题、文件与用例标识，全部通过。
- [x] 测试账本无红行。真实TypeScript类型提取与unsafeWrite负夹具、17命令允许/拒绝矩阵均执行；普通测试另由严格tsconfig.test进行类型检查。
- [x] 内核最终全套 **205 passed、0 failed/skipped/todo**。
- [ ] **原始测试先行流程不完整**：首版FileStore先实现后写7个测试；projection/convention首次RED为模块缺失，不符合“不得用import故障冒充行为RED”。后续真实故障反例及独立审查修复不能抹去这段历史。完整说明保留在 implementation-log.md，未伪造RED。
- [ ] **全仓零skip条件不满足**：根测试2个既有真实MCP bridge探针因workspace缺少确切bridge而跳过。未把skip改成pass，未为此改日常DSH或安装无关宿主依赖。
- [x] 未删除或削弱规格断言。完成投递会合法追加日志，原测试按log.at(-1)误取completion；修成按返回seq定位command，保留事件/状态断言。多事件确认的breaker/reset强断言先真RED再修，不为绿删除。

## Evidence

最终主代理执行，2026-10-17，本受管worktree，Node v24.20.0：

| 检查 | 精确命令 / 结果 |
|---|---|
| 最终内核全套 | `npm --workspace packages/collab-kernel test -- --reporter=dot` → **38 files、205 passed、0 failed/skipped/todo、Type Errors none**，exit0，最终执行02:41:22 |
| 生产和普通测试类型 | `npm --workspace packages/collab-kernel run typecheck` → 两个tsc均exit0 |
| 构建 | `npm --workspace packages/collab-kernel run build` → exit0，约定Markdown复制到忽略的lib |
| 入口烟测 | 从构建的lib/index.js导入CollabService/FileStore/project成功；无全局readConvention/canonical/recordDispatch绕过出口 |
| 根全套 | `npm test` → **445 total、443 passed、0 failed、2 skipped、0 cancelled/todo**，exit0；跳过来源为既有tests/dsh-mcp-client-seam.test.mjs两个真实桥探针 |
| 仓库产物/空白 | `npm run check:artifacts`、`git diff --check` → exit0 |
| 文档治理追加检查 | `node --test tests/repo-docs-governance.test.mjs` → **30/30**，无skip |
| change严格校验 | `openspec validate collab-kernel --type change --strict --json` → **valid:true、issues:[]、exit0** |
| 全主规范 | `openspec validate --specs` → **38 passed、0 failed** |

同步子代理报告过不同CLI对长正文warnings的exit1。主代理以本会话官方受管命令显式类型复核，两change均valid true/issues[]、exit0；未为迎合另一CLI改写已批准delta。无未收集的相关后台测试。

### 真实RED与修复证据摘要

- core2–11逐组RED/GREEN见 test/support/implementation-notes.md；初始就通过的重叠场景没有伪称新RED。
- 存储接管36项中24真RED→40GREEN；独立审查再发现非法UTF8被宽松替换/误算截断offset，先47项中5RED，再47GREEN。存储最终独立复核实际重跑 **47+13=60/60**。
- dispatch17RED/4PASS→正确实现；额外真实磁盘08/10和failed-late先3RED，再通过。全wake表、入队前presence单次采样、无限期SPI不占队列/close另有持久化回归。
- 生命周期独立tests-only首轮6RED/2PASS；修复者额外4RED覆盖principal引用快照等。最终admission8/8与extra5/5通过，旧claim/presence/delivery不能跨close/reopen写入。

## Review Integrity

- [x] 规划第8轮 `VERDICT: APPROVE`，无Required Changes；proposal/design/delta在实施中未修改，批准不因代码修复而失效。
- [x] 初始实现审查的存储S1、调度F1/F2均保留原FAIL报告且已修复；独立终态存储 `storage-code-review-final.md` 为PASS，整体 `code-review-final.md` 为PASS，无Critical/High/Medium阻断。
- [x] 独立整体评审者实际运行205 tests/typecheck/build，并用built入口探针检查同实例重开的旧回调/挂起命令隔离。
- Minor M1 保留：D2描述纯业务decide，实际为纯reducer/dispatch decision加service私有业务callback。当前契约与授权集中入口不受影响；不为了抽象形式做大重构，也不静默修改已批准设计。后续维护应准确更新架构说明。

## Main Specs Synced

- 新主规范19 requirements /108 scenarios；Requirements正文与批准delta逐字节相同，无delta操作头，无重复，二次合并字节幂等。
- SHA256：`38698781f8941a90d9e5f9a688e5dd8b6d9ac920d5f7b898f1b129df65995c84`。
- 约定v1正文核对自包含草案，只移除草案说明；版本/摘要和四个授权读入口联测通过。

## Change Delivery

未提交worktree交付：packages/collab-kernel源码/测试/双语文档，workspace lock及库等级/文档索引治理，主规范和该change工件。已有lock的两个workspace版本归一来自npm install，对应包源码版本未改。根README补齐既有ponytail索引是根回归暴露的文档缺口，不涉及宿主功能改动。生成lib未跟踪；没有commit/merge/archive/cleanup或日常部署。后续版本动作等待用户明确授权。

## Overall Decision

DECISION: FAIL

**实现和独立代码评审已通过；严格Anvil验收不能声明PASS。** 原始TDD流程偏差无法追溯消除，且全仓零skip要求未满足。保留真实失败/偏差而非改写历史或降低门禁。真实DSH close/强退、冷恢复、人类确认通道仍属于未来消费者接入前置，不是本库已验证能力。用户可审阅当前交付后，决定是否接受流程偏差和既有环境限制，再授权后续归档/提交/合入。
