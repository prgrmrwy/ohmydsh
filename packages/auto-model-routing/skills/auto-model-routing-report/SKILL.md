---
name: auto-model-routing-report
description: 仅当用户明确要求评估 AUTO 效果、观察 AUTO 期间的 token 用量或判断分布，或直接点名 auto-model-routing-report 时使用：只读汇总本地 AUTO 决策记录与会话实际用量。不得主动执行或创建定时任务；会话处于 AUTO、普通 token 问题、路由判断或日常任务都不是触发条件。
---

# AUTO 用量观察报告

**仅当用户明确要求时使用。** 不得主动执行，也不得创建定时任务或后台采集。会话处于 AUTO、用户询问 token 计价、讨论路由策略，都不是使用本 skill 的理由。

## 它能回答什么

- AUTO 期间做了哪些决策，按策略版本、模型和推理深度（depth）分组，以及这些决策实际消耗了多少 token。
- 数据覆盖情况：哪些回合没有记录，以及有多少会话处于 AUTO 但完全没有记录。
- 对照首个 AUTO 记录之前的回合，effort 起点发生了什么变化。

**它不能回答“AUTO 省了多少”**：这是观察数据，不是受控对照。

## 步骤

1. 运行（只读：不写文件、不联网、不调用模型）：

   ```bash
   node "<插件目录>/lib/usage-report.js"                     # 全部数据
   node "<插件目录>/lib/usage-report.js" --since 2026-11-01  # 从本地时区该日 00:00 起
   ```

   `<插件目录>` 是 `dsh-auto-model-routing` 包所在的目录。`$DSH_HOME` 未设置时，默认读取 `~/.dsh`。

2. **先检查数据质量，再看数字：**
   - `failures` 中任一项明显不为 0，或 `coverage.unlinkedBindings` 偏高时，说明日志格式可能已随 DSH 升级而变化。此时停止解读，先告诉用户需要核对。
   - `failures.tail-incomplete` 为 1 通常是正常的，因为当前会话的日志还在写入。

3. 转述结果时**保留以下含义，不得放大**：
   - `conclusion: insufficient-sample` → “样本不足，尚不能判断”。门槛是 ≥20 个决策，且来自 ≥3 个会话。
   - `caveats` 中的每一项都要用一句话说明：
     - `observational-not-controlled`：观察数据，不是受控对照；判断因果需要专门对照实验。
     - `scope-main-session-assistant-calls-only`：不含子会话、压缩摘要、标题生成、Jev 判档和失败重试的用量，因此不能推出“节省”。
     - `only-applied-decisions-recorded`：只记录实际生效的决策，已统计部分可能偏向某类回合；`coverage.turnsWithoutRecord` 显示缺口大小。
     - `token-semantics-differ-by-provider`：不同 provider 的 token 口径可能不同，不要跨模型比较。
     - `reference-before-auto-effort-only-confounded`：`referenceBeforeAuto` 只用于看 effort 起点的变化；它受会话阶段、任务类型、模型切换等因素混杂，不能当作对照组。
     - `mode-history-not-persisted`：会话模式的切换历史没有保存，会话计数只是粗略参考。
   - 不要自行计算节省百分比，不要说“质量不变”，也不要把“首个记录之前”称为 MANUAL。
   - token 均值的分母是**出现该字段的调用数**（`present`）；值为 `null` 表示该字段从未出现，不是 0。

4. 如果要把报告原文贴到当前会话之外，例如飞书或 issue，**先请用户确认**。模型名、provider 名可能包含内部信息。

## 前提

- 报告每次都从原始记录和会话日志重新计算，不保存快照。用户删除旧会话后，对应历史无法再统计。
- 旧版策略（legacy）的判档一致率请用同一插件目录下的 `scripts/label-report.mjs`。
