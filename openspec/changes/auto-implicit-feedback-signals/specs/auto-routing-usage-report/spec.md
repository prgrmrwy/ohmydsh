## ADDED Requirements

### Requirement: 隐式信号分布
报告 SHALL 从已读取的会话日志中推导每个决策单位的两项事实：
- 回合结束类别：决策最后一次关联调用所在用户回合的 `turn/end` 原因，映射为 `completed`、`aborted-user`（取消原因为用户）、`aborted-other`、`blocked`、`other`；该回合没有 `turn/end`（会话仍在进行或日志尾段不完整）时为 `unknown`。
- 继续：该回合之后同一会话存在由用户发起的新回合。

结合账本中的曝光与切换 MANUAL 事实，报告 SHALL 在每个比较子组下输出 `implicit` 字段，把每个决策单位按以下优先级归入且只归入一类：
1. `explicit`：存在有效显式评价（撤销后为空的不算），并按评价值细分计数。
2. `negative`：回合结束类别为 `aborted-user`，或存在切换 MANUAL 事实；分别计数，同时满足时只计入总数一次。
3. `implicit-ok`：有曝光、结束类别为 `completed`、已继续，且无负向事实。
4. `not-continued`：有曝光但不满足上一类（未继续、结束类别未知或其它非负向类别）。
5. `unobserved`：没有曝光事实。

五类计数之和 SHALL 等于该子组的决策数。报告 SHALL 另外输出“曝光且有显式评价”的决策中各评价值的计数，作为隐式口径的参照。`caveats` SHALL 固定包含：`implicit-ok` 只表示用户看过且未干预，不等于分配合适；曝光判定依赖页面可见性，不代表用户读过内容；曝光事实上线之前的决策全部归为 `unobserved`。报告仍 MUST 遵守既有的只读、输出白名单与不回显要求，新增字段只包含类别名与计数。

#### Scenario: 五类互斥归类
- **GIVEN** 某子组 6 个决策：一个有显式“偏高”且回合被用户中止；一个被用户中止；一个曝光、完成、继续；一个曝光、完成但之后没有用户回合；一个无曝光；一个曝光、完成、继续但记录了切换 MANUAL
- **WHEN** 生成报告
- **THEN** `explicit` 为 1（too-high 1）、`negative` 为 2、`implicit-ok` 为 1、`not-continued` 为 1、`unobserved` 为 1，合计 6

#### Scenario: 父会话取消不算负向
- **GIVEN** 某决策曝光且已继续，其回合的 `turn/end` 为 aborted 且取消原因为 parent
- **WHEN** 生成报告
- **THEN** 该决策归入 `not-continued`，不计入 `negative`

#### Scenario: 日志尾段不完整
- **GIVEN** 某决策曝光，其所在回合位于日志被截断的尾段，没有 `turn/end`
- **WHEN** 生成报告
- **THEN** 该决策归入 `not-continued`，`tail-incomplete` 照常计数

#### Scenario: 旧数据不被当作看过
- **GIVEN** 账本只含本变更之前的绑定与显式反馈
- **WHEN** 生成报告
- **THEN** 无显式评价的决策全部归入 `unobserved`，`implicit-ok` 为 0，`caveats` 含隐式说明

#### Scenario: 新字段不泄漏
- **GIVEN** 测试数据的会话含正文 `SECRET-TEXT`，并带有隐式事实事件
- **WHEN** 生成报告
- **THEN** 输出不含 `SECRET-TEXT` 或任何 sessionId 片段，`implicit` 只含类别名与计数
