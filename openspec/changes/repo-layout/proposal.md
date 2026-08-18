# Proposal: repo-layout

## Why

zydsh 是 DSH 的扩展仓,预期承载大量定制(agent presets、插件包、skills、composition patch 片段)。目前仓库只有 BACKLOG、openspec 和零散脚本,没有统一结构;每项定制将各找落点,导致部署(装进 `~/.dsh`)不可复现、开关不可控、版本无法独立维护。需要一个定稿的仓库结构:总配置统一管理,各项定制可插拔、独立版本、独立发布,但都在同一仓库内。

## What Changes

- 定义 monorepo 目录布局,定制单元对齐社区 `dsh.bundle` 标准(调研结论:awesome-dsh-plugin 生态的入选标准即 `dsh plugin add` 可安装 + package.json 声明 `dsh.bundle`,参考实现 dsh-agent-teams 0.1.7)。
- 新增根级总配置 `dsh.yaml`:锁定 DSH 版本,声明每项定制的 id / 类型 / 版本 / 开关 / 来源(`local` 自研 / `remote` 第三方)。
- 新增 sync 工具(脚本):按 manifest 幂等地物化 `~/.dsh` —— 安装 enabled 插件包(按来源分发)、合并 enabled 的 patch 行、链接 enabled 的 presets。
- 新增第三方定制管理方式:`remote` 来源只存精确版本 pin + 个人配置覆盖(`patches/<id>.yml`)+ 来源记录,不 vendor 源码;sync 从 npm/git 原址一键安装。
- 新增插件包单元规范:每个包自带 `cordis.patch.yml`(bundle 的一部分)、独立 semver、CHANGELOG,可 `dsh plugin add file:/link:` 安装,亦可独立发布。
- 新增 `presets/` 目录与官方 `~/.dsh/.agent-presets/<id>/` 机制的对接约定(链接或复制,待验证)。
- 新增 skills 落点约定(跟包 `skills/` 目录或 DSH `project-*` 分层源)。
- 迁移现有文件(BACKLOG.md、scripts/dsh.fish)到新布局,并与 openspec 工作流衔接(BACKLOG = 想法池,openspec change = 单项实施)。

## Capabilities

### New Capabilities

- `repo-layout`: 仓库目录结构、定制单元形态、总配置 manifest schema、sync 物化行为与插拔语义的规范契约。

### Modified Capabilities

(无)

## Impact

- **仓库文件**:新增 `dsh.yaml`、sync 脚本、`presets/`、`packages/`、`patches/`(可选)、`skills/`;现有 `BACKLOG.md`、`openspec/`、`scripts/dsh.fish` 按新布局归位。
- **部署面**:`~/.dsh`(`.agent-presets/`、`profiles/web/cordis.patch.yml`、profile node_modules)由 sync 工具物化;`scripts/dsh.fish` 保持锁版本启动。
- **工具链**:pnpm workspace(可选)、`dsh plugin add`、openspec CLI。
- **第三方依赖**:`remote` 定制经 npm/git 原址安装,可用性受上游影响(以精确 pin 缓解)。
- **后续 backlog 项**:B004/B006/B007 等实施产物(package/patch/skill/preset)的落点全部受此结构约束。
