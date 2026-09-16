## MODIFIED Requirements

### Requirement: 默认 read 与 allowlist 授权独立于绑定

所有新建及替换后的 locus SHALL 默认 read，并在接受工作前核验宿主实际文件只读策略；MUST NOT 仅依赖部署默认或数据库标签。`-s/--scope read|write` SHALL 仅由 allowlist 改变当前 locus 的共享档位，记录人、时间与生效结果；不存在关联时机械拒绝，未知值拒绝。

写能力或目标工作根无法被当前宿主策略支持时 SHALL 明确拒绝提权并维持 read，MUST NOT 隐式选择更广模式。忙时变更 SHALL 拒绝并提示稍后；应用失败 MUST NOT 回执成功。read/write MUST NOT 被宣称为外部 API 全部副作用的控制。重新建立关联 MUST NOT 继承旧 write。

提权被拒绝时 SHALL 给出可行动原因并指向「确认执行根」这一确认入口——无论拒绝发生在飞书控制面还是管理面。MUST NOT 以「执行失败，请稍后重试」一类重试提示代替确定性原因：缺少所有者确认与根不一致都是可判定的稳定事实，重试不会改变结论。

管理面 SHALL 把宿主解析出的执行根作为可确认事实呈现，并 SHALL 让所有者据此完成确认；该候选 MUST NOT 自身构成授权，写授权仍只由「所有者已确认」与「live sandbox 回读的 workspace root 精确一致」两个独立事实在每次核验时派生。锚点已确认但尚无执行根时，确认入口 SHALL 保持可用，使所有者仍能补上该事实。

#### Scenario: 写父会话创建只读子会话
- **WHEN** 来源主会话当前允许文件写入，新建 locus
- **THEN** 子会话在工作前确认 read，不静默继承 write

#### Scenario: 授予共享 write
- **WHEN** allowlist 在空闲 locus 提权且宿主支持已确认工作根
- **THEN** 核验生效后回执并记录授权；该入口后续成员请求共享该档位

#### Scenario: 宿主写范围不支持
- **WHEN** 工作根位于当前可写范围之外
- **THEN** 明确说明无法授予该范围，保持 read，不把 prompt 当作解除限制

#### Scenario: 授权按 live root 派生
- **WHEN** 所有者已确认执行根，且 live sandbox 回读的 workspace root 与其规范化后一致
- **THEN** 授予 write 并记录授权人、时间与生效结果，不依赖任何已存储的授权标记

#### Scenario: 仅有 root 一致不足以授权
- **WHEN** live sandbox 的 workspace root 与某路径一致，但所有者从未确认该执行根
- **THEN** 拒绝提权并维持 read，提示需先确认上下文锚点

#### Scenario: 所有者撤销优先
- **WHEN** 所有者已显式撤销该执行根的写授权，而 live root 仍与其一致
- **THEN** 拒绝提权并维持 read

#### Scenario: 冷恢复或降权
- **WHEN** 子会话恢复或空闲时被设置 read
- **THEN** 核验实际策略后才继续派发，策略失败停止服务并诊断

#### Scenario: 管理面确认的执行根可满足提权
- **WHEN** 子会话存在且宿主能解析其工作边界，所有者在管理面确认执行根后再次提权，且 live sandbox 回读的 workspace root 与该根一致
- **THEN** 提权成功并把 effective 记为 write；管理面呈现的候选路径与最终生效的执行根为同一值

#### Scenario: 已确认但缺执行根仍可补确认
- **WHEN** 锚点已带其它已确认事实而尚无 executionRoot，所有者再次打开该 locus
- **THEN** 管理面继续提供确认执行根的入口，不因状态已是 confirmed 而移除该动作

#### Scenario: 提权失败必须给出原因与去处
- **WHEN** 提权被拒绝，原因是缺少所有者确认的执行根或已确认根与宿主回读范围不一致
- **THEN** 飞书控制面与管理面都返回/显示该确定性原因并指向确认执行根的位置，不用重试提示掩盖它
