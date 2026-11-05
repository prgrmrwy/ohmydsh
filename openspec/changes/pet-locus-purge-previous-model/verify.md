# Verify: pet-locus-purge-previous-model

DECISION: PASS_WITH_WARNINGS

## 1. Task completion

`tasks.md` 1.1–7.3 已勾选；7.4 即本文件，写完后勾选。没有未完成的任务。

## 2. TDD integrity

- `test-plan.md` 共 76 行，全部 🟢 green，没有残留的 🔴 行。每一行都对应一个真实存在的测试，测试名与文件名由实现子会话核对过，第 46 行的测试名已修正为实际名称。
- 全套测试通过；跳过数与基线相同（dsh-pet 4 个、根 3 个），没有新增跳过、待办或被注释掉的测试。
- 删除和改写的测试逐条列在 [deleted-tests.md](deleted-tests.md)。唯一整文件删除的是 `test/locus-legacy-retire.test.ts`，对应 REMOVED「旧模型入口按退休规则处理」。其余改写只涉及 L2 行为，或把 fixture 改成合法的 `tier3` + 配对，测试目的不变。
- 偏离 red-first 的地方（见 Warnings W1、W2）都补做了"能失败"的证明。

## 3. Review integrity

- `review.md`：第 3 轮，`VERDICT: APPROVE_WITH_CHANGES`，`CHANGES_APPLIED: yes`。4 项 Required Changes 由评审方复核通过，复核记录在该文件末尾。
- 评审结论没有过期：proposal（17:35:58）、design 和 spec（17:39:19）都早于 review 最后一次写入（17:41:24），之后未再修改。
- 第 1、2 轮的问题和作者回应分别在 `review-round1.md`、`review-round2.md`，第 3 轮已逐项裁定。

## 4. Delivery status

未提交，等所有者审阅。没有部署、`dsh build` 或重启；没有对线上库执行迁移，实现过程只用了临时数据库。

改动范围：
- `packages/dsh-pet/src/**`（17 个文件）
- `scripts/migrate-state-version.mjs`、`package.json`、`README.md`
- 根目录 `package-lock.json`
- `packages/dsh-pet/test/**`：修改 22 个，新增 4 个，删除 1 个
- 本 change 目录下的 `tasks.md`、`test-plan.md`、`deleted-tests.md`、`verify.md`

## Evidence

以下检查都由 lead 在实现完成后重新运行，不是转述子会话的结果：

| 命令 | 基线 | 最终 |
|---|---|---|
| `packages/dsh-pet`: `npm run typecheck` | exit 0 | exit 0 |
| `packages/dsh-pet`: `npm test`（含 build） | 3027 pass / 0 fail / 4 skip | 207 files passed + 2 skipped；3058 pass / 0 fail / 4 skip |
| 根 `npm test` | 754 tests，751 pass / 0 fail / 3 skip | 754 tests，751 pass / 0 fail / 3 skip |
| 根 `npm run check:artifacts` | exit 0 | exit 0（"tracked paths comply with repository policy"） |
| `openspec validate pet-locus-purge-previous-model --strict` | — | valid |
| `npx vitest run test/migrate-cli.test.ts test/migrate-cli-installed.test.ts`（重新生成 lock 之后） | — | 2 files，39 pass |

Lock 文件：子会话手改的 `package-lock.json` 里，`packages/dsh-pet/node_modules/zod` 仍带着 `"dev": true`，用 `--omit=dev` 做生产安装时会漏掉 zod。lead 用 `npm install --package-lock-only --ignore-scripts` 重新生成了 lock，和手改版本相比只少了这一个 `dev` 标记。

## Warnings

- **W1 顺序偏离**：新迁移脚本是先写的，测试后写。补救做法是把新的 migrate-cli 测试拿去跑 git HEAD 上的旧脚本，35 个里有 24 个因断言失败而变红，不是 setup 出错；换回新脚本后全部通过。
- **W2 第一次运行就通过的测试**：迁移后的 3 个场景，以及任务 6 的 4 个表征测试（主会话无法回答、用户主动查阅受实际能力约束、冷恢复保留独立历史、重建不继承 shell），因为对应行为已经存在，第一次跑就是绿的。任务 6 那 4 个都临时把一条断言反过来跑过，确认会失败，然后恢复。
- **W3 超出 design 的小改动**：为了满足 spec 里"入口不存在或已失效"这句回执，`control.ts` 增加了 `LOCUS_NOT_FOUND` 的映射；`index.ts` 的 setCurrentTier/setCurrentMode/unbind 在没有当前 locus 时会抛出这个错误码。这几个闭包只有 dispatcher 层的映射测试覆盖，没有端到端测试。
- **W4 顺带修复的既有界面缺陷**：`src/client/settings.tsx` 原来只有 marker 为 `safe-v2` 时才启用 shell 按钮，快照校验也会拒绝 `tier3`，所以三层入口在管理面上一直无法授予 shell。这次收窄枚举必须改到这个文件，改完后 `tier3` 可以用 shell 了。
- **W5 留待决定**：`persistence.ts:589-591` 的 `commitProvisioning` 里还有一处 `mainRecord?.workSessionId ?? normalized.parentSessionId`，即缺少配对时回退的写路径。它不在 D7 清单里；要删掉它，就得加 design 已经否决的写时跨表校验。目前生产调用方都会带上配对，所以暂时保留，留给 B+C 或另行决定。
- **W6 纵深防御保留**：`composition.ts` 里 `legacy-composition` 的 fail-closed 闸门保留了。理由是 spec 仍然规定，没有 `tier3` 的 child 不得 adopt 或恢复。`locus-composition.test.ts` 里对应的两个测试改名为 "defence in depth…"，断言没有改。
- **W7 未做真机验收**：迁移脚本只在临时数据库和打包安装的布局下验证过。线上库的迁移（`dsh stop` → `--dry-run` → `--yes` → `dsh`）需要所有者另外确认后再执行。
- 其它：实现过程中误覆盖了 tracked 文件 `test/zz-probe.test.ts`，已经从 git 恢复，`git status` 显示它是干净的。
