# 验收记录：auto-routing-managed-scope

日期：2026-10-29，worktree 分支 `ws/auto-locus-bind-locus-auto-pet-1-16-42-00-bind-o`。

## 实际运行的检查

| 命令 | 结果 |
|---|---|
| `packages/auto-model-routing`: `npm run typecheck` | exit 0 |
| `packages/auto-model-routing`: `npm run build` | exit 0 |
| `packages/auto-model-routing`: `npx vitest run` | 30 文件 / 274 测试通过 |
| 根目录 `npm test` | 640 项：pass 638 / fail 0 / skipped 2 |
| `npm run check:artifacts` | 通过 |
| `openspec validate auto-routing-managed-scope --strict` | valid |
| `openspec validate --specs`（主 spec 同步后） | 49 passed / 0 failed |

## 场景覆盖

test-plan.md 74/74 行均有同名测试 `spec Scenario "<场景名>"` 且在上述全量运行中通过。覆盖边界见 test-plan.md 的 Coverage Notes：同窗口旁支用 `agents.create` 构造（服务直建旁支由探针证实满足绑定条件）；实时门禁覆盖 cap 降低与目录不可用。

TDD 说明：先前已有回归按 baseline 处理；新增测试多数在实现之后补写，未逐条记录 red 阶段。

## 隔离预览

2026-10-29 在 worktree 隔离 home 构建并起预览 Host（3246，未碰日常 3080）：插件加载、端点认证与 settings 正常；用真实目录与允许列表离线计算退化链结果符合 spec（traex 子会话留在 traex，不跨 provider）。未用真实模型跑端到端，按用户决定合入后在生产验证：traex 会话派一个子会话；飞书 @ 机器人确认 Pet locus 首轮不再被拦。

## 已知限制

官方工具执行窗口内，插件以同一父会话直接创建的子会话会被一并接管（用户 2026-10-28 接受），`childRouting` 返回 `scopeNote` 说明。
