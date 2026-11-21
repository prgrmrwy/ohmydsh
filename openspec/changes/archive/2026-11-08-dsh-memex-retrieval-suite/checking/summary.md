# 20 题开发集基线（2026-11-08）

20 题的目标均已独立按卡片原文确认；正式关键词评测退出 0，状态 ok、validBaseline:true，运行前后快照完整性均有效且 differences 为空。原有 9 题历史标注不再作为目标正确性的证明。

## 目标来源与限制

- 使用原 20 条症状式开发种子，没有新增题、虚构 slug 或从本轮检索返回反推目标。
- 在计分前冻结 personal 的 1,361 张卡片副本。独立会话只看原题和未排序卡片原文，逐项确认 20/20 目标，37 段逐字引文和 20 个卡片哈希均核对；不调用被测检索，不读取旧的逐题结果或实现。
- 输入种子文档本身带有旧目标提示与历史汇总指标，这些曾被看到，已披露；它们没有作为目标成立的依据。这里的独立性是目标依据不来自实测排名，不宣称完全盲出题。
- 原题由熟悉卡片内容的人编写，仍是偏乐观 dev 种子，全部 single-hop；不是 holdout、全库 recall 或端到端有效性评估。历史版本与后来修复的卡，按全文说明适用边界，不把旧症状当成当前缺陷。

私有目标证据已与观察报告一并保存到仓库外 `~/.dsh-memex-eval/change-observation-20261108-37d8a8c5/target-validation/`。其中有题目、直接目标、原文行号、完整内容 hash 和逐项边界；仓库不保存原题或卡片正文。

## 正式运行

- 运行目录：`~/.dsh-memex-eval/retrieval/37d8a8c5-f483-4d2b-ab45-e33c681fea0a/`。
- 使用正式 CLI 的 `--library <personal冻结副本> --goldset <独立确认的20题> --set dev`，评测执行没有调用模型或语义来源；没有改默认后端或原记忆库。
- 内核 0.4.1；retrieval-v1；han-bigram-v1；K=10；lexical；无手工干扰卡。
- 输入 1,361 张，按既定规则排除 7 张，剩余 1,354 张卡；清单整体 SHA-256 为 `2135510732e10647dac366d007e0df5c27e974f00d70c24cd1fcf08fb3555264`。
- 白名单配置为 `nestedSlugs:false`，来源未提供 `.memexrc`，使用协议默认；没有复制其它配置或凭据。

| 指标 | 实测 |
| --- | ---: |
| hit@1 | 13/20（65%） |
| hit@3 | 14/20（70%） |
| hit@10 | 16/20（80%） |
| MRR | 0.6931 |
| 空结果 | 0/20 |
| 误选率 | 7/20（35%） |
| 首位干扰卡 | 0 |
| 每题含进程启动 p50 / p95 | 243.4 / 264.8 ms |
| 返回字符数中位数（chars-v1） | 5,567，20 题参与 |
| 内核安装大小 / 快照大小 | 85,629,442 / 2,113,848 bytes |

报告标注“样本不足，只看趋势”；multi-hop 无样本，保持 unknown。快照、题数及目标确认与 11-03 的 9 题历史运行不同，不把这两轮的指标差异称为算法提升或退化，也不由此改排序或默认路径。

## 交用户复核的排除清单

类别：handoff、eval。前缀：probe-、handoff-、memex-retrieval-probe-。实际排除以下 7 个 slug：

1. handoff-memex-effectiveness-eval-2026-10-30
2. handoff-store-task-aborted-formatter
3. memex-eval-source-fingerprints-need-run-boundaries
4. memex-retrieval-probe-20-symptom-queries-2026-10-30
5. memex-selftest-rank-uses-frozen-tool-results
6. probe-deployed-exported-functions-for-policy-evidence
7. probe-page-bare-session-path-must-redirect

没有为改善分数额外排除 research/decision、正文命中卡或其它未列规则。完整逐文件清单和 hash 在私有正式报告中。

## 离线重算与收尾

同一轮的正式 `--recompute` 退出 0，另写报告；实际生成的重算 report JSON 与原 report JSON 逐字节及结构均完全相同，不只是“原报告没有被覆盖”。原报告未改写。

8.3 的完整 20 题 dev 基线与排除清单已补齐。2026-11-08 已先归档前两个观察 change，再核对固定底文的全部原约束和场景；主规范因长描述移入既有场景而排版变化，按 8.5 重新生成 integration delta 后完成合并与归档。未覆盖或删去已演进要求，原 fix-stale delta 的完整 SHA-256 仍为 5b82428fb61ae123f9af279e6108340c988c4ef9b7611a43c710c98145804c40。没有触发生产部署或日常 Host 重启。
