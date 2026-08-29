# 贡献指南 / Contributing

感谢你对 ohmydsh 的关注!本文档说明如何在本仓库高效、安全地提交改动。

> English speakers: this repository is primarily documented in Chinese.
> The workflow summary in English lives at the [bottom of this file](#english-summary).

## 这个仓库是什么

ohmydsh 是 **DeepSeek Harness(DSH)的定制与部署真相源**,不是 DSH core 本体。它用一份声明式 manifest(`dsh.yaml`)管理 DSH 版本、第三方插件、自研 package、patch、skill 和环境级 Agent 指令,再由 `scripts/sync.mjs` **幂等物化**到 `~/.dsh`。

理解这一点很关键,它决定了几乎所有贡献约定:

- `dsh.yaml` 是唯一开关面,`~/.dsh` 是产物 —— **不要直接改产物**。
- 第三方能力只保留精确版本 pin + 覆盖片段 + 审查记录,**不 vendor 远端源码**。
- 定制应可独立启用、禁用、升级和移除;`enabled: false` 表示禁用,**不等于删除**。

## 环境准备

前置要求:**Node.js >= 22**、**npm >= 10**(推荐 `.nvmrc` 中的版本)。

```bash
git clone https://github.com/prgrmrwy/ohmydsh.git && cd ohmydsh
./scripts/bootstrap.sh     # 检查 Node 环境 + 安装依赖(幂等)
./scripts/install.sh       # 安装 dsh 命令到 ~/.local/bin
```

依赖出问题想重装:`./scripts/bootstrap.sh --force`。卸载命令:`./scripts/install.sh uninstall`。

## 开始工作前的阅读顺序

不要只根据目录名或局部实现猜测需求。请按以下顺序建立上下文:

1. 根 `dsh.yaml` —— 当前 DSH pin、启用的定制、来源、用途和风险说明。
2. `openspec/specs/` —— 系统**当前应当满足**的行为规范。
3. `openspec/changes/` —— 是否已有相关的进行中 change(读 `proposal.md`、`design.md`、`specs/`、`tasks.md`)。
4. `openspec/changes/archive/` —— 设计演进与历史背景。归档 change 是历史证据,**不覆盖当前 spec**。
5. `docs/adr/`、`docs/notes/` —— 长期架构决策、实现背景与验证方法。
6. `packages/`、`scripts/`、`patches/`、`skills/`、`presets/` 与测试 —— 确认实现现状。

若文档与实现不一致,**不要静默选择一方**:先指出差异,再根据当前 OpenSpec、已接受 ADR 和维护者意图决定该改规范还是改实现。

## 贡献流程

### 1. 先开 Issue 讨论

除明显的小修复(错别字、失效链接)外,建议先开 Issue 说明动机与预期行为,避免方向性返工。

### 2. 规范驱动(OpenSpec)

新功能、行为变化、兼容性调整或架构决策,**优先走 OpenSpec change**:

```bash
openspec new change <name>   # 生成 proposal / design / specs / tasks 骨架
```

- 实现前确认相关 spec 和 tasks;实现中保持任务状态与实际进度一致。
- 完成后运行相关测试与严格校验,确认 current specs 已反映最终行为,再归档 change。
- 修复小缺陷时也应先搜索现有 spec,避免破坏已有场景和不变量。

### 3. 修改配置与定制

- 只改 `dsh.yaml`、对应本地源码(`packages/<id>/`)或 `patches/`;**不要手改 `~/.dsh` 部署目录**。
- remote 定制必须使用**精确版本 pin**,并在条目 `note` 中记录来源与审查结论。
- 自研 package 改代码后**要 bump `package.json` 与 manifest 的 version**。
- 改完通过 `dsh build`(或 `node scripts/sync.mjs`)物化。
- sync 必须保持**幂等**:至少验证连续运行第二次不产生变化。
- TypeScript local package 的 `src/` 是真相源,`lib/` 等构建产物保持 gitignored,不要提交。

### 4. 验证

根据改动范围选择并**报告实际运行过的检查**:

```bash
npm test                 # sync 黑盒回归测试
npm run check:artifacts  # 防止生成产物 / nested lock / raw evidence 入库
node scripts/sync.mjs    # 物化;涉及部署时验证第二次运行无变化
```

package 内若有独立的 build、typecheck 或 test,也应运行对应命令。

> ⚠️ **不要声称未实际执行的验证已经通过。** 这是本仓库的硬性约定。

### 5. 提交 Pull Request

- 保持 PR 聚焦单一主题,便于审查。
- 填写 PR 模板,说明动机、改动内容和**实际运行过的验证命令与结果**。
- 关联相关 Issue 或 OpenSpec change。
- CI 必须通过。

## 提交信息规范

本仓库使用 [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <简短描述>
```

常用 type:

| type | 用途 |
|---|---|
| `feat` | 新功能 / 新定制能力 |
| `fix` | 缺陷修复 |
| `docs` | 文档(含 OpenSpec 提案与归档) |
| `refactor` | 重构,不改外部行为 |
| `test` | 补充或修正测试 |
| `chore` | 依赖、版本 pin、构建等杂务 |

常用 scope:`sync`、`launcher`、`customizations`、`worktree-session`、`openspec`、`dsh` 等。

示例:

```
feat(worktree-session): pnpm 项目支持与不支持项目的前置明确诊断
fix(sync): 按 manifest 承诺核验部署面,自愈残缺 package
docs(openspec): 归档 scope-npm-registry-injection
```

## 代码与文档风格

- 遵循 `.editorconfig`(UTF-8、LF、2 空格缩进)。
- 与周边现有代码风格保持一致;不要顺手做无关的大规模重排。
- 重要行为**先写清规范、设计与验收条件,再改代码**。
- 安全相关路径必须 **fail closed**:身份或状态无法证明时,拒绝破坏性操作。

## 安全与兼容性红线

- Worktree Session、部署覆盖、清理、迁移和历史格式读取等路径必须保守处理。
- 保留 manifest 顺序、GENERATED 生成标记、版本 pin、幂等和可逆开关语义。
- 修改第三方插件集成前,先读 `dsh.yaml` 中的审查记录和相关 OpenSpec/ADR,确认信任面与 DSH 版本兼容性。
- **插件即第三方代码**:引入前先看源码,并把来源与审查结论写进 `note`。

发现安全漏洞?请**不要**开公开 Issue,按 [SECURITY.md](SECURITY.md) 私下报告。

## 不应提交的内容

- 可重建产物(`packages/*/lib/`)、nested lockfile(`packages/*/package-lock.json`)。
- 批量截图、raw session/history evidence(`openspec/changes/**/checking/{baselines,screenshots}/`)。
- 重复的架构图导出(只保留图源 JSON + 一份主题自适应 SVG)。
- 任何密钥、令牌或本机私有配置(`.env.local` 已 gitignored)。

`npm run check:artifacts` 会强制这些约定。

## 行为准则

参与本项目即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 许可

除非另有说明,你提交的贡献将按 [MIT License](LICENSE) 授权。

---

## English summary

ohmydsh is the **source of truth for a personal DeepSeek Harness (DSH) setup** — not DSH core itself. A declarative manifest (`dsh.yaml`) drives an **idempotent** sync (`scripts/sync.mjs`) that materializes everything into `~/.dsh`.

Key rules:

1. **Read first**: `dsh.yaml` → `openspec/specs/` → `openspec/changes/` → `docs/adr/` and `docs/notes/` → implementation.
2. **Spec-driven**: non-trivial changes go through an OpenSpec change (`openspec new change <name>`) before implementation.
3. **Never edit deployed output** under `~/.dsh`; edit `dsh.yaml`, `packages/<id>/`, or `patches/` and re-run `dsh build`.
4. **Pin exactly, never vendor** third-party sources; record provenance and review notes in the entry's `note`.
5. **Verify and report honestly**: run `npm test` and `npm run check:artifacts`; never claim checks you did not actually run.
6. **Conventional Commits** for commit messages; keep PRs focused and fill in the template.

Report security issues privately per [SECURITY.md](SECURITY.md). Contributions are licensed under [MIT](LICENSE).
