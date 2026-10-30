---
name: publish-dsh-plugin
description: 在 ohmydsh 维护的自研 DSH 插件发布与商店上架：整理 README、配置自动镜像/tag、npm OIDC 与 GitHub Release、验证分发并提交商店条目；也用于日常发版或只读检查发布状态。
whenToUse: 用户要求发布/上架自研 DSH 插件、完善其发布资料或流程、发布新版本，或核对镜像/tag/npm/Release/商店状态时使用；安装或移除第三方插件使用 add-dsh-plugin/remove-dsh-plugin。
---

# 自研插件发布与商店上架（publish-dsh-plugin）

本文件同时是执行指引与完整 SOP，是发布规则的唯一维护入口；不要另建一份平行 SOP、发布脚本或状态机。

## 执行原则

- 先明确目标插件与本次范围，检查已有状态，从缺失环节继续；只读检查请求不执行发布操作，日常发版不重复建仓或提首次上架 PR。
- ohmydsh 仓库以当前工作目录或用户明确给出的 checkout 为准，不硬编码本机路径。skill 可能部署在用户目录：以下文件路径均相对 ohmydsh 仓库根；参考链接指向公开源码，不能把 skill 安装目录当成仓库根。
- 有本地 checkout 时以其最新源码、规范和 workflow 为准。先做已授权的准备与验证，再执行该请求范围内的推送、发布和商店提交；需要用户完成网页认证时说明具体阻塞，不反复索取已有授权。
- 执行结束逐项报告镜像、tag、npm、GitHub Release/附件、商店 PR 的实际状态与链接；未执行或失败的步骤直接说明。不得仅凭 Action 成功声称已完成全部上架。

适用于在 ohmydsh `packages/<目录>` 持续开发、以独立 GitHub 仓库分发的自研 DSH 插件。**ohmydsh 是源码真相源，独立仓库是发布镜像；默认必须同时配置 npm 自动发布和 GitHub Release 自动发布。** 只有 tag、只有 npm 或只有 Release，均不算发布链路配置完成。

本 SOP 于 2026-10-28 整理，以 AUTO 已跑通的链路为基准。商店外部规则会变化，提交前应重新读取上游 contributing 与校验脚本；本文件不把早期插件数量、排名或搜索收录时间当作保证。

## 1. 完成标准与参考实现

首次交付需要同时满足：

- 主仓源码与独立镜像对应的文件树一致，插件可脱离 ohmydsh 独立构建、测试和安装。
- 推 ohmydsh main 能自动同步镜像；新包版本自动打 tag 并启动镜像 release workflow。
- npm 的目标版本可查询、可安装；OIDC 发布有 provenance。
- GitHub Release 有同一版本的 tag、CHANGELOG 说明与预构建 `.tgz`，附件直接取自已发布 npm 产物。
- 双语 README、演示素材、仓库元数据与商店描述准确；商店条目按当前规则提交并记录 PR 状态。

参考实现：

| 环节 | 真相源 |
| --- | --- |
| 主仓同步与自动打 tag | [mirror-release.yml](https://github.com/prgrmrwy/ohmydsh/blob/main/.github/workflows/mirror-release.yml) |
| npm + GitHub Release 全流程模板 | [AUTO release.yml](https://github.com/prgrmrwy/ohmydsh/blob/main/packages/auto-model-routing/.github/workflows/release.yml) |
| 包元数据与构建入口 | [AUTO package.json](https://github.com/prgrmrwy/ohmydsh/blob/main/packages/auto-model-routing/package.json) |
| 双语首屏与并排演示 | [AUTO README](https://github.com/prgrmrwy/ohmydsh/blob/main/packages/auto-model-routing/README.md) |
| 本仓文档规则 | [文档治理测试](https://github.com/prgrmrwy/ohmydsh/blob/main/tests/repo-docs-governance.test.mjs) |

复制 AUTO workflow 时必须替换包名等专属内容，不把 AUTO 的名称、描述或测试假定原样带入新插件。

## 2. 开始前：确认身份、规范与当前状态

1. 拉取最新 ohmydsh main，检查工作区与远端差异，保留他人未提交改动。
2. 阅读 `dsh.yaml`、对应 current specs 和进行中的 change，确认行为、兼容性、安装与移除边界。
3. 分清本地目录/manifest id、npm 包名、独立仓库名。它们可以不同，例如 `auto-model-routing` 对应 `dsh-auto-model-routing`；配置时不可凭目录名猜包名。
4. 分别查询镜像 main、Git tags、GitHub Releases 和 npm。不要把任一处的版本当成其它三处也已完成的证据。
5. 已接入自动镜像的插件不再用手工 rsync 覆盖独立仓库，也不在镜像直接开发。

发布和本机部署相互独立。本 SOP 不隐含日常 GUI 的 build 或 Host 重启；生产部署仍按主仓部署约定另行执行。

## 3. 本地包准备

### 元数据与自包含

- `package.json` 提供明确的 name、version、description、license、author、repository、homepage、bugs、keywords、engines、DSH bundle/client 声明。
- `repository.url` 指向独立镜像；**包在镜像根目录时不要填写 monorepo 的 `repository.directory`**，否则 npm 会把 README 相对图片链接拼到不存在的子目录。
- `files` 包含运行产物、bundle patch、必要的包内 skill、双语 README、CHANGELOG、演示资源、screenshots 清单和许可证；排除临时录制帧、原始会话与可重建中间产物。
- 声明真实 dependencies/peerDependencies，构建与运行不得依赖包外源码、主仓 node_modules 的固定相对位置或个人绝对路径。主仓规范链接可作为可选背景，不能成为运行依赖。
- 同时配置 `prepare` 与 `prepack`：前者保障 Git 源码安装构建，后者保障 pack/publish 产物。需要时构建前清理旧输出，避免已删除模块残留进 npm 包。
- vendor 图标或代码时随包附必要的版权、许可与 THIRD-PARTY-NOTICES。

### README：默认结构与展示顺序

中英文 README 使用相同结构并互链，按本仓 docTier 保留 problem/removal 等标记。标题和语言切换之后，正文按以下顺序组织；不要让徽章墙、仓库链接或长介绍挤到演示之前。

1. **第一行并排演示操作面与设置面。** 左侧是用户实际操作与结果，右侧是设置页（如有），默认用两个 `width="49%"` 的 `<img>`，尽量在一行展示。窄屏允许换行；没有设置页就只放操作面，不为凑双图虚构设置，也不拿架构图代替右侧设置演示。**演示图的语言必须与 README 语言一致**：英文 README 用英文界面图，中文 README 用中文界面图，因此默认需要两套演示资源（如 `docs/overview.en.png` 与 `docs/overview.png`），各语言的图注只描述自己那一版；不要让英文 README 展示中文界面（反之亦然）。
2. **紧接一行小字图注。** 简单说明“左：……；右：……”。若为隔离宿主、mock 服务或合成数据，在同一图注简短注明；详细录制来源放截图登记，不把长技术说明塞进首屏。
3. **放 Archify 架构图。** 演示和图注之后、文字介绍之前，展示插件在 DSH 中的位置、主要组件和数据/请求流。基于当前实现制作，默认嵌入 Archify 导出的清晰 SVG，并保留可复现的 JSON 源；英文/中文 README 各用对应语言的图。生成或更新时使用 Archify skill 并完成其验证与导出检查，不用手写 Mermaid 冒充 Archify 产物，也不把大体积临时 HTML/录制帧纳入包。架构图不替代本仓要求的实际界面截图。
4. **一句话介绍解决的问题，再突出特点。** 先用用户能理解的一句话说明“为谁解决什么问题”，放在 `<!-- problem -->` 段；随后用短列表或功能表说明最有辨识度的能力和适用边界。有同类工具时，只围绕实际差异解释选择理由；对比需有事实依据，不为了营销强行拉竞品、不把 DOM 位置相同当成功能相同。
5. **按常规开源项目安排正文。** 默认依次介绍安装与兼容性、快速上手、功能/使用方式、设置与可选集成、数据与权限边界、开发/测试、移除。简单插件合并章节，复杂插件再展开 FAQ、故障排查和实现细节；避免为了套模板写空章节。安装命令以陌生用户可执行的 `dsh plugin --profile web add <npm包名>` 为主，不只写内部 `dsh.yaml` 操作。参考 AUTO 的功能表与行为边界写法，但展示顺序以本节为准。
6. **结尾交代来源、许可证和参与方式。** 说明插件在 [ohmydsh](https://github.com/prgrmrwy/ohmydsh) 中持续维护、独立仓库作为发布镜像，并链接回主仓；标明实际开源协议并链接随包 LICENSE，必要时附第三方声明；用简短一句欢迎 issue/PR，指向独立仓库的问题与贡献入口。外部用户理解和使用插件不应依赖检出 ohmydsh。

演示与资源要求：

- **演示图一律用 PNG 静态截图，不用 GIF。** DSH 插件商店默认不展示 GIF（2026-10-29 实测），README 首屏与 `screenshots.json` 都只放 PNG。中英文各一张时两张都必须是 PNG，并且 `screenshots.json`、`files`、`SCREENSHOTS.md` 都要列全。每张图选最能代表核心价值的一个状态：操作面停在结果已出现的时刻（如决策已应用、菜单已展开分组），设置面停在关键配置与反馈同屏的位置（如连接测试成功、分组与用量卡片），不放空态、半填表单或滚动中的中间态。用 Playwright/CDP 在 `deviceScaleFactor: 2` 下按区域无损截图；已有 GIF 录制时可无损导出其中代表帧，并在截图登记写明帧号与原录制来源。
- 演示必须对应当前界面；完整包住菜单、输入框或设置弹窗，保持文字清晰，不以旧版 UI 冒充当前行为。优先在隔离实例里把界面语言切到目标语言做真实截图；隔离实例没有模型凭据、拍不到该语言界面时，允许该语言版本使用 docTier 允许名单内的 `illustration`（`SCREENSHOTS.md` 的 `kind=illustration` 与原因短语照旧）替代，但中文版与英文版必须来自同一实现状态，图注里明确说明是合成图。
- README 位图在包内 `docs/SCREENSHOTS.md` 登记，注明 screenshot/illustration、来源、日期、审阅与说明；遵守治理测试的单文件 400 KiB 上限。
- `screenshots.json` 列出包内实际存在的演示图片路径，随包发布。图片、架构图与 JSON 源均纳入正确的发布 files；npm README 的相对链接需与镜像根目录一致，发布后再核对实际页面。
- 上述结构是本仓自研插件的默认文档标准，不是商店上游强制要求；新插件或改版插件逐个调整并核对后才能宣称符合（当前状态见 §11）。

## 4. 创建独立镜像并配置仓库元数据

1. 创建公开、未归档的独立仓库，默认分支为 main。首次从已提交的 `packages/<目录>` 做 subtree split，推送到镜像 main。
2. ohmydsh 继续保留 local package 源码；为了上架，不必把主仓改成消费远端 npm 包。
3. GitHub About 与 package description 表达相同能力，配置 homepage、bugs；topics 至少包含 `dsh-plugin`，其它标签只选相关项。
4. 首次同步后在独立布局运行 install、typecheck、test、build/pack，核验输出和实际安装加载。主仓测试通过不等于独立安装通过。
5. 主仓 subtree 只处理已提交内容。镜像非快进时先检查远端独有提交并带回主仓；不得把强推当成日常同步方式。

GitHub Actions 只执行仓库根目录的 workflow。包内 `.github/workflows/release.yml` 在 ohmydsh 中不作为根 workflow 运行，subtree 到独立仓库后才成为发布入口。

## 5. 一次性配置自动发布（两端都必须完成）

### ohmydsh：同步与打 tag

在根 [mirror-release.yml](https://github.com/prgrmrwy/ohmydsh/blob/main/.github/workflows/mirror-release.yml) 中：

- 增加包目录的 push paths 条件和 matrix 项，填写 dir、repo、secret。
- 每个镜像使用独立的 write deploy key；公钥登记到目标镜像，私钥保存为 ohmydsh Actions secret。不得提交私钥或复用宽权限 npm token。
- checkout 完整历史，执行 subtree split，并以普通快进推送镜像 main。
- 读取 split 后包版本；镜像缺少 `v<version>` 时才创建并推送该 tag，触发镜像 release。

当前实现中，任一受管目录触发 workflow 后，会检查 matrix 中全部镜像。同步和发版流程与主仓通用 CI 并行，**不等待主仓 CI 成功**；发布安全检查还必须在镜像 workflow 中执行。

### 独立镜像：npm Trusted Publishing

包内 release workflow 至少具备：

- `push.tags: ['v*']` 与 `workflow_dispatch`。
- `permissions: id-token: write`，使用支持 Trusted Publishing 的 Node/npm。当前模板使用 Node 24、npm `^11.15.0`。
- tag 与包版本相等的校验、依赖安装、必要 typecheck/test；无独立 lockfile 时使用 `npm install`，不要误用 `npm ci`。
- npm 上已有该版本时跳过重复 publish；尚未发布则构建并公开发布。registry 查询失败应报错，不要当作“版本不存在”。

npm 包页面一次性绑定 Trusted Publisher：owner/repository 为独立镜像、workflow filename 为纯文件名 `release.yml`、environment 与 workflow 实际配置一致（无 environment 时留空）。按网页当前要求完成所有确认，并检查允许 `npm publish`，不要停在未保存的表单。

新包可能需要先由用户完成首发/包身份创建，再绑定 OIDC，具体按 npm 当前页面要求。遇到 EOTP/网页授权应向用户交代实际阻塞；不把长期 bypass-2FA token 作为默认方案。凭据不写入仓库、日志或文档。

### 独立镜像：GitHub Release（必配）

在 npm publish/已发布检查之后增加：

1. workflow 声明 `permissions: contents: write`，用内置 `github.token` 操作 Release。
2. `npm pack <包名>@<版本>` 下载 registry 的正式 `.tgz`，不拿另一次本地重建冒充同一分发产物。
3. 从 CHANGELOG 提取该版本的发布说明，缺失说明应失败。
4. 基于已存在的同版 tag 创建公开 GitHub Release；稳定版应核验 `releases/latest` 指向目标版本，预发布版需明确 prerelease，不覆盖稳定 latest。
5. 上传 npm 下载的 `.tgz`。重复运行应能跳过已有 npm 版本与 Release 页面，并补齐附件。

**“Actions 绿 + tag 存在”不能替代 Release 验收。** 前面出现过 AUTO npm/tag 已到 0.5.1、GitHub Release 仍停在 0.4.1；原因就是缺少本步骤。AUTO 现有 workflow 已实际通过全链路。

## 6. 首次发布：先验收分发，再提商店 PR

完成包准备、镜像和两端自动化后：

1. 确定初始版本并更新 CHANGELOG、manifest 与锁文件/版本 fixture，提交后推 ohmydsh main。
2. 确认主仓 Mirror release 成功、镜像 tag 对准预期发布提交、镜像 release workflow 成功。
3. 分别验证 npm、GitHub Release 与附件，完成独立安装加载。首次 OIDC 绑定不可用时按上一节处理并记录，不把尚未完成的发布称为成功。
4. 再按商店当前规则提条目 PR。上游要求仓库年龄时等待满足；不要把“分支已准备”写成“已上架”。

```sh
npm view <包名>@<版本> version dist.tarball dist.attestations.url --json
gh release view v<版本> --repo <owner>/<镜像> --json tagName,url,assets,isDraft,isPrerelease
gh api repos/<owner>/<镜像>/releases/latest --jq .tag_name
```

npm 的搜索结果、包详情页、registry 是不同入口；搜索暂时不可见不能证明发布失败。优先查 registry 精确版本与安装结果，再检查 README 图片是否正常。

## 7. 商店条目与上架验收

目标商店源为 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。提交前读取上游最新 contributing、`scripts/check-submission.mjs` 与 `scripts/lib/entries.mjs`，不要依赖旧会话缓存。

此前核验的规则包括：公开未归档仓库、创建满 1 天、存在可加载的 `dsh.bundle`、仓库 topic `dsh-plugin`、每个 PR 最多 3 个条目、描述与真实代码一致。年龄、字段、分类和条目上限均以上游提交时的实现为准。

独立插件条目为 `data/plugins/<owner>__<repo>.yml`，示例：

```yaml
url: https://github.com/<owner>/<repo>
name: <owner>/<repo>
category: model
description:
  en: 'One factual sentence describing the plugin.'
  zh: '一句描述实际能力的中文说明。'
```

- category 必须在上游允许列表中，不是所有插件都选 model。
- name 与 url 身份一致，文件名按上游 slug 规则生成；字段只用上游支持的项，不自加 npm 字段。
- description.en 单行、以句号结尾；含 YAML 特殊字符时加引号，不写尚未实现的功能或营销结论。
- **已发 npm 的插件不写 `tarball:`。** 商店（`scripts/build-site.mjs` 的 `cardCmd` 与详情页安装命令）在插件映射到 npm 时，首选不带版本的 `dsh plugin --profile web add <npm包名>`，始终是最新版；`tarball:` 只会多出一条备选命令，写成固定版本还会随发版过时。只有不发 npm 的插件才需要它，此时指向已发布的 Release 附件。
- 用上游 `readEntries()` / `validateEntries(entries)` 先本地预校验，再提交自己的 fork 分支和 PR；不手改上游生成的 README/catalog。
- PR 创建、CI 通过、合并、商店实际展示是四个状态，逐项核验和报告。

npm 与仓库的关联依赖正确 repository 元数据；商店采集、索引和下载量展示有自己的刷新周期。GitHub topic、npm 关键词、商店条目各有用途，不承诺实时收录或排名。

## 8. 日常发版与商店维护

**日常只在 ohmydsh 修改、验证、提交并推 main。** 不再手工同步镜像或手工打发布 tag。

| 本次意图 | 主仓操作 | 自动结果 |
| --- | --- | --- |
| 只更新镜像源码/README | 版本不变，提交包目录改动 | 镜像 main 更新；已有 tag 不动，npm/Release 不重发 |
| 发布功能、修复或更新 npm README/截图 | 升包版本，写 CHANGELOG，同步 manifest、锁文件和版本 fixture | 镜像更新 → 新 tag → 检查/构建 → npm → GitHub Release 与附件 |
| 只改主仓 manifest 或根 workflow | 不涉及包目录的 push 可能不触发镜像 | 需要时手动运行 Mirror release；不误判为失败 |

发布后按第 6 节独立核验各分发面。商店安装命令与详情页 README 分别跟随 npm 最新版和仓库，发版后无需改商店条目；当前自动发布 workflow 也**不会改商店条目**。未固定 tarball 的条目按上游采集机制核验，不虚构更新已到达用户端。

## 9. 每次交付的执行清单

- [ ] 拉取最新主仓，核对源码、镜像、tag、npm 与 Release，处理他人新提交。
- [ ] 包自包含、元数据/许可齐全；README 按“操作/设置并排（PNG 代表性截图，无 GIF，中英文各用本语言界面图） → 小字左右图注 → Archify 架构图 → 问题一句话与特点 → 常规使用文档 → ohmydsh/协议/issue/PR”排序，演示与图均对应当前实现，资源与截图登记合规。
- [ ] 主仓 mirror matrix/paths、每仓 deploy key、npm Trusted Publisher 配置齐全。
- [ ] release workflow 同时覆盖 npm 和 GitHub Release，含版本校验、检查、重复运行与附件。
- [ ] 需发布时更新包版本、CHANGELOG、manifest、锁文件及 fixture，完成本地和独立布局验证。
- [ ] 推 main 后两端 Actions 成功，registry 版本存在且可装，Release/tag/说明/附件一致。
- [ ] 首次上架先本地校验条目，再提 PR；记录 CI/合并/商店展示状态。
- [ ] 生产部署与 Host 重启另行处理（商店条目无需随发版更新）。

## 10. 失败补救与禁止事项

| 现象 | 处理 |
| --- | --- |
| 镜像同步非快进 | 比较独有提交并带回主仓，保留远端工作；不自动强推 |
| tag 已创建，测试/npm 发布失败 | 查日志并先确认 npm 版本是否存在。环境临时失败可重跑原 run；代码修复需先同步镜像，再从修复后的 main 手动 dispatch。不要以为新 push 会重发已有 tag |
| 未发布版本的 tag 指错提交 | 只有证明 npm 未发布、没有已分发 Release 且无消费者依赖后，才可专门修复 tag；不作为默认重试流程 |
| npm 成功，Release 缺失 | 补好 workflow，镜像同步后 dispatch 同版本；跳过 npm，创建 Release 与附件，无需为了补发布页而升版 |
| 同版本 tag 与 main 不同 | 重跑前检查差异。不得借补 Release 改写已发布版本的源码或移动其 tag；附件仍下载 npm 既有产物，说明应与发布内容一致 |
| npm 报 EOTP/ENEEDAUTH | 核对包 owner、Trusted Publisher 仓库/文件名/权限/绑定确认；确需用户网页授权时说明真实阻塞 |
| Release 步骤 `npm pack` 404（刚发布） | registry 元数据已有新版但 tarball 端点尚未传播（实测约 3 分钟）。workflow 已对 `npm pack` 重试 20×30s；旧 workflow 失败时等可下载后 dispatch 同版本补 Release，无需升版 |
| npm 图挂了 | 检查 repository.directory、镜像相对路径与资源访问。修正 README/元数据后需新 npm 版本才能更新包页 |
| 本机 pack 测试报 JSON 不可迭代 | 核验 npm 版本与实际输出；npm 11 常见数组、npm 12 可返回包名索引对象，两种都应兼容 |
| 商店仍装旧版 | 先看主安装命令是否为 npm（需 `repository` 指回镜像，商店才会映射 npm）及采集刷新时间；条目里的固定 `tarball:` 只影响备选命令 |

禁止覆盖已发布 npm 版本、移动已发布版本 tag、上传不同重建包冒充 npm 原包，或把临时/原始会话证据放进发布包。通用 CI、发布验收与 DSH 运行兼容是不同证据，不互相替代。

## 11. 当前落地状态与后续基线

截至 2026-10-30，本仓自动镜像已覆盖 AUTO、Magpie、Sidebar、Session ID Copy，四者的 release workflow 都包含 npm OIDC 与 GitHub Release（附 npm 同版 tgz）步骤：

| 插件 | 自动镜像/tag | npm OIDC | GitHub Release + npm 同版附件 | README 结构 |
| --- | --- | --- | --- | --- |
| AUTO | 已配置 | 已配置 | 已配置，0.5.1 起已验 | 已按 §3 |
| Magpie | 已配置 | 已配置 | 已配置，0.3.0 已验（附件与 npm 字节一致） | 已按 §3（npm 页随下一个版本更新） |
| Sidebar | 已配置 | 已配置 | 已配置，0.1.12 起 | 已按 §3（无设置面，右侧为显示规则示意） |
| Session ID Copy (`dsh-session-id-copy`) | 已配置 | 已配置 | 已配置，0.2.0 手动首发补 Release、0.2.1 起经 OIDC 发布并已验（附件与 npm 字节一致） | 已按 §3（无设置面，单图 + Archify） |

演示图：AUTO 0.5.3 与 Magpie 0.3.1 起由 GIF 换为代表性 PNG（取自原录制的代表帧），Sidebar 与 Session ID Copy 一直是 PNG；只有推 main 并核对商店详情页后，才能说商店已展示新图。

演示图语言（2026-10-30 起的要求）：Session ID Copy 已按要求分成两套（`docs/overview.png` 中文真实截图、`docs/overview.en.png` 英文 illustration），Sidebar 也已分成两套（中文 `overview.png`/`screenshot.png` + 英文 `overview.en.png`/`screenshot.en.png`，英文两图是 illustration，源与渲染命令随包）。

**AUTO 与 Magpie 的英文图不能只靠「把 App 语言切到 English 再截一次」。** 2026-10-30 实测：在隔离实例里用 `--lang=en-US` 打开英文界面（General → Language 也是 English），Magpie 设置页仍然整页中文（「连接」「线路 1」「添加备用线路」「刷新模型列表」「默认 effort」「账号/计划/读取于」），因为这两个插件的前端文案是**硬编码中文、没有注册 `ctx.locale` 字典**（与 `system-clock` / `session-title-copy` 的做法不同）。所以顺序必须是：**先给插件 UI 本地化（新增 locale 字典 + `@deepseek-ai/dsh-client-locale` peer 依赖，随一个特性版本发出），再补英文图**。在这之前不要把这两者描述为「已按 §3」；它们的中文图仍可继续服务两个 README，但英文 README 会显示中文控件。2026-10-31 进展：**Magpie 已在 0.5.0 完成 UI 本地化**（`src/client/locales.ts` + `ctx.locale` + 中英字典，421 项测试通过，npm 0.5.0 经 OIDC 发布并回补 GitHub Release），英文 README 的两张英文图尚未补拍；AUTO 仍未本地化。回补 Release 时注意 Magpie 的旧 workflow 只匹配 `## <version>`（不接受日期后缀），已改成与 AUTO/Sidebar 一致的前缀匹配；改 workflow 本身不会重发已发布版本，用 `gh workflow run release --ref main` 在镜像仓回补即可（版本已存在会跳过 publish，只建 Release）。

同一次实测还确认了后续补图可复用的装置：隔离 `DSH_HOME` + 本机 loopback mock 网关（`/v1/models` 分组、`/v1/magpie/quotas/*` 用量卡）+ `MAGPIE_LINE_<8位大写ID>_API_KEY` 环境变量即可跑通完整设置页；浏览器必须用 `~/.agent-browser/browsers/chrome-156.*`（系统 `/usr/bin/chromium` 90 渲染 DSH Web 是空白页，不是代码问题）。

首次发布仍有 bootstrap 限制：npm 不允许给尚不存在的包配置 Trusted Publisher（[npm/cli#8544](https://github.com/npm/cli/issues/8544)），所以**第一个版本必须由维护者本机带 2FA 手动发布**，之后用 `npm trust github <pkg> --file release.yml --repo <owner>/<mirror> --allow-publish`（npm ≥ 11.15）绑定 OIDC。该配置必须在创建后 **2 天内完成首次成功发布**，否则失效；因此绑定后应尽快补一个版本走 OIDC 验证，或者在真正要发版时再绑定。手动首发没有 provenance，绑定后的版本才有 attestations。


更早的版本（Magpie ≤0.2.0、Sidebar ≤0.1.11）没有回补 GitHub Release；需要时按 §10「npm 成功，Release 缺失」处理。后续新插件默认完成全链路；维护现有插件时以实际 workflow 与线上结果更新此表。
