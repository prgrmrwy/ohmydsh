## Context

现状（插件 0.1.0，提交 `e35fedb7`）：
- 凭据：`JevClient` 每次调用经 `launchEnvironmentOf(ctx).get('OPENROUTER_API_KEY')` 读取（`src/jev.ts:37`）。启动环境是 launcher 启动时的快照，`bin/dsh` 会 `source` 主 checkout 的 `.env.local`，所以改 key 必须重启。
- 期限：`JevClient` 构造参数 `timeoutMs = 3000`，只有测试会传入。
- effort：`effort.ts` 中 `automatic = [low, medium, high, xhigh]` 写死了上限 `xhigh`；`CHILD_MODELS` 是常量。
- 新会话模式：`RoutingState.read` 在没有状态文件时返回 `{mode: 'MANUAL'}`（`src/state.ts:45`）。
- 已有 `config.json`，只有 `decisionToast` 一个字段，每次状态请求时用 `readFileSync` 读取。

已核验的宿主事实（来源：本机依赖 `node_modules/@deepseek-ai/*` 的 README 与类型，以及 `dsh-pet/compat/subagent/.upstream` 源码）：
- `dsh-credentials`：`ctx.credentials.resolve/describe/set/unset(credentialRef(name))`。`describe` 永不返回值；对只读来源 `set` 会被拒绝；每次 `resolve` 都重新读取，换 key 即刻生效。基础组合已挂载 `dsh-credentials-local`（文件 `~/.dsh/.credentials.yaml`，0600）。查找顺序：启动环境 > 存储文件 > 项目 `.env` > `$DSH_HOME/.env`。
- `dsh-tool-subagent/model-selection-settings` 提供服务 `subagentModelSelection`，`current()` 返回 `{enabled, allowedModels: [{provider, model}]}`。白名单在会话创建时写入会话、此后固定。
- `agent/created` 的载荷为 `{agent, source: 'startup' | 'resume' | 'clear' | 'compact'}`。
- `dsh-settings` 的自动表单（`.volatile()`）写入目标是 profile 的 `cordis.patch.yml`，而本插件那一行由 ohmydsh sync 管理；官方 README 也写明目前没有客户端会按 schema 自动生成页面。
- 先例：`home-network-model-guard` 自注册 `settings.section` 区块，用 RPC 读写 `$DSH_HOME/plugins/<id>/config.json`，写入时先校验、再原子替换，并拒绝形似凭据的字段名。

## Goals / Non-Goals

**Goals:**
- 第一期开放凭据、会话默认模式、上限、期限、提示，以及 Claude/GPT 分页中的主会话 effort 与子会话 model + effort 映射。界面明确显示可编辑的推荐值，不把算法示例混进配置表。
- 设置即时生效，不需要重启，也不需要 `dsh build`。
- key 的值不出现在插件的任何文件、响应或日志中。
- 默认值与当前行为完全一致：不保存任何设置时，行为与 0.1.0 相同。

**Non-Goals:**
- 开放判档规则、外发长度与上下文、脱敏规则、OpenRouter 地址、Jev 模型 id、effort 起点表。
- 修改官方子会话白名单（属于 DSH 设置，本插件只读）。
- 对已有会话批量切换模式。
- 校验 key 是否有效（不额外发请求，也不查询余额；有效性仍由下一次判档的失败类别反映）。
- 让 `max` 可以被自动选中。

## Decisions

### D1. 设置存储：沿用插件自己的 `config.json`，不用官方 volatile 表单
`mainEfforts` 按 provider/tier 保存体系级 effort，`childRoutes` 按 provider/tier 保存完整 model + effort；缺省值保持稀疏，不把未修改格子固化。所有非密钥设置都存进现有的 `$DSH_HOME/plugins/dsh-auto-model-routing/config.json`，由新模块 `src/settings.ts` 统一负责。它用 zod schema 做两种模式：
- **宽松读取**：逐字段解析，非法字段按缺省值处理；
- **严格写入**：整体校验，拒绝未知字段与形似凭据的字段名。

读取不做缓存，每次判档、映射和工具调用都重新读取（文件很小，只有本地 IO）。要是以后测出读取开销，再按 mtime 加缓存。写入方式与 guard 相同：0700 目录、写临时文件后改名替换、文件 0600。

否决的方案：官方 `.volatile()` 自动表单。它会和 sync 争写 `cordis.patch.yml` 中本插件那一行，而且目前没有客户端会渲染它。

### D2. API key：官方 credentials 服务，插件不落盘
- **Host 读取**：`ctx.inject(['credentials'])` 存在时用 `credentials.resolve(credentialRef('OPENROUTER_API_KEY'))`，否则退回 `launchEnvironmentOf(ctx)`。`JevClient` 的 `CredentialSource` 改成异步接口，`missing-credential` 的语义不变。
- **写入**：只通过 `setKey` 端点调用 `credentials.set/unset`。值只在请求体中经过一次，不写日志；端点出错时只返回固定文案。
- **只读来源**：`describe().writable === false` 时直接拒绝，并提示需要先从启动环境移除。本机现状正是这种情况（key 在 `.env.local` 中）。README 写明迁移步骤：先在本机自行保留现有 key，从 `.env.local` 删除该变量并重启一次，再通过设置页保存 key。不能先从只读页面保存；迁移期间未配置 key 时 AUTO 会按原有规则停用。之后换 key 不必再重启。

否决的方案：
- 插件自己加密存储：重复造轮子，还多出一个存放密钥的文件。
- 保留 `.env.local` 不动：无法从 GUI 管理。

信任面变化：key 从仓库根的 `.env.local`（gitignored）转到 `~/.dsh/.credentials.yaml`（0600）。两者对 Agent 工具进程同样可读（官方 README 已说明，file store 不能把密钥与 Agent 隔离）。`dsh.yaml` 的 note 要同步改写。

### D3. 新会话默认模式：在 `agent/created` 里一次性写入
- **监听**：`agent/created`，只处理确认为全新创建、非子会话、尚无插件状态的普通会话。`source === 'startup'` 只作候选条件，不单凭它证明会话全新；实现时结合宿主创建生命周期/会话首始状态核验，并用真实创建与恢复集成测试固定区别。
- **写入**：按当时的 `defaultMode` 写入 `{mode}`；`defaultMode` 为 `MANUAL` 时不写，保持现在"无文件即 MANUAL"的语义。
- **"无文件"判定**：`resume` 恢复的老会话不在此条件内，仍按无文件视为 `MANUAL`，这样修改默认值不会翻转已有会话。

否决的方案：把"无文件时取 defaultMode"放进 `RoutingState.read`。这样会让所有从未切过模式的老会话都随设置变成 AUTO，违反 spec。

Pet 新建的主会话也是普通会话，同样会按默认模式创建。这是用户已接受的结果（2026-10-22：不讨论隐私边界）。

### D4. 映射数据与 effort 上限

自动 effort 集合仍为 `low < medium < high < xhigh`，max 不可自动使用。缺省起点表与偏移算法不开放编辑，但允许覆盖最终映射：

```json
{
  "mainEfforts": {
    "codex": {
      "simple": "low", "complex": "high"
    }
  },
  "childRoutes": {
    "codex": {
      "simple": { "model": "gpt-6-luna", "reasoningEffort": "medium" }
    }
  }
}
```

- `mainEfforts[provider][tier]`：作用于该体系所有主模型；缺省格用实际模型现有起点算法。主会话请求按官方最终 provider 读取对应体系映射，不换模型。保存显式 effort 必须被当前目录该体系全部模型支持；运行时再按实际 model 校验，不支持则明确错误，不静默降档。
- `childRoutes[provider][tier]`：一个原子 `{model, reasoningEffort}` 推荐；不允许只存模型而留下不可见的计算值。缺省格仍用 `CHILD_MODELS` 与该模型的起点算法生成完整组合，不继承主会话覆盖。
- 缺省算法生成的推荐受上限约束，再按实际模型支持集合选取不高于目标的最高等级；如没有候选，不抬高到超过上限的等级。主会话透传并报告无法自动调整；子会话返回明确错误，停止委派，不换模型。
- **显式映射不能被静默截断**：超上限、不被模型支持或模型不可用时，保存返回字段错误；降低上限必须在同一次保存中修复冲突的显式格子。UI 展示的是实际将使用的值，不再画划线旧值。
- 手工文件修改或模型目录变化也必须在使用时校验：主会话配置错误则阻止该次 AUTO 请求并给出固定、不含凭据的设置错误；子会话返回设置错误，暂停委派。不得当成 Jev 失败类别，不自动写入 `disabled`，不退回别的映射。
- Router 已缓存同回合映射时，配置变更必须使缓存失效；不重新请求 Jev，只按当前档位重新解析设置。保存后下一次请求/工具调用生效。

未覆盖的格子可直接使用缺省算法；首次保存页面其它设置时不把整个缺省表固化为显式值。每格提供「恢复默认」，删除对应覆盖；主会话恢复后显示「默认（随模型）」；子会话仍显示解析后的具体组合。

### D5. 模型目录、允许列表与失效配置

界面名称 Claude/GPT 对应内部 `claude`/`codex`；只在页面展示名称，不修改工具参数或持久 provider id。页签结构由小型本地 provider 描述表驱动，本期仅两项，不搭建动态注册系统。

- 主会话 effort 选项来自官方当前目录内对应 provider 全部模型支持集合的交集，不套用子会话白名单。目录无对应模型或读取失败时不新增显式 effort，仍可恢复默认。
- 子会话可选项为「官方启用的子会话允许路由 ∩ 当前可用模型目录 ∩ 本页 provider」。模型详细名称及 reasoning efforts 从官方模型目录获取，不自行推断支持列表。
- 下拉和 Host 保存都使用同一规则；Host 拒绝伪造 provider/model、未允许路由、不支持的 effort、max 和超上限组合。
- 白名单未启用、为空或服务不可用时，不猜测一个更大的列表：子会话 picker 禁用并引导用户配置官方子智能体设置；其它可验证设置仍能保存，未改动的历史失效记录保留并提示，不能顺带清掉或批准它们。
- 已存模型后来被移除时，收起的 trigger 显示原值和「不可用」；模型菜单没有该路由，只能改选当前有效项或恢复默认。缺省模型原本不在允许列表时也显示不可用，不自动换成列表第一个。
- 模型能力或允许列表发生变化后，读取、保存及子任务工具使用时重新核验。这里的当前列表不代替会话创建时的白名单快照：旧会话仍可能被官方拒绝；保留官方拒绝，不自行改路由。

### D6. Jev 期限：每次请求读取，上限 4500ms
`judge()` 每次调用都从设置读取期限。上限 4500 的依据是 `route_subagent` 工具自身的 `timeoutMs` 为 5000：期限不能更长，否则工具会先超时，返回的就不是闭集失败类别。下限 1000 用来防止误配导致必然失败。

### D7. 设置页 UI（2026-10-23 紧凑体系表修订）
原则：页面要像 DSH 自己的设置页，不另立视觉风格。颜色只用官方 `--dsw-alias-*` 令牌，深浅色由宿主的 `body[data-ds-dark-theme]` 切换；能用官方 primitives 的地方一律直接用。采用模型体系分页与主/子映射对照。此前截图是已被替代的单表探索稿，不作为当前方案验收证据；新方案实施时需重新检查深浅色与窄栏。

**注册与导航图标**
- client 注册 `settings.section`：id `auto-model-routing`，label「自动模型路由」，order 300（guard 为 290）。
- `settings.section` 不提供 icon 字段，导航行默认显示齿轮。沿用 dsh-memex / dsh-pet 的有界 DOM 适配：
  - 用 MutationObserver 找到可见文字等于本 label 的 `[role="dialog"] nav button`，只给这一行打标记；
  - 隐藏官方 svg，由 `::before` 以 CSS mask + `currentColor` 画自有字形；
  - 找不到这一行时静默不处理（保留齿轮），卸载时清除所有标记。
- **字形（定稿 E：大脑 + 路线，2026-10-22 用户选定）**：左半是大脑轮廓，带上下两道褶皱，代表判断；中线引出一根主干，分出三条路线，末端各一个实心点，代表按档位分流。
  - 规格：16×16 网格，几何落在 1.5–14.5 内，描边 1.3（官方 Medium 档），圆头圆角，与官方「模型」（Think）「子智能体」（Branch）同一笔画体系。
  - 路径：轮廓 `M8 3C7.1 2.1 5.2 2.2 4.5 3.6C3.1 3.7 2.2 5 2.6 6.3C1.7 7.1 1.7 8.9 2.7 9.7C2.4 11.1 3.3 12.3 4.7 12.4C5.2 13.8 7.1 14.1 8 13.2Z`（stroke-linejoin round）+ 褶皱 `M5.2 6.4C6 6.4 6.6 5.9 6.7 5.1M5.3 9.7C6.1 9.6 6.7 10.1 6.8 10.9`（stroke-linecap round）+ 路线 `M8 8H10M10 8C11.3 8 11.4 4.4 13.1 4.4M10 8C11.3 8 11.4 11.6 13.1 11.6M10 8H13.1`（round）+ 三个 r=0.9 的实心点，圆心 (14, 4.4 / 8 / 11.6)。
  - 否决的候选：G（E 的单褶皱、路线更开的变体，用户选了 E）、完整双半脑（16px 下糊成一团，且与「记忆」语义相近）、菱形决策框（读作流程图，不像 DSH 图标）、纯分叉（与官方 Branch 太像，会和「子智能体」混淆）、端点为空心圈（16px 下与褶皱粘连）。

**页面结构**（外层用官方 `SettingsForm`，自带只读提示、保存失败提示和底部保存按钮）。分三个 section，标题和分隔沿用官方子智能体卡片的样式：标题 13px/600，section 之间用 0.5px `border-l2` 分隔，上下内边距 16px。
1. **判档服务**（导语：AUTO 时每个用户回合请 Jev（经 OpenRouter）判断任务难度。）
   - OpenRouter API Key：直接用官方 `SettingsSecretField`（与官方网页搜索设置页同一控件）。
     - 状态 Tag：`已配置`（neutral）/ `未配置`（quiet）/ `来自启动环境`（neutral，输入框禁用）。
     - 提示文案三选一：已配置时说明「保存在 DSH 凭据存储，不写入设置文件；留空表示保持当前 key」；未配置时说明后果；只读时给出 `.env.local` 迁移步骤。
     - key 的保存走独立端点，但由页面底部同一个「保存」按钮触发：输入框非空才写 key。
   - 判档等待上限：行布局（左标题+说明，右边 76px 右对齐、等宽数字的输入框 + 「毫秒」），与官方「通用」页的行一致。
2. **会话**
   - 新会话默认模式：官方 `SegmentedControl`，选项 `MANUAL | AUTO`；选中 AUTO 时说明追加「新会话的每个用户回合都会请求 Jev」。不弹确认框。
   - 判档提示：官方 `Switch`。
3. **路由映射**
   - 上面的「会话」分区增加「推理强度上限」：官方 `SegmentedControl`，可选 low/medium/high/xhigh。它是全局约束，不与模型表共享一个控制行。
   - 本区先放官方 `SegmentedTabs`：Claude / GPT，切换仅改变当前编辑视图，两页未保存草稿均保留。页面统一称 GPT，内部仍为 codex。
   - 删除页顶主会话模型 selector，表格主 effort 列直接配置本体系四档，说明「主会话推理等级适用于本页体系的所有模型；默认随实际模型计算」。
   - 每页一张表：4 档 ×「主会话推理等级」「子会话推荐」。不再把 Claude/GPT 横向并排，也不使用嵌套主/子分页。

```text
路由映射                         [ Claude | GPT ]

档位                 主会话推理等级        子会话推荐
simple       ⓘ      [ Low       ▾ ]      [ GPT-6-Luna Medium  ▾ ]
standard     ⓘ      [ Medium    ▾ ]      [ GPT-6.1-Sol Medium ▾ ]
complex      ⓘ      [ High      ▾ ]      [ GPT-6.1-Sol High   ▾ ]
escalated    ⓘ      [ XHigh     ▾ ]      [ GPT-6.1-Sol XHigh  ▾ ]
```

   - 档位只写英文名，info 图标用官方 `IconInfoOutlineRegular` + `Tooltip`，悬停/聚焦直接显示共享 `rubric.json` 的 `criteria[tier]` 英文原文。没有中文转述、翻译文件或第二套规则字符串。Tooltip 用 portal，不被表格裁切。
   - 主会话格只编辑本体系该档 effort，未覆盖显示「默认（随模型）」，不是任意模型示例。只列本体系目录全部模型共同支持且不超过上限的自动 effort；无可选项时说明，恢复默认仍可用。
   - 子会话格是一个完整的 picker：收起显示官方模型展示名 + 次要色 effort 展示名；打开根菜单两行「模型」「推理等级」，再分别进入候选列表，和官方 composer picker 相同。模型选择受 D5 限制，推理等级受实际模型能力和上限限制；两项都可编辑。
   - 换模型时，原 effort 被新模型支持且符合上限则保留；否则显示「请选择推理等级」并阻止保存，不悄悄选默认值。草稿可暂时不完整，持久配置必须是完整组合。
   - 失效旧值仅展示为 trigger 状态，不作为菜单可选项。警告仅用于失效状态，不在正常每格常驻。
   - 每格在已覆盖时提供「恢复默认」动作。父/子两列说明常驻：主会话保留当前模型，只调 effort；子会话在 `route_subagent` 判档后返回推荐 model + effort，不改既有子会话、不决定是否派发。
   - 上限与显式值冲突时，在对应格旁显示「超过推理强度上限」，保存禁用；不使用划线旧值或不可编辑的 effort 注释。降低上限不自动改写格子。
   - 表格用 0.5px `border-l4` 外框、`radius-lg`、`border-l2` 行分隔；模型名和 effort 作为一个 trigger，不拆成旁边的裸文本。窄栏按每档叠成主/子两行，不横向撑出宿主面板。

**Picker 复用范围**
官方 `ui-model-selection` 的 `ModelSelect` 实现组件没有在 `/client` 公开导出，且 `ModelDirectory` 绑定真实 session 的 `selectModel`。不能把它直接接到设置草稿，也不从 feature plugin 私有路径导入。复用 `ui-primitives` 的 `MenuSurface` / `MenuGroup`、官方图标、定位/焦点工具及语义令牌；本插件只实现草稿选择逻辑，菜单遵循官方两层导航、选中标记、Escape 返回、关闭后焦点回 trigger 的行为。保存设置不得调用 `sessionController.selectModel`。不改 DSH core、不复制整份官方 ModelSelect。

**紧凑尺寸**：模式/上限/体系分段控件统一 28px 高、12px 字号、一致圆角与内边距，选项随内容自然占宽；不使用 310px 固定宽大页签。表格 picker 同为紧凑高度，字段保持官方 13px 阅读尺寸，辅助动作/控件 12px，分区标题 13px/600。局部样式只作用本插件，不改全局 primitives。

**文案**：中文与芯片一致；模型 id、effort 档名、MANUAL/AUTO 保留英文原样。按钮只叫「保存」，与官方表单一致。不用全大写标签和装饰性编号。

**状态**：
- 加载中：沿用 `SettingsForm` 的不可用态。
- 设置文件损坏：页面按缺省值显示，表单顶部显示一行 tertiary 说明「设置文件无法解析，已按默认值显示；保存会覆盖它」。
- credentials 服务不可用：key 输入框禁用，Tag 显示「不可用」。
- 白名单服务不可用：子会话 picker 禁用，说明「无法读取子智能体允许列表」；原值只读展示，不成为可选项。

**参照**：官方 `ui-settings-subagent`（section 结构）、`ui-settings-web-search`（secret 字段）、`ui-settings-models`（select 样式）、`ui-settings-general`（行布局）、`ui-primitives`（`SettingsForm` / `SettingsSecretField` / `SegmentedControl` / `Switch` / `Tag` / `Tooltip` / `IconInfoOutlineRegular`）。实现时先按同样的方式（真实主题令牌 + agent-browser，深浅两色）截图核对，再进入现有 GUI 验收。

### D8. 端点
在现有 `connection.fetch.register` 循环中增加 `settings`、`saveSettings`、`setKey` 三个操作，复用现有的信封解析。这三个端点不带 `sessionId`，不经 `resolveAgent`，与 guard 的设置端点同为已认证连接上的操作。

## Risks / Trade-offs

- **默认 AUTO 时每个新会话都外发、都可能换 effort 丢缓存**。这是用户的选择；页面在该选项旁用一句话说明"新会话每回合会把消息发送到 OpenRouter"，不弹确认框。
- **迁移期 key 只读的困惑**：本机 key 在 `.env.local`，第一次打开页面会看到"来自启动环境、只读"。用页面文案与 README 的迁移步骤缓解。
- **改 effort 上限会影响已标注数据的可比性**：判档记录目前只存 effort，不存上限。影响有限：标注衡量的是档位，而档位不受上限影响。本期不改判档记录格式；如果以后要按 effort 分析，再另开 change 加字段。
- **模型能力与白名单会变化** → 保存与实际使用双重核验；保留失效值供修复，不悄悄换模型。
- **全局上限与显式映射冲突** → 字段级错误阻止保存，要求在同一次提交中解决；未修改的默认格仍由缺省算法按上限解析。
- **设置每次都读文件**：本地小文件，开销可以忽略；若测出问题再按 mtime 缓存。

## Migration Plan

1. 部署新版插件后，不改设置时行为不变；`.env.local` 中的 key 照常可读。
2. 如需在 GUI 管理 key：在本机自行保留 key → 从 `.env.local` 删除该变量 → 重启一次 → 在页面保存。只读环境覆盖期间不能先在页面保存。
3. 回滚：插件降回 0.1.0 时，新字段会被旧代码忽略（旧代码只读 `decisionToast`）；存在 credentials store 里的 key 对旧代码不可见，需要放回 `.env.local`。

### D10. 旧逐模型覆盖的显式处理
旧 `mainEfforts[provider][model][tier]` 不能猜测为体系规则，也不能隐藏后继续使用。读取保留原值并诊断，运行时该体系有旧形状即报设置错误；不相关普通设置保存不丢数据。用户提交新的规范体系 map 时明确替换旧体系对象，或 `mainEfforts[provider]=null` 整组恢复默认。界面显示警告与可操作的整组恢复按钮。实际部署此前仅 decisionToast 时无需迁移。
