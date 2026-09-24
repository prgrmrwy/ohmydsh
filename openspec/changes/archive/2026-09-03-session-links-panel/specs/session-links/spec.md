# session-links Specification

## Purpose

在 better-sidebar 右侧工作台提供「会话链接」面板:实时采集当前会话消息中的 URL,按 MR/部署/meego/产物制品/其他分类展示,随会话切换联动,并用徽标提示链接数量。纯浏览器侧、只读、不出网。

## ADDED Requirements

### Requirement: 以 better-sidebar tab 形式提供面板入口
系统 SHALL 通过 `ctx.betterSidebar.registerTab` 注册一个 id 为 `session-links` 的工作台 tab,出现在「+」菜单与 tab 栏中,并遵循 better-sidebar 设置页的开关语义(显式禁用后不展示、不打开)。面板 SHALL 为单实例:tabs 中已存在同类型 tab 时再次打开 SHALL 聚焦已有实例而非重复创建。

#### Scenario: 通过 + 菜单打开面板
- **WHEN** 用户在 better-sidebar 工作台的「+」菜单选择「会话链接」
- **THEN** 右侧工作台打开该面板,展示当前会话的链接列表

#### Scenario: 重复打开聚焦已有面板
- **WHEN** 面板已打开,tabs 中存在 `session-links` 类型 tab,用户再次请求打开
- **THEN** 聚焦已有面板,不创建第二个实例

#### Scenario: 设置中禁用后隐藏
- **WHEN** 用户在 better-sidebar 设置页关闭「会话链接」开关
- **THEN** 面板不再出现在「+」菜单,`openTab` 请求被宿主拒绝为 no-op

### Requirement: 采集当前会话消息中的 URL
系统 SHALL 订阅官方 runtime 的 conversation snapshot,从当前会话中采集链接,覆盖 user、assistant、steering、context 消息;assistant 仅采集正文 text 块(不采集 reasoning 与 tool-call 载荷),其余角色采集全部 text 块。采集 SHALL 是增量的:新消息到达后面板无需刷新即更新;会话为空或无可识别 URL 时面板 SHALL 显示空态提示。

#### Scenario: 助手回复包含部署链接
- **WHEN** 助手在某条消息正文里给出部署链接(如 `https://deploy.example.com/app/42`)
- **THEN** 面板在「部署」分类下展示该链接,无需刷新页面

#### Scenario: 用户消息包含 MR 链接
- **WHEN** 用户在消息中贴出 MR 链接
- **THEN** 面板在「MR」分类下展示该链接

#### Scenario: 推理文本中的链接不采集
- **WHEN** 链接仅出现在助手的 reasoning 推理文本中
- **THEN** 面板不展示该链接

#### Scenario: 无可识别 URL 的空态
- **WHEN** 当前会话尚无任何消息或消息中不含可识别 URL
- **THEN** 面板显示空态文案,不渲染空分类

### Requirement: 展示会话中产出的文件
系统 SHALL 从窗口快照的工具调用展示意图(diff 卡片,或 generic 卡片 kind 为 edit)的 follow-along 位置提取本会话产出的文件,与链接并列展示在「本次产出」分组:失败调用、读取类(含 delete/search/read)不产出;同一文件多次写入/编辑按首次出现保留一条;条目展示文件名与时间,点击 SHALL 经 better-sidebar 的编辑器 tab 打开该文件内容(与工作台文件面板点击文件同效:相对路径按会话 cwd 解析、per-path 去重;宿主未提供打开能力时降级为纯文本展示)。产物当前遵循窗口快照语义(host 完整日志基线只覆盖链接,窗口外历史产物不在本期范围)。

#### Scenario: 写入的文件出现在产出分组
- **WHEN** 会话中某次工具调用以 diff 卡片写入 `src/a.ts`
- **THEN** 「本次产出」分组展示 `src/a.ts`,点击在 better-sidebar 编辑器 tab 打开文件内容

#### Scenario: 读取与删除不产出
- **WHEN** 会话中仅读取或删除过文件
- **THEN** 「本次产出」分组不包含这些文件

#### Scenario: 同一文件多次写入只保留一条
- **WHEN** 同一文件先写入后编辑
- **THEN** 产出分组仅一条该文件条目

### Requirement: 链接按类别归组
系统 SHALL 将采集到的链接归入以下类别:MR(合并请求链接,含 git 平台 MR/PR 与 merge_request 特征)、部署(部署/发布平台链接)、meego(meego 域名工作项)、产物制品(制品/包/下载物平台链接)、其他(未命中以上特征的链接)。无法归入前四类的链接必须进入「其他」,不得丢弃。规则判定基于 URL 的 host 与路径/查询特征,并 SHALL 集中维护、可扩展。

#### Scenario: MR 特征命中
- **WHEN** 链接 host/路径/查询含 MR、PR 或 merge_request 特征
- **THEN** 链接归入「MR」类别

#### Scenario: meego 工作项命中
- **WHEN** 链接 host 为 meego 域名(如 `meego.bytedance.net`)
- **THEN** 链接归入「meego」类别

#### Scenario: 未知名平台落入其他
- **WHEN** 链接 host 与路径不匹配任何已知类别特征
- **THEN** 链接归入「其他」类别并正常展示

### Requirement: 展示、排序与打开
面板 SHALL 按分类分组、组内按链接出现时间倒序展示;每条链接 SHALL 展示可读标题(host 加路径摘要)与出现时间。assistant 消息产生的链接在排序 SHALL 优先于同时间的其他来源。点击链接 SHALL 在新标签页打开该 URL,且不向目标页面注入任何脚本。

#### Scenario: 组内倒序与助手优先
- **WHEN** 同一分类下,助手消息产生的链接 T2 与更早的用户消息链接 T1 同时存在且 T2 不晚于 T1
- **THEN** 展示顺序为 T2 在前,T1 在后

#### Scenario: 点击打开新标签页
- **WHEN** 用户点击面板中的链接
- **THEN** 浏览器在新标签页打开该 URL,页面其余行为不变

### Requirement: 随当前会话联动并保持状态生命周期
面板 SHALL 只反映「当前会话」的链接:切换会话后 SHALL 停止订阅旧会话、清空旧列表,并采集新会话的链接。面板组件卸载(关闭 tab / 插件禁用 / 页面卸载)时 SHALL 移除其订阅与 DOM,不残留监听器;收集过程 SHALL 不修改官方会话数据。

#### Scenario: 切换会话后面板清空重建
- **WHEN** 用户从会话 A 切到会话 B
- **THEN** 面板不再展示会话 A 的链接,改为展示会话 B 的链接;A 的链接在其存续期内不残留

#### Scenario: 关闭面板后无残留
- **WHEN** 用户关闭「会话链接」tab(或禁用插件)
- **THEN** 官方会话数据与其余 tabs 不受影响,面板订阅与 DOM 被清理

### Requirement: 只读、本地处理、不访问网络
系统 SHALL 仅在本地处理会话数据:浏览器半区经 Connection RPC 请求 host 半区读取本机会话日志,不向任何外部主机发送链接或会话内容,不加载外部 CDN 资源,不读取或写入凭据。URL 提取与分类 SHALL 全部本地完成。链接打开行为仍受浏览器与 better-sidebar 既有的外部链接策略约束。

#### Scenario: 离线可用
- **WHEN** 浏览器与外部网络断开
- **THEN** 面板仍能展示已采集的当前会话链接(打开链接失败属浏览器正常行为)

### Requirement: 以完整会话日志为链接真相源
系统 SHALL 通过 host 半区读取该会话的**完整**持久化事件日志(经官方 sessionPersistence),据此建立全量链接基线,而不仅依赖浏览器对话窗口快照。消息窗口被截断(加载更多折叠)、被 compaction 摘要替换时,面板 SHALL 仍展示这些历史消息中的链接。基线到达后,新消息 SHALL 继续由窗口快照增量采集,增量水位以基线解析到的最大事件 seq 为准;重复应用基线 SHALL 不重复计数。host 读取失败时系统 SHALL 安全降级为仅展示窗口快照可见的链接,不抛未捕获异常。

#### Scenario: 窗口外历史链接可见
- **WHEN** 会话历史已被「加载更多」折叠,而早期消息中包含 MR 链接
- **THEN** 面板在 MR 分类下展示该链接,无需展开窗口

#### Scenario: compaction 后的旧链接仍在
- **WHEN** 会话发生过 compaction,被摘要替换的历史消息中包含部署链接
- **THEN** 面板仍展示该部署链接

#### Scenario: 基线幂等且增量续接
- **WHEN** 基线已应用,新助手消息再次包含同名 URL(且 seq 大于基线水位)
- **THEN** 该链接计数在基线计数基础上 +1,不重复基线部分

#### Scenario: host 基线失败降级
- **WHEN** host 日志读取不可达或失败
- **THEN** 面板继续展示当前窗口快照采集到的链接,页面与其余 tabs 不受影响

### Requirement: 长会话的采集性能
系统 SHALL 对每个会话最多执行一次全量扫描,其后仅增量处理新增消息;重渲染 SHALL 防抖合并,避免长会话下每帧重扫;采集过程 SHALL 不持有消息全文(仅保留提取出的链接条目与必要展示字段)。

#### Scenario: 长会话滚动追加
- **WHEN** 一个 500 条消息的会话持续增长,助手每轮回复都含链接
- **THEN** 面板随消息追加增量更新,不重复扫描历史消息,界面不因新消息产生明显卡顿