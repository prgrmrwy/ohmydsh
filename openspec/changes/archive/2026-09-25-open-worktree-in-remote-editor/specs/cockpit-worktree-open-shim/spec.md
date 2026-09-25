## ADDED Requirements

### Requirement: shim 是两端之间唯一的耦合点
系统 SHALL 以一个独立的 package 承载 Worktree Session 与 dsh-cockpit 之间的全部耦合。该 shim SHALL 是本仓库唯一同时知道两端存在的地方。

Worktree Session MUST NOT 依赖 dsh-cockpit 的任何 package、服务名或产品概念。dsh-cockpit 的任何 package MUST NOT 依赖 Worktree Session。

移除该 shim SHALL 完全解除两端耦合，且 MUST NOT 要求修改两端任一方。

#### Scenario: 两端互不引用
- **WHEN** 审阅 Worktree Session 与 dsh-cockpit-bridge 的源码与依赖声明
- **THEN** 两者 MUST NOT 互相引用对方的 package 名或服务名

#### Scenario: 移除 shim 解除耦合
- **WHEN** 从部署 manifest 中移除该 shim 条目并重新物化
- **THEN** Worktree Session 回落其默认打开行为、dsh-cockpit 保持全部既有功能，两端源码均无需改动

#### Scenario: 耦合知识只存在于 shim
- **WHEN** 在本仓库中搜索同时提及两端的代码
- **THEN** 除该 shim 与规范/文档外，MUST NOT 存在其它位置

### Requirement: shim 只做探测与转接，不承载业务逻辑
shim SHALL 只做三件事：探测 dsh-cockpit 侧能力、探测 Worktree Session 的注册点、把前者注册进后者。

shim MUST NOT 承载路径校验、URI 拼装、重试、状态持有、认证或任何业务判断 —— 这些职责属于两端各自。shim MUST NOT 解释或改写经过它的路径。

#### Scenario: 路径原样转接
- **WHEN** Worktree Session 经注册点传入一个绝对路径
- **THEN** shim SHALL 将其原样交给 dsh-cockpit 侧能力，MUST NOT 改写、规范化或截断

#### Scenario: shim 不做校验
- **WHEN** 传入的路径不合法
- **THEN** shim MUST NOT 自行判定与拒绝；校验由 dsh-cockpit 侧按其自身规范执行

#### Scenario: shim 不持有状态
- **WHEN** 多次触发打开动作
- **THEN** shim MUST NOT 在调用之间累积状态、缓存结果或维护队列

### Requirement: 任一端缺失时 shim 整体不生效且不影响两端
shim SHALL 在运行时探测两端。任一端缺失、不可用或探测失败时，shim SHALL 整体不生效，且 MUST NOT 影响任一端的正常加载与既有功能。

shim MUST NOT 把任何一端声明为加载期必需依赖（`inject`）。

跨插件服务读取 MUST 使用完整服务名直接读取（`ctx.get('<完整名>')`）；MUST NOT 先读取父服务再取属性（`ctx.get('<父>').<子>`）。后者会被 cordis 的 traceable proxy 重新路由回 context proxy 并强制 `inject`，抛出 `cannot get property ... without inject` 且以未捕获的 promise rejection 逃逸。

#### Scenario: 仅安装 shim 未安装 cockpit bridge
- **WHEN** 部署中存在 shim 与 Worktree Session，但不存在 dsh-cockpit-bridge
- **THEN** shim 不注册任何实现；Worktree Session 使用默认打开行为并完整加载

#### Scenario: 仅安装 shim 未安装 Worktree Session
- **WHEN** 部署中存在 shim 与 dsh-cockpit-bridge，但不存在 Worktree Session
- **THEN** shim 不产生任何效果；dsh-cockpit-bridge 的既有上报功能不受影响

#### Scenario: cockpit 能力存在但不可用
- **WHEN** dsh-cockpit-bridge 已加载但其远程打开能力当前不可用（例如本机设备无 alias）
- **THEN** shim 不注册实现或注册后由该能力自行拒绝；Worktree Session 回落默认行为，不报告成功

#### Scenario: shim 不写入 inject
- **WHEN** 审阅 shim 的依赖声明
- **THEN** 两端的可选服务 MUST NOT 出现在 `inject` 中

#### Scenario: 使用完整服务名读取
- **WHEN** shim 读取 dsh-cockpit 侧能力
- **THEN** 其实现 SHALL 以完整服务名一次性读取，MUST NOT 经父服务属性访问路径读取

### Requirement: shim 具备明确的移除路径
shim SHALL 在其 README 中记录移除路径与移除条件，与本仓库既有缓解型 package 的惯例一致。

#### Scenario: README 记录移除路径
- **WHEN** 阅读 shim 的 README
- **THEN** 其中 SHALL 说明该 package 为何存在、依赖哪两端、以及如何移除
