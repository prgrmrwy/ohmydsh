## Why

`sync` 判断 local package 是否需要重新构建时，只看**输入侧**：源码 hash 与账本是否一致、`lib/` 目录是否存在。它从不验证现有构建产物**是否由当前源码编译而来**。当"源码 hash 命中账本、但 `lib/` 并非其产物"时，构建被跳过，陈旧产物被当作合法结果交给下游。

下游的 `sync-local-deploy-refresh`（change `2026-09-03-sync-local-deploy-refresh`）随后忠实地把这份陈旧产物原子地、经复验地部署上线——它保证的是"部署副本 ↔ 源目录产物"一致，**默认源目录产物本身正确**。两个机制各自按契约正确工作，缺口在它们中间：没有任何一环负责"源目录产物 ↔ 本机上次构建产出"的一致性。

**失败是静默的**：日志照常打印 `reinstalling atomically`，部署哈希复验通过，退出码 0。表现为源码已修复、测试全绿、改动已合入主干，但运行时行为仍是旧的。

2026-09-08 实证：`dsh-pet` 的一处修复因此**两次**被静默部署成旧版本。实验可复现——在 main 上只污染 `lib/index.js`、完全不动 `src/`，`sync` 不重建，直接将被污染产物部署上线。跨 checkout 时尤其容易触发（在 worktree 构建后账本已记录该源码 hash，合入主干后主 checkout 源码 hash 相同 → 命中 → 跳过构建 → 部署主 checkout 那份过期 `lib/`），单 checkout 的分支切换、rebase、手动删改产物同样可触发。

## What Changes

- 构建新鲜度纳入判定：`sync` SHALL 记录"上次成功构建**实际产出**的发布内容 hash"，并在磁盘上的产物 hash 与该记录不一致时重新构建，而不仅依据"源码是否相对上次 sync 变化"与"产物目录是否存在"。
- 无法证明产物即上次构建产出时（例如账本中缺少该记录、或记录与当前产物 hash 不符）SHALL 重新构建，而非假定其为最新——与仓库既有的 fail closed 取向一致。
- 保持增量构建：源码输入未变且产物 hash 与记录一致时，仍不重建、报告 up-to-date，连续两次 `dsh build` 无变化的幂等性不变。
- 非 local package（remote package、skill、preset、patch）流程不变；`sync-local-deploy-refresh` 的部署面校验与原子刷新语义不变，本变更只在其上游补齐前置条件。

## Capabilities

### New Capabilities
<!-- 无：本变更不引入新能力，只补齐既有 sync 部署正确性能力的上游缺口。 -->

### Modified Capabilities
- `sync-local-deploy-refresh`: 该能力当前只承诺"部署副本发布字节 == 源目录发布字节"。新增要求：在此比对之前，系统 SHALL 先确保源目录产物仍是本机上次成功构建的产出，否则一致性比对只能证明"两份同样陈旧的产物彼此相等"。这使该能力的 Purpose 从"构建产物能忠实上线"扩展为"当前源码的构建产物能忠实上线"。

## Impact

- `scripts/sync.mjs`：local package 构建判定路径（`needsBuild` 及其依据 `localBuildInputHash` / `localBuildOutputsExist`）与账本读写。
- `$DSH_HOME/.dsh-sync-state.json`：新增 `localPackageBuiltFrom`，每包一条 `{ input, output }` 定长记录。需兼容既有账本——升级后首次运行时该记录缺失，按"无法证明"处理（重建一次），不得因缺字段而失败。
- `tests/`：新增覆盖"源码未变但产物陈旧 → 必须重建"的回归测试；既有 `tests/sync-deploy-refresh.test.mjs` 的部署面语义应保持通过。
- `openspec/specs/sync-local-deploy-refresh/spec.md`：归档时按 delta 更新。
- 无用户可见配置变更；不改 `dsh.yaml` manifest 结构，不影响任何 DSH 插件运行时行为。
