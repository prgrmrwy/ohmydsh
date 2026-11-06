## MODIFIED Requirements

### Requirement: 评估记录可追溯
新绑定 SHALL 保存不可变决策快照：时间、策略家族 id（`strategy`，取自注册表中匹配实际主模型的策略）、判档预设 id（`preset`，取自作出该主决策的 Jev 判断所用的预设，而非绑定时的设置）、决策服务模型与耗时、返回的确定度分布、实际 provider/model/effort、请求事件 seq 及消息 ID。新快照 MUST NOT 含 `policyVersion`、`mappingVersion` 或任何版本字段。反馈修改与撤销 SHALL 独立追加含时间与身份的事件，不复制或覆盖快照；新追加的反馈事件与隐式事实事件 MUST NOT 含 `version` 键。旧记录（含 `policyVersion`/`mappingVersion` 而无 `strategy` 的快照、无 `preset` 的快照、无快照的记录、带 `version: 2` 的反馈事件与带 `version: 1` 的事实事件）SHALL 可读，缺失字段保持未知，不补造；其它未知键与形状错误仍按损坏行跳过。`label` 端点 SHALL 原样返回快照中的 `preset`。主决策的决策时间与预设归属 SHALL 保留到该会话的主决策被新决策替换、因失败或取消被废止或会话 disposed 为止，MUST NOT 因其它会话产生的判断数量被淘汰，MUST NOT 以绑定时的设置补填。统计 SHALL 按 session/decision 去重取最后有效反馈；无法判断与撤销单列，不当成功样本。记录 MUST NOT 包含任务原文或 key。

#### Scenario: 新旧记录并存
- **GIVEN** 账本含一条旧快照绑定 `{snapshot: {policyVersion: "policy-v2-d774ffe6", mappingVersion: "capability-slots-2-magpie", …}}` 及其“合适”反馈
- **WHEN** 插件重启后新增一条主模型为 `gpt-6.1-sol` 的已应用绑定，再读取两条绑定
- **THEN** 旧绑定的快照与反馈原样可读，`strategy` 为未知；新绑定快照含 `strategy: "codex"`，不含 `policyVersion`、`mappingVersion`；之后对新绑定的反馈事件行不含 `version` 键，且不改变原决策快照

#### Scenario: 快照记录作出决策时的预设
- **GIVEN** 设置 `preset` 为 `effort-as-verification`，AUTO 主会话本回合 Jev 判断已完成；账本另有一条 0.6.6 写入、快照含 `strategy` 而无 `preset` 的绑定
- **WHEN** 在该回合回复绑定前把设置改为 `reasoning-depth`，随后回复完成并绑定，再以两条回复调用 `label`
- **THEN** 新绑定快照 `preset` 为 `effort-as-verification`；旧绑定可读且 `label` 响应快照不含 `preset`，账本中旧行字节不变；快照不含任何版本键

#### Scenario: 活跃决策跨越大量其它判断仍保留归属
- **GIVEN** 会话 A 以 `effort-as-verification` 判出并应用主决策 d1；之后会话 B 完成 201 次成功的主判断；设置 `preset` 改为 `reasoning-depth`
- **WHEN** A 在一个由子会话完成通知开启的非用户回合中完成回复并绑定，另有 A 的一条在 B 判断期间延迟完成的 d1 回复随后绑定
- **THEN** 两条绑定都含 `snapshot`，其 `decisionId` 为 d1、`snapshot.preset` 为 `effort-as-verification`、`snapshot.decidedAt` 为 d1 的判断时间；A 的 Jev 请求数不增加；会话 A disposed 后其归属条目不再保留

#### Scenario: 新旧事件格式混读
- **GIVEN** 账本含带 `version: 2` 的反馈事件、带 `version: 1` 的事实事件、不带 `version` 的反馈与事实事件，以及一行带未知键 `extra` 的反馈事件
- **WHEN** 插件重启后读取
- **THEN** 前四类都生效，折叠规则与只有旧格式时一致；带 `extra` 的行被跳过

#### Scenario: 修改撤销
- **WHEN** 用户修改或撤销某条回复分配评价
- **THEN** 持久保存后刷新和重启仍正确显示，失败提示且不乐观改变

#### Scenario: 手动及新回合隔离
- **WHEN** 新回合未判定、MANUAL 或决策未应用
- **THEN** 不复用上轮已应用决策生成反馈入口
