## 1. 先写失败的测试

- [x] 1.1 `packages/dsh-memex/test/telemetry.test.ts`：命中解释的纯函数用例——逐词逐字段匹配（slug/title/tags/category/headings/wikilinks/body）、每词取最高权重字段、汉字子串与 ASCII 分段两种比较、输出只含词序号不含词本身；内容 hash 与 `modified` 读取；卡片文件缺失时只缺这三项。验证：无实现时失败。
- [x] 1.2 同文件：库快照——git 仓库给出 HEAD 与是否有未提交改动；非 git 目录或 git 失败记为 `unknown`；快照前后库的 `git status` 与文件不变。验证：无实现时失败。
- [x] 1.3 `packages/dsh-memex/test/tools.test.ts`：`memex_search`/`memex_recall` 带与不带 `intent`、带未知 `intent` 时，发给内核的参数与返回 JSON 逐字节相同；记录中的意图分别为原值、未提供、`unknown`；记录含会话 hash 与调用 id，不含会话 id 原文、查询原文与查询词；工具描述与改动前相同。验证：新用例失败，既有用例通过。
- [x] 1.4 同文件：写卡事件——新建与覆盖各一条且 hash 不同；附加库写入各记一条；守门拒绝或内核失败不记录；遥测不可写时写卡照常成功；关闭记忆的工作区不记录；事件与卡片 frontmatter 中都没有标题、正文或新字段。验证：无实现时失败。
- [x] 1.5 `packages/dsh-memex/test/lifecycle-runtime.test.ts`：首个请求的注入文本包含第一段写法要求与 `intent` 提示，原有护栏与写卡时机句子仍在。验证：无实现时失败。
- [x] 1.6 `packages/dsh-memex/test/recall-report.test.ts`：报告读取混有新字段的召回记录与旧记录时结果正确，且不读取写卡事件文件。验证：新用例失败或已通过（兼容性回归）。

## 2. 实现

- [x] 2.1 `packages/dsh-memex/src/telemetry/record.ts`：扩展 `HitRecord`（`rank`、`hash`、`modified`、`explain`）与 `RecallRecord`（`libraries`、`session`、`call`、`intent`），全部可选；新增命中解释函数，沿用 `anchored()` 的比较约定与内核字段权重。验证：1.1 通过。
- [x] 2.2 新增 `packages/dsh-memex/src/telemetry/snapshot.ts`：只读 git 快照（`--no-optional-locks`、1 秒超时）与卡片文件读取。验证：1.2 通过。
- [x] 2.3 `packages/dsh-memex/src/telemetry/sink.ts`：增加写卡事件文件 `writes-YYYY-MM.ndjson` 的追加函数，复用目录、权限与只告警一次的逻辑。验证：1.4 中遥测不可写用例通过。
- [x] 2.4 `packages/dsh-memex/src/tools/index.ts`：两个召回工具增加 `intent` 参数并规范化；`recordRecall` 传入库快照、命中名次与解释、会话 hash、调用 id、意图；写入成功后按库记录写卡事件（写前判断新建/覆盖，写后取 hash，模型取 `requestHeader()`）。返回值不变。验证：1.3、1.4 通过，`tools.test.ts` 既有用例全部通过。
- [x] 2.5 测量单次召回的额外耗时；超过 20ms 则改为返回后记录。验证：在测试或本机实测中记录耗时数值。
  - 实测（真实 personal 库，1 库 10 条命中，20 次）：中位 15.9ms、p90 17.3ms，低于阈值，保持同步记录；数值写入 design.md。
- [x] 2.6 `packages/dsh-memex/src/lifecycle/index.ts`：`RECALL_TEXT` 追加第一段写法与 `intent` 提示两行。验证：1.5 通过。
- [x] 2.7 `packages/dsh-memex/src/telemetry/report.ts`：确认兼容新字段（必要时调整类型）。验证：1.6 通过。
  - `StoredRecord` 由 `Partial<RecallRecord>` 派生，新字段全为可选，无需改动；报告只读 `recall-*.ndjson`，不读写卡事件。
- [x] 2.8 运行包内 `npm test`、`npm run typecheck`、`npm run build`、`npm run check:descriptions`。验证：退出码均为 0。

## 3. 指令、版本与文档

- [x] 3.1 `instructions/dsh-home.md` 的写卡句子补充第一段写法要求，与注入文本语义一致。验证：两处措辞对照检查。
- [x] 3.2 `packages/dsh-memex/package.json` 0.3.0 → 0.4.0；`dsh.yaml` 中 dsh-memex 的 version 同步，note 追加本 change 与回滚方式；CHANGELOG 的 Unreleased 合并为 0.4.0 并新增本 change 条目。验证：`npm run check:artifacts` 通过。
- [x] 3.3 更新 `packages/dsh-memex/README.md`、`README.zh.md` 的遥测字段说明，`packages/dsh-memex/docs/integration-notes.md` 记录命中解释是近似复算、git 快照只读带超时。验证：文档包含上述说明。
- [x] 3.4 `packages/dsh-memex/docs/effectiveness-evaluation-draft.md` 第 7 节标注已进入本 change 的部分。验证：文档已更新。
- [x] 3.5 运行仓库级 `npm test`、`npm run check:artifacts`、`openspec validate dsh-memex-reuse-evidence-and-card-lead --strict`。验证：退出码为 0（既有无关失败需与 main 基线对比并记录）。
  - 结果：`npm test` 424 通过 / 0 失败 / 2 跳过（既有）；首次运行因 `dsh.yaml` 的 dsh-memex note 超过 600 码点而失败，已压缩 note（细节移至 CHANGELOG）后通过。`check:artifacts` 与 `--strict` 校验通过。包内 vitest 400/400、typecheck、build、`check:descriptions` 通过。

## 4. 部署与上线观察（需用户确认后执行）

- [ ] 4.1 用户确认 DSH 空闲后执行 `node scripts/sync.mjs` 两次确认幂等，并以脱离调用方进程的方式重启。验证：第二次 sync 无变化，Web GUI 可访问。
- [ ] 4.2 GUI 实测：新会话的注入含新两行；带 `intent` 召回一次，遥测记录含库快照、命中 hash/名次/解释、会话 hash、调用 id、意图；写一张卡，`writes-*.ndjson` 出现对应事件。同时完成 `dsh-memex-defer-write-reminder` 的 3.3–3.4 实测。验证：在报告中描述观察结果，不提交截图与原始记录。
- [ ] 4.3 记录观察窗起点；1 周后统计新卡第一段达标率，3–4 周后按讨论稿统计检索与消费端，并对比上线前后各两周的召回频率与成本。验证：仓库外评估目录中有报告，说明样本量与区间。
