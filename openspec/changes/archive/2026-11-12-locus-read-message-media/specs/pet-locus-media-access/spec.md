## MODIFIED Requirements

### Requirement: 当前 Delivery 的图片由 Host caller-bound 取得

系统 SHALL 通过官方 `lark-cli` 在受守卫的私有落盘目录内取得当前请求绑定消息中的图片。该 binary SHALL 与 Pet 订阅、身份与出站调用使用的 `lark-cli` 为同一解析结果；其 `--version` 报告的版本 SHALL 不低于 Pet 已审查的最低版本 `1.0.97`，版本缺失、不可解析或低于下限时媒体 SHALL 不可用。系统 MUST NOT 以版本作为隔离依据：私有目录、有界下载与结算前删除的不变量 SHALL 对任何放行版本同等生效。Host SHALL 从已接受 Delivery 的不可变触发 `messageId` 枚举资源，并只自动取得该消息内的图片；这条自动注入路径上模型 MUST NOT 提供 chat、message、thread、file key、本地路径、URL 或其它目标 selector。被回复消息、历史消息与视频 MUST NOT 经自动注入路径取得；子会话需要它们时，SHALL 经「子会话按消息 id 读取本入口 chat 内的单条消息」所定义的工具按需读取。

资源枚举、下载与 attachment 提交 SHALL 绑定该 Delivery 的 active locus/generation/child；在保存与最终入队前 SHALL 重验它仍是同一 current Delivery。若 Delivery 已终结、晋升或代际改变，Host SHALL 丢弃未发布结果且 fail closed。

#### Scenario: 官方 CLI 与私有落盘目录已证明
- **WHEN** 官方 binary 可解析且报告的版本不低于 `1.0.97`，私有落盘目录存在、权限为 0700，且位于 Locus child 读取守卫拒绝的 root 内
- **THEN** Host 以该目录为 spawn cwd 调用该 CLI 取得 current message 图片，且不向项目目录写入任何字节

#### Scenario: 更高版本无需改动即放行
- **WHEN** 官方 binary 报告的版本高于 `1.0.97`（例如 `1.0.98` 或 `1.1.0`）
- **THEN** media port 可用，且私有目录、尺寸上限与结算前删除的约束照常生效

#### Scenario: CLI 或私有目录不可用
- **WHEN** 官方 binary 缺失、不可执行、未报告可解析版本或版本低于 `1.0.97`，或私有落盘目录缺失、权限不符或不被 child 守卫覆盖
- **THEN** media port 保持 unavailable，不枚举、不下载、不保存 attachment，文字 Delivery 继续，诊断中给出实际版本与所需最低版本

#### Scenario: Delivery 结算后迟到下载
- **WHEN** 图片下载已开始但 current 随后终结或被下一条 Delivery 替换，旧下载才完成
- **THEN** Host 拒绝提交或投递结果，不把旧资源注入新 Delivery

#### Scenario: 被回复消息不自动注入
- **GIVEN** IM 入口且 Host 媒体能力可用（已装配 `pet_locus_message`），当前 Delivery 的触发消息只有文字，它回复的那条消息含一张图片
- **WHEN** Host 为该 Delivery 准备 typed content
- **THEN** 投递内容不含被回复消息的图片或正文，prompt 的 `replied message` 行给出其消息 id 并指明可用单条消息读取工具读取

### Requirement: 媒体下载在私有目录内有界完成并在结算前删除

Pet SHALL 使用一个位于 `DSH_HOME` 之下、权限 0700 的私有目录作为媒体下载与视频抽帧的唯一落盘位置，并 SHALL 为每次下载或抽帧调用在该目录下创建一个独占子目录，以该子目录作为 spawn cwd 调用官方 `lark-cli` 或抽帧工具，使相对 `--output` 落在 CLI 内置允许根之内。目标名 SHALL 不可预测，MUST NOT 复用固定名。整个私有根 SHALL 被 Locus child 的 project-read guard 显式拒绝。

下载期间 Pet SHALL 以本次调用允许的单项与剩余总额持续检查该子目录内最长条目的尺寸；超过上限时 SHALL 立即终止整个进程组。成功、非零退出、Abort、timeout 与进程错误一律 SHALL 在同一次调用内递归删除该子目录（含 CLI 或抽帧工具可能以任意名字创建的临时文件、下载的视频文件与抽出的帧）；Pet 启动时 SHALL 清扫私有根下的全部残留。自动注入路径在结算后、工具读取路径在该次工具调用返回后，MUST NOT 在私有根内留下任何下载或抽帧产物；交给模型的图片只以 DSH attachment 形式存在。

#### Scenario: 下载期超过字节上限
- **WHEN** 目标文件在写入过程中超过本次调用允许的字节上限
- **THEN** Pet 终止 downloader 及其后代、删除目标与临时文件，Host 不保存 attachment，并返回可判定原因

#### Scenario: 取消、超时与进程失败
- **WHEN** Delivery 或工具调用被取消、下载或抽帧超过 Host timeout，或 CLI、抽帧工具非零退出
- **THEN** Pet 终止该进程及其后代并删除全部落盘字节，不留下文件、进程或可供其它 Agent 读取的路径

#### Scenario: 崩溃残留清扫
- **WHEN** Pet 启动时私有目录内存在上一轮未删除的下载或抽帧产物
- **THEN** Pet 删除这些残留，且不把它们当作任何 Delivery 或工具调用的输入

#### Scenario: child 无法读取私有目录
- **WHEN** safe child 以 `read`、`read_image`、`glob` 或 `grep` 访问 Pet 媒体私有目录内的文件
- **THEN** project-read guard 在工具 body 之前拒绝，child 得不到任何媒体字节

#### Scenario: 工具调用返回后不留视频
- **WHEN** 单条消息读取工具下载了一个视频并抽取了关键帧，随后返回
- **THEN** 私有根内不再存在该视频文件、抽出的帧或其独占子目录

### Requirement: 非图片媒体保守降级

普通文件与音频在没有独立验证的读取路径时 SHALL 只返回有界元数据与不支持说明，MUST NOT 自动执行、解压、转码、OCR 或写入项目工作区。视频 SHALL 只按「视频以封面与有界场景关键帧呈现」处理，MUST NOT 以其它方式解码、转码或交给模型。自动注入路径遇到当前消息含视频时 SHALL 只附有界元数据，并说明可用单条消息读取工具查看封面与关键帧；该说明只在 Host 媒体能力可用（即已装配该工具）时出现，媒体能力不可用时按「当前 Delivery 的图片由 Host caller-bound 取得」只说明媒体读取不可用，MUST NOT 提及该工具。

#### Scenario: 普通附件尚无解析器
- **WHEN** current 消息包含 PDF、压缩包或音频，而该类型未声明受支持
- **THEN** child 只得到名称、类型等有界元数据和明确降级说明，不得到可执行文件或通用路径

#### Scenario: 当前消息含视频
- **GIVEN** Host 媒体能力可用
- **WHEN** current 消息包含视频
- **THEN** 自动注入内容只含该视频的有界元数据和「可用单条消息读取工具查看封面与关键帧」的说明，不下载视频、不抽帧

## ADDED Requirements

### Requirement: 子会话按消息 id 读取本入口 chat 内的单条消息

子会话调用 `pet_locus_message`（装配与参数见「单条消息读取工具的装配与参数」）时，Host SHALL 先以 bot 身份读取 `messageId` 指定的消息，并 SHALL 核对返回的唯一消息 `message_id` 等于请求值、其 `chat_id` 等于 caller 入口的 `chatId`；话题入口以所在群的 `chatId` 判定，不要求消息位于同一话题。任一核对不成立、消息已删除、读取失败或返回结构无法解析时，SHALL 返回确定性失败原因，MUST NOT 下载任何资源，MUST NOT 以空结果冒充「消息没有内容」。核对通过后 SHALL 返回有界的消息正文、发送者显示名、创建时间、话题 id 与消息类型，并标注其为不可信群内输入；正文中的图片 SHALL 经私有 spool 下载、magic MIME 检测与 DSH `AttachmentStore` 部署限额校验后，按出现顺序以 typed image block 返回；视频 SHALL 按「视频以封面与有界场景关键帧呈现」处理；文件与音频只返回有界元数据。

#### Scenario: 读取被回复消息中的截图
- **GIVEN** Host 媒体能力可用，当前 Delivery 回复了本群一条带截图的帖子消息，子会话模型支持图片输入
- **WHEN** 子会话以该消息 id 调用 `pet_locus_message`
- **THEN** 返回该消息的正文、发送者与时间，并以 typed image 返回截图

#### Scenario: 其它 chat 的消息被拒绝
- **WHEN** 子会话传入的消息 id 读取成功，但其 `chat_id` 不等于本入口 `chatId`
- **THEN** 工具返回确定性失败原因，不下载任何资源，不返回该消息正文

#### Scenario: 话题入口读取所在群的消息
- **GIVEN** 子会话服务一个话题入口
- **WHEN** 它传入同一群里、不在该话题中的消息 id
- **THEN** Host 按群 `chatId` 核对通过并返回该消息内容

#### Scenario: 读取失败不冒充空消息
- **WHEN** 平台读取失败、消息已删除或返回结构无法解析
- **THEN** 工具返回失败原因，不返回空正文或零张图片的成功结果

### Requirement: 单条消息读取按模型图片能力与额度返回并重验 caller

Host SHALL 在下载前判定当前子会话的精确模型 route 是否声明图片输入；未声明或无法判定时 SHALL 只返回文字部分并明确说明「当前模型无法查看图片」，MUST NOT 下载或保存任何媒体。每次调用返回的图片总数 SHALL 不超过部署的单条消息图片数上限，超出部分 SHALL 以说明文字标注被省略的数量。Host SHALL 在平台读取与下载之后、返回之前重验 caller 仍是该入口当前子会话；不成立时 SHALL 丢弃结果并返回失败原因。

#### Scenario: 模型不支持图片
- **WHEN** 子会话当前模型 route 未声明图片输入
- **THEN** 工具只返回正文和媒体元数据，说明当前模型无法查看图片，且不下载、不保存任何媒体

### Requirement: 单条消息读取工具的装配与参数

Host 媒体能力可用时，IM 入口的 locus 子会话 SHALL 获得 caller-bound 只读工具 `pet_locus_message`，唯一参数为 `messageId`（`om_` 前缀），MUST NOT 接受 chat、thread、file key、URL、本地路径或其它目标参数。Host SHALL 从实际执行 caller 解析其入口；caller 不可解析、不是该入口当前子会话或入口为文档入口时 SHALL 拒绝。文档入口 MUST NOT 装配该工具。Host 的媒体能力不可用（见「当前 Delivery 的图片由 Host caller-bound 取得」中 CLI 或私有目录不可用的情形）时，Host MUST NOT 装配该工具，而不是装配一个必然失败的工具。媒体能力以 Host 启动时的解析结果为准：运行中 CLI 或私有目录发生变化，须重启 Host 重新探测后才改变装配；已装配的工具单次读取失败只返回失败原因，不卸载工具。

#### Scenario: 不接受额外目标参数
- **WHEN** 调用携带 `messageId` 之外的任何参数
- **THEN** 工具拒绝该调用，不发起平台读取

#### Scenario: 文档入口不装配
- **WHEN** Host 组装文档入口子会话的工具面
- **THEN** 工具面不含 `pet_locus_message`，composition attestation 通过

#### Scenario: 媒体能力不可用时不装配
- **WHEN** Host 的媒体能力不可用，Host 组装 IM 入口子会话的工具面
- **THEN** 工具面不含 `pet_locus_message`，composition attestation 通过

### Requirement: 视频以封面与有界场景关键帧呈现

单条消息读取工具遇到视频（`media` 类型消息或帖子中的 `media` 元素）时，SHALL 先下载其封面图并按图片规则返回。Host 启动时 SHALL 探测抽帧工具（`ffmpeg` 与 `ffprobe`）是否可执行；可用时 SHALL 在私有 spool 的独占子目录内下载该视频，下载 SHALL 受部署声明的视频字节上限约束；SHALL 先探测时长，时长超出上限、无法探测或容器格式不在白名单内时 MUST NOT 抽帧。抽帧 SHALL 只允许本地文件协议、禁止网络协议、不从标准输入读取，受整体超时约束，超时或失败时 SHALL 终止进程组。抽出的帧 SHALL 按「视频关键帧的尺寸、校验与时间点」返回。

抽帧工具不可用、视频超出上限、下载或抽帧失败时，SHALL 只返回封面并写明未抽帧的确定性原因；封面也取不到时 SHALL 只返回元数据与原因。视频文件与抽出的帧 SHALL 在调用返回前删除。

#### Scenario: 有 ffmpeg 时返回封面与关键帧
- **GIVEN** Host 探测到可用的 `ffmpeg` 与 `ffprobe`，视频大小与时长都在上限内
- **WHEN** 子会话读取含该视频的消息
- **THEN** 返回封面、按时间顺序的若干关键帧（含首帧，各附时间点）以及时长与帧数说明，私有根内不留视频与帧文件

#### Scenario: 无 ffmpeg 时只给封面
- **WHEN** Host 启动时未探测到可用的抽帧工具
- **THEN** 读取视频消息只返回封面，并写明未抽帧的原因

#### Scenario: 视频超出上限
- **WHEN** 视频字节数或时长超过部署上限
- **THEN** Host 不抽帧（字节超限时在下载中途终止），只返回封面与超限原因

#### Scenario: 抽帧超时
- **WHEN** 抽帧超过整体超时
- **THEN** Host 终止抽帧进程组、删除全部中间产物，只返回封面与超时原因

### Requirement: 视频关键帧的尺寸、校验与时间点

抽出的帧 SHALL 包含首帧与按场景变化选出的帧，总数不超过部署声明的帧数上限与本次调用的剩余图片额度，保持宽高比缩放到宽与高均不超过声明的最长边（不放大，尺寸取偶数），并 SHALL 经与图片相同的 magic MIME 检测与 `AttachmentStore` 校验后，以 typed image block 按时间顺序返回，每帧附抽帧工具为该帧报告的视频时间点；时间点 SHALL 与输出帧逐一配对，缺失、无法解析、数量不一致或任一帧未通过 attachment 校验时 SHALL 丢弃全部抽出的帧并按封面降级，MUST NOT 推算或编造时间点。返回内容 SHALL 写明视频时长与所取帧数，并 SHALL 说明这些帧是抽样，模型 MUST NOT 被引导声称已看过完整视频。

#### Scenario: 非均匀抽样的帧逐一配对时间点
- **GIVEN** 抽帧工具按场景变化输出 3 帧，其逐帧记录的时间点为 0、1.53、4.27 秒
- **WHEN** Host 组装返回内容
- **THEN** 3 帧按输出顺序分别标注 0s、1.53s、4.27s，不按帧序号或均匀间隔推算

#### Scenario: 时间点缺失时不伪造
- **WHEN** 抽帧进程成功退出并产生帧文件，但逐帧时间点缺失、无法解析或数量与帧文件数不一致
- **THEN** Host 丢弃全部抽出的帧，只返回封面与确定性原因，不为任何帧编造时间点

#### Scenario: 横屏、竖屏与窄长帧的最长边约束
- **GIVEN** 部署声明的最长边为 1024
- **WHEN** 分别从 1920×1080、1080×1920、200×3000、640×360 的视频抽帧
- **THEN** 返回帧的实际尺寸分别为 1024×576、576×1024、宽为偶数且高为 1024、640×360（不放大），宽高比与原视频一致，且均通过 `AttachmentStore` 校验

#### Scenario: 帧未通过 attachment 校验
- **WHEN** 抽出的某一帧未通过 magic MIME 或 `AttachmentStore` 部署限额校验
- **THEN** Host 不返回任何关键帧，只返回封面与确定性原因，不产生部分 attachment refs

### Requirement: 入口历史为含媒体的消息标注消息 id

`pet_locus_chat_history` 返回的每一行中，正文含图片、视频、文件或音频标记的，SHALL 在行尾附上该消息的 `om_` 消息 id，供子会话调用单条消息读取工具；其余行 MAY 不附 id。附加内容 SHALL 计入该工具既有的字符预算。

#### Scenario: 视频消息行带 id
- **WHEN** 入口历史中某条消息正文含视频标记
- **THEN** 该行行尾含其消息 id；已装配 `pet_locus_message` 时，子会话以该 id 调用它可读到其封面与关键帧

### Requirement: 引用消息与消息链接的读取指引

已装配 `pet_locus_message` 的 IM 入口，其投递 prompt（首投与续投）在存在 reply 关联时，SHALL 在 `replied message` 行说明可用 `pet_locus_message` 读取被回复消息的正文与媒体。此时 prompt 与工具说明 SHALL 写明：飞书消息链接（`…/client/message/link/open?token=…`）无法由 Host 解析为消息；子会话可以在本入口历史或被回复消息中寻找候选消息并读取，确认不了时 SHALL 在答复中如实说明并请发送者直接回复该消息或转发过来，MUST NOT 声称已看过链接内容，也 MUST NOT 把猜测的候选当作已确认的那条消息。

未装配 `pet_locus_message` 时（见「单条消息读取工具的装配与参数」），投递 prompt 与其它工具说明 MUST NOT 提及该工具，SHALL 改为说明被回复消息与链接内容当前无法读取，并请发送者直接回复该消息或转发过来；`replied message` 行仍给出消息 id。

#### Scenario: 未装配工具时不提及
- **GIVEN** Host 的媒体能力不可用，当前 Delivery 带有 reply 关联
- **WHEN** Host 渲染首投或续投 prompt
- **THEN** prompt 不含 `pet_locus_message`，`replied message` 行仍给出消息 id，并说明消息链接无法解析、请发送者直接回复或转发

#### Scenario: 续投 prompt 指向工具
- **GIVEN** IM 入口且 Host 已装配 `pet_locus_message`
- **WHEN** 一条续投 Delivery 带有 reply 关联
- **THEN** prompt 的 `replied message` 行给出消息 id，并说明可用 `pet_locus_message` 读取

#### Scenario: 无法确认链接指向的消息
- **GIVEN** IM 入口（是否装配 `pet_locus_message` 均适用），触发消息只给出一个消息链接，入口历史和被回复消息里都没有能确认的候选
- **WHEN** 子会话答复
- **THEN** 答复说明无法打开该链接，请发送者直接回复那条消息或转发过来，不描述视频内容
