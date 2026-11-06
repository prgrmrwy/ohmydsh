## MODIFIED Requirements

### Requirement: 接入方代人处置其托管成员的 request

内核 SHALL 提供 manager 命令 `disposeManagedRequest({itemId, progress})`，供接入方代表本机用户处置由其托管成员登记的 request。它按 manager 命令的两阶段流程执行（不认领；事务内依次判定空间存在、收据、授权、关闭、业务校验、守卫），收据 scope 为 `{kind:'manager', channel}`。

业务校验：
- 条目必须存在且 `kind` 为 `request`，否则 `COLLAB_ITEM_NOT_FOUND`（不存在）或 `COLLAB_FORBIDDEN`（非 request）；
- 条目作者必须满足其一，否则 `COLLAB_FORBIDDEN`：由该 channel 托管的成员（`managedBy` 等于该 channel，作者已退役或被 `markGone` 仍算）；或绑定为 `dsh-session` 的普通成员且宿主为该 manager 命令提供的 `authorOwned(address)` 判定返回真（宿主未提供该判定时视为假）。`authorOwned` 与命令守卫一起在提交边界重验；
- 条目状态为 `escalated` 或 `decided` 时分别以 `COLLAB_ITEM_ESCALATED`、`COLLAB_DECIDED_LOCKED` 拒绝；
- 允许的转换为 `open → accepted`、`open → done`、`open → rejected`、`accepted → done`、`accepted → rejected`，其余以 `COLLAB_BAD_TRANSITION` 拒绝。

成功时提交一条 `request/progressed` 事件，actor 为 `manager:<channel>`。该命令 MUST NOT 产生任何 `dispatch/intended`，也不计入任何话题。终态不可逆，因此 assignee 此后的 `advanceRequest` 以 `COLLAB_BAD_TRANSITION` 拒绝。

#### Scenario: 代人受理不唤醒
- **GIVEN** 空间 S 已授权 `pet-locus`；托管成员 `pet` 创建 request `todo-1`（assignee `main`，open）
- **WHEN** manager 以 `cmdId:'acc-1'` 调用 `disposeManagedRequest({itemId:'todo-1', progress:'accepted'})`，再以相同参数重试
- **THEN** 两次返回同一 seq；`todo-1.progress` 为 `accepted`；提交中 actor 为 `manager:pet-locus`，不含 `dispatch/intended`

#### Scenario: 不经受理直接完成
- **GIVEN** 承上但 `todo-1` 为 open
- **WHEN** manager 推进为 `done`
- **THEN** 成功；随后 `main` 调用 `advanceRequest` 推进为 `rejected` 返回 `COLLAB_BAD_TRANSITION`

#### Scenario: 不能处置非托管成员的 request
- **GIVEN** 普通成员 `main` 创建 request `r-2`（assignee `main`）
- **WHEN** manager 调用 `disposeManagedRequest({itemId:'r-2', progress:'done'})`
- **THEN** 返回 `COLLAB_FORBIDDEN`，日志长度不变

#### Scenario: 作者退役后仍可处置
- **GIVEN** `pet` 登记 `todo-3` 后被 `retireMember`
- **WHEN** manager 推进 `todo-3` 为 `rejected`
- **THEN** 成功，不含 `dispatch/intended`

#### Scenario: 未授权空间不可区分
- **GIVEN** 空间 T 未授权 `pet-locus`
- **WHEN** manager 对 T 调用 `disposeManagedRequest`
- **THEN** 返回 `COLLAB_NOT_MEMBER`，与对不存在空间的 `admitMember` 同类

#### Scenario: 处置接入方拥有的普通会话登记的 request
- **GIVEN** 空间 S 已授权 `pet-locus`；普通成员 `locus`（绑定 `dsh-session:M`）创建 request `todo-2`；宿主的 `authorOwned` 只对 `M` 返回真
- **WHEN** manager 调用 `disposeManagedRequest({itemId:'todo-2', progress:'done'})`；随后对普通成员 `work` 创建的 `todo-3` 同样调用
- **THEN** 前者成功、actor 为 `manager:pet-locus`、不含 `dispatch/intended`；后者返回 `COLLAB_FORBIDDEN`，日志不变
