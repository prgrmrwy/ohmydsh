# Tasks

## 1. SKILL 显示口径

- [x] 1.1 把 `skills/jev-workflow-router/SKILL.md` 的「Show advice only when…」与「say nothing…」两条规则改为显式门槛：两阶段都要满足 `confidence >= 0.50` 且 winner margin `>= 0.50`；写明 winner margin 取 Jev 的 `margin`，结果不含该字段时按概率分布最大与次高之差计算。验证：`grep -n "MCP's conservative defaults" skills/jev-workflow-router/SKILL.md` 无输出，`grep -n "0\.50" skills/jev-workflow-router/SKILL.md` 命中门槛说明，`node --test tests/jev-workflow-router.test.mjs` 通过。
- [x] 1.2 更新 SKILL 的示例行与 recorder 载荷说明：`confidenceMet` = confidence ≥ 0.50、`marginMet` = margin ≥ 0.50，示例 `confidence` 用 0.72（低于 0.85）。验证：把示例 JSON 写入临时文件，用临时 `DSH_HOME` 执行 `node recorder.mjs record < <file>`，记录落为 `auto-candidate`。
- [x] 1.3 在 `tests/jev-workflow-router.test.mjs` 的 SKILL 文本断言组加入新口径断言（0.50 门槛、margin 计算、不再出现「MCP's conservative defaults」）。验证：`node --test tests/jev-workflow-router.test.mjs` 通过，且把旧措辞临时改回时该断言失败。

## 2. 规范校验

- [x] 2.1 运行 `openspec validate fix-jev-advisory-display-gate --type change --strict` 通过；delta 中 MODIFIED requirement 标题与 `openspec/specs/jev-workflow-routing/spec.md` 完全一致。验证：命令退出码 0。
- [x] 2.2 比对 delta 与主 spec 的既有场景：`0.77/0.70 → 显示`（已补第二阶段数据）、`0.45/0.37 → 沉默`，确认语义不变、只新增门槛与场景。验证：比对结果写进 apply 记录。

## 3. 部署与集成验证

- [x] 3.1 在 worktree 运行 `node scripts/sync.mjs` 连续两次，第二次不产生变更；`~/.dsh/skills/jev-workflow-router/SKILL.md` 与仓库副本逐字节一致。不要用 `dsh build`：PATH 上的 `dsh` 指向主 checkout，会把主仓源码物化下去。验证：第二次前后 `git status --short` 无变化，`diff ~/.dsh/skills/jev-workflow-router/SKILL.md skills/jev-workflow-router/SKILL.md` 为空。
- [x] 3.2 运行 `npm test` 与 `npm run check:artifacts`，确认产物策略合规、且相对 HEAD 基线没有新增失败。验证：`check:artifacts` 退出 0；`npm test` 的失败项与暂时回退本改动后的 HEAD 基线相同（本 worktree 的 node_modules 为只读 555 且缺 typescript，导致 `subprocess-closure` 3 个 EACCES 与 `sync-dsh-openspec` 1 个 `tsc: not found`）。

## Workflow follow-up

- 归档前把 `jev-workflow-routing` delta 同步进主 spec（`openspec-archive-change`），确认主 spec 的显示门槛与 `SKILL.md` 一致。
- 重启 Host 后（是否重启由用户决定）在真实决策点观察：建议行出现且记录为 `auto-candidate`。若 5 天内仍无新增 `real-vibe` 记录，说明问题在触发侧而非门槛侧，在 `BACKLOG.md` 记录「advisory 触发率仍为 0，需评估插件化」。
