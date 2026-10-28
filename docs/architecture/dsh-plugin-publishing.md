# 自研插件发布与商店上架 SOP

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
| 主仓同步与自动打 tag | [mirror-release.yml](../../.github/workflows/mirror-release.yml) |
| npm + GitHub Release 全流程模板 | [AUTO release.yml](../../packages/auto-model-routing/.github/workflows/release.yml) |
| 包元数据与构建入口 | [AUTO package.json](../../packages/auto-model-routing/package.json) |
| 双语首屏与并排演示 | [AUTO README](../../packages/auto-model-routing/README.md) |
| 本仓文档规则 | [文档治理测试](../../tests/repo-docs-governance.test.mjs) |

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

### README 与演示

- 中英文互链，按本仓 docTier 保留 problem/removal 等标记；说明用途、安装、兼容版本、配置、数据外发、限制和卸载残留。
- 安装命令以陌生用户可执行的 npm 命令为主：`dsh plugin --profile web add <npm包名>`。不要只写内部 `dsh.yaml` 操作。
- **演示放在标题/语言切换之后、介绍之前；有两张 GIF 时默认并排一行**，使用两个 `width="49%"` 的 `<img>`。窄屏可换行；单张素材无需硬凑第二张。
- 演示必须对应当前界面。使用隔离 Host、合成数据和 mock 服务时在图注说明；完整包住菜单、输入框或设置弹窗，保持文字清晰，不以旧版 UI 冒充当前行为。
- README 位图在包内 `docs/SCREENSHOTS.md` 登记，注明 screenshot/illustration、来源、日期、审阅与说明；遵守治理测试的单文件 400 KiB 上限。
- `screenshots.json` 列出包内实际存在的演示图片路径，随包发布。npm README 的相对链接需与镜像根目录一致，发布后再核对实际页面。

## 4. 创建独立镜像并配置仓库元数据

1. 创建公开、未归档的独立仓库，默认分支为 main。首次从已提交的 `packages/<目录>` 做 subtree split，推送到镜像 main。
2. ohmydsh 继续保留 local package 源码；为了上架，不必把主仓改成消费远端 npm 包。
3. GitHub About 与 package description 表达相同能力，配置 homepage、bugs；topics 至少包含 `dsh-plugin`，其它标签只选相关项。
4. 首次同步后在独立布局运行 install、typecheck、test、build/pack，核验输出和实际安装加载。主仓测试通过不等于独立安装通过。
5. 主仓 subtree 只处理已提交内容。镜像非快进时先检查远端独有提交并带回主仓；不得把强推当成日常同步方式。

GitHub Actions 只执行仓库根目录的 workflow。包内 `.github/workflows/release.yml` 在 ohmydsh 中不作为根 workflow 运行，subtree 到独立仓库后才成为发布入口。

## 5. 一次性配置自动发布（两端都必须完成）

### ohmydsh：同步与打 tag

在根 [mirror-release.yml](../../.github/workflows/mirror-release.yml) 中：

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
# 若条目声明固定 tarball，必须对应已发布且可下载的 Release 附件。
tarball: https://github.com/<owner>/<repo>/releases/download/v<版本>/<包名>-<版本>.tgz
description:
  en: 'One factual sentence describing the plugin.'
  zh: '一句描述实际能力的中文说明。'
```

- category 必须在上游允许列表中，不是所有插件都选 model。
- name 与 url 身份一致，文件名按上游 slug 规则生成；字段只用上游支持的项，不自加 npm 字段。
- description.en 单行、以句号结尾；含 YAML 特殊字符时加引号，不写尚未实现的功能或营销结论。
- tarball 是否需要由商店当前安装机制与条目决定；本仓默认提供 Release 安装包，因此填写时直接使用同版附件。
- 用上游 `readEntries()` / `validateEntries(entries)` 先本地预校验，再提交自己的 fork 分支和 PR；不手改上游生成的 README/catalog。
- PR 创建、CI 通过、合并、商店实际展示是四个状态，逐项核验和报告。

npm 与仓库的关联依赖正确 repository 元数据；商店采集、索引和下载量展示有自己的刷新周期。GitHub topic、npm 关键词、商店条目各有用途，不承诺实时收录或排名。

## 8. 日常发版与商店维护

**日常只在 ohmydsh 修改、验证、提交并推 main。** 不再手工同步镜像或手工打发布 tag。

| 本次意图 | 主仓操作 | 自动结果 |
| --- | --- | --- |
| 只更新镜像源码/README | 版本不变，提交包目录改动 | 镜像 main 更新；已有 tag 不动，npm/Release 不重发 |
| 发布功能、修复或更新 npm README/GIF | 升包版本，写 CHANGELOG，同步 manifest、锁文件和版本 fixture | 镜像更新 → 新 tag → 检查/构建 → npm → GitHub Release 与附件 |
| 只改主仓 manifest 或根 workflow | 不涉及包目录的 push 可能不触发镜像 | 需要时手动运行 Mirror release；不误判为失败 |

发布后按第 6 节独立核验各分发面。若商店条目有固定旧版 `tarball:`，需另提更新该 URL 的 PR；当前自动发布 workflow **不会自动改商店条目**。未固定 tarball 的条目按上游采集机制核验，不虚构更新已到达用户端。

## 9. 每次交付的执行清单

- [ ] 拉取最新主仓，核对源码、镜像、tag、npm 与 Release，处理他人新提交。
- [ ] 包自包含、元数据/许可齐全，README 演示对应当前实现且顶部并排，资源与截图登记合规。
- [ ] 主仓 mirror matrix/paths、每仓 deploy key、npm Trusted Publisher 配置齐全。
- [ ] release workflow 同时覆盖 npm 和 GitHub Release，含版本校验、检查、重复运行与附件。
- [ ] 需发布时更新包版本、CHANGELOG、manifest、锁文件及 fixture，完成本地和独立布局验证。
- [ ] 推 main 后两端 Actions 成功，registry 版本存在且可装，Release/tag/说明/附件一致。
- [ ] 首次上架先本地校验条目，再提 PR；记录 CI/合并/商店展示状态。
- [ ] 既有固定 tarball 条目跟进更新；生产部署与 Host 重启另行处理。

## 10. 失败补救与禁止事项

| 现象 | 处理 |
| --- | --- |
| 镜像同步非快进 | 比较独有提交并带回主仓，保留远端工作；不自动强推 |
| tag 已创建，测试/npm 发布失败 | 查日志并先确认 npm 版本是否存在。环境临时失败可重跑原 run；代码修复需先同步镜像，再从修复后的 main 手动 dispatch。不要以为新 push 会重发已有 tag |
| 未发布版本的 tag 指错提交 | 只有证明 npm 未发布、没有已分发 Release 且无消费者依赖后，才可专门修复 tag；不作为默认重试流程 |
| npm 成功，Release 缺失 | 补好 workflow，镜像同步后 dispatch 同版本；跳过 npm，创建 Release 与附件，无需为了补发布页而升版 |
| 同版本 tag 与 main 不同 | 重跑前检查差异。不得借补 Release 改写已发布版本的源码或移动其 tag；附件仍下载 npm 既有产物，说明应与发布内容一致 |
| npm 报 EOTP/ENEEDAUTH | 核对包 owner、Trusted Publisher 仓库/文件名/权限/绑定确认；确需用户网页授权时说明真实阻塞 |
| npm 图挂了 | 检查 repository.directory、镜像相对路径与资源访问。修正 README/元数据后需新 npm 版本才能更新包页 |
| 本机 pack 测试报 JSON 不可迭代 | 核验 npm 版本与实际输出；npm 11 常见数组、npm 12 可返回包名索引对象，两种都应兼容 |
| 商店仍装旧版 | 检查条目是否固定 tarball、PR 是否合并及采集刷新，不能只看 npm latest |

禁止覆盖已发布 npm 版本、移动已发布版本 tag、上传不同重建包冒充 npm 原包，或把临时/原始会话证据放进发布包。通用 CI、发布验收与 DSH 运行兼容是不同证据，不互相替代。

## 11. 当前落地状态与后续基线

截至 2026-10-28，本仓自动镜像已覆盖 AUTO、Magpie、Sidebar；按本 SOP 的默认完成标准：

| 插件 | 自动镜像/tag | npm OIDC | GitHub Release + npm 同版附件 | 状态 |
| --- | --- | --- | --- | --- |
| AUTO | 已配置 | 已配置 | 已配置，0.5.1 已验 | 完整参考实现 |
| Magpie | 已配置 | 已配置 | workflow 尚未配置 | 待补 Release 环节 |
| Sidebar | 已配置 | 已配置 | workflow 尚未配置 | 待补 Release 环节 |

这是本次核对时的状态，不是把后三者差异当作永久例外。后续新插件默认完成全链路；维护现有插件时以实际 workflow 与线上结果更新此表。

本次整理只更新 SOP，不宣称已替 Magpie/Sidebar 补配置，也不改变现有发布行为。其它目录中的历史计划引用旧 §9/§11 时，以本 SOP 的当前流程为准；归档设计仍保留为历史证据。
