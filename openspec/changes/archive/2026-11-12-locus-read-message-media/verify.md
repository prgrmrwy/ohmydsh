# Verify — locus-read-message-media

Date: 2026-11-12. dsh-pet 0.2.16，DSH 日常 Host（16:31:53 重启，日志确认 `video keyframes enabled (/opt/homebrew/bin/ffmpeg)`，无「媒体不可用」）。

## Verification Results

### Task Completion
- [x] All tasks marked `[x]` in tasks.md
- Remaining open tasks: none

### TDD Integrity
- [x] Every test-plan.md entry exists as a real test
- [x] Every test-plan.md row flipped to 🟢 green
- [x] Full suite passes
- [x] Zero skipped/pending/commented-out tests introduced by this change（见 Evidence：现存的跳过项都是环境门控，与本 change 无关）
- [x] No test weakened or deleted without REMOVED requirement

### Evidence

在 worktree `ws promote` 后执行 `npm ci`（lockfile 未改）：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck`（packages/dsh-pet） | exit 0 |
| `npm test`（packages/dsh-pet） | 234 files passed / 2 skipped；3336 tests passed / 4 skipped；ffmpeg 集成测试实际运行 |
| 仓库根 `npm test` | 811 tests：808 pass，0 fail，3 skipped |
| `npm run check:artifacts` | exit 0 |
| `openspec validate locus-read-message-media --strict` | valid |

跳过项（均为预先存在的环境门控）：dsh-pet `independent-runtime-probe.test.ts`（3）与 `locus-turn-observer-runtime.test.ts`（1）；根目录两条需托管 DSH profile 的 MCP bridge 测试，以及一条仅限 Linux 的测试。

### Live acceptance（日常 Host，群 `oc_1f75…`，子会话 `session-acab09f5…`）

| 7.3 项 | 结果 | 证据 |
| --- | --- | --- |
| 被回复消息截图可见 | ✅ | 11-12 00:08 第 2 轮：`pet_locus_message` 读取 image 消息，回复正确描述了截图里的「伙伴」页 |
| 视频返回封面与关键帧 | ✅ | 16:47:46 第 3 轮：返回封面和 1 张关键帧（t=0s），并注明时长 9.7s、场景抽样、非完整视频、未补帧；回复如实说明只看了封面和 1 帧 |
| 消息链接如实说明 | ✅ | 00:08 第 1 轮：说明链接打不开、本群历史中没有该视频，请对方转发或回复原消息 |
| 已有子会话冷恢复后的工具 | ✅（范围见下） | 16:31 Host 重启后，同一子会话第 3 轮的 request header 含 `pet_locus_message`，且调用成功 |

### Review Integrity
- [x] review.md `VERDICT: APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`；规范补充项 `AMENDMENT_VERDICT: APPROVE`
- [x] Verdict not stale — 例外见 Warnings 1
- [x] All findings fixed or rebutted

### Change Delivery
- Commit range: `301cf6bc`（实现，main 上为 `ffed6b60`）..`e8e063ee`（7.1 收尾）；本 verify 与归档另行提交。

## Warnings

1. 评审结论给出后，`specs/pet-locus-media-access/spec.md` 改过一次（`e8e063ee`）：为通过 strict validate 的 500 字限制，把两条 ADDED requirement 按原文拆成五条。没有改任何措辞或场景，21 个场景全部保留，只是重新分组。未重新送审。
2. 冷恢复项证明的是「已有工具的子会话冷恢复后工具仍在、可用」。该子会话在重启前已拿到此工具，所以不能证明「工具上线前创建的子会话冷恢复后会新获得它」；这一点由测试 `a cold-restored active child is composed through the same selection and runtime` 覆盖，没有做真机验证。

## Overall Decision

DECISION: PASS_WITH_WARNINGS

⚠️ PASS WITH WARNINGS
