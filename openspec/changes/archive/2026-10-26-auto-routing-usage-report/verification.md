# 验证记录（2026-10-26）

## 自动化
- 包内：`npm run typecheck` 通过；`vitest run` 33 个文件、229 个测试全部通过，其中新增 usage-report 17 个、CLI 4 个、content 1 个，并按新增 skill 调整了 bundled-skill 1 个用例；`npm run build` 通过。
- CLI 测试：`node --permission` 只授予测试 DSH_HOME、包目录和 zod 目录的读权限，运行成功；DSH_HOME 前后字节不变；stdout/stderr 不含正文、cwd、sessionId。
- 打包：`npm pack --dry-run` 包含 `lib/usage-report.js` 与 `skills/auto-model-routing-report/SKILL.md`。从 tarball 安装到隔离目录后，在权限模式下运行成功。
- 部署：`node scripts/sync.mjs` 连续两次，第二次为 no changes；部署目录 `skills/` 下有两个 skill，会话 skill catalog 中 `auto-model-routing-report` 恰好出现一次。
- 仓库：`npm test` 共 622 个用例，619 通过、1 失败（`tests/auto-model-routing-sync.test.mjs`）。不含本 change 改动的基线同样失败：该用例的 manifest 固定为 `version: 0.3.0`，而包已是 0.4.0，导致 sync 重装。这是 0.4.0 发布遗留，与本 change 无关。`npm run check:artifacts` 通过。

## 本机真实数据只读运行（只记聚合）
- 读取失败：decode-failed / tail-incomplete / parse-failed / missing-log 均为 0；排除的子会话和 seeded 会话均为 0。
- 覆盖：首条 v2 记录之后共 40 个用户回合，其中 14 个无记录；未关联绑定为 0；当前 AUTO 但两本账都无记录的会话有 10 个。
- 分组：所有子组均为 insufficient-sample（最多 10 个决策 / 3 个会话），符合预期；反馈中已评价 1 个，其余未评价。
- 参照：AUTO 之前 Sol 共 4467 次调用中有 4460 次为 high，AUTO 期间以 medium 为主；Opus 在 AUTO 之前为 high 522 次、medium 918 次。只作为 effort 起点观察。
- 同一输入连续运行两次，输出字节一致；state 目录前后哈希不变。运行耗时约 1.1 秒。
- 人工判断：无记录回合 14/40 偏高，但符合已知机制（仅已应用的决策会写入记录），报告已通过 caveat 和计数暴露；未见无法解释的异常。
