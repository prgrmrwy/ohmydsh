# Changelog

## 0.1.0 — 2026-08-21

- 首个版本：host 侧 `provider` session-projection 单元 + web client 侧边栏 provider 徽标注入。
- 数据链路：官方 `SessionProjectionMap` 扩展（键 `provider`），折叠日志 `request/header` 事件（最后一次实际请求的 provider/model），持久化缓存 + 列表帧下发，重启不丢、不存 localStorage。
- 渲染：轻量 DOM 注入 + `row-locator` 单一结构模块；不触碰官方 `StateDot`；定位失败安全降级。
- 对应 openspec change `sidebar-session-provider-icon`。

## 0.1.1 — 2026-08-21

### Real-GUI feedback revision

- 当前打开 session 改为订阅官方 `modelDirectories` selector store：输入框切模型成功后无需发送消息即更新 icon；last-request projection 仅作冷历史 fallback。
- 手绘近似 SVG 全部替换为下载落盘的固定品牌资产：DeepSeek 鲸鱼、OpenAI 螺旋、OpenCode、Anthropic、Grok；运行时不访问 CDN。
- 按真实 route 校正映射：`opencode-go/deepseek-v4-flash` 显示 OpenCode，`deepseek-official/deepseek-v4-flash` 才显示 DeepSeek。
- 空白 session 有当前 selector 值时亦显示品牌；继续保持 StateDot/时间/菜单/拖拽原样。

## 0.1.2 — 2026-08-21

- 按真实 GUI 对齐反馈调整图标间距为仅左侧 4px；新增 Kimi、GLM（智谱）、MiniMax、Pi、OpenClaw、Hermes Agent 的固定品牌资产和 route/model 映射；Hermes 同时兼容用户输入的 `hermas` 别名。

## 0.1.3 — 2026-10-10

- 复合 icon：provider route 与 model id 分别识别出**不同**已知品牌时，主图为 provider 品牌、右下角叠加 7px model 品牌子图标（9px 圆底 + 淡描边，`Canvas` 底色随深浅主题）；同品牌、model 不可识别或 route 未知时仍为单一 logo。外框保持 14×14，行布局不变；tooltip 不变。
- 新增 Trae 品牌资产（`@lobehub/icons-static-svg@1.94.0`，MIT），`trae` / `traex*` / `trae-ai` route 映射到 Trae；此前 `traex/GPT-*` 经 model fallback 误显示 OpenAI。
- 子图标内 SVG 的内部 id 与 `url(#…)` 引用加后缀，避免与同页其它副本串用定义。
- 对应 openspec change `sidebar-provider-icon-composite-model-badge`。

## 0.1.4 — 2026-10-10

### Real-GUI feedback revision

- 子图标去掉圆底、描边与内边距，改为裸 glyph，尺寸 7px → 10px，向右下溢出 4px；14×14 外框不变，行布局不变。
- 按 OpenCode Go / Zen 模型目录补齐 model 品牌：Qwen、混元（`hy3` / `hy4-*`）、LongCat、小米 MiMo、Gemini、NVIDIA（Nemotron）、Meta（Muse Spark / Llama）、蚂蚁（Ling/Ring）。对应 provider route（`qwen-token-plan*`、`xiaomi-token-plan*`、`google`、`nvidia`、`ant-ling` 等）同样映射。资产均为 `@lobehub/icons-static-svg@1.94.0`（MIT）。
- 目录中没有可识别厂商的模型（如 `omen-alpha`、`big-pickle`）仍只显示 OpenCode 单 logo。

## 0.1.5 — 2026-10-10

- 按当前 TraeX 目录补齐 model 子图标：`openrouter-*` 使用 OpenRouter，`Seed-*` 使用 ByteDance；既有 GPT、DeepSeek、Gemini 映射继续复用。主图始终保持 Trae。

## 0.1.6 — 2026-10-13

插件行为不变；这一版是公开发布所需的分发与合规改动。

- 新增 `prepare` 脚本（与 `prepack` 并用）：npm/pnpm 安装 **git 依赖**时执行的是 `prepare`，
  此前只有 `prepack`，从 GitHub 源码安装装出来没有 `lib/`，插件无法加载。
- 新增 `THIRD-PARTY-NOTICES.md`：LobeHub 图标（MIT）与 `anomalyco/opencode`（MIT）的版权行与
  许可全文，以及渲染期技术性改动与商标立场说明。
- `package.json` 补 `repository`（指向发布仓库，市场按它关联 npm 包与下载量）、`homepage`、
  `bugs`、`keywords`；`files` 增加 `THIRD-PARTY-NOTICES.md` 与 `docs`。
- 新增 `screenshots.json`（市场详情页截图顺序）与 `.github/workflows/release.yml`
  （tag 触发、npm trusted publishing / OIDC 发版，仓库内不存长期 token）。
- README 双语安装段改为消费者视角（npm 与源码两条命令），描述补上产品名。

## 0.1.7 — 2026-10-13

插件行为不变；只改用于被检索到的描述文本。

- 描述统一为 **"show a provider + model icon in the sidebar for every session"**：GitHub About、
  `package.json` 与 npm 页面用同一句（npm 的描述只在发版时刷新，所以借这一版更新）。
  此前那句缺 `provider` 与 `icon` 两个检索词。

## 0.1.8 — 2026-10-13

### Real-GUI feedback revision

两条行为修复（本地 2026-10-12 实测发现；原在本仓库内编号为 0.1.6/0.1.7，因该编号已被公开发布的分发版本占用，合并后统一改记为 0.1.8）。

#### 切模型后图标即时跟随

- 修复：会话已经切到新模型（实机：`claude/claude-opus-5-5` → `codex/gpt-6.1-sol`，Host 侧 `provider` 与 `modelSelection` 投影都已是 `codex`）后，侧边栏该行仍显示 Anthropic 图标，必须刷新页面。根因是「即时选择」被当成永久事实：官方 per-session store 属于客户端 Session scope（回收再物化会给同一个 session id 换一个 store），而旧实现按 session id 只绑定一次、永不再解析；同时无法再核验的观测值一直压在持久投影之上。
- 观测生命周期改为按 store 身份绑定：每次会话列表 / DOM 信号重新解析当前打开会话的目录，store 变化即重订阅并重读快照，身份未变时也重读（漏发、订阅曾失效都能在下一次信号自愈）。观测值只在「其 session 是当前打开会话、且目录可解析」期间保留，否则丢弃。
- 持久取值改为两级：官方 `modelSelection` 投影的 `next`（含"已选但尚未发送"）优先，其次才是本插件的最近一次实际请求投影——避免观测值被丢弃后退回上一次请求的品牌。
- 对应 openspec change `sidebar-provider-icon-selection-freshness`。

#### 同名会话徽标不再互相串用

- 修复：**同名会话的徽标互相串用**。实机：两个标题都是「下线豆包工作伙伴」的会话（`session-a1f7a6e8` 在用 `codex/gpt-6.1-sol`，另一个 7 小时前的会话在用 `claude/claude-opus-5-5`）显示的品牌正好互换——运行中那行显示 Anthropic，另一行显示 OpenAI；Host 侧两个会话的 `provider` 投影都正确。
- 根因：行 → session 的映射一直靠**标题文本反查**（`providerTitleIndex` + 每轮 `used` 集合），同名会话按「DOM 行顺序 ↔ 列表顺序」逐一对号；侧栏按工作区分组后两者顺序不一致（两个同名会话分属不同 workspace），两行就把彼此的 id 拿反了。
- 修复：官方行 DOM 本身带 `data-row-key="session:<id>"`（`dsh-client-ui-workspace` 的 `SessionNodeItem`），改为优先用它做精确身份；标题反查保留为没有该属性时的 fallback；同一 key 重复出现时宁可不显示该行徽标，也不回退到别人的标题。
- 测试：`test/row-locator.test.ts` 新增 4 条用例（行键优先、同名不互换、无属性回退、缺失/畸形/重复键不显示），旧实现下 3 条 RED——失败信息就是互换本身（`expected 'newer' to be 'older'`）。

## 0.1.9 — 2026-10-23

- 新增 Magpie 网关品牌：provider route `magpie`、`magpie-*` 与 `dsh-magpie-connect` 插件 route（规范化后为 `magpie-connect`）识别为 Magpie，按完整名或前缀匹配，不按子串。此前该 route 不被识别，网关会话按模型名回落，与直连会话图标完全一样。
- 网关型 route 下 model id 形如 `<上游provider>/<model>`：右下角小图标先按上游段当作 provider route 识别（`claude/claude-haiku-5-5` → Anthropic，`opencode-go/deepseek-v4-flash` → OpenCode），认不出时再按 `/` 后的模型名识别（`auto/claude-haiku-5.5` → Anthropic）；都认不出只显示 Magpie。其它 route 的判定不变。
- 资产：`yetone/magpie` commit `ba1dc7f` 的官方标志 `internal/provider/magpie.svg`（MIT），逐字节落盘并记录 SHA-256。该文件本身不带 fill（magpie 页面用 CSS 上色），渲染时只对它的根元素注入 `fill="currentColor"`，深浅主题下都可见。
- 测试环境：vitest 的资源内联上限提高到 16 KB，使约 4.9 KB 的 magpie.svg 与生产构建一样以 markup 形式进入代码。
- 对应 openspec change `sidebar-provider-icon-magpie-route`。


## 0.1.10 — 2026-10-25

### Real-GUI feedback revision

修复网关会话的小图标显示成上游平台、而不是模型厂商。

- 实机：会话的 `provider` 已经是 `dsh-magpie-connect`，`model` 是 `opencode-go/deepseek-v4.1-flash`，但侧边栏显示「Magpie 主图 + OpenCode 小图」，看起来 model 是 OpenCode 而不是 DeepSeek。
- 根因：0.1.9 的网关解析先读 `/` 前的上游段并把它当 provider route，命中即返回。而 `<上游provider>/<model>` 的上游段正是分发平台，主图已经把「走网关」这件事表达掉了，小图标再复述平台就等于丢掉唯一的厂商信息。
- 修复：网关型 route 下的小图标改为**先按 `/` 后的模型名识别厂商**（`opencode-go/deepseek-v4.1-flash` → DeepSeek、`claude/claude-haiku-5-5` → Anthropic），模型名认不出时才退回上游段（`opencode-go/private-model` → OpenCode），两段都认不出仍只显示 Magpie。
- 主图与直连 route 完全不变：`opencode-go/deepseek-v4.1-flash` 直连仍是 OpenCode 主图 + DeepSeek 小图。
- 对应 openspec change `sidebar-provider-icon-gateway-model-brand`；回滚：`dsh.yaml` 版本改回 0.1.9 → `dsh build` → 重启。

## 0.1.11 — 2026-10-25

### Real-GUI feedback revision

网关会话的 `<上游provider>/<model>` 其实有**三层**身份，此前只表达了两层。

- 实机：`dsh-magpie-connect / opencode-go/deepseek-v4.1-flash` 显示「Magpie + DeepSeek」，中转平台 OpenCode 被完全丢弃，看不出这一轮是经 OpenCode 中转还是直连 DeepSeek。而中转平台是 Magpie 网关的一等配置维度。
- 复合 icon 增加第三个位置：**左下角**（与右下角镜像）显示中转平台，右下角继续显示模型厂商，主图继续显示 provider route。
- 只在「上游段是可识别品牌、且与模型厂商不同」时出现第三层：`claude/*`、`codex/*`（同品牌）、`opencode-go/private-model`（兜底同品牌）、`auto|group|custom`（上游段非品牌）都保持两层，不重复画同一个图标。
- 几何依据（实测官方行 CSS）：badge 位于 x∈[28,42]，官方 StateDot 圆点在 x∈[13,19]；左下角 10px 图标放 `left:-4px` 占 x∈[24,34]，与圆点留 5px、与右下角图标留 2px，badge 占位宽度仍为 14px，行布局不变。
- 直连 route 判定与渲染完全不变。
- 对应 openspec change `sidebar-provider-icon-gateway-transit-tier`；回滚：`dsh.yaml` 版本改回 0.1.10 → `dsh build` → 刷新。

## 0.1.12 — 2026-10-29

- README 按插件标准布局重排：顶部并排展示真实侧边栏与显示规则，随后是新增的 Archify 双语架构图，再是问题说明与特点；补充移除步骤，以及指向 ohmydsh 源码、MIT 许可与 issue 的结尾。
- npm 包补带 `README.zh.md` 与 `CHANGELOG.md`；`screenshots.json` 加入真实侧边栏截图。
- 发布 workflow 现在会为每个版本创建 GitHub Release，并附上与 npm 完全相同的 tarball。运行行为无变化。
