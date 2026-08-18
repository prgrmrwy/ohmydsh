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

### D4:sync 物化策略 = 生成 + 链接(而非全 copy)
- presets:优先 symlink `~/.dsh/.agent-presets/<id>` → 仓库目录(单真相源,改即生效);若 DSH 不跟随 symlink,退化为 copy + 变更检测;
- `cordis.patch.yml`:sync 生成(带 generated 标记头,按 manifest 顺序合并 enabled patch 行),`~/.dsh` 手改不保留(仓库是真相源);
- packages:`dsh plugin add file:<path>`(或 link:,实测选优)。
- 备选:全 copy(易漂移、需重复同步);启动时 `--patch` 参数(依赖启动方式,且 preset/skill 仍需物化,不解决全部)。

### D5:版本与发布 = 独立 semver + git tag,先不接 registry
- package 类用 package.json 的 version;非包类(preset/patch/skill)用目录内 `VERSION` 文件;各自 CHANGELOG;
- tag 规则 `<id>@<version>`;package 类未来可 publish(发布策略另议)。

### D6:skills 落点 = 仓库根 `skills/<name>/SKILL.md`
DSH skill 解析为分层多源(含 `project-dsh`/`project-agents`),仓库即项目根,skill 可随 cwd 被发现。目录名在实施首步 spike 验证;若不成立,退化为"跟包 skills/ 目录"(社区惯例)或 preset 携带。

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
    note: 多角色团队插件,B001 评估候选
```

- sync 按 `source` 与 type 分发物化动作(`local` → 仓库路径;`remote` → `spec` 原址);`enabled: false` = 不物化(仓库内容保留);
- sync 全量重建生成文件(先备份),重跑即修复漂移;回滚 = 改 manifest 重 sync;
- `dshVersion` 与 `scripts/dsh.fish` 的 `DSH_VERSION` 对齐(sync 校验,不一致告警)。

### D9:第三方定制 = 引用 + 覆盖,不 vendor
`remote` 定制只在仓库维护三样东西:manifest 里的 `spec` 精确 pin、`patches/<id>.yml` 个人覆盖片段、条目说明(`note`/审查记录)。代码永远从 npm/git 原址安装。
- 备选 vendor 源码入仓:LICENSE 混杂、上游更新需手工合并、仓库角色变成代码库,维护负担随插件数线性增长;
- 备选完全不进 manifest 手动装:换机/重建不可复现,违背"一键加载";
- 采纳理由:仓库定位是"个人配置清单 + 自研定制",第三方代码归属上游,升级 = 改 pin 重跑 sync;
- 安全约定:第三方插件即第三方代码(社区列表明示警告),安装前看源码、`note` 记录来源与审查结论;`spec` 必须含精确版本,避免漂移。

## Risks / Trade-offs

- [DSH 不跟随 preset symlink] → 实施首步 spike;失败则退化为 copy + 变更检测 + re-sync 提示。
- [`dsh plugin add file:` 在 DSH 升级/profile 刷新后丢失] → sync 是唯一安装入口,升级后重跑 sync 即恢复;README 写明。
- [社区 bundle 标准随 DSH 版本演进] → manifest 锁 DSH 版本;升级前先验证社区包兼容性,再升 manifest。
- [sync 覆盖 `~/.dsh` 手改] → generated 标记头 + README 明示"真相源在仓库";手改一律回写仓库。
- [skills 目录名未验证] → tasks 里设 spike,不阻塞其他物化路径。
- [remote 包下架/改版/破坏性升级] → `spec` 精确 pin;升级是显式动作(改 pin 重跑 sync),不自动漂移;
- [第三方代码安全] → manifest `note` 记录来源与审查;安装前人工看源码的约定写入 README;
- [remote 安装失败(网络/源不可达)] → sync 报可读错误并列出失败条目,不半途静默。

## Migration Plan

1. 完成本 change 的 planning 工件并提交;
2. 按 D7 建目录骨架、写 `dsh.yaml`、实现 `scripts/sync.mjs`;
3. 迁移现有 `BACKLOG.md`、`scripts/dsh.fish`(引用路径不变,保持提交历史);
4. 首跑 sync(空 customizations 验证幂等),再启用第一个真实定制;
5. B004 单机接入作为第一个按新结构落地的定制,实战验证 sync 与 bundle 链路。

## Open Questions

(无——待验证项均已落入 tasks 的 spike。)
