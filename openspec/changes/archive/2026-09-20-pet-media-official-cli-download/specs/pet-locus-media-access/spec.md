## MODIFIED Requirements

### Requirement: 当前 Delivery 的图片由 Host caller-bound 取得

系统 SHALL 通过 manifest 中精确 pin 的官方 `lark-cli`（由 Pet 私有解析，绝不回退 PATH）在受守卫的私有落盘目录内取得当前请求绑定消息中的图片。Host SHALL 从已接受 Delivery 的不可变触发 `messageId` 枚举资源，并只取得该消息内的图片；模型 MUST NOT 提供 chat、message、thread、file key、本地路径、URL 或其它目标 selector。

资源枚举、下载与 attachment 提交 SHALL 绑定该 Delivery 的 active locus/generation/child；在保存与最终入队前 SHALL 重验它仍是同一 current Delivery。若 Delivery 已终结、晋升或代际改变，Host SHALL 丢弃未发布结果且 fail closed。

#### Scenario: 官方 CLI 与私有落盘目录已证明
- **WHEN** 官方 binary 可解析且版本与 manifest pin 一致，私有落盘目录存在、权限为 0700，且位于 Locus child 读取守卫拒绝的 root 内
- **THEN** Host 以该目录为 spawn cwd 调用官方 CLI 取得 current message 图片，绝不回退 PATH 中的全局 `lark-cli`，且不向项目目录写入任何字节

#### Scenario: CLI 或私有目录不可用
- **WHEN** 官方 binary 缺失、不可执行或版本与 pin 不符，或私有落盘目录缺失、权限不符或不被 child 守卫覆盖
- **THEN** media port 保持 unavailable，不枚举、不下载、不保存 attachment，文字 Delivery 继续

#### Scenario: Delivery 结算后迟到下载
- **WHEN** 图片下载已开始但 current 随后终结或被下一条 Delivery 替换，旧下载才完成
- **THEN** Host 拒绝提交或投递结果，不把旧资源注入新 Delivery

## REMOVED Requirements

### Requirement: 媒体下载无具名路径且双层有界

**Reason**: 该 requirement 把"字节不存在于任何具名路径"当作唯一可接受形态，因此只有一份私有 fork（固定源码 + patch + 固定 Go 工具链）才能成立，冷构建代价约 430 MB 并需长期承担 patch 与上游 pin 维护。但图片最终必然持久化到 `~/.dsh/attachments`，那份持久副本的唯一保护已经是 Locus child 的 project-read guard；fd seam 额外保护的只是"网络 → Host 内存"这一跳，不足以支撑这份 fork。

**Migration**: 由新增 requirement「媒体下载在私有目录内有界完成并在结算前删除」承接：隔离依据从"无路径"改为"路径位于 child 读取守卫拒绝的 root 内"，并新增写入期硬终止、启动清扫与结算前删除。**明确接受的退化**：已知 Content-Length 的读前拒绝不再可用（官方 CLI 路径模式没有任何字节上限）。补偿为写入期轮询终止、下载后尺寸校验与无条件删除；pet-locus-media-access 的单图/消息双层限额语义不变。

## ADDED Requirements

### Requirement: 媒体下载在私有目录内有界完成并在结算前删除

Pet SHALL 使用一个位于 `DSH_HOME` 之下、权限 0700 的私有目录作为媒体下载的唯一落盘位置，并 SHALL 为每次调用在该目录下创建一个独占子目录，以该子目录作为 spawn cwd 调用官方 `lark-cli`，使相对 `--output` 落在 CLI 内置允许根之内。目标名 SHALL 不可预测，MUST NOT 复用固定名。整个私有根 SHALL 被 Locus child 的 project-read guard 显式拒绝。

下载期间 Pet SHALL 以本次 Delivery 的单图与消息剩余额持续检查该子目录内最长条目的尺寸；超过上限时 SHALL 立即终止整个进程组。成功、非零退出、Abort、timeout 与进程错误一律 SHALL 在同一次调用内递归删除该子目录（含 CLI 可能以任意名字创建的原子写临时文件）；Pet 启动时 SHALL 清扫私有根下的全部残留。结算后 MUST NOT 在磁盘上留下任何下载产物。

#### Scenario: 下载期超过字节上限
- **WHEN** 目标文件在写入过程中超过本次 Delivery 允许的字节上限
- **THEN** Pet 终止 downloader 及其后代、删除目标与临时文件，Host 不保存 attachment，并返回可判定原因

#### Scenario: 取消、超时与进程失败
- **WHEN** Delivery 被取消、下载超过 Host timeout 或 CLI 非零退出
- **THEN** Pet 终止 downloader 及其后代并删除全部落盘字节，不留下文件、进程或可供其它 Agent 读取的路径

#### Scenario: 崩溃残留清扫
- **WHEN** Pet 启动时私有目录内存在上一轮未删除的下载产物
- **THEN** Pet 删除这些残留，且不把它们当作任何 Delivery 的输入

#### Scenario: child 无法读取私有目录
- **WHEN** safe child 以 `read`、`read_image`、`glob` 或 `grep` 访问 Pet 媒体私有目录内的文件
- **THEN** project-read guard 在工具 body 之前拒绝，child 得不到任何媒体字节
