# Design: repo-layout

## Context

zydsh 是嵌套 git 仓库(独立 `.git`,main 分支),已装 openspec(CLI 1.9.0,spec-driven schema)。部署面:`~/.dsh`(profiles/web 为 pnpm workspace,含用户 patch 层 `cordis.patch.yml`;`~/.dsh/.agent-presets/` 尚未创建)。DSH 版本锁定 0.1.0-rc.6(`scripts/dsh.fish`)。社区生态事实:插件入选标准 = `dsh plugin add` 可安装 + package.json 声明 `dsh.bundle`(参考 dsh-agent-teams)。动机见 proposal.md。

## Goals / Non-Goals

**Goals:**
- 每项定制是自包含单元,可单独开关、单独版本、单独发布;
- sync 一次命令把 manifest 状态物化到 `~/.dsh`,幂等、可重跑、可回滚;
- 仓库结构被 openspec/`dsh plugin add`/官方 preset 机制直接消费,不自造协议。

**Non-Goals:**
- 不改 DSH 本体、不做 DSH 分叉;
- 不建私有 npm registry、不建 CI 发布流水线(先用 git tag 当发布;发布策略另行决定);
- 不做运行时动态开关(manifest 是部署期开关;运行时开关属 cordis `disabled` 行职责);
- 不做多 profile 分组(工作/个人),后续按需加。

## Decisions

### D1:定制单元采用社区 `dsh.bundle` 标准
每个插件包自带 `cordis.patch.yml`(bundle 的一部分),`dsh plugin add file:/link:` 可安装。
- 备选:官方 monorepo 包规范(packages/<group>/<pkg> + 仓库级约束脚本)——面向向官方贡献,依赖官方工具链,不适合本仓;
- 备选:自造目录格式——与生态脱节,无法进 dsh-market,放弃。
- 采纳理由:生态兼容 + 官方安装口子 + 有真实参照实现。

### D2:总配置 = 自研薄层 `dsh.yaml`
根级 YAML:锁 DSH 版本 + `customizations` 列表(每项 `id/type/version/source/enabled`,其中 `source` 区分 `local` 自研与 `remote` 第三方)。
- 备选 JSON:无注释,人工维护体验差;
- 备选"目录存在即启用":无版本、无开关语义,无法表达"保留但禁用"。
- 采纳理由:YAML 可读 + 显式插拔语义 + 版本引用。manifest 之外的一切都复用现有机制,不自研。

### D3:patch 跟包走,仅纯 composition 调优进 `patches/`
- 社区 bundle 标准即 patch 跟包;`patches/` 只放无代码的纯行调优(如启用某工具行)。
- 备选:集中 patches/ 目录——拆包时行与代码分离难维护,与生态冲突。

### D4:sync 物化策略 = copy + 生成(不用 symlink,spike 已证)
- presets:**copy 进** `~/.dsh/.agent-presets/<id>`(spike 1.1 代码级确认:roster 扫描用 `readdir({withFileTypes:true})` 的 `Dirent.isDirectory()`,对 symlink 返回 false,symlink 不会被发现);copy 后按内容哈希做变更检测;
- `cordis.patch.yml`:sync 生成(带 generated 标记头,按 manifest 顺序合并 enabled patch 行),`~/.dsh` 手改不保留(仓库是真相源);
- packages:`dsh plugin add <spec>`(spike 1.3 确认:add 自动写 dependencies 并追加进 `dsh.profile.bundles`,重启即自动加载 bundle patch,无需 sync 写 composition 行);local 用 `file:` 路径;
- 版本 pin:安装后校验 `node_modules/<name>/package.json` 版本 == manifest pin,不一致则重装;`--save-exact` 仅首次安装生效,漂移修正靠重装。
- 备选已排除:全 copy(易漂移);symlink(roster 不认);启动 `--patch`(依赖启动方式,不解决 preset/skill)。

### D5:版本与发布 = 独立 semver + git tag,先不接 registry
- package 类用 package.json 的 version;非包类(preset/patch/skill)用目录内 `VERSION` 文件;各自 CHANGELOG;
- tag 规则 `<id>@<version>`;package 类未来可 publish(发布策略另议)。

### D6:skills 落点(spike 1.2 已定)
DSH skill 分层源(每 skill = `<root>/<name>/SKILL.md`):
- project 级:`<项目根>/.dsh/skills/`(project-dsh)、`<项目根>/.agents/skills/`(project-agents),随会话 cwd 的 git 根发现;
- user 全局:`~/.dsh/skills`(user-dsh)、`~/.agents/skills`(user-agents);
- custom 目录(config 可配)、bundled(宿主)。
仓库以 `skills/<name>/SKILL.md` 为源码位置,sync 物化到 `~/.dsh/skills`(user-dsh,全局可用、不依赖会话 cwd);project 级方案仅作备选。

### D7:目录布局(定稿)

```
zydsh/
  dsh.yaml                  # 总配置(唯一开关面)
  README.md                 # 仓库说明 + 真相源声明
  BACKLOG.md                # 想法池(留在根)
  openspec/                 # spec-driven 流程
  scripts/
    dsh.fish                # 锁版本启动(已有)
    sync.mjs                # manifest → ~/.dsh 物化
  packages/<name>/          # bundle 插件:package.json(dsh.bundle)+ cordis.patch.yml + src/
  presets/<id>/             # cordis.yml + VERSION + CHANGELOG
  patches/<id>.yml          # 纯 composition 调优(可选)
  skills/<name>/            # SKILL.md(落点见 D6)
```

### D8:manifest schema 与 sync 语义

```yaml
dshVersion: 0.1.0-rc.6
dependencies:               # 无 bundle 支撑包(可选):精确版本 pin,plain dependency,不进 bundle 层
  - '@deepseek-ai/dsh-sdk-protocol@0.1.0-rc.6'
customizations:
  # 自研:源码 + 配置都在仓库
  - id: tool-open-ide
    type: package            # package | preset | patch | skill
    source: local            # 默认值;源码在 packages/<id>/
    version: 0.1.0           # package/preset 必填;patch 可省略
    enabled: true
  # 第三方:只存 pin + 覆盖 + 记录,不 vendor 源码
  - id: dsh-agent-teams
    type: package
    source: remote
    spec: '@nanmicoder/dsh-agent-teams@0.1.7'   # npm 精确版本;或 github:owner/repo#tag
    enabled: true
    deps: ['@deepseek-ai/dsh-sdk-protocol']     # 可选:归属引用(安装以顶层 dependencies 为准)
    note: 多角色团队插件,B001 评估候选
```

- 顶层 `dependencies` = 无 bundle 支撑包的**安装唯一入口**:sync 按精确版本安装/校验/移除,不进 bundle 层;条目 `deps` 仅为归属引用,sync 校验引用的包名必须存在于顶层列表,悬空引用报错;

- sync 按 `source` 与 type 分发物化动作(`local` → 仓库路径;`remote` → `spec` 原址);`enabled: false` = 不物化(仓库内容保留);
- package 类:sync 只负责 `dsh plugin add <spec>`,不写 composition 行;声明 `dsh.bundle` 的包自动进 `dsh.profile.bundles`(spike 1.3 证实),bundle-less 包保持 plain dependency 不进 bundle 层(sync 归一化与 `dsh plugin add` reconcile 对齐);pin 校验按安装后 `node_modules` 实际版本比对;
- sync 全量重建生成文件(先备份),重跑即修复漂移;回滚 = 改 manifest 重 sync;
- `dshVersion` 与 `scripts/dsh.fish` 的 `DSH_VERSION` 对齐(sync 校验,不一致告警)。

### D9:第三方定制 = 引用 + 覆盖,不 vendor
`remote` 定制只在仓库维护三样东西:manifest 里的 `spec` 精确 pin、`patches/<id>.yml` 个人覆盖片段、条目说明(`note`/审查记录)。代码永远从 npm/git 原址安装。
- 备选 vendor 源码入仓:LICENSE 混杂、上游更新需手工合并、仓库角色变成代码库,维护负担随插件数线性增长;
- 备选完全不进 manifest 手动装:换机/重建不可复现,违背"一键加载";
- 采纳理由:仓库定位是"个人配置清单 + 自研定制",第三方代码归属上游,升级 = 改 pin 重跑 sync;
- 安全约定:第三方插件即第三方代码(社区列表明示警告),安装前看源码、`note` 记录来源与审查结论;`spec` 必须含精确版本,避免漂移。

## Risks / Trade-offs

- [preset symlink 不被 roster 跟随(已证实)] → copy + 哈希变更检测;详见 D4。
- [`dsh plugin add file:` 在 DSH 升级/profile 刷新后丢失] → sync 是唯一安装入口,升级后重跑 sync 即恢复;README 写明。
- [社区 bundle 标准随 DSH 版本演进] → manifest 锁 DSH 版本;升级前先验证社区包兼容性,再升 manifest。
- [sync 覆盖 `~/.dsh` 手改] → generated 标记头 + README 明示"真相源在仓库";手改一律回写仓库。
- [remote 包下架/改版/破坏性升级] → `spec` 精确 pin;升级是显式动作(改 pin 重跑 sync),不自动漂移;
- [第三方代码安全] → manifest `note` 记录来源与审查;安装前人工看源码的约定写入 README;
- [remote 安装失败(网络/源不可达)] → sync 报可读错误并列出失败条目,不半途静默;
- [第三方插件拉高依赖版本(实测 cost-meter 带 rc.7,运行体 rc.6)] → 重启后验证加载;`note` 记录;sync 的 pin 校验覆盖。

## Migration Plan

1. 完成本 change 的 planning 工件并提交;
2. 按 D7 建目录骨架、写 `dsh.yaml`、实现 `scripts/sync.mjs`;
3. 迁移现有 `BACKLOG.md`、`scripts/dsh.fish`(引用路径不变,保持提交历史);
4. 首跑 sync(空 customizations 验证幂等),再启用第一个真实定制;
5. B004 单机接入作为第一个按新结构落地的定制,实战验证 sync 与 bundle 链路。

## Open Questions

(无——待验证项均已落入 tasks 的 spike。)
