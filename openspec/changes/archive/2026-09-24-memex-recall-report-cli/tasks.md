## 1. 规范

- [x] 1.1 在 `dsh-memex-memory` 增加「召回报告为随插件分发的只读命令」requirement
- [x] 1.2 `openspec validate memex-recall-report-cli --strict` 通过

## 2. 统计逻辑

- [x] 2.1 `src/telemetry/report.ts`：纯函数，输入记录、卡片 slug、时间窗，输出结构化统计
- [x] 2.2 保持现行口径：空结果、仅非锚定命中、逐库归属、缺 scope 旧记录计入但不归属、坏行跳过
- [x] 2.3 夹具测试覆盖上述口径，以及另一库同名卡被召回时本库卡仍判为从未召回（修正旧脚本口径）

## 3. 命令入口

- [x] 3.1 `src/cli/recall-report.ts`：参数 `--days` / `--lib` / `--scope`，目录复用 `telemetryDir()`
- [x] 3.2 `package.json` 增加 `bin: dsh-memex-recall-report`
- [x] 3.3 测试：命令只读——运行前后遥测目录与库目录无任何文件变化

## 4. 验收

- [x] 4.1 package typecheck / test，仓库 `npm test`、`check:artifacts`
- [x] 4.2 `node scripts/sync.mjs` 后 profile 的 `.bin/dsh-memex-recall-report` 存在且可执行，第二次 sync 无变化
- [x] 4.3 对同一份真实遥测与新旧两版比对：除同名跨库卡外数字一致

## 验收记录

- 2.3 变异验证：把判定改回旧口径（按 slug 跨库匹配），恰好 2 个用例失败，恢复后全绿
- 4.2 `.bin/dsh-memex-recall-report -> ../dsh-memex/lib/cli/recall-report.js`，目标 `-rwxr-xr-x`；第二次 sync `no changes`
- 4.3 真实遥测：统计行逐字一致，NEVER RECALLED 均为 143/147；MOST RETURNED 仅同为 1x 的并列项顺序不同（新版按 key 稳定排序）；真实数据中无同名跨库卡，故修正口径未产生数字差异
