## MODIFIED Requirements

### Requirement: Pet 设置采用固定的页签信息架构且不接触 provider 凭据

系统 SHALL 在 DSH Settings 注册独立 Pet section，并固定包含以下六个页签：

- **General**：Pet 外观/位置重置、默认 Agent composition、provider/model、新 Task 使用的默认上下文策略；
- **Skills**：Skill 列表、本地目录导入、已安装版本、启用/禁用、快捷能力可见性、升级/卸载和 Workspace 投影同步状态；
- **Locus**：飞书入口与 DSH 会话关联的**只读展示、导航与生命周期动作**——按入口（群/话题）聚合当前代并折叠历史代际、展示来源与默认 Q&A、权限、工作根与状态，并提供跳转到对应飞书入口与主/子会话的入口，以及解绑/归档/停止/重建/权限确认等动作。该页签 MUST NOT 提供任何**新建外部资源**的入口（绑定新入口、创建答疑群），关联 SHALL 由飞书消息建立、答疑群 SHALL 由 Pet 轮盘建立；
- **环境变量**：按全局与来源 workspace 两个作用域配置的键值，经官方 `ctx.shellEnv` 以 `DSH_PET_*` 注入 Pet executor 的每次 shell 调用；
- **Channel**：bot 绑定入口（创建新 Bot / 连接已有 Bot）与已绑定身份摘要、channel 启用开关、发送者 allowlist、default workspace、chat 到 workspace 的绑定列表（含自动写回的绑定行）与改绑/删除操作；
- **Diagnostics**：Host 生命周期、状态/Workspace/Skill store 与投影路径、版本摘要、同步漂移、依赖可用性、channel 连接状态与队列深度，以及显式修复/重建投影/重连操作。

环境变量页签 SHALL 提供全局与 workspace 两个作用域的编辑入口：全局配置对所有 Pet
Task 生效，workspace 配置只对该来源生效并**覆盖**同名的全局配置；两者都没有时该
变量不存在，由 Skill 自行发现并停止。workspace 作用域允许从 Host 已知 workspace
选择，也允许手工输入尚未列出的 workspace id。页面 SHALL 显示每个 key 实际注入的
变量名，使用户知道在 Skill 中如何引用。系统 MUST NOT 为此引入自定义模板语法：
Skill 侧就是普通的 `$DSH_PET_<KEY>` 环境变量引用。

Pet 浮层与 Task 面板 SHALL 只提供快捷能力执行、调用前来源确认以及 Task/Invocation 的日常操作；它们 MUST NOT 承担 Skill 安装、版本管理、环境变量编辑、channel 配置或完整诊断配置。浮层 SHALL 提供进入相应 Settings 页签的明确入口。

channel 尚未绑定 bot 时，浮层的提示区 SHALL 显示一条通向 Channel 页签的引导，且该
引导 SHALL 可被用户永久关闭——channel 是可选增强，不使用它的用户 MUST NOT 被长期
提示。关闭该引导 MUST NOT 影响 Channel 页签本身的可用性：绑定入口 SHALL 始终可从
Settings 到达。提示区同时具备多条引导资格时 SHALL 只显示一条，且 Skill 引导优先于
channel 引导——没有任何能力的 Pet 首先需要的是 Skill。

#### Scenario: 已配置 Skill 但未绑定 Bot
- **WHEN** 用户已启用至少一个 Skill 且尚未绑定飞书 bot，展开轮盘
- **THEN** 提示区显示通向 Channel 页签的绑定引导

#### Scenario: 既无 Skill 也未绑定 Bot
- **WHEN** 全新安装的 Pet 展开轮盘
- **THEN** 提示区只显示添加 Skill 的引导，不同时显示 channel 引导

#### Scenario: 关闭 channel 引导后仍可绑定
- **WHEN** 用户关闭浮层的 channel 引导，随后改变主意想绑定 bot
- **THEN** 浮层不再显示该引导，Settings 的 Channel 页签仍提供完整绑定入口

#### Scenario: 绑定完成后引导消失
- **WHEN** 用户完成 bot 绑定
- **THEN** 浮层不再显示 channel 引导，无需用户手动关闭

Pet SHALL 显示 provider/model 可用性，但 MUST NOT 读取、回传或保存 subscription token 和其它 provider credentials。环境变量页保存的值 MUST NOT 被当作凭据保管机制，页面 SHALL 提示其会进入子进程环境。Channel 页 MUST NOT 展示或保存任何飞书凭据。配置写入失败 SHALL 保留用户输入并显示错误；需要重启才生效的配置 SHALL 明确提示。敏感 channel 字段在未来加入时 SHALL 以 secret reference 或等价受保护机制保存，管理读取不得回显明文。

#### Scenario: 打开 Pet 设置
- **WHEN** 用户从 Pet 浮层或 DSH Settings 打开 Pet 配置
- **THEN** 用户看到 General、Skills、Locus、环境变量、Channel、Diagnostics 六个稳定页签，并能在 Skills 页完成安装、启用和投影诊断而无需进入 Task 执行面板

#### Scenario: Locus 页签不提供新建外部资源的入口
- **WHEN** 用户打开 Locus 页签
- **THEN** 页面只提供既有入口的展示、导航与生命周期动作，不出现绑定新入口或创建答疑群的控件；两者分别由飞书消息与 Pet 轮盘建立

#### Scenario: Skill 投影发生漂移
- **WHEN** Diagnostics 检测到已启用 allowlist 与 Workspace `.dsh/skills` 投影摘要不一致
- **THEN** Pet 显示具体漂移项且停止把不一致 Skill 用于新 Invocation，用户可执行显式重建投影

#### Scenario: 选择已注册模型
- **WHEN** 用户在 Pet 设置中选择当前 DSH Host 可路由的 provider/model
- **THEN** 后续新 Pet executor session 使用该选择，Pet 配置中不出现 provider token

#### Scenario: 选择不可用模型
- **WHEN** 已配置 provider/model 在当前 Host 不可路由
- **THEN** Pet 在启动 Invocation 前显示可诊断配置错误，不静默回退到另一个可能产生不同副作用的模型

#### Scenario: 配置 CR 目标群
- **WHEN** 用户在环境变量页为某 workspace 保存 `CR_GROUP`
- **THEN** 页面显示其引用形式 `$DSH_PET_CR_GROUP`，该 workspace 来源的后续 shell 调用可读到该值

#### Scenario: 全局配置对所有 Task 生效
- **WHEN** 用户在环境变量页的全局作用域保存 `CR_GROUP`，且某来源 workspace 未配置该 key
- **THEN** 该来源的 shell 调用读到全局值；若该 workspace 另配了同名 key，则读到 workspace 值

#### Scenario: 保存无效配置
- **WHEN** 用户提交不合法的 key 或空 value
- **THEN** 系统拒绝写入、保留表单输入并指出无效字段

#### Scenario: 在 Channel 页改绑一个群
- **WHEN** 用户把一个此前自动绑定到 default workspace 的群改绑到另一个已注册 workspace
- **THEN** 后续该群的触发路由到新 workspace，改绑行标记为用户显式绑定
