# AUTO 人工反馈数据与评估口径

## 记录
`$DSH_HOME/state/auto-model-routing/allocation-feedback.jsonl` 是本地append-only记录，无会话正文和key。

绑定行使用sessionId/messageId/decisionId、depth、实际model/effort，新增boundAt与不可变snapshot：decidedAt/appliedAt、policyVersion/mappingVersion、decisionProvider/decisionModel、判断ms、返回的confidence/probabilities、实际provider、requestSeq及可得时requestTurn。requestSeq是同session请求头事件，可与该会话历史关联actual request及usage；绑定并非完成任务或用量已知的证明。

反馈事件为`type:feedback, version:2`，带sessionId/messageId/decisionId、at、feedback。每次修改或撤销独立追加；null表示撤销。读取时按追加顺序应用到既有精确绑定。历史完整记录仍兼容，原快照不可被后续同身份行替换；旧记录没有时间或快照则未知，禁止用迁移时刻或最新配置补造。

## 评估
- 评估单位为(sessionId, decisionId)，不是每个assistant/message，避免同轮多条工具消息导致重复计数。先按消息取最后事件，再按决策取最后反馈；历史无时间以追加顺序作本文件内顺序，跨文件不可猜。
- appropriate/too-high/too-low分别统计；unknown不是满意，null撤销不计有效评价；未评价不能计为合适。多条消息评价冲突也应单独报告。
- 按策略版本/映射版本/服务模型及depth/实际路由分组；旧缺字段独立unknown组，不混进新策略精确对照。
- 以requestSeq和消息ID关联实际usage/延迟/返工证据；拿不到价格或token就未知。用户主观反馈不等于正确性oracle，适合率也不能单独证明质量或节省。
- 按需观察报表见包内 skill `auto-model-routing-report`（`lib/usage-report.js`，只读）；仍不做自动阈值调整、自动训练或换模重试。

## 隐式事实与分布（2026-10-26）

运行时只追加 `{type:'fact', version:1, sessionId, decisionId, fact, at}`。`fact` 仅为 `exposed` 或 `manual-switch`；按决策/类型保留首次事实，时间由 Host 生成，不收正文。曝光要求回复操作栏在前台、聚焦页面连续完整可见 3 秒；切 MANUAL 在清除运行态之前取当前主决策，只在切换成功后记录。写入失败只记录日志，不阻断主线。

回合结束与继续不重复写账本，按需报告从已有日志推导。决策所在回合取最后一次关联调用的实际回合号，不是归属的用户回合。第一个后续用户回合的开始时间为继续时间；曝光时间必须早于继续时间，否则视为事后翻看，不算有效曝光。没有继续时曝光仍有效，但不能得到隐式无异议。

每个比较子组的 `implicit.counts` 五类互斥，合计等于决策数：
1. `explicit`：有显式评价；`implicit.explicit` 分类别，冲突单列。
2. `negative`：无显式评价，且用户中止了决策最后一次关联调用所在回合，或切换 MANUAL；`implicit.negative` 分原因，两原因可重叠。
3. `implicit-ok`：有效曝光、正常完成且用户继续，无负向事实。只表示这些行为同时出现，不证明资源分配合适。
4. `inconclusive`：有效曝光但其它条件不足，包括未继续、结束未知或父会话取消。
5. `unobserved`：没有有效曝光。

`implicit.exposedExplicit` 是有效曝光且有显式评价的参照计数。曝光不证明读过；用户中止或切 MANUAL 也可能因为换任务，不证明策略有错。旧数据不回填曝光，未知不能当正例。隐式信号、显式评价和将来的机器评审均应分开，不自动调策略。

D012 修复后，实际配置不变、不产生新 `request/header` 的回合也会绑定决策。`snapshot.requestSeq` 指向当时生效的请求头（可能来自更早回合），`requestTurn` 是应用时的当前回合。上线后记录覆盖率会提高；这是补缺口，不是策略改善，不能直接比较修复前后的适合率。

## 确定度
UI称“判定确定度”，Choice公式为`(pmax - 1/n)/(1 - 1/n)`；n为该维候选数。三选一最高概率70%得到55%，不等于选中概率或任务成功率。插件直接展示服务返回值，分布独立保留，不从四舍五入后的百分比反推。官方定义：https://docs.typesafe.ai/confidence.md 。
