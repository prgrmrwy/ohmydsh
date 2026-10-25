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
- 本期只提供采集与可追溯性，不做报表、自动阈值调整、自动训练或换模重试。

## 确定度
UI称“判定确定度”，Choice公式为`(pmax - 1/n)/(1 - 1/n)`；n为该维候选数。三选一最高概率70%得到55%，不等于选中概率或任务成功率。插件直接展示服务返回值，分布独立保留，不从四舍五入后的百分比反推。官方定义：https://docs.typesafe.ai/confidence.md 。
