## Why

本仓库是**公开**的 DSH 定制真相源，但部分定制**不可公开**：内网 npm 包、内网采集器、
含本机绝对路径的 patch 片段。现有承载方式（`enabled: false` + `enabledEnv` + gitignored
`.env.local`）把一件事拆到两个文件，且仍在公开 manifest 里留下内网包名、内部 registry、
maintainer 与内部服务描述（见 `dsh.yaml` 的 `dsh-traex-bridge` 条目）——即「默认关闭」
并不等于「不公开」。

已经出现第二个实例（Bits 三方 AI 采集插件，调研见
`docs/notes/ai-code-report-dsh-integration-research.md`），说明这是结构性需求而非个例。

## What Changes

- 新增**本地 manifest overlay**：可选文件 `dsh.yaml.local`（gitignored），结构与
  `dsh.yaml` 的 `customizations` **同构**，由 sync 在加载期追加到定制列表。
- overlay **只能追加**定制条目，不得声明 `dshVersion`、`autoUpdate`、`web`、
  `agentInstructions`、`dependencies` 等顶层字段；id 与公开 manifest 冲突时 sync 报错。
- overlay 条目走**完全相同**的校验路径：`loadManifest` 的逐字段校验与
  `hostRuntimeCompatibility` 版本围栏，不得因来源是本地文件而放宽。
- 支持环境变量 `DSH_LOCAL_MANIFEST` 指定 overlay 的绝对路径，使该文件可置于仓库之外
  （为多机共享留出无需后续开发的通道；分发本身不在本 change 范围）。
- 四处解析 `customizations` 的消费方统一走同一份合并结果：`scripts/sync.mjs`、
  `scripts/plugin-list.mjs`、`scripts/lib/plugin-updates.mjs`、
  `scripts/lib/dsh-host-runtime.mjs`。
- `dsh-traex-bridge` 条目从公开 `dsh.yaml` 迁出（连同其 `enabledEnv` workaround），
  改由本机 overlay 承载；`enabledEnv` 机制本身保留（`dsh-memex` 的熔断用途不变）。
- 文件缺失是**常态**而非错误：无 overlay 时 sync 行为与现状完全一致。

非目标：不做跨机器分发/同步能力（结论与理由记入 design：与联邦控制面已声明的
「不同步文件」边界冲突，且 git 已解决同构问题）。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `repo-layout`: manifest 契约新增「本地 overlay 追加定制」这一来源，并约束其
  权限边界（只追加、禁顶层字段、id 冲突拒绝、校验不放宽）与缺失时的降级行为；
  同时明确公开 manifest 不承载不可公开定制的痕迹。

## Impact

- `scripts/sync.mjs`：manifest 加载路径（`loadManifest`）。
- `scripts/plugin-list.mjs`：启动清单需包含 overlay 条目，否则本机装了却看不见。
- `scripts/lib/plugin-updates.mjs`：升级检查需覆盖 overlay 条目，否则内网包永不检查更新。
- `scripts/lib/dsh-host-runtime.mjs`：Host runtime 版本围栏必须覆盖 overlay 条目
  （**安全相关**：该围栏在任何 profile 操作前完成校验）。
- `dsh.yaml`：移除 `dsh-traex-bridge` 条目。
- `.gitignore`：新增 `dsh.yaml.local`。
- `.env.local`：不再需要 `DSH_TRAEX_BRIDGE`（本机操作，不在版本控制内）。
- `openspec/specs/repo-layout/spec.md`：manifest 契约与 sync 行为。
- `tests/`：新增 overlay 行为测试（缺失/追加/冲突拒绝/越权字段拒绝/幂等）。
- 不改 `bin/dsh`，不改 `cordis.patch.yml` 生成逻辑，不新增 manifest `type`。
