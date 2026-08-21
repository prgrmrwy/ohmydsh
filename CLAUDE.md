# ohmydsh 项目指南

## 项目内涵

本仓库是 **DeepSeek Harness（DSH）的个人定制与部署真相源**，不是 DSH core 源码本体。它通过一个声明式 manifest 管理 DSH 版本、第三方插件、自研 package、patch、skill、preset 和环境级 Agent 指令，再由 sync/build 流程幂等物化到 `~/.dsh`。

核心原则：

- `dsh.yaml` 是 DSH 版本和定制开关的唯一入口；不要直接修改 `~/.dsh` 中的生成副本。
- 自研能力保留源码，第三方能力保留精确版本 pin、配置覆盖和审查记录，不 vendor 远端源码。
- 定制应可独立启用、禁用、升级和移除，并尽量遵循 DSH 社区 bundle 标准。
- 重要行为先写清规范、设计与验收条件，再改代码；安全相关路径应 fail closed。
- 不提交可重建产物、批量截图或 raw session/history evidence，只长期保留轻量、可复核的规范与报告。

## 开始工作前的阅读顺序

不要只根据目录名或局部实现猜测需求。开始分析或修改前，按以下顺序建立上下文：

1. 阅读根目录 `dsh.yaml`，了解当前 DSH pin、启用的定制、来源、版本、用途和风险说明。
2. 阅读 `openspec/specs/` 下与任务相关的当前规范；这里描述系统当前应当满足的行为。
3. 检查 `openspec/changes/` 中是否存在相关的进行中 change，并阅读其 `proposal.md`、`design.md`、`specs/` 和 `tasks.md`。
4. 如需理解设计演进、取舍或历史背景，再查阅 `openspec/changes/archive/`。归档 change 是历史证据，不应覆盖当前 spec。
5. 阅读 `docs/adr/` 中相关架构决策，以及 `docs/notes/` 中的实现背景、运行约束和验证方法。
6. 最后结合 `packages/`、`scripts/`、`patches/`、`skills/`、`presets/` 与测试代码确认实现现状。

若文档与实现不一致，不要静默选择一方：先指出差异，再根据当前 OpenSpec、已接受 ADR 和用户意图决定应修改规范还是实现。

## 关键目录

- `dsh.yaml`：总 manifest；DSH 版本、自动更新、Web 配置和全部定制的单一开关面。
- `openspec/specs/`：当前系统行为规范，是理解需求与验收标准的首要入口。
- `openspec/changes/`：进行中的 OpenSpec change；包含 proposal、design、delta specs 和 tasks。
- `openspec/changes/archive/`：已完成 change 的历史设计与验收记录。
- `docs/adr/`：已接受的长期架构决策。
- `docs/notes/`：运行机制、问题背景和验证说明。
- `packages/`：本仓库自研的 DSH package/bundle 源码。
- `patches/`：纯 composition patch 或远端插件的个人覆盖。
- `skills/`：同步到 `~/.dsh/skills/` 的自定义 skill。
- `presets/`：可选 Agent preset；不要仅为通用环境指令复制官方 preset。
- `instructions/`：环境级 Agent 指令真相源，由 manifest 物化到 `$DSH_HOME/AGENTS.md`。
- `scripts/`：sync、构建、升级和仓库维护脚本。
- `tests/`：仓库级 Node 测试。

## 工作约定

### 规范驱动

- 新功能、行为变化、兼容性调整或架构决策，优先走 OpenSpec change。
- 实现前确认相关 spec 和 tasks；实现过程中保持任务状态与实际进度一致。
- 完成后运行相关测试和严格校验，确认 current specs 已反映最终行为，再归档 change。
- 修复明显的小缺陷时也应先搜索现有 spec，避免破坏已有场景和不变量。

### 配置与部署

- 修改定制配置只改 `dsh.yaml`、对应本地源码或 `patches/`；不要手改部署目录。
- `enabled: false` 表示禁用，不等于从仓库删除。
- remote 定制必须使用精确版本 pin；local 定制源码位于 `packages/<id>/`。
- 修改 manifest 或定制后，通过 `dsh build`（或底层 `node scripts/sync.mjs`）物化。
- sync 应保持幂等；涉及部署时，至少验证连续运行第二次不产生变化。
- TypeScript local package 的 `lib/` 等标准构建产物不应进入版本控制。

### 验证

根据改动范围选择并报告实际运行过的检查：

```bash
npm test
npm run check:artifacts
node scripts/sync.mjs
```

package 内若有独立的 build、typecheck 或 test，也应运行对应命令。不要声称未实际执行的验证已经通过。

### 安全与兼容性

- Worktree Session、部署覆盖、清理、迁移和历史格式读取等路径必须保守处理；身份或状态无法证明时应拒绝破坏性操作。
- 保留 manifest 顺序、生成标记、版本 pin、幂等和可逆开关语义。
- 修改第三方插件集成前，先读 `dsh.yaml` 中的审查记录和相关 OpenSpec/ADR，确认信任面与 DSH 版本兼容性。
- 不把 `openspec/changes/archive/` 中的旧设计误当成当前实现要求；当前规范以 `openspec/specs/` 为准。

## 给 AI 的执行提示

回答项目问题或实施改动时，应明确引用实际阅读过的 OpenSpec、docs 和代码证据。优先解释“该能力为何存在、受什么不变量约束、当前真相源在哪里”，而不只是描述文件表面结构。若任务涉及 OpenSpec 的提案、实施、探索或归档，使用仓库提供的对应 OpenSpec skill 与流程。