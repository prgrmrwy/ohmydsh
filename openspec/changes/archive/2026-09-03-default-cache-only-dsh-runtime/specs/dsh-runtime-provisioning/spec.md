## Purpose

定义 ohmydsh 在启动、构建与官方 CLI 转交时如何解析和准备精确 pin 的 DSH 运行体，使已知存在 npm 依赖计算卡死风险的版本默认走可复用缓存，并提供有界、可诊断且可撤销的 provision 行为。

## ADDED Requirements

### Requirement: 已缓存的精确 pin 必须直接执行

启动器必须(SHALL)按 `dsh.yaml` 的精确 `dshVersion` 解析 DSH CLI。若显式 `DSH_BIN`、该精确 spec 的 npx 缓存入口或仓库管理的固定缓存入口已经存在，所有 start、build 与官方 CLI 转交必须直接执行该入口，不得再次调用 npx/npm 计算依赖。

#### Scenario: rc.2 npx 缓存已就绪

- **WHEN** `dshVersion` 为 `0.1.1-rc.2` 且对应 npx 缓存入口存在
- **THEN** `dsh`、`dsh build` 与官方 CLI 转交直接执行该入口，整个解析过程不 spawn npx/npm

#### Scenario: 固定缓存已就绪

- **WHEN** npx 缓存入口不存在但相同精确版本的仓库管理固定缓存入口存在
- **THEN** 启动器直接执行固定缓存入口，不访问 registry、不改变版本

### Requirement: 受影响版本默认绕过 npx provision

对仓库明确列入临时受影响集合的 DSH 版本，cache miss 时必须(SHALL)默认跳过 npx/libnpmexec provision，改走不依赖 npx Arborist 解析锁的固定缓存准备通道。该行为默认启用，并必须提供显式环境变量逃生门以恢复标准 npx-first 行为，供诊断或上游修复验收使用。

#### Scenario: rc.2 两级缓存均缺失

- **WHEN** `0.1.1-rc.2` 的 npx 缓存和固定缓存均不存在且未设置逃生门
- **THEN** provision 不得 spawn npx，必须直接尝试固定缓存准备通道

#### Scenario: 显式恢复标准策略

- **WHEN** 操作者为一次调用设置临时逃生门以允许 npx provision
- **THEN** cache miss 时可按标准 npx-first 顺序执行，并在输出中明确该临时策略已启用

#### Scenario: 不受影响的新版本

- **WHEN** `dshVersion` 不在临时受影响集合且缓存缺失
- **THEN** 启动器保持标准 provision 顺序，不把 rc.2 临时策略静默扩展到所有未来版本

### Requirement: provision 必须有界且失败可诊断

任何可能访问 registry 或安装运行体的 provision 子进程必须(SHALL)具有明确超时上限。超时或安装失败时必须终止其子进程树、以非零状态返回，并说明目标精确版本、尝试的通道和恢复办法；不得无限等待、静默回退到其他 DSH 版本或破坏已有可用缓存。

#### Scenario: 固定缓存准备超时

- **WHEN** 固定缓存安装在规定时间内未结束
- **THEN** 启动器终止该次 provision，保留已有缓存，报告超时并以非零状态退出

#### Scenario: provision 失败

- **WHEN** 所有允许的 provision 通道均失败
- **THEN** 启动器不启动任何其他版本的 DSH，并给出可操作的缓存/网络/逃生门诊断

### Requirement: 临时策略必须可集中删除

受影响版本集合、默认策略选择和删除条件必须(SHALL)集中记录，不得把 rc.2 特判复制到多个 launcher 分支。只有在标准 npx 通道针对目标版本的冷缓存安装、连续 build 和重复 restart 均通过有界回归后，才可删除该临时策略。

#### Scenario: 上游修复后移除临时策略

- **WHEN** 标准通道已通过约定回归矩阵并决定移除 rc.2 临时绕过
- **THEN** 删除集中策略项即可恢复通用解析流程，既有 `DSH_BIN`、npx 缓存和固定缓存继续有效
