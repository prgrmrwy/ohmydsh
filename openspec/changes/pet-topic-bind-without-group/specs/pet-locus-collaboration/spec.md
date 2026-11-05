## MODIFIED Requirements

### Requirement: 入口建立统一为一条路径

auto、Q&A 与显式绑定 SHALL 走同一条建立路径，三者只在"干活主会话从哪来"上不同：
- auto（未绑定入口的首个授权 at）：由 Pet 在 default workspace 新建干活主会话；
- Q&A：以所有者打开的会话为干活主会话；
- `/bind`：以所有者指定的普通一级会话为干活主会话。

之后三者 SHALL 一致地：复用该干活主会话的 active locus 主会话；没有时新建 locus 主会话，并按"协作空间由干活主会话与 locus 主会话两个普通成员组成"建立空间；再为入口发布一个子会话状态为 `not-created` 的新代际。建立 MUST NOT 预先创建子会话。显式绑定改变入口来源时 SHALL 如实告知上下文改变。

显式绑定是所有者对"该入口 ↔ 该干活主会话"的点对点声明，MUST NOT 为任何其它入口执行 auto 建立、旧模型退休重建或修复。凡因此需要的会话或协作空间，都 MUST NOT 被创建：包括自动干活主会话，以及非 W 的 locus 主会话与协作空间。

下文"群级结构未建立"指以下两种情况之一：
- 该 chatId 下不存在任何群级 locus 行（不论状态）；
- 最新群级 locus 行属于旧模型（其父会话不是任何 locus 主会话），且不处于所有者停止或退役状态。

在话题内显式 `/bind W`、且群级结构未建立时，系统 SHALL 只建立该话题入口：复用或新建 W 的 locus 主会话，发布一个不带 `parentLocusId` 的话题代际（下称"无父话题"）。该话题自身若有旧模型行，按"旧模型入口按退休规则处理"由该代际取代；群级行保持原样。

群级结构已按三层模型建立时：
- 若群级当前代可服务（`active` 或 `not-created`），显式话题挂在其下，不改变群来源；
- 若群级当前代处于停止、退役、失效，或需要换代、迁移才能服务，话题显式绑定 SHALL 被拒绝，并且不修复群级入口、不创建任何会话。

无父话题建立之后，群本体或其它未绑定话题的首个授权 at SHALL 照常按 auto（或旧模型退休）规则建立群级结构；已有的无父话题 MUST NOT 因此被改挂、换来源或换代。未绑定话题在群级结构未建立时的首个授权 at，仍按 auto 先建立群级结构，再以群级 locus 为父。

#### Scenario: auto 建立
- **WHEN** 一个从未关联的群收到所有者的首个 at
- **THEN** Pet 新建干活主会话与 locus 主会话，建立协作空间，入口新代际为 `not-created`，随后按首条消息创建子会话并处理该消息

#### Scenario: 绑定到已有干活主会话复用 locus 主会话
- **GIVEN** 干活主会话 W 已有 active locus 主会话 M
- **WHEN** 所有者把另一个群 `/bind` 到 W
- **THEN** 不新建 locus 主会话，新入口的父为 M

#### Scenario: 建立失败不留半成品
- **WHEN** 新建 locus 主会话成功但建立协作空间失败
- **THEN** 本次建立失败并回执；provisioning 操作按"provisioning 失败超时后不再阻塞"处理，补偿器归档未投入使用的 locus 主会话

#### Scenario: 从未建立的群内话题显式绑定只建话题
- **GIVEN** 群 G 下不存在任何群级 locus 行，干活主会话 W 没有 locus 主会话
- **WHEN** 所有者在 G 的话题 T 内 `/bind W`
- **THEN**
  - `createMainSession` 调用 0 次；`createLocusMainSession` 与 `establishSpace` 各调用 1 次，且都针对 W；
  - T 的代际为 `not-created`，父为 W 的 locus 主会话，不带 `parentLocusId`；
  - G 仍没有任何群级 locus 行。

#### Scenario: 话题显式绑定复用已有 locus 主会话
- **GIVEN** 群 G 下不存在群级 locus 行，W 已有 active locus 主会话 M
- **WHEN** 所有者在 G 的话题 T 内 `/bind W`
- **THEN** `createMainSession`、`createLocusMainSession`、`establishSpace` 均调用 0 次；T 的代际父为 M，不带 `parentLocusId`

#### Scenario: 旧模型群内话题显式绑定不修复群
- **GIVEN** 群 G 的最新群级 locus 行属于旧模型且未被所有者停止，话题 T 尚无任何行
- **WHEN** 所有者在 T 内 `/bind W`
- **THEN** `createMainSession` 调用 0 次；G 的群级行逐字段不变；T 为无父话题，父为 W 的 locus 主会话

#### Scenario: 旧模型话题的显式绑定不修复其旧群
- **GIVEN** 群 G 的最新群级 locus 行与话题 T 的最新行都属于旧模型，且都未被所有者停止
- **WHEN** 所有者在 T 内 `/bind W`
- **THEN** `createMainSession` 调用 0 次；G 的群级行逐字段不变；T 的新代际取代旧行，为 W 下的无父话题

#### Scenario: 无父话题同源重复绑定幂等
- **GIVEN** 话题 T 是 W 的无父话题，且 G 当前仍没有群级 locus 行
- **WHEN** 所有者在 T 内再次 `/bind W`
- **THEN** 返回 reused；locus 行总数、locus 主会话数与会话创建调用次数都不变；G 仍没有群级 locus 行

#### Scenario: 群后来建立后无父话题同源重复绑定
- **GIVEN** 话题 T 是 W 的无父话题，之后 G 已按 auto 建立群级 locus L
- **WHEN** 所有者在 T 内再次 `/bind W`
- **THEN** 返回 reused；T 的当前代际号与 `parentLocusId` 缺省不变；L 的代际与父会话不变

#### Scenario: 群已有群级入口时话题显式绑定不变
- **GIVEN** 群 G 已有 active 三层群级 locus L（来源 auto，干活主会话 W0）
- **WHEN** 所有者在 G 的话题 T 内 `/bind W`
- **THEN** T 的代际父为 W 的 locus 主会话，`parentLocusId` 为 L；G 的群级来源仍为 W0；`createMainSession` 调用 0 次

#### Scenario: 群级不可服务时话题显式绑定被拒且不修复
- **GIVEN** 群 G 的三层群级 locus 被所有者停止，或处于 `invalid`
- **WHEN** 所有者在 G 的新话题 T 内 `/bind W`
- **THEN** 绑定被拒绝；没有新的 locus 行、locus 主会话或会话创建调用；G 的群级行不变

#### Scenario: 显式来源无效时不建立任何会话
- **GIVEN** 群 G 下不存在群级 locus 行
- **WHEN** 所有者在 G 的话题 T 内 `/bind` 一个无法解析的目标或子会话
- **THEN** 绑定被拒绝；会话创建调用 0 次，没有任何 locus 行或 provisioning 操作被提交

#### Scenario: 无父话题之后群本体首个 at 走 auto
- **GIVEN** 话题 T 是 W 的无父话题，群 G 下没有群级 locus 行
- **WHEN** G 的群本体收到所有者的首个授权 at
- **THEN** `createMainSession` 调用 1 次，G 的群级 locus 来源为 auto；T 的当前代际 id、父会话与代际号均不变

#### Scenario: 从未建立的群内未绑定话题首个 at 仍走 auto
- **GIVEN** 群 G 下不存在群级 locus 行
- **WHEN** G 的话题 T 未经绑定，收到所有者的首个授权 at
- **THEN** `createMainSession` 调用 1 次，建立 G 的 auto 群级结构；T 继承群级来源，并以群级 locus 为 `parentLocusId`

#### Scenario: 群本体 auto 与话题显式绑定并发
- **GIVEN** 群 G 下不存在群级 locus 行
- **WHEN** G 的群本体首个授权 at 与 G 的话题 T 内 `/bind W` 并发到达
- **THEN**
  - 恰好建立一个群级 locus，`createMainSession` 恰好调用 1 次；
  - T 的父为 W 的 locus 主会话；
  - 若 T 先于群级提交，则 T 不带 `parentLocusId`；否则 T 的 `parentLocusId` 为该群级 locus。

#### Scenario: 同一干活主会话的话题绑定与 Q&A 并发
- **GIVEN** W 没有 locus 主会话，群 G 下不存在群级 locus 行
- **WHEN** 所有者在 G 的话题 T 内 `/bind W`，同时为 W 打开默认 Q&A
- **THEN** W 只有一个 active locus 主会话与一个协作空间；T 为该主会话下的无父话题；默认 Q&A 指针指向 Q&A 群的群级 `qa-created` 行

### Requirement: 管理面按入口聚合且区分代际

所有者管理面 SHALL 以**入口**（一个飞书 endpoint：群或话题）为第一层呈现单位，MUST NOT 以单条 locus 记录为单位平铺。

- 一个入口的当前代 SHALL 占据主行；其历史代际 SHALL 折叠为可展开的「历史 N 代」。折叠 MUST NOT 隐藏事实，展开后各代的状态、时间与其专属子会话 SHALL 仍可完整核对。
- 同一父会话 MUST NOT 被重复渲染为多份。其特征（工作区、可用性）SHALL 只出现一次，该父会话的入口 SHALL 归入其下。
- 话题 locus SHALL 按其 `parentLocusId` 嵌套在所属群级 locus 之下。以下两类话题 SHALL 作为其父会话下的根入口行呈现，MUST NOT 被嵌套到其它父会话之下：
  - 不带 `parentLocusId` 的话题；
  - 所属群级 locus 属于其它父会话的话题。
- 管理面 SHALL 区分 locus 代际与用于客户端变更检测的快照 generation，MUST NOT 将后者呈现为所有者可见读数。

#### Scenario: 同一入口的多代聚合为一行

- **WHEN** 一个入口经重建产生第 3 代，其前两代仍为已停止与已退役
- **THEN** 管理面以一行呈现该入口，主行是第 3 代，前两代折叠为「历史 2 代」；展开后各代的状态、时间与子会话均可核对

#### Scenario: 同一父会话的多个入口只出现一次父会话

- **WHEN** 一个父会话下关联了两个入口
- **THEN** 该父会话的标题、工作区与可用性只渲染一次，两个入口作为其下的入口行呈现

#### Scenario: 话题嵌套在群级之下

- **WHEN** 某群已有群级 locus，其下新话题建立了继承该群来源的话题 locus
- **THEN** 该话题行嵌套在群级入口行之下，并标明其继承来源

#### Scenario: 无父话题作为根入口行

- **GIVEN** 话题 T 是干活主会话 W 的无父话题
- **WHEN** 管理面按父会话读法渲染
- **THEN** T 是 W 下的根入口行，不在任何群级行的子节点中

#### Scenario: 群级入口属于其它父会话时话题不跨父嵌套

- **GIVEN** 群级 locus L 属于干活主会话 W0，话题 T 显式绑定到 W，且 `parentLocusId` 为 L
- **WHEN** 管理面按父会话读法渲染
- **THEN** T 是 W 下的根入口行；W0 下只出现 L

## ADDED Requirements

### Requirement: 无父话题的代际由持久层证明

话题行 MAY 不带 `parentLocusId`。单行校验（领域构造、持久 normalize、持久行 schema）只拒绝带 `parentLocusId` 的群级行，不判断历史。

每个能看到完整 locus 集合的写入口，都 SHALL 在**提交前**的集合上执行同一判定。这些写入口包括：首次 provisioning、replacement、rebuild、regeneration（含批量 locus 主会话迁移）、`putLocus`，以及 `LocusRepository` 的入口写入。判定规则如下：

- 新话题行不带 `replacesLocusId` 时：该 endpoint 必须没有任何既有行，且该 chatId 的群级结构未建立（定义见"入口建立统一为一条路径"），才可以不带 `parentLocusId`。
- 新话题行带 `replacesLocusId` 时：被替代者必须存在，属于同一 endpoint，是提交前该 endpoint 的最新行，且新行代际号等于被替代者代际号加 1。在此基础上：
  - 被替代者不带 `parentLocusId` 时，新行 MUST NOT 带 `parentLocusId`；
  - 被替代者带 `parentLocusId` 时，新行只有在该 chatId 的群级结构未建立时才可以不带 `parentLocusId`。
- 带 `parentLocusId` 的话题行，原有父级校验不变。

不满足以上任一条件时，SHALL 以 provisioning 冲突（或该写入口既有的冲突错误）拒绝，且不改变任何持久状态。无父话题的后继，SHALL 由 controller 在以下各路径中都保持无父：同 locus 主会话重建、locus 主会话迁移、归档后显式换绑、停止后显式重建。

#### Scenario: 同 locus 主会话重建保持无父
- **GIVEN** 话题 T 的代际 g 是无父话题，之后 G 已建立群级 locus
- **WHEN** T 的子会话永久不可用，系统在同一 locus 主会话下为 T 发布新代际
- **THEN** 新代际号为 g+1，不带 `parentLocusId`，`replacesLocusId` 为 T.g，提交成功

#### Scenario: locus 主会话迁移保持无父
- **GIVEN** W 的 locus 主会话 M 下有无父话题 T 和群入口 A
- **WHEN** M 被归档，下一条授权 at 触发迁移到 M2
- **THEN** T 与 A 都迁到 M2；T 的新代际不带 `parentLocusId`，代际号加 1

#### Scenario: 归档后显式换绑保持无父
- **GIVEN** 无父话题 T 的干活主会话 W1 已被归档
- **WHEN** 所有者在 T 内 `/bind W2`
- **THEN** T 的新代际父为 W2 的 locus 主会话，不带 `parentLocusId`，代际号加 1；旧代际不再可服务

#### Scenario: 停止后显式重建保持无父
- **GIVEN** 无父话题 T 已被所有者停止
- **WHEN** 所有者在管理面对 T 显式重建
- **THEN** 新代际不带 `parentLocusId`，代际号加 1，返回结果不要求群级记录

#### Scenario: 群级行存在时拒绝新的无父首代
- **GIVEN** 群 G 已有三层群级 locus 行
- **WHEN** 一次话题 provisioning 提交不带 `parentLocusId` 与 `replacesLocusId`
- **THEN** 提交以 `PROVISIONING_CONFLICT` 拒绝，持久状态中不出现该话题行，provisioning 操作不进入 committed

#### Scenario: 跳代引用无父前代被拒
- **GIVEN** T.g1 无父，T.g2 带 `parentLocusId` 且已停止
- **WHEN** 经 `putLocus` 写入不带 `parentLocusId` 的 T.g3，其 `replacesLocusId` 为 T.g1
- **THEN** 写入被拒绝，T 的最新行仍为 T.g2

#### Scenario: 无父前代的后继补父被拒
- **GIVEN** T.g1 无父，G 已建立群级 locus L
- **WHEN** 提交 T.g2，其 `replacesLocusId` 为 T.g1，`parentLocusId` 为 L
- **THEN** 提交被拒绝，T 的最新行仍为 T.g1

#### Scenario: 群已三层建立时有父前代不得转为无父
- **GIVEN** T.g1 以三层群级 locus L 为父
- **WHEN** 提交不带 `parentLocusId` 的 T.g2，其 `replacesLocusId` 为 T.g1
- **THEN** 提交被拒绝

#### Scenario: 内存 LocusRepository 遵循同一判定
- **GIVEN** `LocusRepository` 中群 G 已有处于 `stopped` 的群级行
- **WHEN** 经其入口写入建立不带 `parentLocusId` 的新话题
- **THEN** 写入被拒绝，集合不变

#### Scenario: 无父话题重启后读回
- **GIVEN** 持久层中有一个已提交的无父话题
- **WHEN** 关闭并重新打开持久层，读取全部 locus
- **THEN** 加载成功，该话题行逐字段相同，仍不带 `parentLocusId`

### Requirement: 群级绑定携带遗留话题只限挂在群下的话题

群级 `/bind`（含同源重试与归档换绑后的携带）在改挂同群遗留话题时，SHALL 只携带带 `parentLocusId` 的话题。无父话题是所有者对该话题的独立声明，MUST NOT 被群级命令携带、改挂或换来源；即使其干活主会话已被归档，也 SHALL 保持原状，由所有者在该话题内单独 `/bind`。

#### Scenario: 无父话题不被群级绑定携带
- **GIVEN** 话题 T 是 W1 的无父话题；G 之后 `/bind W2`；W1 被归档
- **WHEN** 所有者在 G 再次 `/bind W2`
- **THEN** T 的当前代际 id、干活主会话、locus 主会话、代际号与 `parentLocusId` 缺省都不变；回执不把 T 计入已携带或跳过的话题

#### Scenario: 挂在群下的遗留话题照常携带
- **GIVEN** 话题 U 以 G 的群级 locus 为父，其干活主会话 W1 已被归档
- **WHEN** 所有者在 G `/bind W2`
- **THEN** U 被改挂到 W2，回执计入已携带的话题 1 个
