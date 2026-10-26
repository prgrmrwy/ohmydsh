# auto-allocation-feedback Specification

## Purpose
让用户对已应用的主 AUTO 资源分配给出精确绑定到回复与决策的评价，并保存不可变的决策快照，供事后评估策略是否合适；反馈本身不改变路由。

## Requirements

### Requirement: 资源分配反馈
系统 SHALL 为已应用主AUTO决策关联的回复展示反馈图标，允许合适/偏高/不足/无法判断及撤销。反馈 SHALL 精确绑定消息与请求决策，不取子任务或下一轮最近值。系统 MUST NOT 因反馈改策略、换模或重试。无已应用决策 SHALL 不显示入口。
#### Scenario: 已应用回复反馈
- **WHEN** 主AUTO请求已应用并产出回复
- **THEN** 消息末尾可选择四项评价或撤销，不改变路由

### Requirement: 评估记录可追溯
新绑定 SHALL 保存不可变决策快照：时间、策略与映射版本、决策服务模型与耗时、返回的确定度分布、实际provider/model/effort、请求事件seq及消息ID。反馈修改撤销 SHALL 独立追加含时间与身份的事件，不复制或覆盖快照。旧记录 SHALL 可读且缺失字段保持未知，不补造。统计 SHALL 按session/decision去重取最后有效反馈；无法判断与撤销单列，不当成功样本。记录 MUST NOT 包含任务原文或key。
#### Scenario: 新旧记录并存
- **WHEN** 旧反馈与含快照的新反馈混合读取并重启
- **THEN** 原评价保留，新反馈事件不改变原决策快照，旧缺失字段保持未知

#### Scenario: 修改撤销
- **WHEN** 用户修改或撤销某条回复分配评价
- **THEN** 持久保存后刷新和重启仍正确显示，失败提示且不乐观改变
#### Scenario: 手动及新回合隔离
- **WHEN** 新回合未判定、MANUAL或决策未应用
- **THEN** 不复用上轮已应用决策生成反馈入口
