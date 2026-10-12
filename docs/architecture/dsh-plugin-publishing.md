# 自研插件的发布与生态收录 playbook

**本文是 ohmydsh 自研插件通用的发布流程，不属于某一个插件**（`sidebar-session-provider-icon` 只是它的第一个实例），
因此放在 `docs/architecture/` 而不是任何 package 的 `docs/` 里——后者会随镜像仓库一起公开，且只被一个插件继承。

调研时间：2026-10-10。事实来源：`awesome-dsh-plugin/awesome-dsh-plugin@main` 的
[`contributing.md`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)、
`scripts/check-submission.mjs`、`scripts/lib/entries.mjs`、`scripts/probe-npm.mjs`、`scripts/build-site.mjs`，
以及 GitHub / npm API 实测。商店网站 <https://awesome-dsh-plugin.com/zh/>。

结论先行：**上架只需要一个 YAML 文件 + 一个 PR，今天就能提**；但插件现在住在 ohmydsh monorepo 的子目录里，
这对「被别人和 AI 搜到」是最不利的一种形态。两个目标的最好解法是分开的：上架走最短路径，可发现性要求独立仓库。

**要直接照做，跳到最后一节「9. 按需照做：六步清单 + 三个坑」；§1–§7 是规则与证据，需要核对时再翻。**

---

## 1. 收录规则（已逐条核对源码，不是抄文档）

商店本身就是 GitHub 仓库 `awesome-dsh-plugin/awesome-dsh-plugin`（18,295 ★，CC0-1.0），网站和 README 都由
`data/plugins/*.yml` 生成。一个条目 = 一个文件，文件名由 URL 推导。

| 规则 | 出处 | 说明 |
|---|---|---|
| 条目字段只有 `url` `name` `category` `description` `tarball` | `lib/entries.mjs` `ENTRY_KEYS` | 多写一个键（例如 `npm:`）CI 直接报错；npm 映射是从 registry 自动采集的 |
| 文件名必须是 `slugFor(url).yml` | `lib/entries.mjs` | `owner__repo.yml`；monorepo 是 `owner__repo--packages-x.yml` |
| `name` 的 `#` 之前必须是 url 里的 `owner/repo` | `lib/entries.mjs` | 防止链接文字指向另一个仓库 |
| `description.en` 必填、单行、以句号结尾；`zh` 可选 | 同上 | 中文留空由维护者补；含 `: ` 必须加引号 |
| `category` 必须取自固定 23 个 key | `CAT_IDS` | 本插件最贴合 `ui`（UI 增强，现有 778 条）；同类先例 `fengb3/dsh-session-icons`、`bf185003/dsh-favicon-status` 都在 `ui` |
| 每个 PR 最多 3 条 | `check-submission.mjs` `MAX_ENTRIES_PER_PR` | 超了 CI 直接拒 |
| 仓库 `package.json` 必须有 `dsh.bundle` | `hasBundle()` | 只看 `dsh.client` 是最常见的被拒原因 |
| 仓库创建满 1 天、公开、未归档 | `MIN_AGE_DAYS = 1` | 没有提交数门槛（2026-09-03 起取消） |
| 描述必须与代码一致、无营销词 | 人工评审 | 夸张是「本来能过」被打回的主因 |
| 与现有条目不重复 | 人工评审 | 「覆盖」比的是**做的事**，不是插在哪个 DOM 位置。`fengb3/dsh-session-icons` 也是插在会话标题左侧，但它为每个标题发一次辅助模型调用**生成**一枚 24×24 单色隐喻图标并写盘缓存（能力扫描 = `llm`+`fs-write`+`fs-read`+`env`+`dynamic-code`）；本插件不调模型、不写盘、不联网，展示的是**真实品牌 SVG** 与「该会话选中的 provider/model」这一身份信息，外加聚合路由下的复合角标。二者不构成覆盖关系，描述按自身事实写即可，不需要提对方 |
| 商店会给条目做**能力扫描**并公示 | `probe-capabilities.mjs` → 注册表 `capabilities` / `capabilityRedLines` | 同类插件实测：`dsh-favicon-status` = `["dynamic-code"]`，`dsh-session-icons` = `["dynamic-code","fs-write","fs-read","env","llm"]`，`DSH-better-sidebar` = `["shell","fs-write","fs-read","network","env","host-runtime"]`。本插件无网络、无文件写入、无 shell，应只落 `dynamic-code`，这是 README 里值得明说的信任优势 |

CI 顺序：条目数 → `dsh.bundle` → 仓库年龄 → `awesome-lint` + 站点构建。绿 CI 只是前置条件，合并前维护者会读源码。

**本插件现状核对（实测）**

| 项 | 现状 | 判定 |
|---|---|---|
| `dsh.bundle` | `package.json` → `dsh.bundle.patch = ./cordis.patch.yml`，文件存在 | ✅ 已用商店 `hasBundle()` 的同一路径实测通过 |
| 仓库公开且 ≥1 天 | `prgrmrwy/ohmydsh` public，创建于 2026-08-18 | ✅ |
| 真实代码 | `src/` + 5 个测试文件 + 22 个品牌 SVG，MIT | ✅ |
| 仓库 `dsh-plugin` topic | ohmydsh topics 为空 | ❌ 要加 |
| npm 包 | `npm view dsh-sidebar-session-provider-icon` → 404，这个名字还空着 | ❌ 建议发布 |
| `repository` 字段 | `package.json` 里没有 | ❌ npm↔仓库关联必需 |
| `screenshots.json` | 没有 | ⚠️ 可选；不加则市场从 README 抽图 |

---

## 2. 两条路线，先选一条

### 路线 A（推荐）：独立仓库 `prgrmrwy/dsh-sidebar-session-provider-icon`

商店条目指向独立仓库。这是唯一能让「仓库」这个实体等于「产品」的形态：

- GitHub 仓库检索的匹配对象**有文档可查**：`in:name` `in:description` `in:readme` `in:topics`。实测
  `gh search repos "dsh sidebar"` 前 5 名都是仓库名或 description 命中查询词（`dsh-sidebar-qa`、`dsh-sidebar-size`、
  `dsh-sidebar-browser` …）；monorepo 子目录的路径不在这些字段里，只有代码搜索能命中。
  （注意：GitHub 从未公布 best-match 的打分权重，「star 决定排名」是未经验证的说法。）
- 商店条目和 dsh-market 详情页显示仓库 star 数。monorepo 条目显示的是父仓库的 star（站点上
  `zhu1090093659/dsh-web` 的每个子包条目都重复显示 8568），ohmydsh 现在 1 ★。
- npm 包的 `repository` 指回独立仓库 = npm / GitHub / 商店三处同一个身份，AI 检索时是同一个可引用实体。
- Releases、social preview、watch/star、Canonical 详情页 URL（`/p/prgrmrwy/dsh-sidebar-session-provider-icon/`）才有地方挂。
- **硬证据**：GitHub 的 <https://github.com/robots.txt> 对 GPTBot、OAI-SearchBot、ClaudeBot、anthropic-ai、
  PerplexityBot 明确写了 `Disallow: /*/tree/`。monorepo 条目的 URL 正是 `.../ohmydsh/tree/main/packages/...`，
  也就是**商店详情页给出的那个规范链接对主流 AI 爬虫是禁止抓取的**；独立仓库的落地页
  `github.com/prgrmrwy/dsh-sidebar-session-provider-icon` 不在任何 Disallow 规则里，可以直接被抓。

代价：要把子目录拆成独立仓库（`git subtree split` 保留历史），README 的安装段要重写成陌生人的视角，
并且新仓库要等满 1 天才满足 CI 年龄门槛。

### 路线 B（今天就能提，零迁移）：monorepo 子目录条目

```
url: https://github.com/prgrmrwy/ohmydsh/tree/main/packages/sidebar-session-provider-icon
name: prgrmrwy/ohmydsh#sidebar-session-provider-icon
```

CI 已实测三项都过（子路径 package.json 有 `dsh.bundle`、仓库 2026-08-18 创建、文件在 `origin/main` 上）。
npm 关联同样成立：`probe-npm.mjs` 只要求包 `repository` 字段里 `includes("prgrmrwy/ohmydsh")`，与是否子路径无关。
代价：可发现性弱（如上），而且要在 ohmydsh 上打 `dsh-plugin` topic——那个仓库的身份是「个人 DSH 集成配置」，
topic 语义并不贴。

**建议**：如果目标是「让不认识你的人搜到」，走 A；如果只是想要一个商店条目做收录证明，走 B 再择机迁到 A
（迁移时第二个 PR 要同时删掉旧条目，否则触发重复条目评审）。

---

## 3. 路线 B 的完整提交步骤

```sh
# 1) fork（一次性）
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone=false

# 2) 浅克隆自己的 fork，开分支
git clone --depth 1 git@github.com:prgrmrwy/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git checkout -b add/sidebar-session-provider-icon

# 3) 唯一的改动：一个文件
mkdir -p data/plugins
cat > data/plugins/prgrmrwy__ohmydsh--packages-sidebar-session-provider-icon.yml <<'YAML'
url: https://github.com/prgrmrwy/ohmydsh/tree/main/packages/sidebar-session-provider-icon
name: prgrmrwy/ohmydsh#sidebar-session-provider-icon
category: ui
description:
  en: 'Show the brand logo of the model selected for each sidebar session, updated live from the composer model selector with a last-request fallback for history sessions; aggregator routes render the provider logo with a 10px model logo in the corner.'
  zh: '侧边栏每个会话标题前显示当前所选模型的品牌 logo：跟随输入框选择器即时更新，历史会话回退到最近一次请求；聚合路由（如 opencode-go、traex）显示 provider 主图并叠加 10px 模型小图标。'
YAML

# 4) 预览生成结果（可选，提交也行，但必须与数据源一致）
npm ci && node scripts/generate-readme.mjs

git add -A
git commit -m "Add prgrmrwy/ohmydsh#sidebar-session-provider-icon"
git push -u origin add/sidebar-session-provider-icon
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "Add sidebar-session-provider-icon (prgrmrwy/ohmydsh)" \
  --body "Adds one entry. The plugin draws the selected model's brand logo before each sidebar session title; the source and its behavior spec live in packages/sidebar-session-provider-icon."
```

同时给 `prgrmrwy/ohmydsh` 加 topic：

```sh
gh api -X PUT repos/prgrmrwy/ohmydsh/topics --input - <<'JSON'
{"names":["dsh-plugin","deepseek-harness","dsh"]}
JSON
```

（或网页 Settings → Topics。）

描述里的每个声明都要能被源码验证：主体 logo 来自 `src/client/logos.ts` 的 provider 解析，角标来自 model 解析，
10px 是 `badgeInnerHTML` 的角标尺寸，输入框即时更新来自 `src/client/selection-binding.ts`，
历史回退来自 `src/provider.ts` 的 `request/header` projection。

---

## 4. 路线 A 的完整步骤

**已实测**：把 `packages/sidebar-session-provider-icon/` 整份复制到独立目录后，`npm install`（146 包）→
`npm run typecheck` → `npm test`（39/39 通过）→ `npm run build`（`lib/` 产物齐全）全绿。
包的 tsconfig / tsdown / vitest 配置都是自包含的（不 extends 仓库根配置），测试不依赖 DOM（无 jsdom），
所以拆仓库**不需要改构建配置**，只需要补元数据。

```sh
# 1) 从 monorepo 拆出子目录（保留每个文件的提交历史）
cd <ohmydsh main checkout>
git subtree split -P packages/sidebar-session-provider-icon -b plugin-standalone

# 2) 建公开仓库并推上去
gh repo create prgrmrwy/dsh-sidebar-session-provider-icon --public \
  --description "DeepSeek Harness plugin: show the selected model's brand logo before each sidebar session title"
git push git@github.com:prgrmrwy/dsh-sidebar-session-provider-icon.git plugin-standalone:main

# 3) 一次性补元数据（见第 5 节），然后本地验收
npm install && npm run typecheck && npm test && npm run build

# 4) npm 首发（需要已登录；当前 npm whoami = ENEEDAUTH）
npm login
npm publish        # prepack 会跑 build

# 5) 建仓库后满 24 小时才能提 PR（CI 会读 created_at）
```

ohmydsh 侧改为消费远端包（`dsh.yaml` 里 `source: remote` + 精确版本 pin + integrity），或暂时继续保留
`packages/` 下的本地副本并定期同步——前者符合仓库「第三方能力精确 pin、不 vendor」的约定，但属于一次架构调整，
应单独走 OpenSpec change。

---

## 5. 首次公开前要补的元数据（两条路线都要）

`package.json`（现在缺 4 项）：

```jsonc
{
  "description": "Show each sidebar session's currently selected model brand logo in DeepSeek Harness, updated live from the composer selector with a last-request fallback",
  "repository": { "type": "git", "url": "git+https://github.com/prgrmrwy/dsh-sidebar-session-provider-icon.git" },
  "homepage": "https://awesome-dsh-plugin.com/p/prgrmrwy/dsh-sidebar-session-provider-icon/",
  "bugs": { "url": "https://github.com/prgrmrwy/dsh-sidebar-session-provider-icon/issues" },
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "plugin", "sidebar", "session", "model", "provider", "icon", "logo"],
  "files": ["lib", "cordis.patch.yml", "README.md", "LICENSE", "docs"]
}
```

- `repository` 是硬要求：`probe-npm.mjs` 靠它把 npm 包挂回商店条目，否则市场显示不出下载量。
- `files` 里加 `docs` 让 npm 上的 README 能显示 `docs/screenshot.png`（这两张图 330 KB，可接受）。
- `keywords` 只影响 npm 搜索结果页，不影响 GitHub 搜索；不要指望它带来多少流量，但也别空着。

`screenshots.json`（放插件目录 / 独立仓库根，1–8 张相对路径，市场详情页会当 App Store 截图用）：

```json
["docs/screenshot.png", "docs/overview.png"]
```

---

## 6. README 首屏（当前对陌生人不可用）

现在的安装段写的是「Managed through `dsh.yaml`（entry `sidebar-session-provider-icon`, `source: local`）……
run `dsh build`」——这是 ohmydsh 内部视角，外人看不懂也无法执行。首屏应改成：

1. 一行是什么（与 package.json / GitHub About / 商店条目逐字一致的同一句话）；
2. 截图（已有 `docs/screenshot.png`）；
3. 安装命令：`dsh plugin --profile web add dsh-sidebar-session-provider-icon`（发布 npm 后）；
4. 兼容性：DSH `0.2.0-rc.2` 实测；
5. ~~与最近邻的差别~~（已撤回：`fengb3/dsh-session-icons` 与本插件只是 DOM 区位相同，做的事不同——它用辅助模型生成隐喻图标并写盘，本插件展示真实品牌与 provider/model 身份，不构成覆盖关系，描述里不必提对方）；
6. 能力面：无网络请求、无文件读写、无 shell（商店的能力扫描会公示，写清楚能降低安装顾虑）；
7. 然后是现有的行为表、边界与安全段（这两段质量已经很好，是「真实可用代码」评审的加分项）。

`dsh-client-ui-model-selection` 等官方包的 peer 范围现在是 `^0.2.0-rc.2`：按 node-semver 它能接受
`0.2.0-rc.x` 和 `0.2.0`，但**接不住后续的 `0.2.1-rc.1`**。商店 contributing.md 专门警告过这件事。
DSH 出 0.2.1 预发布时，peer 要补显式 `||` 分支（例如 `^0.2.0-rc.2 || >=0.2.1-rc.1 <0.3.0-0`），
否则用户会撞 `ERESOLVE`。现在不用改，但记进升级复核。

---

## 7. 目标二：可发现性清单（按杠杆排序）

**Tier 0 — 身份一致性**（成本最低；注意：这是工程卫生，不是被证实的排名杠杆）
让「同一个名字 + 同一句话」出现在：仓库名、GitHub About 描述、`package.json` name/description、
npm 包页、商店条目 `description.en`、README 第一行、详情页 URL。
理由是机制性的、可验证的：商店的 `catalog.json` 每个插件只有一个 `desc` 字段，措辞不一致就会在外面被改写成
你不认识的样子；而措辞一致时，AI 检索到的是同一个可引用实体。但**没有任何厂商文档或研究证明「逐字重复能提升
AI 引用率」**——所以把它当便宜的卫生习惯，不要当成策略支柱。

**Tier 1 — GitHub 元数据**
- 可用的检索限定符是**有文档的**：`in:name` `in:description` `in:readme` `in:topics`、`topic:`、`stars:`、
  `created:`、`pushed:`。但 GitHub **没有公布** best-match 打分里 star / 新近度 / 阅读量的权重，
  「star 决定排名」属于未经验证的说法。
- topics：`dsh-plugin`（商店要求）`deepseek-harness` `dsh` `sidebar` `model-selector` `web-ui` `plugin`。
  硬约束是每个仓库最多 20 个 topic、每个 topic 最长 50 字符。实测 `topic:dsh-plugin` 有 1.8 万级仓库、
  `topic:deepseek-harness` 1.4 万级——topic 的作用是**进入可浏览的索引**（以及被 topic 爬虫类工具抓到），
  不是排名加成。
- About 面板：description 用那句一字不差的话，Website 填商店详情页 URL。
- Social preview 图（Settings → Social preview）：官方要求 PNG/JPG/GIF、**<1 MB、≥640×320、推荐 1280×640**；
  影响的是被分享到 HN/Reddit/X/Discord 时的展开效果，不是排名。
- Releases：每个版本打 tag + 发 Release notes。商店要求「活跃维护」，定期扫描会清掉长期停更的条目；
  另外仓库一旦 force-push 或删除历史，商店条目指向的 commit 也就断了。
- 注意：已有基于 topic 的第三方发现工具在跑（例如 npm 上的 `dsh-find-plugin`），不打 topic 就等于不进索引。

**Tier 2 — README 结构**
首屏五要素（见第 6 节）。再补一段 Compatibility 和 3–5 条 FAQ（把「会不会动官方 UI」「会不会联网」
「卸载后残留什么」写清楚）——这些问题正是别人会去问 AI 的形态，答案在 README 里，AI 才有东西可引。

**Tier 3 — 分发面**（决定「有没有人真的看到」）
- **npm 发布是最高杠杆的一件事**：商店默认排序就是「下载量」，dsh-market 详情页也显示下载量；
  没有 npm 包 = 没有下载数字 = 默认排在 4481 个条目末尾。同时预构建安装免掉 `allowBuilds` 构建授权。
  预期量级要现实：同类单功能侧边栏插件在商店里是 **0–17 ★ / 700–1,600 次/月下载**，不是四位数之后的数字。
  另外 npm 自己的文档写明：搜索基于 title/description/**readme**/keywords 做关键词匹配，
  且**新发布的包最多要两周才出现在 npm 搜索结果里**——所以首发要趁早，别指望当天见效。
- 商店收录本身会同时进入 dsh-market（站内市场，站点上显示 5992 ★ / 542,536 下载）和 `plugins.json` /
  `catalog.json` 公共注册表，第三方 storefront（含 dshmarket.com 详情页、giscus 评论线程）直接消费它。
  所以「上架 awesome-dsh-plugin」是一鱼多吃，也是唯一必须做的那一件。
- 另外 8 个 DSH 精选列表（都存在、都有 `dsh-plugin` topic，收录格式各不相同，提之前先读各自的 CONTRIBUTING）：
  `0xsline/awesome-deepseek-harness`（1159★）、`Zhiyuan-Fan/Awesome-DeepSeek-Harness-Plugins`（573★）、
  `bruc3van/awesome-dsh-plugin`（401★）、`libukai/awesome-deepseek-harness`（287★）、
  `imsai-sh/awesome-deepseek-harness-plugins`（274★）、`beancookie/awesome-dsh-plugin`（163★）、
  `Alex-Yanggg/awesome-DSH-plugin`（101★）、`kejixiaoliang/awesome-dsh-plugins`（49★）。
- **`dsh-plugin` topic 才是总钥匙，而且它是官方第一方入口**：DeepSeek 官方站点/README 里的「社区插件 / Community plugins」
  链接指向的就是 <https://github.com/topics/dsh-plugin>（18,584 个仓库，topic 页自述 18,874）。
  一个 topic 动作会同时喂给下列自动爬取的索引（均已实测确认爬取方式）：

  | 站点 | 规模 | 收录方式 | 需要你做什么 |
  |---|---|---|---|
  | `dshplugin.store` | 16,385 | 自动爬 topic，**没有提交入口**（/submit /about /faq /contact 全 404） | 打 topic |
  | `dsh-plugin.app` | 11,630 | 自动爬 topic（页面载荷里 `sourceUrl` 就是 topic 页） | 打 topic |
  | `bradeGithub/DSH-Plugins-Marketplace`（GUI 内市场） | ★173，9,500+ 插件 | 每 2 小时爬 topic，「无需申请或提 issue」 | 打 topic |
  | `LivXue/dsh-plugin-shop`（GUI 内市场） | ★1,007 | topic **或** npm keyword `dsh-plugin` / `deepseek-harness` | 打 topic 或发 npm（keyword 必须对） |
  | `plugin.dshx.dev`（中文社区） | 5,178 | 自动爬，但有「可加载证据」门槛：`package.json` 的 `dsh.bundle`/`dsh.plugin`/`dsh.profile`，或 README 里有可执行的 `dsh plugin` 命令，或 monorepo 子包 | 本插件已满足（有 `dsh.bundle`） |
  | `dsh.so` | 16,962 | topic 自动索引（`dsh-plugin` 或 `dsh-pack`）**且**有自助提交表单 | 打 topic；想上 L1–L5 验证梯子再提交表单 |
  | `dshget.com` | 6,018 | 纯镜像（合并 awesome-dsh-plugin + 两个 catalog + topic） | 不用做 |

- **但 `dsh-market`（GUI 内市场，最大触达面 ★6,066）不爬 topic**：它直接读 awesome-dsh-plugin 的注册表。
  所以「提一个 YAML 的 PR」不可省略，它是唯一能进站内市场的路径。
- 另外两个可选手工入口：`dshplugin.app/submit`（**没有连字符，是另一个站**，3,055 个插件，网页表单）、
  `dsh.directory` 的 [plugin-submission issue 表单](https://github.com/alexchenzl/dsh-plugin-directory/issues/new?template=plugin-submission.yml)
  （仓库 2026-08-31 后未更新，优先级低）。
- 官方社区面：`deepseek-ai/deepseek-harness` 的 Discussions 有 **「Show Your Plugins!」** 分类（9,214 条讨论）、
  官方 Discord（3.1 万成员）、官方微信公众号与企微群。这些是「被人看到」而非「被索引」的渠道。
- Show HN 只在「一条命令能装」之后再发：官方规则要求可以真的试用，纯落地页会被拒。
  中文社区（掘金/知乎/V2EX/HelloGitHub）各自的提交规则未核实，发之前先读规则。

**Tier 4 — 机器可读文件**（按证据强度排序，整体别投入太多）
- **不需要做任何事**：仓库在 GitHub 上，`github.com/robots.txt` 已经放行 `OAI-SearchBot`、`GPTBot`、`ClaudeBot`、
  `anthropic-ai`、`PerplexityBot`。需要区分：OpenAI 的 `OAI-SearchBot` 负责「被检索/被引用」，
  `GPTBot` 负责训练——想出现在 ChatGPT 搜索答案里，靠的是前者，而它默认就允许。只有当你自建文档站时，
  才需要在**自己的** robots.txt 里显式放行这些 UA。
- **只在自己有文档站时才有意义**：sitemap.xml、OpenGraph、JSON-LD（`SoftwareApplication` /
  `SoftwareSourceCode`）。商店详情页本身已经带 canonical + hreflang(en/zh/x-default) + sitemap 且每日重建；
  README 里塞 JSON-LD 没有任何用（GitHub 不执行 script）。JSON-LD 被 AI 引擎消费**没有找到任何证据**。
- **证据不足、别当策略**：`llms.txt` 是有真实规范的（v2，2026-08-10 修订，Chrome Lighthouse 会检查它），
  但消费端未经验证——Google 已公开表示不支持且不打算支持。GitHub 仓库也不可能在根路径提供 `/llms.txt`。
  真要做，只在自建文档站上做。
- **不需要操心**：GitHub 的 `robots.txt` 不由你控制；README 的 Markdown 对爬虫就是最优格式。

**Tier 5 — 度量**（没有度量就没法判断哪一招有效）
```sh
gh api repos/prgrmrwy/<repo>/traffic/views            # 14 天窗口，referrer 里不含搜索引擎和 GitHub 自身
gh api repos/prgrmrwy/<repo>/traffic/popular/referrers
curl -s https://api.npmjs.org/downloads/point/last-month/dsh-sidebar-session-provider-icon
curl -s https://awesome-dsh-plugin.com/catalog.json | grep -c prgrmrwy     # 0 = 还没收录
gh search repos --topic dsh-plugin --limit 100 --json fullName,stargazersCount
```
再加一条人工检查：直接问 Perplexity / ChatGPT / Claude「DSH 侧边栏显示当前模型图标的插件」看是否被提到。
目前没有免费的官方 AI 引用查询接口，各类 AI 可见度打分工具的分数都不可当证据。

**反模式**：关键词堆砌、买 star、AI 批量生成的 README、给仓库打满不相关 topic。买 star 不只是无效——
GitHub 可接受使用政策 §4 明确把「rank abuse, such as automated starring or following」列为禁止行为；
而 AI 生成的通用描述会直接撞上商店评审那条「描述必须与代码一致」。

---

## 8. 立即可以做的四件事

1. **加 `dsh-plugin` topic**（1 分钟，无副作用）：一次动作同时喂给 dshplugin.store / dsh-plugin.app 的 topic 同步，
   并成为 dsh.so / 商店的准入信号。
2. **到 <https://www.dsh.so/submit/> 粘贴仓库 URL**（2 分钟，自助）。
3. **`npm login` 后发布 `dsh-sidebar-session-provider-icon`**（名字还空着；需要先补 `repository` 字段；
   注意 npm 搜索索引最多要两周才收录新包）。
4. **决定路线 A / B，然后提商店 PR**（B 今天就能提；A 需要先建仓库、补元数据，并等满 1 天）。

---

## 9. 按需照做：六步清单 + 三个坑

**新 session（或未来的我）不需要任何历史上下文，直接照这一节做即可；§1–§7 是依据与证据，要核对时才翻。**

1. **本地准备**（合成一个 commit）：`package.json` 补 `repository`/`homepage`/`bugs`/`keywords`/`files`，
   `repository` 指向将要建的公开仓库；vendor 了第三方图标或代码就加 `THIRD-PARTY-NOTICES.md`
   （MIT 要求随附版权行 + 许可全文）并加进 `files`；加 `screenshots.json`；README 双语自包含
   （不留 `../../` 相对链接，安装命令要让陌生人能照着执行）。
2. **建公开仓库 + 推镜像**：`git subtree push --prefix=packages/<插件目录> git@github.com:prgrmrwy/<仓库名>.git main`。
   ohmydsh 仍是唯一真源，`dsh.yaml` 不动。
3. **仓库元数据**：topics 必带 `dsh-plugin`（§7 的索引总钥匙）；About 描述 = 与 `package.json`
   description 逐字一致的那一句话。
4. **上架商店**：仓库创建满 1 天后，一个 PR 只加 `data/plugins/<owner>__<repo>.yml`（规则见 §1、命令见 §3），
   每个 PR ≤3 条。
5. **npm**：确认包名空闲 → `npm publish`；发布后商店夜间 probe 自动关联下载量，**不需要补 PR**。
6. **其它索引**：dsh.so 自助表单 <https://www.dsh.so/submit/>（服务端 GitHub API 会限流，重试即可）；
   其余站点都爬 topic，不用提交。

三个必须避开的坑：

- **`prepare` 与 `prepack` 缺一不可。** npm/pnpm 安装 **git 依赖**时执行的是 `prepare`，而 `prepack`
  只在 `npm pack` / `npm publish` 时运行。只写 `prepack` 的包，从 GitHub 安装后没有构建产物，
  而 `main` 指向 `./lib/index.js` → 插件直接加载失败（dsh.so 的源码安装验证也会走这条路）。
  两个都写 `npm run build` 即可。依据：pnpm 10.26 release notes、npm-install 文档。
- **镜像只能推已提交内容。** `git subtree push` 走的是 commit，工作区改动不会过去；ohmydsh 侧若做过
  rebase/amend，镜像需要一次性 `--force-with-lease`，之后恢复为普通 fast-forward。
- **提 PR 前先本地预校验。** 用上游 `scripts/lib/entries.mjs` 的 `validateEntries()` 跑一遍
  （文件名 slug、name 与 url 一致、category 白名单、description 单行且含 `: ` 要加引号），比等 CI 快；
  描述必须能被源码逐句证实。

monorepo 子包要各自上架时：topic 爬虫只认仓库级，子包必须手动提 PR
（`url …/tree/main/packages/<id>`、`name owner/repo#<id>`、文件名 `owner__repo--packages-<id>.yml`），
商店会为它生成 `dsh plugin --profile web add github:owner/repo#path:/packages/<id>` 这样的安装命令。

---

## 10. 发布之后：推广位与度量

**什么样的仓库才值得投。** 不要按 star 数找仓库铺链接。实测（2026-10-12 抽样头部插件
`V1ki/dsh-plugin-subscriptions`、`omdsh-dev/DSH-better-sidebar`、`MichengAI/dsh-codex-ui`、
`zhu1090093659/dsh-pet`、`dsh-market/dsh-market`）：**几乎全都 `has_discussions = false`**，
但其中多数 README 里有维护者自建的 `## Related plugins` / `## 相关插件` 区块。所以真实的位是
**"该仓库明确留出的生态位"**，不是"有讨论区的高星仓库"。

按回报/风险排序的投放顺序：

1. **相邻插件的 `Related plugins` 区块** —— 只投"互补"关系（例如多 provider 插件 ↔ 侧边栏模型标识），
   每家最多提一次 PR，格式照抄该仓库既有条目（链接 + 一句相对本插件做什么 + 安装命令）。
2. **商店条目** —— 复利渠道：站点、dsh-market、第三方 storefront 读同一份注册表，用户在那里浏览。
3. **官方 Discussions 的 Show Your Plugins** —— 每个插件发一次，别重复。
4. **中文社区一篇**（掘金/知乎/V2EX 任选一处，不同文同发）。

**明确不做**：在别人的 issue tracker 里发推广；同一文案跨仓库复制（GitHub 可接受使用政策 §4
"excessive or repeated promotion"）；请求维护者为你改仓库设置（例如开 Discussions）。

**时机**：Related PR 要等 npm 发布成功后再提——否则条目里那句
`dsh plugin --profile web add <name>` 是 404，比不提更伤。

**度量（一周后）**：

```sh
gh api repos/prgrmrwy/<repo>/traffic/views                  # 14 天窗口
gh api repos/prgrmrwy/<repo>/traffic/popular/referrers      # 看哪个渠道真的带量
curl -s https://api.npmjs.org/downloads/point/last-month/<pkg>
```
平台侧另有现成指标：商店条目的 downloads / stars、dsh.so 的 L1–L5 验证级别。再人工问一次
AI 助手（"DSH 侧边栏显示当前模型图标的插件"）看是否被提及——目前没有免费的官方 AI 引用查询接口。
