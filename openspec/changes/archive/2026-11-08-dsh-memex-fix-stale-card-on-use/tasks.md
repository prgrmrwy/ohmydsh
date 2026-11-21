## 1. 先写失败的测试

- [x] 1.1 `packages/dsh-memex/test/lifecycle-runtime.test.ts`：首个请求的注入文本包含“使用时修订过期卡片”的提示，并点名用 `memex_write`、保留原标题与创建日期、追加带日期与依据的修订说明、只修订实际核对过的事实；原有句子（召回入口、写卡时机、第一段写法、intent、护栏）仍然存在。验证：无实现时新用例失败，既有用例通过。
- [x] 1.2 同文件：压缩后重新注入的引导同样包含该提示。验证：无实现时失败，或若已由现有压缩用例覆盖，则在用例中补充断言。

## 2. 实现

- [x] 2.1 `packages/dsh-memex/src/lifecycle/index.ts`：在 `RECALL_TEXT` 的写卡相关句子之后追加一行英文提示，语义与 delta spec 一致，并加注释说明这是对内核方法论的本地附加。验证：1.1、1.2 通过。
- [x] 2.2 `instructions/dsh-home.md`：写卡说明补充同样含义的中文句子。验证：两处措辞对照，语义一致。
- [x] 2.3 运行包内 `npm test`、`npm run typecheck`、`npm run build`、`npm run check:descriptions`。验证：退出码均为 0。

## 3. 版本与文档

- [x] 3.1 `packages/dsh-memex/package.json` 0.4.0 → 0.4.1；`dsh.yaml` 中 dsh-memex 的 version 同步，note 追加本 change 与回滚方式（保持在 600 码点以内）；CHANGELOG 新增 0.4.1 条目。验证：`npm run check:artifacts` 通过。
- [x] 3.2 `packages/dsh-memex/README.md`、`README.zh.md` 中描述注入内容的段落补充本条（若有该段落）。验证：文档与注入文本一致。
- [x] 3.3 运行仓库级 `npm test`、`npm run check:artifacts`、`openspec validate dsh-memex-fix-stale-card-on-use --strict`。验证：退出码为 0（既有无关失败与 main 基线对比并记录）。
  - 结果（2026-10-26）：包内 vitest 401/401、typecheck、build、`check:descriptions` 通过；仓库级 `npm test` 622 项中 619 通过 / 1 失败 / 2 跳过，`check:artifacts` 与 `--strict` 通过。唯一失败 `tests/auto-model-routing-sync.test.mjs`（期望第二次 sync 无变化，实际报 dsh-auto-model-routing 0.4.0 -> 0.3.0）与本 change 无关：暂存本 change 全部改动后单独重跑同样失败；`configurable-jev-provider` 任务 10.1 也已将其记为既有基线失败。

## 4. 部署与观察（需用户确认后执行）

- [x] 4.1 用户确认 DSH 空闲后执行 `node scripts/sync.mjs` 两次确认幂等，并重启 DSH。验证：第二次 sync 无变化；`$DSH_HOME/AGENTS.md` 含新句子；新会话的注入文本含新的一行。
  - 2026-10-26 14:51：另一会话执行 `configurable-jev-provider` 任务 10.4 的 `dsh build`，从同一工作区构建，已把本 change 未提交的 0.4.1 与 `AGENTS.md` 新句子物化到 `$DSH_HOME`（部署包 0.4.1、`AGENTS.md` 含新句子，已核对）。DSH 尚未重启，运行中的 Host 仍是旧注入文本；14:53 再次执行 `node scripts/sync.mjs` 输出 no changes（幂等已确认）。15:09 用户重启 DSH：运行中的 Host 加载部署包 0.4.1（`lib/lifecycle/index.js` 含新提示）；重启后新建会话的 `plugin:dsh-memex` instructions 注入已含新的一行（会话日志核对）。
- [x] 4.2 上线约两周后，从写卡遥测统计 `overwritten` 事件数，抽查其中修订说明是否写明依据、`created` 是否保留原值；对比上线前后新卡数量。验证：仓库外评估目录中有简短记录，说明样本量。
  - 2026-11-08（上线后 12.89 天，约 13 天，未称满 14 天）：[脱敏摘要](checking/summary.md)与仓库外 `~/.dsh-memex-eval/change-observation-20261108-37d8a8c5/REPORT.md` 已落盘。截止共 89 条可关联 overwritten，personal 为 66 条；固定身份哈希抽样 12 条，均能绑定实际落盘版本、带日期与依据的说明，created 均与不同的更早已知版本一致，不保证所有中间更新。等长 12.80699 天的前/后窗 created 为 594/173，personal 为 274/156；记录任务/库/模型变化与未知，不作因果解释。
  - 2026-11-09 10:00 +08:00 定时补充复核：仓库外 [简报](</Users/bytedance/.dsh-memex-eval/stale-card-on-use-20261109-1000/REPORT.md>)及遥测快照/逐日统计/前后 Git blob 已保存；不改卡。排除 3 条 `mxp-*` 后 895 条事件，前窗可见 created/overwritten 为 591/37，后窗截至 10:00 为 177/90。前窗最早遥测距请求起点缺 28.63 小时，后窗距满 14 天尚差 5 小时 9 分，不声称两个完整两周窗。等长 12.80699 天比较为 created 591→173（日均 46.15→13.51，-70.73%）、personal 274→156（日均 21.39→12.18，-43.07%）；排除 eval-* 的敏感性分析为 591→172。personal 后窗 67 条覆写中固定身份哈希抽样 12 条，写后 hash 与更早不同版本均可绑定；created 11/12 一致，另 1 条由 11-02 改为 11-01（不是改成修订当天，不能凭此确定是否恢复原日期）；标题 11/12 保留。新增尾部说明 11/12 有日期，其中 6/12 明确到文件行号，其余依据精度不同；另 1 条只有正文内修正。不能推断全库遵从率或提示造成下降。与 11-08 样本/截止/排除口径不同，保留历史记录、不合并总体；本次是已归档 4.2 的补充检查，不重新打开 change。
- [x] 4.3 归档顺序：在 `dsh-memex-reuse-evidence-and-card-lead` 归档之后再归档本 change，归档前核对主 spec 同时包含第一段写法、intent 与使用时修订三项。验证：归档后主 spec 包含三项提示。

  - 2026-11-08：前置 reuse change 已归档，归档前后主规范均核对含第一段、intent、使用时修订三项提示；按依赖顺序完成本 change 归档。
