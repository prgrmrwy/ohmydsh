# Pet Workspace Environment Specification

## Purpose
Pet 按全局与来源 workspace 两个作用域持久保存环境变量，经官方 `ctx.shellEnv` 以 `DSH_PET_*` 注入 executor 的每次 shell 调用，并提供「环境变量」设置页签。

## Requirements

### Requirement: 环境变量按全局与 workspace 两个作用域持久保存

系统 SHALL 在 Pet 持久化存储中保存环境变量键值对，行形如
`{ scope, key, value }`，其中 `scope` 为字符串 `global` 或某个 workspace id，
主键为 `scope + key`。数据 MUST 位于 Pet 自有状态目录，插件升级或 profile 重建
不得覆盖。

**全局作用域**的变量对所有 Pet Task 生效，与来源 workspace 无关，用于所有项目
共用的配置。**workspace 作用域**的变量只对来源于该 workspace 的 Invocation 生效。

key SHALL 限定为 `[A-Z][A-Z0-9_]*`（大写蛇形，环境变量惯例），系统 SHALL 拒绝不
符合该形状的 key；value 为空 SHALL 拒绝写入。同一 scope 下重复 key 的写入
SHALL 覆盖既有值而非新增行；不同 scope 下的同名 key 是两条独立记录，MUST NOT
互相覆盖。

#### Scenario: 配置全局变量
- **WHEN** 用户在全局作用域保存 `CR_GROUP=oc_default`
- **THEN** 该键值持久化，并对所有 Pet Task 可见

#### Scenario: 为 workspace 配置变量
- **WHEN** 用户为某 workspace 保存 `CR_GROUP=oc_xxx`
- **THEN** 该键值持久化，按该 workspace 查询可读回，且不影响全局记录

#### Scenario: 非法 key 被拒绝
- **WHEN** 用户提交 key 为 `cr-group` 或 `1ABC` 等不符合大写蛇形的值
- **THEN** 系统拒绝写入并说明 key 形状要求，不产生持久化变更

#### Scenario: 同 scope 同 key 覆盖
- **WHEN** 用户对同一 scope 的同一 key 保存新 value
- **THEN** 原值被覆盖，不产生重复行

#### Scenario: 跨 scope 同名 key 互不影响
- **WHEN** 全局与某 workspace 都存在 key `CR_GROUP`
- **THEN** 两者是独立记录，修改其一不影响另一

### Requirement: 经官方 shellEnv 以 DSH_PET_ 前缀注入执行环境

系统 SHALL 通过 DSH 官方 `ctx.shellEnv` 注册一个 contributor，把当前 Invocation
适用的环境变量注入 Pet executor 的每一次 shell 调用。注入的变量名
SHALL 为配置 key 加固定前缀 `DSH_PET_`（例如 `CR_GROUP` → `DSH_PET_CR_GROUP`），
因为 DSH 的 `DshEnvironmentKey` 契约要求 `DSH_` 前缀，而 `DSH_PET_` 二级前缀避免
与 harness 内建及其他插件变量碰撞。

contributor 的 `resolve(execution)` SHALL 从 `execution.agent.session.header.id`
反查 Pet Task 与当前 Invocation，再取其快照的 `sourceWorkspaceId`；模型 MUST NOT
能通过任何参数改变这一解析结果。

**合并顺序 SHALL 为：先全局，后来源 workspace，同名 key 由 workspace 覆盖全局。**
即 workspace 配置优先级高于全局，全局是所有 Pet Task 的兜底。快照无 workspace
（独立任务）时 SHALL 只注入全局变量。

非 Pet executor session 或无当前 Invocation 时 SHALL 返回空集合而不是报错。两个
作用域都没有配置某个 key 时，该变量 SHALL 不存在于子进程环境——缺变量由 Skill
自己发现并停止，注入层不阻断无关的 shell 调用，也不代为提供默认值。

变量值 MUST NOT 出现在 prompt、envelope 或会话文本中；它只经 DSH 的
`ShellExecRequest.dshEnv` 通道到达子进程环境。

#### Scenario: workspace 覆盖全局
- **WHEN** 全局配置 `CR_GROUP=oc_default`，来源 workspace 配置 `CR_GROUP=oc_xxx`
- **THEN** 该子进程环境中 `DSH_PET_CR_GROUP` 为 `oc_xxx`

#### Scenario: 回退到全局
- **WHEN** 全局配置了 `CR_GROUP=oc_default`，来源 workspace 未配置该 key
- **THEN** 该子进程环境中 `DSH_PET_CR_GROUP` 为 `oc_default`

#### Scenario: 两个作用域合并
- **WHEN** 全局有 `NOTIFY_CHANNEL`，来源 workspace 有 `CR_GROUP`
- **THEN** 子进程环境同时含 `DSH_PET_NOTIFY_CHANNEL` 与 `DSH_PET_CR_GROUP`

#### Scenario: 独立任务只拿全局
- **WHEN** 当前 Invocation 来源为独立任务（无 workspace），且全局有配置
- **THEN** 只注入全局变量，shell 调用正常执行

#### Scenario: 都未配置则变量缺失
- **WHEN** 全局与来源 workspace 均未配置 `CR_GROUP`
- **THEN** 子进程环境中不存在 `DSH_PET_CR_GROUP`，Skill 自行发现并停止

#### Scenario: 非 Pet 会话不受影响
- **WHEN** 一个普通 DSH session 执行 bash 调用
- **THEN** contributor 返回空集合，不注入任何 `DSH_PET_*`，该调用正常执行

#### Scenario: 并发会话不串号
- **WHEN** 两个不同 workspace 来源的 Pet Task 同时各自执行 shell 调用
- **THEN** 各自只收到自己 workspace 的变量（叠加同一份全局），彼此的 workspace
      变量互不可见

### Requirement: 提供「环境变量」设置页签

Pet Settings SHALL 以「环境变量」作为第四个稳定页签，页面按顺序包含三个区域：
**全局**、**工作区**、**生效结果**。

**全局**区域 MUST NOT 要求先选择 workspace，直接展示并编辑全局作用域的键值。

**工作区**区域 SHALL 从 Host 的 workspace registry 枚举可选 workspace（显示标题
与路径等可辨识信息，而非仅 id），并允许手工输入尚未列出的 workspace id 后添加
配置；其列表展示并编辑选定 workspace 的键值。当某 key 与全局同名时，该行 SHALL
明确标示其覆盖了全局值。

**生效结果**区域 SHALL 展示选定 workspace 实际生效的合并结果：每项标注其来源
（全局或工作区），被覆盖的全局项 SHALL 一并列出并明确标示为已被覆盖，而不是
静默隐藏。该区域为只读呈现。

每个可编辑区域 SHALL 支持新增、修改、删除；写入失败 SHALL 保留用户输入并指出
无效字段。页面 SHALL 显示每个 key 实际注入的变量名（`DSH_PET_<KEY>`），使用户
知道在 Skill 中该写什么。页面 SHALL 提示这些值会进入子进程环境、不适合存放高敏
凭据，其安全性由用户自行判断。

变量值 SHALL 默认以打码形式展示，并提供逐项的显示/隐藏切换，避免共享屏幕或截图
时泄露。该遮挡 SHALL 只发生在渲染层，MUST NOT 被理解为凭据保护机制——值仍按明文
持久化并注入。

#### Scenario: 编辑全局变量无需选 workspace
- **WHEN** 用户打开环境变量页并在全局区域新增一条配置
- **THEN** 无需选择任何 workspace 即可保存成功

#### Scenario: 查看注入名
- **WHEN** 用户配置了 key `CR_GROUP`
- **THEN** 页面显示其在 Skill 中的引用形式 `$DSH_PET_CR_GROUP`

#### Scenario: 提示覆盖关系
- **WHEN** 选定 workspace 配置了与全局同名的 key
- **THEN** 工作区区域标示该项覆盖全局值

#### Scenario: 生效结果标示来源与被覆盖项
- **WHEN** 全局与选定 workspace 都配置了 `CR_GROUP`，且全局另有 `NOTIFY_CHANNEL`
- **THEN** 生效结果区域显示 workspace 的 `CR_GROUP`（标注来自工作区）、全局的
      `CR_GROUP`（标注已被覆盖）与全局的 `NOTIFY_CHANNEL`（标注来自全局）

#### Scenario: 值默认打码
- **WHEN** 页面展示任一已配置的变量值
- **THEN** 该值默认打码显示，用户可逐项切换显示与隐藏

#### Scenario: 保存失败保留输入
- **WHEN** 用户提交非法 key 或空 value
- **THEN** 页面保留已输入内容并指出无效字段，不静默丢弃

### Requirement: 环境变量管理路由

系统 SHALL 提供列出与写入/删除环境变量的管理路由，复用既有
`petRoute`/`strictBody`/`requireReady` 围栏，仅接收声明过的字段。请求 SHALL 以
显式 `scope` 字段区分作用域：值为 `global`，或一个 workspace id。缺少 `scope`、
`scope` 形状非法或缺少 `key` 的请求 SHALL 返回既有 `BINDING_INVALID` 错误码。
路由 SHALL 能返回供 UI 枚举的 workspace 候选（id + 标题）。

列表路由 SHALL 同时返回全局与各 workspace 的记录，使 UI 能标示覆盖关系而无需
多次请求。

#### Scenario: 写入全局作用域
- **WHEN** 客户端以 `scope: "global"` 提交合法 key/value
- **THEN** 该记录写入全局作用域并可被列出

#### Scenario: 非法请求被拒绝
- **WHEN** 客户端提交缺少 `scope` 或 `key` 的写入请求
- **THEN** 路由返回 `BINDING_INVALID` 且不产生任何持久化变更
