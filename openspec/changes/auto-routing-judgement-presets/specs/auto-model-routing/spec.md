## ADDED Requirements

### Requirement: 判档预设注册表
系统 SHALL 以包内置的**判档预设**提供 Jev 问题文本：每个预设的 questions 位于 `src/presets/<id>/rubric.json`；预设列表与元数据 SHALL 只在 `src/presets/index.ts` 中以一个带类型的常量数组定义，每项含 `id`、静态 import 的 `rubric`、`title`/`summary`/`evidence`（`{zh, en}`）、`sources`（`{title, url, date}` 数组）与 `context`（闭集 `"execution"` 的子集），第一项为缺省预设。运行时 MUST NOT 读取文件系统发现预设，MUST NOT 在模块加载时做会抛错的元数据校验；预设 MUST NOT 修改 depth 偏移、effort cap、家族起点或能力槽。预设的结构约束 SHALL 由包测试按下列场景检查。

#### Scenario: 内置预设满足注册表约束
- **GIVEN** `src/presets/index.ts` 导出的预设数组
- **WHEN** 运行注册表测试
- **THEN** id 依次恰为 `reasoning-depth`、`effort-as-verification`，且各自等于其目录名、互不相同；`effort-as-verification` 的 `context` 为 `["execution"]`，`reasoning-depth` 的 `context` 为 `[]`；每个 `rubric` 恰含 `capability` 与 `depth`，两者 `type` 为 `"choice"`、`instructions` trim 后非空；capability criteria 键集合恰为 `bounded/analytical/frontier/insufficient_context`，depth criteria 键集合恰为 `lower/baseline/higher`，每个 criterion trim 后非空；`context` 只含 `execution`；`title`/`summary`/`evidence` 的 `zh`、`en` 非空；`sources` 非空，每个 `url` 以 `https://` 开头、`date` 形如 `YYYY-MM-DD`

#### Scenario: 约束检查能发现不合格预设
- **GIVEN** 测试把注册表约束检查函数分别作用于以下构造值：两个 id 相同；depth criteria 多出 `max`；capability 缺少 `insufficient_context`；`higher` criterion 为 `"  "`；`context` 含 `history`；`sources` 为空数组
- **WHEN** 调用检查函数
- **THEN** 每次都返回至少一条问题，且问题文本含出错的预设 id 与出错字段

### Requirement: 判档预设发布后不可变
已发布预设的判断内容（`rubric.json` 文件字节与 `context`）SHALL 不可原地修改；修改判断内容 SHALL 以新 id 新增预设，`title`、`summary`、`evidence`、`sources` 不在此限。包测试 SHALL 以测试文件内的常量表记录每个内置预设 `rubric.json` 的 sha256 与 `context`，并断言表中 id 集合等于注册表 id 集合、每项与实际一致；`reasoning-depth` 的哈希 SHALL 直接取自 `test/fixtures/routing-oracle-0.4.2.json` 的 `rubricSha256`，不另存一份。该测试只检测与常量表的漂移；新增预设的评审 SHALL 按 `docs/presets/README.md` 的规则核对：既有 id 的表项只读，只能追加新 id。

#### Scenario: 内置预设与锁定表一致
- **GIVEN** 包内预设目录与测试常量表
- **WHEN** 运行锁定测试
- **THEN** 每个预设 `rubric.json` 的 sha256 与 `context` 都等于表项；`reasoning-depth` 表项等于 oracle 的 `rubricSha256`；表 id 集合等于注册表 id 集合

#### Scenario: 内容漂移使锁定测试失败
- **GIVEN** 锁定比对函数（输入：注册表条目与常量表）
- **WHEN** 以 `rubric.json` 改动一个字节后的内容，或以 `context` 改为 `[]` 的 `effort-as-verification` 调用
- **THEN** 函数返回的问题含该预设 id 与 `rubric` 或 `context`；`docs/presets/README.md` 存在且含“只能追加新 id”

### Requirement: 内置判档预设
系统 SHALL 内置两个预设。`reasoning-depth` 为缺省预设：其 `rubric.json` 与本变更前 `src/rubric.json` 逐字节相同、`context` 为空，因而所选为它时 Jev 请求的 `questions` 与 `state` 与本变更前逐字节相同。`effort-as-verification` 的来源为 Anthropic《Using Claude Code: Spending your effort》（2026-09-25，`https://claude.dev/blog/spending-your-effort/`），`context` 为 `["execution"]`，判断内容按「effort-as-verification 判断内容」。每个内置预设 SHALL 有文档 `docs/presets/<id>.md`，含来源、要点、与其它预设的差异及已知限制。

#### Scenario: 缺省预设与变更前规则逐字节相同
- **GIVEN** 包源码
- **WHEN** 计算 `src/presets/reasoning-depth/rubric.json` 的 sha256
- **THEN** 等于 `routing-oracle-0.4.2.json` 的 `rubricSha256`；`src/rubric.json` 不存在

#### Scenario: 每个内置预设都有文档
- **GIVEN** 注册表 id 列表
- **WHEN** 检查 `docs/presets/<id>.md`
- **THEN** 每个文件都存在；缺任一文件测试失败

### Requirement: effort-as-verification 判断内容
`effort-as-verification` 的 rubric SHALL 把 depth 定义为下一步工作需要的验证、边界情况测试与自主判断投入，而非推理难度；SHALL 写明额外 effort 不能修正方法选错（该风险归入 capability）、工作量与风险本身不改变 depth，以及 `Execution` 行只表示调用路径、不能证明是否有人逐步复核。`lower` 覆盖有人复核并迭代的快速首轮及琐碎检索/复制；`baseline` 覆盖常规功能、规格完整的执行、规则驱动的运维与证据不足；`higher` 覆盖需经复现、对照、模糊测试、测量或比较多种解读才能发现隐藏边界情况的工作及专门的验证/评审轮。`evidence` SHALL 写明数据为厂商内部跑分、对 GPT 家族属于未经验证的外推。

#### Scenario: 新预设文本含关键分界
- **GIVEN** `src/presets/effort-as-verification/rubric.json` 与注册表条目
- **WHEN** 读取 depth 与 capability 的 instructions、criteria 及 `evidence.en`
- **THEN** depth instructions 含 `does not fix choosing the wrong approach`、`Execution` 与 `does not prove whether anyone reviews`，且不含 `a user reads and steers each reply`；`higher` criteria 含 `edge cases` 与 `review`；`lower` criteria 含 `brainstorming`；capability instructions 含 `wrong approach`；`evidence.en` 含 `GPT`

#### Scenario: 新预设不改变引擎档位
- **GIVEN** AUTO 主会话主模型 `claude-opus-5-5`（支持 `low..max`），设置 `preset` 为 `effort-as-verification`
- **WHEN** Jev 分别返回 depth `lower`、`baseline`、`higher`
- **THEN** 主请求 effort 依次为 `low`、`medium`、`high`，与 `reasoning-depth` 下相同 depth 的结果一致；从不为 `max`

### Requirement: 判档预设的采样与归属
每次 Jev 判断 SHALL 在判断开始时（主会话 step 1 的 pre-step、受管子任务首次请求前的 pre-step、`route_subagent` 调用、设置页测试连接）从当次设置读取一次 `preset` 并解析为预设对象（未注册的 id 解析为缺省预设）；该次判断的 `state`（是否含 `Execution` 行）、`questions`、choice 校验与主会话决策的预设归属 SHALL 都使用这个捕获值。判断进行中设置变更 MUST NOT 影响该次判断，也 MUST NOT 触发重判或重试；只影响之后开始的判断。受管子任务的预设在其首次判断开始时捕获，不在创建时捕获。非用户回合不重新判断，沿用上一用户回合的 depth 与预设归属。`route_subagent` 与随后 fresh 创建的子任务各自独立捕获，预览结果不约束后者。设置页测试连接 SHALL 使用所选预设的 questions，`state` 保持固定测试文本。

#### Scenario: 主判断进行中切换预设
- **GIVEN** 设置 `preset` 为 `reasoning-depth`，AUTO 主会话用户回合的 Jev 请求已发出、尚未返回
- **WHEN** 保存 `preset: "effort-as-verification"`，随后 Jev 返回 depth `higher`、回复完成并绑定，再开始下一用户回合
- **THEN** 第一次请求的 `questions` 等于 `reasoning-depth` 的 depth、`state` 不含 `Execution:`；该回合 Jev 请求数为 1；绑定快照 `preset` 为 `reasoning-depth`；下一回合请求的 `questions` 取自 `effort-as-verification`，`state` 含 `Execution: main conversation.`

#### Scenario: 子任务在创建后、首次判断前切换预设
- **GIVEN** 设置为 `reasoning-depth` 时经官方 fresh 子会话工具创建受管子任务
- **WHEN** 子任务首次请求前把设置改为 `effort-as-verification`，然后子任务进入首次判断；判断进行中再改回 `reasoning-depth`
- **THEN** 子任务的 Jev 请求恰 1 次，`questions` 取自 `effort-as-verification`，`state` 含 `Execution: delegated subtask; the result returns to an orchestrating agent.`；改回不触发第二次请求

#### Scenario: 预览进行中切换预设
- **GIVEN** 设置为 `reasoning-depth`，AUTO 主会话调用 `route_subagent`，凭据解析被测试挂起
- **WHEN** 挂起期间保存 `preset: "effort-as-verification"`，再释放凭据解析；之后再调用一次 `route_subagent`
- **THEN** 第一次调用的 Jev 请求恰 1 次，`questions` 取自 `reasoning-depth`、`state` 不含 `Execution:`；第二次调用的 `questions` 取自 `effort-as-verification`、`state` 含 `Execution: delegated subtask; the result returns to an orchestrating agent.`

#### Scenario: 预览与 fresh 子任务独立采样
- **GIVEN** 设置为 `reasoning-depth`，AUTO 主会话调用 `route_subagent`
- **WHEN** 预览返回后把设置改为 `effort-as-verification`，再以同一任务文本经官方 fresh 工具创建子任务
- **THEN** 预览的 Jev 请求使用 `reasoning-depth`，子任务的 Jev 请求使用 `effort-as-verification`；子任务路由不读取预览结果

#### Scenario: 非用户回合不重判
- **GIVEN** 上一用户回合按 `effort-as-verification` 判出 depth `higher` 并已应用
- **WHEN** 把设置改为 `reasoning-depth` 后，一个由子会话完成通知开启的回合发出首个请求并完成回复、回复被绑定
- **THEN** 该请求 effort 与上一回合相同，Jev 请求数不增加；该回复绑定快照的 `preset` 为 `effort-as-verification`，决策 id 与上一用户回合相同

#### Scenario: 测试连接使用所选预设
- **GIVEN** 设置为 `effort-as-verification`，测试连接的凭据解析被测试挂起
- **WHEN** 调用设置页测试连接端点，挂起期间保存 `preset: "reasoning-depth"`，再释放；之后再调用一次测试连接
- **THEN** 第一次假 Jev 服务收到的 `questions` 等于 `effort-as-verification` 的 rubric，`state` 等于固定测试文本，请求恰 1 次；第二次收到 `reasoning-depth` 的 rubric

### Requirement: 判档预设评估脚本
`eval/live.mjs` SHALL 接受 `--preset <id>`（缺省为缺省预设）与输出文件路径；未注册的 id SHALL 在任何网络请求与创建输出文件之前以非零码退出。脚本 SHALL 使用该预设的 `rubric.json`，并通过 import 包构建产物 `lib/context.js` 的 `buildState` 构造与运行时一致的 `state`：用例 `execution` 为 `main` 时按主会话首回合构造，缺省 `delegated` 按子任务构造。单次运行 SHALL 保持现有 20 次调用与 0.10 USD 上限；多次重放的稳定性检验不在单次运行范围内。本变更 MUST NOT 执行付费调用。

#### Scenario: 未知预设提前拒绝
- **GIVEN** 环境中设有任意 `OPENROUTER_API_KEY`，输出路径为不存在的临时文件
- **WHEN** 以 `--preset does-not-exist` 运行脚本，且以预加载方式替换全局 `fetch` 为计数桩
- **THEN** 退出码非零；`fetch` 调用次数为 0；输出文件不存在

### Requirement: 判档预设评估报告
`eval/cases.json` 每条用例的 `capability`/`depth` SHALL 为所有预设的共同期望，可选 `depthFor: {<presetId>: string[]}` 覆盖指定预设的 depth 期望，可选 `execution` 取 `main` 或 `delegated`。`eval/live.mjs` 的报告 SHALL 含顶层 `preset`，每条结果含实际用于判命中的 `expected: {capability, depth}` 与 `execution`，MUST NOT 含版本键。

#### Scenario: 报告记录实验条件
- **GIVEN** 以预加载方式把全局 `fetch` 替换为桩：价格查询返回合规价格，判断请求按收到的 `questions` 返回首个 criteria 键与 `usage.cost: 0`
- **WHEN** 以 `--preset effort-as-verification` 运行脚本
- **THEN** 报告顶层 `preset` 为 `effort-as-verification`；`calls` 恰 18 条；`dev-debug` 的 `expected.depth` 为 `["higher"]`；每条含 `execution`；桩收到的每个 `state` 为字符串且等于对相同输入调用 `lib/context.js` 的 `buildState` 的结果；报告不含版本键；桩收到的判断请求数不超过 20

## MODIFIED Requirements

### Requirement: 无策略版本
系统 MUST NOT 存在策略、规则、映射或记录格式的版本概念：设置 MUST NOT 有 `policy` 字段；以下新写入 MUST NOT 含 `policy`、`policyVersion`、`mappingVersion`、`rubricVersion`、`pluginVersion`、`schema` 或 `version` 键：Host 状态响应、`label` 端点响应、`route_subagent` 输出、子会话决策记录、反馈账本的绑定行、反馈事件行与隐式事实行、用量报告输出、`eval/` 实测脚本的报告。子会话恢复 MUST NOT 以版本比对作为门禁。`label` 端点 SHALL 把绑定投影为不含上述键的公开形状后返回，历史快照在账本中保持原样，供用量报告的历史分组使用。发布包 MUST NOT 含已删除或改名源文件的旧构建产物。Jev 规则文件 SHALL 只存在于「判档预设注册表」定义的预设目录中；判档预设是并存、由用户选择、发布后不可变的命名方案，不是版本：注册表与记录 MUST NOT 表达预设之间的先后、继承或替代关系（新预设以描述其判断思路的名字命名，不以序号或日期作后缀），不自动升级、不自动迁移用户所选预设，`preset` 不属于上述禁用键。工具描述、参数说明、错误信息、client 渲染文本与包内 skill MUST NOT 出现 `policy-v2`、`legacy`、`新策略`、`旧策略`、`原策略` 或“回滚”。插件行为随包版本迭代，包的发布版本号只属于发布元数据，不进入运行时记录。唯一保留的历史名称是子会话决策记录目录 `state/auto-model-routing/policy-v2/`：该路径不迁移，只在一处常量中定义。

#### Scenario: 新写入不含版本字段
- **GIVEN** AUTO 主会话有一个已应用的主决策并绑定回复，且创建并应用了一个 bounded 子任务
- **WHEN** 依次读取：状态响应；该回复的 `label` 响应；一次 `route_subagent` 输出；子任务的决策记录文件；修改、撤销该回复反馈，触发一次曝光与一次切 MANUAL 后反馈账本的全部新增行；随后运行用量报告
- **THEN** 以上 JSON（含嵌套对象）中都不存在键 `policy`、`policyVersion`、`mappingVersion`、`rubricVersion`、`pluginVersion`、`schema`、`version`

#### Scenario: 旧绑定的 label 响应不暴露历史版本键
- **GIVEN** 反馈账本中回复 m0 的旧绑定快照含 `policyVersion`、`mappingVersion`，已有反馈“合适”与一条带 `version: 1` 的曝光事实
- **WHEN** 升级后以 m0 调用 `label` 查询，再改为“投入偏高”，再撤销
- **THEN** 三次响应（含嵌套 `snapshot`）都不含上述版本键，也不含 `strategy`；新增的两行反馈事件不含 `version`；账本中原绑定行字节不变；查询结果的反馈与曝光语义与升级前一致；用量报告仍把该绑定归入其历史组

#### Scenario: 源码与文案不含版本
- **GIVEN** 包内 `src/`、`eval/`、`skills/` 与 `route_subagent` 工具定义
- **WHEN** 测试扫描文本
- **THEN** 从已含 0.4.2 构建产物的 `lib/` 出发执行包构建与 `npm pack --dry-run` 后，文件列表不含 `lib/router.js`、`lib/judgements.js`、`lib/policy-v2.js`、`lib/policy-v2-rubric.json`、`lib/rubric.json`，且仍含 `lib/index.js`、`lib/client.js`、`lib/usage-report.js` 与 `skills/` 下两个 skill；`src/` 中字符串字面量 `policy-v2` 恰出现一次（决策记录目录常量）；不存在字符串字面量 `legacy`，不存在标识符 `rubricVersion`、`pluginVersion`；`policyVersion` 与 `mappingVersion` 只出现在 `feedback.ts`、`policy-store.ts`、`usage-report.ts` 的旧记录读取处；工具描述、参数说明与两个 skill 不含 `policy-v2`、`legacy`、`原策略`、`旧策略`、`回滚`；`src/presets/reasoning-depth/rubric.json` 与变更前规则文件的 sha256 相同，`src/rubric.json` 与 `src/policy-v2-rubric.json` 都不存在

#### Scenario: 旧子会话记录恢复不比较版本
- **GIVEN** 决策记录目录中有一个已应用子任务的旧记录，含 `version: 1`、`policyVersion: "policy-v2-0000aaaa"`、`mappingVersion: "capability-slots-1"` 与 route `claude` / `claude-haiku-5-5` / `medium`
- **WHEN** 插件重启后该子会话发出下一次请求
- **THEN** 请求使用记录中的 route，不报错、不调用 Jev；该请求之后记录文件被重写时不再含 `version`、`policyVersion`、`mappingVersion`

#### Scenario: 切换预设不改变已绑定子任务与已作出的决定
- **GIVEN** AUTO 主会话本回合已按预设 `reasoning-depth` 判出 depth，并已有一个按该预设判断、已应用 route 的受管子任务
- **WHEN** 用户把设置 `preset` 改为 `effort-as-verification`，随后同回合再发请求、该子任务发出下一次请求
- **THEN** 同回合请求复用原 depth、Jev 请求数不增加；子任务使用记录中的 route、不调用 Jev；任何记录都未因预设变化被改写或比对；下一用户回合的 Jev 请求使用 `effort-as-verification` 的 questions

### Requirement: Jev 判断请求与脱敏
系统 SHALL 在 AUTO 主会话用户回合 step 1 与已绑定子任务首次请求前，各以一次 Jev 决策请求得出判断：请求发往设置中所选决策服务的端点与模型（见 auto-decision-services-feedback），凭据按该服务的固定引用在每次调用时经官方 credentials 服务解析（credentials 服务不存在时经官方 launch environment 读取），未解析到值时为 `missing-credential`；单次期限取设置项「Jev 期限」（整数毫秒，范围 1000–8000，缺省 8000，每次请求时读取），`redirect: 'error'`，MUST NOT 重试。请求 body 为 `{model, state, questions}`；`questions` SHALL 取自按「判档预设的采样与归属」为该次判断捕获的预设的 `rubric.json`：主会话只含 `depth`，子任务按显式维度含 `capability`、`depth` 或两者；`route_subagent` 同样使用所选预设。返回的 choice SHALL 按该捕获预设的 criteria 键校验。Jev 返回后 SHALL 重新读取会话模式，等待期间模式已变或回合决定已被废止时丢弃结果（不写决定、不写 `disabled`）。系统 MUST NOT 包含本地规则、关键词或通用对话模型的判断路径。请求 MUST NOT 携带会话状态、其它会话内容或凭据以外的鉴权信息；出站主机 SHALL 仅为所选决策服务的端点主机。

主会话请求的 `state` SHALL 依次包含：
1. 固定首行 `Previous user-turn tier: none`。
2. 仅当所选预设 `context` 含 `execution` 时：固定行 `Execution: main conversation.`。
3. 上一轮上下文（存在时）：一行固定说明“上下文仅用于理解新消息，只判断新消息引出的工作”，随后 `Previous user message (truncated):` 加上一用户回合文本 `.slice(0, 500)`，以及 `Previous assistant reply (last part):` 加上一轮助手文本 `.slice(-1200)`（均为脱敏后截取）。不存在时省略对应段，两者都不存在时省略说明行。
4. `New user message:` 加本回合分类输入（无上一轮上下文时标签为 `User message:`）。
“上一轮”两段在 step 1 的 `agent/pre-step` 中、本回合消息进入之前，从 `agent.session.deriveMessages()` 取得：上一用户回合文本为最后一条 `source.kind === "user"` 的消息的 `text` 块按序以 `"\n"` 连接；助手段为最后一条含非空 `text` 块的 `assistant` 消息的文本块连接。子任务与预览工具的 `state` 为 `Previous user-turn tier: none`、（仅当所选预设 `context` 含 `execution` 时）固定行 `Execution: delegated subtask; the result returns to an orchestrating agent.`、`User message:` 加处理后的任务文本。`Execution` 行的取值只由调用路径（主会话或子任务/预览）决定，只陈述调用路径、不断言是否有人复核，不含任何会话内容，不属于“会话状态”。

外发的每段文本 SHALL 先对**完整文本**经同一函数 `redact` 处理，再截断。`redact` 依次替换（`i` 表示不区分大小写）：
1. `/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g` → `<redacted>`
2. `/\bBearer\s+[A-Za-z0-9._~+\/=-]{8,}/gi` → `Bearer <redacted>`
3. `/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g` → `<redacted>`
4. `/(密码|授权码|appid|password|passwd|token|api[_-]?key|secret)(["']?\s*[:：=]\s*["']?)[^\s"',;]+/gi` → 保留关键字与分隔符，值替换为 `<redacted>`
5. `/\/\/[^\s/:@]+:[^\s/@]+@/g` → `//<redacted>@`
6. `/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g` → `<ip>`
这是形态匹配，尽力而为，不保证移除所有敏感信息。

#### Scenario: 请求内容受限
- **GIVEN** 决策服务为缺省 OpenRouter，预设为缺省 `reasoning-depth`；上一轮用户文本为“修一下登录”，上一轮最后一条助手回复以“要我开始实施吗？”结尾，本回合分类输入为“继续”
- **WHEN** 主会话向 Jev 发起请求
- **THEN** 请求地址为 `https://openrouter.ai/api/alpha/decisions`，body 的 `model` 为 `typesafe/jev-1.13`，`questions` 只有键 `depth` 且与 `src/presets/reasoning-depth/rubric.json` 的 `depth` 深度相等；`state` 首行为 `Previous user-turn tier: none`，不含 `Execution:`，并依次含“修一下登录”“要我开始实施吗？”与 `New user message:\n继续`；`Authorization` 为 Bearer 凭据；失败后无第二次请求

#### Scenario: 上一轮上下文截断、取末段并脱敏
- **GIVEN** 会话历史中上一条用户消息 900 字；之后有两条助手消息，第一条为“早先内容”，最后一条 3000 字且结尾含 `token=abc123def456` 与 `10.1.2.3:8080`
- **WHEN** 构造 `state`
- **THEN** 上一轮用户段为脱敏后文本的前 500 字；助手段为最后一条助手消息脱敏后的末 1200 字，不含“早先内容”；`state` 不含 `abc123def456` 与 `10.1.2.3`，含 `token=<redacted>` 与 `<ip>`

#### Scenario: 脱敏覆盖常见形态且不误伤正文
- **GIVEN** 文本依次含 `{"API_KEY": "abc123"}`、`Token：xyz789`、`Authorization: Bearer abcdefgh12345`、`ghp_0123456789abcdefghijABCD`、`https://u:p@host/x`、`token 过期了怎么办`，以及一个 `sk-` 开头、长 40 字符且起始位置在末 1200 字边界之前 10 字符处的密钥
- **WHEN** 对该文本执行 `redact` 后取末 1200 字
- **THEN** 结果不含 `abc123`、`xyz789`、`abcdefgh12345`、`ghp_0123`、`u:p@` 与该密钥的任何 8 字以上片段；`token 过期了怎么办` 原样保留

#### Scenario: 首个用户回合不带上一轮上下文
- **GIVEN** 会话为 `AUTO`，预设为 `reasoning-depth`，没有上一用户回合
- **WHEN** 首个用户回合发送“看下这个报错”
- **THEN** `state` 恰为 `Previous user-turn tier: none\nUser message:\n看下这个报错`

#### Scenario: 启用 execution 的预设加入固定行
- **GIVEN** 设置 `preset` 为 `effort-as-verification`；会话为 `AUTO`，没有上一用户回合
- **WHEN** 首个用户回合发送“看下这个报错”，随后该会话经官方 fresh 子会话工具创建任务文本为“整理日志”的子任务，并以同一任务文本调用 `route_subagent`
- **THEN** 主会话 `state` 恰为 `Previous user-turn tier: none\nExecution: main conversation.\nUser message:\n看下这个报错`；子任务与预览工具的 `state` 都恰为 `Previous user-turn tier: none\nExecution: delegated subtask; the result returns to an orchestrating agent.\nUser message:\n整理日志`；三次请求的 `questions` 均取自 `effort-as-verification/rubric.json`

#### Scenario: 自主主任务不被断言为逐条复核
- **GIVEN** 设置 `preset` 为 `effort-as-verification`；用户在主会话发送“自主完成迁移，过程中不需要我复核”
- **WHEN** 主会话向 Jev 发起请求
- **THEN** `state` 第二行恰为 `Execution: main conversation.`；`state` 不含 `a user reads and steers each reply` 与 `no user in the loop`；分类输入原样保留在 `User message:` 之后

#### Scenario: 设置中的未知预设回落到缺省预设
- **GIVEN** 配置文件 `preset` 为 `does-not-exist`
- **WHEN** AUTO 主会话发起用户回合
- **THEN** Jev 请求的 `questions` 取自 `reasoning-depth`，`state` 不含 `Execution:`；会话不被停用

#### Scenario: 等待期间切换模式丢弃结果
- **GIVEN** 会话为 `AUTO`，Jev 请求进行中
- **WHEN** 用户在 Jev 返回前切为 `MANUAL`，随后 Jev 分别返回 depth `higher` 或 HTTP 402
- **THEN** 两种情况本回合均不按 Jev 改写 effort；会话为 `MANUAL`，无 `disabled`

#### Scenario: 不跟随重定向
- **GIVEN** 假 Jev 服务返回 302 指向其它主机
- **WHEN** AUTO 会话发起用户回合
- **THEN** 不请求重定向目标，`disabled.category` 为 `rejected`

#### Scenario: 源码不含本地分类与其它出站
- **GIVEN** 包内 `src/` 源码
- **WHEN** 测试扫描源码文本
- **THEN** 不存在 `classify` 导出或关键词词表；出站 URL 主机只属于内置决策服务（`openrouter.ai`、`api.typesafe.ai`、`api.concentrate.ai`）与文档链接主机（含预设 `sources` 中的来源主机）；不出现 `node:http`、`node:https`、`node:child_process`

#### Scenario: 凭据从存储读取且换 key 立即生效
- **GIVEN** 启动环境中没有 `OPENROUTER_API_KEY`，credentials 存储中为 key A
- **WHEN** 发出一次 AUTO 判断，然后经设置页把 key 换成 B，再发出一次判断，再删除 key 后判断
- **THEN** 假 Jev 服务依次收到 `Bearer A`、`Bearer B`；第三次不发请求，会话以 `missing-credential` 停用；全程无需重启

#### Scenario: 期限按设置生效
- **GIVEN** 「Jev 期限」设为 1500，假 Jev 服务 2000ms 后才响应
- **WHEN** 发出一次 AUTO 判断
- **THEN** 约 1500ms 时以 `timeout` 停用；把期限改为 2500 后，下一次判断成功

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

分段控件 SHALL 统一紧凑高度 28px、字号 12px、内边距和圆角，随内容自然占宽。字段保持官方 13px 阅读尺寸、辅助动作/控件用 12px、分区标题 13px/600。页面 SHALL 复用官方主题令牌、表单与菜单基础组件，深浅色跟随宿主；图标使用 E 字形，仅修改自己的导航行，定位失败保留官方默认图标；窄栏不得水平溢出。

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
- **THEN** 只有自己的导航行使用 E 字形；卸载清除标记，找不到行不报错
