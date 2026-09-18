## MODIFIED Requirements

### Requirement: 默认 read 与 allowlist 授权独立于绑定

所有新建及替换后的 locus SHALL 默认 read，并在接受工作前核验宿主实际文件策略；MUST NOT 仅依赖部署默认或数据库标签。`-s/--scope read|write` SHALL 仅由 allowlist 改变当前 locus 的共享档位，记录人、时间与生效结果；不存在关联时机械拒绝，未知值拒绝。

写档 SHALL 映射为宿主的完全访问模式（`danger-full-access`）：授予 write 即代表该入口的成员共享**整机无边界**的文件写能力。系统 SHALL 在管理面与飞书回执中如实说明这一点，MUST NOT 声称写范围等于某个目录。

更广模式 SHALL 由所有者显式选择，MUST NOT 由系统隐式采用；显式选择 SHALL 可审计（记录操作者、时间、期望值与生效值）。授予前 SHALL 确认该入口空闲；应用失败 MUST NOT 回执成功。宿主拒绝应用该模式、回读模式不符或持久化失败时 SHALL 拒绝提权并维持/回到 read，并给出可行动原因。read 档 MUST NOT 因此放宽任何既有约束。重新建立关联 MUST NOT 继承旧 write。

写档的权威事实 SHALL 是「宿主回读的 live 文件策略恰为完全访问」；它 MUST NOT 依赖任何持久授权标记。上下文锚点（执行根、约束、资料入口）SHALL 只作为上下文事实注入子会话与展示，MUST NOT 门控提权；`unauthorized` 之类的锚点值若存在，MUST NOT 被当作唯一授权真相。

系统 SHALL 提供一个全局写档开关，**当前默认关闭**。关闭期间：新的 write 请求 SHALL 在入口处（飞书控制面与管理面）被直接拒绝并说明真实原因，MUST NOT 先授予再降级；既有 write 记录 SHALL 在下次核验时按 read 生效并继续服务，MUST NOT 使该入口失效或暂停。降级 SHALL 只发生在派生层，durable 记录 SHALL 保留所有者原本的授权意图，使开关恢复后无需重新授予。

关闭的理由 SHALL 被如实说明：多个 locus 子会话共享同一份工作目录，而 write 即完全访问，并发写入尚无协商机制。系统 MUST NOT 把该拒绝表述为宿主故障或可重试的临时失败。管理面的提权控件 SHALL 在关闭期间不可用并就地说明原因，MUST NOT 呈现为可用而在提交时才失败。

#### Scenario: 写父会话创建只读子会话
- **WHEN** 来源主会话当前允许文件写入，新建 locus
- **THEN** 子会话在工作前确认 read，不静默继承 write

#### Scenario: 授予共享 write
- **WHEN** allowlist 在空闲 locus 提权，且宿主接受完全访问模式
- **THEN** 核验 live 模式为完全访问后回执并记录授权；该入口后续成员共享该档位，管理面明确写出"整机无边界、入口成员共享"

#### Scenario: 宿主拒绝完全访问
- **WHEN** 宿主拒绝应用完全访问模式，或回读到的模式不是完全访问
- **THEN** 拒绝提权并维持 read，说明该拒绝是宿主策略所致，不把 prompt 当作解除限制

#### Scenario: 提权不依赖执行根确认
- **WHEN** 所有者在空闲 locus 提权，而该入口从未确认过执行根
- **THEN** 提权照常进行并只受闲置与 mode 核验约束；锚点缺失不构成拒绝理由

#### Scenario: 授权按 live 模式派生
- **WHEN** 所有者已授予 write，且宿主回读的 live 模式为完全访问
- **THEN** 生效 write 并记录授权人、时间与生效结果，不依赖任何已存储的授权标记

#### Scenario: live 模式漂移
- **WHEN** 某入口已授予 write，但宿主回读的模式不再是完全访问
- **THEN** 按既有策略漂移路径暂停该入口并诊断，MUST NOT 静默继续按 write 服务

#### Scenario: 冷恢复或降权
- **WHEN** 子会话恢复或空闲时被设置 read
- **THEN** 核验实际策略后才继续派发，策略失败停止服务并诊断

#### Scenario: 提权失败必须给出原因与去处
- **WHEN** 提权被拒绝，原因是缺少前置、宿主拒绝应用或持久化失败
- **THEN** 飞书控制面与管理面都返回/显示该确定性原因，不用重试提示掩盖它

#### Scenario: 写档开关关闭时拒绝新提权
- **WHEN** 写档开关关闭，allowlist 在空闲 locus 请求 write
- **THEN** 请求在入口处被拒绝并说明是写档已全局停用及其并发写理由，不进入授予流程，也不表述为宿主故障或可重试失败

#### Scenario: 开关关闭时既有 write 降为只读且继续服务
- **WHEN** 某入口此前已授予 write，此后写档开关被关闭
- **THEN** 该入口在下次核验时按 read 生效并继续服务，不被暂停或失效；对外呈现的生效档位是 read，不是记录中的 write

#### Scenario: 降级不改写授权意图
- **WHEN** 某 write 入口因开关关闭而降级，随后开关被重新打开
- **THEN** 该入口恢复按其原有授权记录生效，无需所有者重新授予

#### Scenario: 关闭期间提权控件不可用
- **WHEN** 所有者在开关关闭期间打开管理面
- **THEN** 提权控件不可用并就地说明原因，MUST NOT 呈现为可用而在提交时才失败
