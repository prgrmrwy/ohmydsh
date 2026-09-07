## MODIFIED Requirements

### Requirement: Bot 绑定经 lark-cli 专属 profile 完成且 Pet 不接触凭据

系统 SHALL 提供两条 bot 绑定路径：**创建新 Bot**（经 lark-cli 发起授权流程，由用户在浏览器完成创建与授权）与**连接已有 Bot**（用户提供 App ID 与 App Secret）。两条路径 SHALL 使用 Pet 专属且稳定命名的 lark-cli profile，MUST NOT 修改或依赖用户当前默认 profile，也 MUST NOT 覆盖用户既有的 lark-cli app 配置、令牌或身份策略。Pet 发起的事件订阅、身份查询及其它 channel 命令 MUST 显式选择该专属 profile；多 profile 环境下切换默认 profile不得改变 Pet 使用的 app。

Pet MUST NOT 保存、回显或写入日志任何 app secret。「连接已有 Bot」路径中用户提供的 secret SHALL 仅经进程标准输入直接传递给 lark-cli，随后立即丢弃；「创建新 Bot」路径中 secret 由 lark-cli 自行落地，Pet SHALL 只读取 App ID、bot open_id、名称和权限诊断等非机密身份信息。

创建流程是阻塞式的，系统 SHALL 以后台任务承载并向用户展示待完成的验证入口与当前等待状态，MUST NOT 在流程未完成时报告绑定成功。绑定失败、被拒绝或超时 SHALL 保留可诊断说明且不写入部分配置。

绑定成功后，系统 SHALL 立即通过专属 profile 的已验证 bot 身份状态取得并持久化 bot 自身 open_id 与名称；取得的 App ID MUST 与本次绑定的 App ID 一致，否则绑定 SHALL fail closed。系统 SHALL 识别已安装 lark-cli 是否满足 Pet 已验证的身份输出契约；版本过低、版本不可识别或身份状态不提供 open_id 时 MUST 明确提示升级，不得启动订阅、猜测 open_id 或依赖首次群消息回填。

#### Scenario: 创建新 Bot
- **WHEN** 用户在 Channel 页选择创建新 Bot 并完成浏览器授权
- **THEN** 新 app 落在 Pet 专属 profile 中，Channel 页显示其 App ID、名称与已确认 open_id，用户既有 lark-cli app 的配置、登录态和默认 profile 不变

#### Scenario: 授权尚未完成
- **WHEN** 创建流程已发起但用户尚未在浏览器完成授权
- **THEN** 系统显示等待状态与验证入口，不报告绑定成功，也不写入部分配置

#### Scenario: 连接已有 Bot
- **WHEN** 用户提供既有 App ID 与 App Secret 并提交
- **THEN** secret 仅经标准输入交给 lark-cli，Pet 的持久层与日志中不出现该值，页面此后也不回显它，并通过专属 profile 验证返回的 bot App ID 与输入一致

#### Scenario: 绑定失败
- **WHEN** 授权被拒绝、超时、凭据无效或身份验证返回另一个 App ID
- **THEN** 系统给出可诊断说明，channel 保持未配置状态而非半配置状态

#### Scenario: 多 profile 环境不串用默认身份
- **WHEN** Pet 绑定完成后用户新增其它 lark-cli profile 或切换默认 profile
- **THEN** Pet 的订阅、身份查询与出站操作仍使用绑定时创建的 Pet 专属 profile

#### Scenario: 绑定后直接取得 bot open_id
- **WHEN** 专属 profile 的已验证 bot 身份状态返回当前 App ID 对应的 open_id 与名称
- **THEN** 系统立即持久化该身份，用户不需要发送一条必然被丢弃的群消息来完成 Bot 身份配置

#### Scenario: lark-cli 版本不受支持
- **WHEN** 已安装 lark-cli 低于 Pet 已验证的最低版本、版本不可识别或身份输出缺少可信 bot open_id
- **THEN** 绑定或启用失败并明确提示升级，系统不启动 consumer、不写入半配置，也不尝试从群消息猜测身份

### Requirement: channel 生命周期独立降级且可诊断可回收

channel SHALL 维护独立于 Pet 整体状态的连接状态机（stopped、starting、connected、reconnecting、down 含原因）。订阅子进程异常退出时系统 SHALL 指数退避重启；达到退避上限 SHALL 进入 down 并在 Diagnostics 显示原因与显式重连操作。channel 故障 MUST NOT 影响 Pet 浮层、面板与非 channel 能力。Pet 停止时 SHALL 显式回收订阅子进程，MUST NOT 遗留孤儿进程。

Channel 设置页 SHALL 最终一致地展示 Host 当前连接状态，而不是永久保留 mutation 响应中的瞬时状态。页面收到 `starting` 或 `reconnecting` 后 MUST 持续刷新或订阅状态变化，直至进入 `connected`、`down` 或 `stopped`；即使 ready 状态变更发生在 mutation 响应返回与客户端开始等待之间，也 MUST 收敛。状态刷新 MUST 有界、可取消，页面卸载或终态到达后不得继续轮询。

#### Scenario: 启用后 consumer 快速连接
- **WHEN** 启用 mutation 返回 `starting`，consumer 随后到达 ready，且 ready edge 早于客户端下一次等待请求
- **THEN** Channel 设置页仍在有界时间内刷新为 `connected`，不永久显示“启动中”

#### Scenario: 重连期间状态持续更新
- **WHEN** 已连接 consumer 退出并经历 `reconnecting` 后恢复或达到失败上限
- **THEN** 页面持续反映 Host 状态，最终显示 `connected` 或带原因的 `down`

#### Scenario: 订阅子进程崩溃
- **WHEN** channel 子进程异常退出
- **THEN** channel 进入 reconnecting 并按指数退避重启，Pet 其余能力持续可用

#### Scenario: 重连达到上限
- **WHEN** 连续重启均失败并达到退避上限
- **THEN** channel 进入 down，Diagnostics 显示原因并提供显式重连操作

#### Scenario: Pet 停止
- **WHEN** dsh web 停止使 Pet Host 进入 stopping
- **THEN** 订阅子进程被显式终止，不留孤儿进程

## ADDED Requirements

### Requirement: Channel onboarding 是有序、可判定且可恢复的

Channel 管理面 SHALL 将“绑定 Bot、确认 Bot 身份、配置至少一个 allowlist 成员、选择默认 workspace、启用订阅”展示为有序的 onboarding 状态，而不是把“绑定成功”呈现为“已经可以在群中使用”。每一步 SHALL 显示完成状态；未满足下一步前置条件时，操作 SHALL 被禁用或返回紧邻操作位置的具体诊断。

系统 SHALL 在启动、显式重连及启用前验证：受支持的 lark-cli 可用、Bot 已绑定且身份可用、bot open_id 已确认、allowlist 非空、默认 workspace 可解析；异步验证完成后 SHALL 再次读取最新配置，已 disable、Host 已停止或前置已失效时不得启动 consumer。已启用时管理面 MUST NOT 允许清空 allowlist 或默认 workspace。可提前验证的版本/scope/身份错误 SHALL 在设置页暴露；目标群调用发现的权限错误 SHALL 持久为 channel 诊断并提供飞书返回的权限申请入口（若有），而不是只表现为群内沉默。系统 MUST NOT 自动授予权限或把未确认用户加入 allowlist。

#### Scenario: 只完成 Bot 绑定
- **WHEN** 用户完成 Bot 绑定但尚未配置 allowlist 或默认 workspace
- **THEN** 页面明确显示绑定已完成但 channel 尚不可用，并指出下一项待完成步骤，不启动事件订阅

#### Scenario: allowlist 为空时尝试启用
- **WHEN** 用户在没有允许成员时启用 channel
- **THEN** 系统拒绝启用并在开关附近说明必须先添加至少一个 `ou_...`，而不是仅留下一个没有反应的关闭状态

#### Scenario: Bot 身份尚未确认时尝试启用
- **WHEN** 绑定记录存在但 bot open_id 尚未通过受支持 CLI 的已验证身份证明
- **THEN** 系统拒绝启用并展示身份确认诊断，不启动一个无法判定群聊 mention 的订阅

#### Scenario: 默认 workspace 不可用
- **WHEN** 用户选择的默认 workspace 已删除、归档或无法解析
- **THEN** 系统拒绝将 channel 标为可用并要求重新选择，不在收到消息后才静默失败

#### Scenario: 全部前置条件满足
- **WHEN** Bot 身份、allowlist、默认 workspace 与订阅权限均满足且用户显式启用
- **THEN** consumer 到达 connected，页面显示 channel 可用，allowlist 用户随后在群中 @ Bot 可进入既有路由与 Invocation 流程

### Requirement: 未通过准入的入站消息保持飞书侧静默但 Host 可诊断

未通过 channel 准入的消息 SHALL 继续在飞书侧静默丢弃，不添加表情、不回复文本、不暴露 Bot 后存在 Agent。与此同时 Host SHALL 记录或向 Diagnostics 暴露低基数原因分类，至少区分 `disabled`、`not-allowed-sender`、`no-mention`、`too-old`、`duplicate`、`unsupported-type` 与 `bot-identity-unresolved`。诊断 MUST NOT 包含消息正文、App Secret、token、完整会话历史或未脱敏的任意外部标识。

#### Scenario: Channel 关闭时收到消息
- **WHEN** consumer 或测试入口向 pipeline 提交消息而 channel 配置为关闭
- **THEN** 飞书侧无响应，Host 诊断记录 `disabled` 分类

#### Scenario: 非 allowlist 用户 @ Bot
- **WHEN** 非 allowlist 用户在普通群中 @ Bot
- **THEN** 飞书侧保持静默，Host 诊断仅记录 `not-allowed-sender` 分类，不记录消息正文或发送者完整 open_id

#### Scenario: 目标群调用因权限失败
- **WHEN** 已确认身份的 channel 在目标群调用中收到结构化缺 scope 错误
- **THEN** 本条操作 fail closed，Host 与 Channel 管理面仅记录可安全展示的缺失 scope/申请入口
