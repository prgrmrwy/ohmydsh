## ADDED Requirements

### Requirement: 当前 Delivery 的图片由 Host caller-bound 取得

系统 SHALL 通过 Pet 私有、固定源码构建且运行时证明 provenance 的 `lark-cli` bounded inherited-fd seam，为 read-only Locus 取得当前请求绑定消息中的图片。Host SHALL 从已接受 Delivery 的不可变触发 `messageId` 枚举资源，并只取得该消息内的图片；模型 MUST NOT 提供 chat、message、thread、file key、本地路径、URL 或其它目标 selector。

资源枚举、下载与 attachment 提交 SHALL 绑定该 Delivery 的 active locus/generation/child；在保存与最终入队前 SHALL 重验它仍是同一 current Delivery。若 Delivery 已终结、晋升或代际改变，Host SHALL 丢弃未发布结果且 fail closed。

#### Scenario: 私有 compat 能力已证明
- **WHEN** 包内 binary 的版本、commit、patch、平台和 bounded-fd capability 均与 provenance 一致
- **THEN** Host 使用 fd3 匿名 pipe 取得 current message 图片，绝不回退 PATH 中的全局 `lark-cli`

#### Scenario: compat 缺失或不匹配
- **WHEN** 私有 binary 缺失、不可执行、平台不符或 provenance/capability 不匹配
- **THEN** media port 保持 unavailable，不枚举、不下载、不保存 attachment，文字 Delivery 继续

#### Scenario: Delivery 结算后迟到下载
- **WHEN** 图片下载已开始但 current 随后终结或被下一条 Delivery 替换，旧下载才完成
- **THEN** Host 拒绝提交或投递结果，不把旧资源注入新 Delivery

### Requirement: 媒体下载无具名路径且双层有界

私有 `lark-cli` 的 fd 模式 SHALL 仅在 POSIX 接受配对的 inherited `output-fd >= 3` 与正整数 `max-bytes`，并 MUST 与普通 `output` 路径互斥。已知 Content-Length 超限时 SHALL 在输出任何 bytes 前拒绝；未知长度 SHALL 最多向 fd 写入 `max-bytes + 1` 后拒绝。普通全局 CLI 与路径下载行为 MUST NOT 因此改变。

Pet SHALL 通过 Host-owned child process 的 fd3 pipe 接收 bytes，并以相同单图/消息剩余额做第二层累计。超限、Abort、timeout、进程错误或 receipt 大小不符 SHALL 关闭 pipe、终止完整进程组并丢弃 bytes。stdout SHALL 只承载小型 JSON receipt，图片 bytes MUST NOT 进入 stdout/stderr、项目目录、`/tmp` 或 Pet state。

#### Scenario: 已知长度超限
- **WHEN** 平台 Content-Length 大于 `max-bytes`
- **THEN** 私有 CLI 非零退出且 fd 不输出资源 bytes，Host 不保存 attachment

#### Scenario: Host 第二层检测超限
- **WHEN** fd3 实际输出超过 Host 传入的 byte 上限
- **THEN** Host 立即关闭 pipe、终止进程组并丢弃全部已收 bytes

#### Scenario: 取消和超时
- **WHEN** Delivery 被取消或下载超过 Host timeout
- **THEN** Host 终止 downloader 及其后代，不留下文件、进程或可供其它 Agent 读取的路径

### Requirement: 图片进入 DSH durable attachment 与 typed content

Host 取得的图片 SHALL 在 magic MIME 检测及完整解码验证后，通过 DSH `AttachmentStore` 的部署限额批量持久化为不可变、content-addressed `ImageAttachmentRef`，并按消息中出现顺序以 typed image content block 返回给当前 child。系统 SHALL 继承单图 bytes、消息总 bytes、像素、边长、数量和支持媒体类型限制，MUST NOT 仅信任飞书声明的 MIME、扩展名或尺寸。

若当前精确模型 route 不支持 image input，系统 SHALL 对同一 exact current 至多重试一次纯文字投递，并明确说明模型未查看图片；MUST NOT 重跑媒体 admission、重开旧 Delivery 或把 A 的 fallback 投进已晋升 B。纯文字重试失败时才按既有规则终态失败。

#### Scenario: 合法图片注入
- **WHEN** 飞书资源解码为受支持图片且未超过 DSH attachment 限额
- **THEN** Host 批量保存 normalized image refs，并按原顺序把 typed image blocks 与必要文字说明交给同一 child

#### Scenario: 伪造或超限图片
- **WHEN** 声明为图片的资源无法完整解码、实际类型不匹配或超过 bytes/pixel/count 限额
- **THEN** Host 拒绝保存与注入，返回可判定原因且不产生部分 attachment refs

#### Scenario: 文本模型请求看图
- **WHEN** typed image queue 明确返回 `image-route-unsupported`
- **THEN** Host 重验同一 current 后只重试一次原文字加“当前模型无法查看图片”的提示，不声称图片已被理解

#### Scenario: fallback 期间 current 改变
- **WHEN** A 的 typed image 被拒后、纯文字重试入队前 A 已终结且 B 已晋升
- **THEN** 最终 queue fence 拒绝 A 的 fallback，不把其文字或图片投进 B

### Requirement: Locus project-read guard 限制 safe child 文件读取

系统 SHALL 在每个 safe locus child 的同步 prepublication 与 cold-restore composition 中安装 caller-bound project-read guard。`read`、`read_image`、`glob` 与 `grep` 只能访问 Host 从 exact child Session cwd、parent Session cwd 和 sandbox workspace root 一致证明出的单一 canonical project root；三者不一致、缺失或不可解析时 MUST veto child publication。

路径授权 SHALL 使用 physical `realpath` 与路径边界比较，MUST NOT 仅用字符串前缀。DSH_HOME、Pet state 与 attachment roots SHALL 显式拒绝；project root 与任一拒绝根互相包含时 MUST veto publication。缺 path、不存在目标、相对越界和 symlink escape 均 SHALL fail closed。

#### Scenario: 项目内读取允许
- **WHEN** safe child 读取或搜索已确认 project root 内的真实文件
- **THEN** project-read guard 允许调用继续

#### Scenario: Pet 私有根读取拒绝
- **WHEN** safe child 尝试 glob 或 read DSH_HOME、Pet state、attachment root 或指向这些位置的 symlink
- **THEN** guard 在工具 body 前拒绝，不能枚举或读取私有数据

### Requirement: 非图片媒体保守降级

第一版 SHALL 只处理当前消息图片。普通文件、音频和视频在没有独立验证的读取路径时 SHALL 只返回有界元数据与不支持说明，MUST NOT 自动执行、解压、转码、OCR 或写入项目工作区。

#### Scenario: 普通附件尚无解析器
- **WHEN** current 消息包含 PDF、压缩包、音频或视频，而该类型未声明受支持
- **THEN** child 只得到名称、类型等有界元数据和明确降级说明，不得到可执行文件或通用路径
