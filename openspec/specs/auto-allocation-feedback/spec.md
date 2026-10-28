# auto-allocation-feedback Specification

## Purpose
让用户对已应用的主 AUTO 资源分配给出精确绑定到回复与决策的评价，并保存不可变的决策快照，供事后评估策略是否合适；反馈本身不改变路由。
## Requirements
### Requirement: 资源分配反馈
系统 SHALL 为已应用主AUTO决策关联的回复展示反馈图标，允许合适/偏高/不足/无法判断及撤销。反馈 SHALL 精确绑定消息与请求决策，不取子任务或下一轮最近值。系统 MUST NOT 因反馈改策略、换模或重试。无已应用决策 SHALL 不显示入口。

“已应用” SHALL 以该回合实际发出的模型请求配置判定，与宿主是否为该请求写入新的 `request/header` 事件无关：判断结果与上一请求的配置相同、宿主沿用旧请求头时，该回合的决策同样 SHALL 判定为已应用并绑定回复。实际配置与判断不一致时仍 SHALL 判定为未应用。

#### Scenario: 已应用回复反馈
- **WHEN** 主AUTO请求已应用并产出回复
- **THEN** 消息末尾可选择四项评价或撤销，不改变路由

#### Scenario: 配置未变的回合
- **WHEN** 连续两个用户回合的判断结果相同，第二个回合的实际请求配置与上一请求一致，宿主没有为它写入新的 `request/header`
- **THEN** 第二个回合的决策状态为已应用，其回复绑定该决策并显示反馈入口，绑定快照的 `requestSeq` 指向当时生效的请求头事件

### Requirement: 评估记录可追溯
新绑定 SHALL 保存不可变决策快照：时间、策略家族 id（`strategy`，取自注册表中匹配实际主模型的策略）、决策服务模型与耗时、返回的确定度分布、实际 provider/model/effort、请求事件 seq 及消息 ID。新快照 MUST NOT 含 `policyVersion`、`mappingVersion` 或任何版本字段。反馈修改与撤销 SHALL 独立追加含时间与身份的事件，不复制或覆盖快照；新追加的反馈事件与隐式事实事件 MUST NOT 含 `version` 键。旧记录（含 `policyVersion`/`mappingVersion` 而无 `strategy` 的快照、无快照的记录、带 `version: 2` 的反馈事件与带 `version: 1` 的事实事件）SHALL 可读，缺失字段保持未知，不补造；其它未知键与形状错误仍按损坏行跳过。统计 SHALL 按 session/decision 去重取最后有效反馈；无法判断与撤销单列，不当成功样本。记录 MUST NOT 包含任务原文或 key。

#### Scenario: 新旧记录并存
- **GIVEN** 账本含一条旧快照绑定 `{snapshot: {policyVersion: "policy-v2-d774ffe6", mappingVersion: "capability-slots-2-magpie", …}}` 及其“合适”反馈
- **WHEN** 插件重启后新增一条主模型为 `gpt-6.1-sol` 的已应用绑定，再读取两条绑定
- **THEN** 旧绑定的快照与反馈原样可读，`strategy` 为未知；新绑定快照含 `strategy: "codex"`，不含 `policyVersion`、`mappingVersion`；之后对新绑定的反馈事件行不含 `version` 键，且不改变原决策快照

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

### Requirement: 隐式反馈事实
系统 SHALL 为已应用主 AUTO 决策记录以下两类**会话日志中不存在**的事实，作为独立事件追加到反馈账本，并以 `(sessionId, decisionId)` 关联：
- 曝光：该决策关联的某条回复在页面可见、窗口处于前台时，连续可见达到 3 秒，记一次曝光。未达到阈值、页面隐藏或无已应用决策的回复 MUST NOT 记曝光。
- 切换 MANUAL：用户把会话切到 MANUAL 时，若该会话存在最近一次已应用且尚未被新请求取代的主决策，记一次切换，关联到该决策。无论切换发生在该决策的回合进行中还是回合结束后，都 SHALL 记录；判定 SHALL 基于切换生效之前的状态，切换本身清除决策状态 MUST NOT 导致漏记。

每类事实对同一决策 SHALL 至多记录一次。回合结束原因与是否继续下一回合 MUST NOT 由运行时重复记录，它们由会话日志承载，在报告时推导。事实事件 MUST NOT 改写决策快照或显式反馈，MUST NOT 被当作显式评价显示在反馈菜单中，MUST NOT 包含任务原文、消息正文或 key。系统 MUST NOT 因这些事实改变策略、换模或重试。事实写入失败 SHALL 只记日志，不影响回复展示、显式反馈或路由。

#### Scenario: 看过且未干预
- **WHEN** 已应用决策的回复连续可见 3 秒，用户随后在 AUTO 下发起下一回合
- **THEN** 账本中该决策只有一条曝光事实，决策快照与显式反馈不变

#### Scenario: 一闪而过不算曝光
- **WHEN** 回复只可见 1 秒就被滚出视口，或页面处于后台标签
- **THEN** 不记录曝光事实

#### Scenario: 回合后切换 MANUAL
- **WHEN** 已应用决策的回合结束后、下一次模型请求之前，用户把会话切到 MANUAL
- **THEN** 该决策记录一次切换 MANUAL 事实；再次切回 AUTO 或重复切换不新增记录

#### Scenario: 回合进行中切换 MANUAL
- **WHEN** 已应用决策的回合仍在运行，用户把会话切到 MANUAL
- **THEN** 该决策记录一次切换 MANUAL 事实

#### Scenario: 新请求之后切换不再关联旧决策
- **WHEN** 已应用决策之后会话又发出了新的模型请求（新决策或 MANUAL 配置），用户随后切到 MANUAL
- **THEN** 不为旧决策记录切换 MANUAL 事实

#### Scenario: 多条回复与重复触发
- **WHEN** 同一决策关联的三条回复先后可见，或同一回复反复滚入视口、刷新页面
- **THEN** 该决策只有一条曝光事实

#### Scenario: 无已应用决策
- **WHEN** 回合为 MANUAL、决策未应用，或回复属于子会话
- **THEN** 不记录任何隐式事实

#### Scenario: 旧读取兼容
- **WHEN** 账本中混有隐式事实事件、旧完整记录和显式反馈事件，插件重启后读取
- **THEN** 绑定与显式反馈的读取结果与未加入隐式事实时相同

