## MODIFIED Requirements

### Requirement: 飞书入站通道经本机 lark-cli bot 身份接入且凭据零接触

Pet Host SHALL 以内嵌子进程方式运行恰好一个 `lark-cli event +subscribe --as bot --compact --event-types im.message.receive_v1,drive.notice.comment_add_v1`，作为唯一入站来源，并按每行输出的 `type` 字段分派给群消息与文档评论两条处理链路。Pet MUST NOT 为同一应用再运行任何 `lark-cli event consume`、第二个 `event +subscribe`，或使用 `--force`：飞书长连接按集群模式把每个事件随机投给该应用的某一条连接，两条连接并存会让两侧都静默丢失事件。

`--compact` 输出对 `im.message.receive_v1` 的字段集与 `event consume` 相同（顶层 `message_id`、`chat_id`、`chat_type`、`message_type`、`sender_id`、`sender_type`、`root_id`、`thread_id`、`reply_to`、`create_time`、预渲染的 `content` 与 `mentions[{key,id,name}]`），下游准入 SHALL 原样复用。`interactive` 类消息在 compact 下以原始信封输出，SHALL 与其它不支持的类型一样静默丢弃。

订阅子进程 SHALL 在独立进程组中运行。停止时 SHALL 向整个进程组发送 SIGTERM 并等待组内全部进程退出，上限 5 秒；超时 SHALL 对该进程组发 SIGKILL 并记录诊断。只向 npm shim 发信号是不够的：原生进程会被收养并继续占住连接与订阅锁。Pet MUST NOT 终止任何不是由当前 Host 进程拉起的进程。

就绪 SHALL 以 stderr 出现 SDK 连接成功行（`connected to wss://`）为准。启动水位 SHALL 在每个子进程中只锁存一次，同一子进程内部重连 MUST NOT 推进水位。Pet MUST NOT 传 `--quiet`。

订阅子进程的 stderr 中含有连接凭据（URL 查询串中的 `access_key`、`ticket`）。Host SHALL 只按固定模式对 stderr 做分类匹配（就绪、单实例锁、`not found handler`），MUST NOT 把 stderr 原文或其中的 URL 写入日志、持久层、诊断或管理面。

Pet MUST NOT 读取、保存、回传或代理任何飞书 app secret、token 或其它凭据；凭据生命周期完全属于 lark-cli。所有出站飞书调用 SHALL 统一使用 bot 身份，MUST NOT 使用 lark-cli 的 user 身份。出站调用包括：拉取历史、表情增删、单聊回复、评论读取与回复、评论回复表情、连接计数查询、联系人姓名查询。

channel SHALL 是显式开关能力且默认关闭。正式 Channel 未启用时，Pet MUST NOT 因普通消息处理而启动订阅子进程；但在 Bot 已绑定、身份已确认且存在有效配对时，Pet SHALL 为配对临时运行同一个受监督订阅。系统 MUST NOT 为配对另起第二个订阅。订阅的运行条件 SHALL 是“正式 Channel 已启用”或“存在处于启动、等待或认领阶段的有效配对”。两个条件都不成立时，SHALL 按上述进程组方式回收。

#### Scenario: 启用 channel 后启动订阅
- **GIVEN** 应用连接计数为 0，lark-cli 版本不低于 1.0.97，bot 身份可用
- **WHEN** 用户在设置中启用 channel，Pet Host 达到 ready
- **THEN** Pet 恰好启动一个子进程，其 argv 为 `event +subscribe --as bot --compact --event-types im.message.receive_v1,drive.notice.comment_add_v1`；收到 SDK 连接成功行后 channel 状态为 connected；本机不存在该应用的 `event consume` 进程

#### Scenario: 单连接同时承载群消息与评论
- **GIVEN** channel 已 connected
- **WHEN** 同一子进程先后输出一行 `type=im.message.receive_v1` 和一行 `type=drive.notice.comment_add_v1`
- **THEN** 前者进入群消息准入，后者进入评论处理链路；两者都不被另一条链路消费

#### Scenario: compact 群消息与既有准入兼容
- **GIVEN** 一行 compact 输出：`{"type":"im.message.receive_v1","message_id":"om_1","chat_id":"oc_1","chat_type":"group","message_type":"text","sender_id":"ou_u","sender_type":"user","reply_to":"om_0","content":"@pet hi","mentions":[{"key":"@_user_1","id":"ou_bot","name":"pet"}]}`
- **WHEN** 以现有 `parseInboundLine` 解析
- **THEN** 得到 `message_id=om_1`、`reply_to=om_0`、`mentions[0].id=ou_bot` 的事件，并通过现有群消息准入测试夹具

#### Scenario: 卡片消息静默丢弃
- **GIVEN** 一行 compact 输出为原始信封（含 `header` 与 `event`，无顶层 `message_id`），`event.message.message_type=interactive`
- **WHEN** 系统处理该行
- **THEN** 不进入准入，不回复也不打表情，诊断计数 `unparsable` 加一

#### Scenario: 停止时回收整个进程组
- **GIVEN** 订阅子进程由 shim 与原生进程两层组成
- **WHEN** channel 停用
- **THEN** 5 秒内组内无存活进程，应用连接计数回到 0

#### Scenario: stderr 原文不落盘
- **GIVEN** 子进程 stderr 输出 `[SDK Info] connected to wss://msg-frontier.feishu.cn/ws/v2?...&access_key=AK&ticket=TK`
- **WHEN** Host 处理该行并更新 channel 状态
- **THEN** channel 为 connected；Host 日志、持久层与诊断接口的输出中都不含 `AK`、`TK` 或 `wss://` 子串

#### Scenario: 内部重连不推进水位
- **GIVEN** 子进程于 T0 就绪，SDK 于 T1 内部重连
- **WHEN** 重连后平台重推一条创建时间介于 T0 与 T1 之间的消息
- **THEN** 该消息不因 `before-watermark` 被丢弃

#### Scenario: lark-cli bot 身份不可用
- **WHEN** channel 已启用，但 lark-cli 未登录 bot 或登录态失效
- **THEN** channel 进入 down 状态，并给出指向 lark-cli 重新登录的诊断说明，Pet 其余能力不受影响

#### Scenario: 升级后默认不消费事件
- **WHEN** 用户升级到含配对能力的 Pet 版本，未显式启用 channel，也没有发起配对
- **THEN** Pet 不启动订阅子进程，不消费任何飞书事件

#### Scenario: Channel 关闭时为配对临时订阅
- **WHEN** 正式 Channel 未启用，但用户生成了有效配对码
- **THEN** Pet 复用既有受监督订阅，启动唯一的子进程，只允许配对前置分支处理匹配的单聊；其它消息与全部评论事件仍按关闭语义静默丢弃

#### Scenario: 配对结束后按运行原因回收
- **WHEN** 配对成功、取消、失败或过期
- **THEN** 若正式 Channel 已启用，订阅继续运行；否则 Pet 按进程组方式停止订阅子进程

### Requirement: 未通过准入的入站消息保持飞书侧静默但 Host 可诊断

未通过 channel 准入的消息与评论事件 SHALL 在飞书侧静默丢弃：不添加表情、不回复文本、不暴露 Bot 背后存在 Agent。与此同时，Host SHALL 记录或向 Diagnostics 暴露低基数原因分类，至少区分以下各项，其它原因才可归入 `other`：

- `disabled`、`not-allowed-sender`、`no-mention`、`too-old`、`duplicate`、`unsupported-type`、`bot-identity-unresolved`
- 评论链路：`comment-scope-unknown`、`comment-reply-missing`、`unsupported-file-type`
- 连接门禁：`event-connection-conflict`、`subscribe-lock-held`、`lark-cli-too-old`、`connection-check-failed`

诊断 MUST NOT 包含消息或评论正文、App Secret、token、完整会话历史或未脱敏的任意外部标识。

#### Scenario: Channel 关闭时收到消息
- **WHEN** consumer 或测试入口向 pipeline 提交消息，而 channel 配置为关闭
- **THEN** 飞书侧无响应，Host 诊断记录 `disabled` 分类

#### Scenario: 非 allowlist 用户 @ Bot
- **WHEN** 非 allowlist 用户在普通群中 @ Bot
- **THEN** 飞书侧保持静默，Host 诊断仅记录 `not-allowed-sender` 分类，不记录消息正文或发送者完整 open_id

#### Scenario: 评论范围无法判定
- **WHEN** 评论查询失败，导致范围无法判定
- **THEN** 诊断记录 `comment-scope-unknown`，而不是 `other`

#### Scenario: 目标群调用因权限失败
- **WHEN** 已确认身份的 channel 在目标群调用中收到结构化的缺 scope 错误
- **THEN** 本条操作 fail closed，Host 与 Channel 管理面仅记录可安全展示的缺失 scope 与申请入口

## ADDED Requirements

### Requirement: 事件连接独占在拉起订阅前被证明

每次拉起订阅子进程之前，Host SHALL 依次通过以下门禁。首次启动、显式重连和监督器自动重启都算作一次拉起。任一门禁失败时，SHALL 不拉起子进程，并给出对应理由：

1. lark-cli 版本不低于 1.0.97。不满足时 channel 进入 down，理由为 `lark-cli-too-old`。
2. 以 bot 身份调用 `GET /open-apis/event/v1/connection`，读取 `online_instance_cnt`。
   - 调用失败或结果不可解析：理由为 `connection-check-failed`，channel 进入 reconnecting，按既有指数退避重试，并计入既有失败上限。
   - 计数不为 0：每 2 秒复查一次，最多等 40 秒。仍不为 0 时，理由为 `event-connection-conflict`，channel 进入 down。

既有的启用前验证 SHALL 额外执行一次 `event consume im.message.receive_v1 --as bot --dry-run`，在以下时机执行：
- 正式 Channel 启动，包括 Host 启动时恢复一个已启用的 channel；
- 用户启用 channel；
- 显式重连。

报告的前置条件中任一项为 `blocked` 时，SHALL 拒绝启动、启用或重连，并给出 lark-cli 报告的原因；`unknown` 视为通过。以下两种情况 MUST NOT 执行 dry-run：
- 监督器自动重启；
- 仅为配对而拉起订阅。

`connection-check-failed` 若由 lark-cli 的认证或未登录错误引起，诊断 SHALL 使用既有的“lark-cli 未登录 bot 或登录态失效，请重新登录”说明。

停止、停用或显式重连 SHALL 取消正在进行的门禁等待（包括 40 秒复查）。等待被取消后，MUST NOT 再拉起子进程。

评论事件与 drive/docx 权限没有可用的启动前探测，MUST NOT 作为门禁。缺失时 IM 照常工作，文档入口不可用。

Host MUST NOT 执行 `lark-cli event stop`，MUST NOT 终止 lark-cli 的共享 bus daemon，MUST NOT 终止任何不是由当前 Host 进程拉起的进程。

`event +subscribe` 若因同应用已有订阅者的单实例锁而退出，SHALL 直接进入 down，理由为 `subscribe-lock-held`，MUST NOT 退避重试，也 MUST NOT 使用 `--force`。

冲突诊断 SHALL 写明“同一应用只能有一条事件连接”，并给出排查线索：用 `lark-cli event status` 查看本机 bus，用 `pgrep -fl "event +subscribe"` 查看本机订阅进程。后者包括 Host 异常退出后遗留的子进程，Pet 不会自动终止它们。

已披露的限制：订阅运行期间，如果另一台机器或另一个进程以 `--force` 连接同一应用，事件会被分流，Pet 不会主动发现。下次拉起子进程时，门禁会发现冲突。

#### Scenario: 无其它连接时启动
- **GIVEN** 版本满足，连接计数为 0
- **WHEN** Pet 启动订阅
- **THEN** 子进程被拉起；整个过程 Host 没有执行任何 `event stop` 命令

#### Scenario: 旧 bus 在空闲期内
- **GIVEN** 升级后首次启动，旧 consume 已退出，其 bus 仍持有连接，连接计数为 1，约 30 秒后归零
- **WHEN** Pet 启动订阅
- **THEN** Pet 每 2 秒复查一次，计数归零后拉起子进程，channel 为 connected；Host 没有执行任何 `event stop` 命令

#### Scenario: 他方持续占用连接
- **GIVEN** 同一应用有另一个消费者持续在线（本机其它 profile、遗留的子进程或远端），连接计数恒为 1
- **WHEN** Pet 启动订阅
- **THEN** 40 秒后 channel 为 down，理由 `event-connection-conflict`，诊断包含计数、`lark-cli event status` 与 `pgrep -fl "event +subscribe"`；该消费者进程仍存活

#### Scenario: 监督器重启时上一条连接尚未释放
- **GIVEN** 子进程异常退出，它在服务端的连接约 3 秒后释放
- **WHEN** 监督器按退避规则重启子进程
- **THEN** 重启前先走门禁，等到计数为 0 再拉起；不判为冲突，不进入 down，也不执行 dry-run

#### Scenario: 连接计数接口暂时失败时退避重试
- **GIVEN** 监督器重启子进程时连接计数接口返回网络错误，下一次退避重试时返回 0
- **WHEN** 监督器处理这两次门禁
- **THEN** 第一次 channel 为 reconnecting，计一次失败；第二次拉起子进程，channel 为 connected，全程没有进入 down

#### Scenario: 连接计数接口持续失败
- **GIVEN** 连接计数接口每次都返回非零 code 或不可解析的内容
- **WHEN** Pet 启动订阅，并按退避多次重试
- **THEN** 每次都不拉起子进程，channel 为 reconnecting，理由 `connection-check-failed`；连续失败达到既有上限后 channel 进入 down

#### Scenario: 启用时 IM 前置条件被阻断
- **GIVEN** 用户启用 channel，dry-run 报告 `scopes_granted` 为 `blocked`
- **WHEN** 执行启用前验证
- **THEN** 启用被拒绝，诊断给出 lark-cli 报告的原因；不拉起子进程

#### Scenario: dry-run 报告 unknown 时照常启用
- **GIVEN** 用户启用 channel，dry-run 报告 `console_event_published` 为 `unknown`，没有任何一项为 `blocked`，连接计数为 0
- **WHEN** 执行启用前验证并启动订阅
- **THEN** 子进程被拉起，channel 为 connected

#### Scenario: 门禁等待期间停用 channel
- **GIVEN** Pet 启动订阅时连接计数为 1，正处于 40 秒复查等待中
- **WHEN** 用户停用 channel，随后计数归零
- **THEN** 等待被取消，Host 不拉起任何子进程，channel 为 stopped

#### Scenario: Host 启动恢复已启用 channel 时执行 dry-run
- **GIVEN** channel 配置为已启用，Host 重启
- **WHEN** Host 恢复 channel
- **THEN** 启用前验证执行一次 dry-run；之后监督器自动重启子进程时不再执行 dry-run

#### Scenario: 评论事件未开通不影响 IM
- **GIVEN** 飞书后台未开通 `drive.notice.comment_add_v1`，门禁均通过
- **WHEN** Pet 启动订阅并收到一条群 @
- **THEN** channel 为 connected，群消息正常进入准入

#### Scenario: 单实例锁被占用
- **GIVEN** 子进程启动后以 `failed_precondition` 退出，错误包含 `another event +subscribe instance is already running`
- **WHEN** 监督器处理该退出
- **THEN** channel 为 down，理由 `subscribe-lock-held`，不安排重试

#### Scenario: lark-cli 版本过低
- **GIVEN** `lark-cli --version` 报告 1.0.93
- **WHEN** Pet 启动订阅
- **THEN** 不调用连接计数接口，channel 为 down，理由 `lark-cli-too-old`，诊断给出实际版本与最低版本 1.0.97

#### Scenario: 就绪超时
- **GIVEN** 子进程启动后 30 秒内 stderr 未出现 SDK 连接成功行
- **WHEN** 监督器判定
- **THEN** 按进程组回收该子进程，并按既有退避规则进入 reconnecting
