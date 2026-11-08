## MODIFIED Requirements

### Requirement: 自动模型路由设置页
系统 SHALL 在官方设置页注册「自动模型路由」，提供读取设置、保存设置、设置 API key、测试连接四个已认证 Host 端点。非密钥设置 SHALL 保存在 `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`（目录 0700、文件 0600，原子替换），字段均可缺省：
- `decisionService`：见 auto-decision-services-feedback；
- `decisionToast`：布尔，缺省 true；
- `defaultMode`：MANUAL | AUTO，缺省 MANUAL；
- `effortCap`：low | medium | high | xhigh，缺省 xhigh；
- `jevTimeoutMs`：1000–8000 整数，缺省 8000；
- `preset`：判档预设注册表中的 id，缺省 `reasoning-depth`。
写入 SHALL 整体校验、保留未修改字段，只持久化文件中已有或本次提交的字段，拒绝未知字段（含 `policy`、`mainEfforts`、`childRoutes`）、形似凭据的字段名与非法值（含未注册的 `preset`）；失败 SHALL 返回字段级错误且配置文件字节不变。文件缺失/不可解析时 SHALL 使用缺省设置并报告配置状态；可独立解析的非法普通字段（含未注册的 `preset`）按缺省值处理并报告字段问题。旧映射字段按「旧配置与旧记录只读兼容」处理。下一次请求或工具调用采用新配置，无需重启。

读取响应 SHALL 包含设置、默认值、配置问题、`deprecated` 列表、API key 状态 `{configured, source?, writable, available}`、当前模型目录与子会话允许列表状态；MUST NOT 包含 key 值。

页面 SHALL 包含：决策服务与 API key、判断等待上限、新会话默认模式、判断提示开关、推理强度上限、判档预设选择，以及只读的「查看决策策略」说明。预设选择 SHALL 列出注册表中全部预设的本地化标题与摘要，缺省预设带“默认”标记，选择后经保存设置端点提交 `preset`。策略说明 SHALL 展示所选预设的本地化标题、摘要、证据说明与来源链接（新窗口打开、`rel="noopener noreferrer"`），并直接展示该预设 `rubric.json` 的 instructions 与 criteria 原文，以及按注册表列出各家族的能力槽模型与推荐起点；MUST NOT 提供按家族或档位编辑映射的表格。页面 MUST NOT 切换真实会话模型或调用会话 selectModel。

分段控件 SHALL 统一紧凑高度 28px、字号 12px、内边距和圆角，随内容自然占宽。字段保持官方 13px 阅读尺寸、辅助动作/控件用 12px、分区标题 13px/600。页面 SHALL 复用官方主题令牌、表单与菜单基础组件，深浅色跟随宿主；图标 SHALL 通过官方 `settings.section.icon` 槽、以页面 id `auto-model-routing` 提供 E 字形，使用宿主 size 并继承 currentColor，不使用导航行 marker、按文案定位、MutationObserver 或按钮伪元素；图标槽缺失或贡献释放时保留官方默认图标且页面可用；窄栏不得水平溢出。

设置 API key 端点接受 `{value: string}`（保存/替换）或 `{value: null}`（删除），经官方 credentials 服务写入所选决策服务的凭据引用。空、超过 512 字符或含空白时拒绝。启动环境只读来源 SHALL 拒绝修改，页面说明先移除启动环境变量并重启，再在这里保存。credentials 服务不可用时禁用输入。任何响应、日志、配置文件与错误 MUST NOT 含 key 值；输入不预填，保存后清空草稿；保存 key 不自动清除会话 disabled。key 与非密钥配置是独立提交，任一失败时 SHALL 明确显示哪部分已保存、哪部分未保存。

#### Scenario: 保存普通设置
- **GIVEN** 文件只含 `decisionToast: false`
- **WHEN** 保存 `defaultMode: AUTO`、`jevTimeoutMs: 2500`
- **THEN** 文件为 `{decisionToast: false, defaultMode: "AUTO", jevTimeoutMs: 2500}`，权限 0600；后续新会话与请求采用新设置

#### Scenario: 非法设置整体拒绝
- **GIVEN** 当前设置有效
- **WHEN** 分别提交期限 999、8001、1500.5、`effortCap: max`、`defaultMode: auto`、未知字段 `foo`、凭据字段 `apiKey`、`mainEfforts: {}`、`preset: "does-not-exist"`
- **THEN** 每次均返回字段错误，文件字节不变；另分别提交期限 1000、6000、8000 均保存成功

#### Scenario: 设置文件损坏
- **GIVEN** 文件不可解析，或普通字段 `effortCap: max` 而期限为 2000，或 `preset: "does-not-exist"` 而期限为 2000
- **WHEN** 打开页面并解析设置
- **THEN** 第一种使用默认并说明保存将覆盖损坏文件；第二种上限用 xhigh、期限用 2000；第三种 `preset` 为 `reasoning-depth`、期限用 2000，配置问题含路径 `preset`，状态为 `invalid`

#### Scenario: 选择并保存判档预设
- **GIVEN** 文件只含 `decisionToast: false`，页面已加载
- **WHEN** 读取设置，在预设选择中选 `effort-as-verification` 并保存
- **THEN** 读取响应 `settings.preset` 为 `reasoning-depth`；选择列表恰列出注册表两个预设的标题且 `reasoning-depth` 带“默认”标记；保存后文件为 `{decisionToast: false, preset: "effort-as-verification"}`；下一次 Jev 判断的 `questions` 取自该预设

#### Scenario: 策略说明来自规则文件与注册表
- **GIVEN** 页面已加载，所选预设为 `effort-as-verification`
- **WHEN** 展开「查看决策策略」
- **THEN** 文本含该预设的标题、`evidence` 与来源链接（`href` 为其 `sources[0].url`、`target="_blank"`、`rel="noopener noreferrer"`），含 `src/presets/effort-as-verification/rubric.json` 每个维度的 instructions 与每条 criteria 原文，不含 `reasoning-depth` 独有的 `higher` criteria 原文；含注册表中每个家族的 label 与三个能力槽模型；页面不存在 `[data-tier]` 行或家族分页；展开不发出任何保存请求

#### Scenario: key 的只读来源与迁移
- **GIVEN** key 来自启动环境
- **WHEN** 打开页面并尝试替换
- **THEN** 显示只读并拒绝，提示先移除环境变量、重启、再保存；不回传 key

#### Scenario: 独立保存结果与不泄漏
- **GIVEN** credentials 可写，用户同时编辑 key 和普通设置
- **WHEN** key 保存成功而普通设置因字段错误失败
- **THEN** 明确显示 key 已保存、设置未保存，清空 key 草稿但保留配置草稿；响应、日志与配置文件无 key

#### Scenario: 导航图标只作用于本区块
- **GIVEN** 设置导航中有本区块与其它插件
- **WHEN** 插件挂载再卸载
- **THEN** 只有 id 为 auto-model-routing 的行显示一个 E 字形，无默认齿轮叠加；卸载释放图标贡献并恢复宿主默认字形，未声明图标槽时页面仍可用
