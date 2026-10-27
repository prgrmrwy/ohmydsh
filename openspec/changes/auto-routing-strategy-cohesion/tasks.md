## 0. Preparation

- [x] 0.1 Do this change in its own Worktree Session. Confirm review.md says `VERDICT: APPROVE_WITH_CHANGES` and `CHANGES_APPLIED: yes`, and that no file under proposal / design / specs has changed since the review.
- [x] 0.2 Before touching any source, run the oracle inputs from test-plan "Equivalence oracle" against `packages/auto-model-routing/lib/policy-v2.js` (the 0.4.2 build output). Save the results as `test/fixtures/routing-oracle-0.4.2.json`. Also save the 0.4.2 `lib/` file list as `test/fixtures/lib-files-0.4.2.json`, and save copies of the 0.4.2 legacy artifacts (`router.js`, `judgements.js`, `policy-v2.js`, `policy-v2-rubric.json`) under `test/fixtures/lib-0.4.2/` for the dirty-output build test.
- [x] 0.3 Record the sha256 of `src/policy-v2-rubric.json` in the fixture (used by "源码与文案不含版本").
- [x] 0.4 Run the full suite once inside the package and once at the root, and record the baseline pass/skip counts in `implementation-log.md`.

## 1. Registry and built-in strategies (家族策略注册表, 内置家族策略)

- [x] 1.1 Write failing tests in `strategies.test.ts`: "内置注册表可构造且允许跨 provider 共用前缀", "冲突的注册表拒绝构造" (7 cases), "effort 起点按模型名查找且保持原结果", "effort 边界保持原结果" (expected values come only from the oracle fixture). Confirm they fail because `src/strategies/` does not exist yet.
- [x] 1.2 Implement `src/strategies/index.ts` (`FamilyStrategy`, `createRegistry`, default `registry`, the query functions from design D2, the construction checks from D3) and `claude.ts` / `codex.ts`, so that 1.1 passes.
- [x] 1.3 Rename `policy-v2.test.ts` to `routing.test.ts`. Write failing tests "内置子路由与原行为一致" and "支持范围判定只依据注册表".
- [x] 1.4 Rename `policy-v2.ts` to `routing.ts`. Switch `choosePolicyRoute` / `policyEffort` / `modelFamily` / `validatePolicyRoute` and `support.ts` to the registry. Delete `STARTING_POINTS`, `targetEffort`, `CHILD_MODELS` and the known-model regex. Make 1.3 pass.
- [x] 1.5 Refactor. Keep the full package suite green, except for tests that sections 3–5 will delete or migrate (list them explicitly in `implementation-log.md`).

## 2. Registry-driven Host boundaries (provider sets, persistence, injection)

- [x] 2.1 Write failing tests: "未给出家族且 provider 有多个家族时不猜测", "未注册家族的 Magpie 模型需显式模型与可验证 effort" (`subagent-tool.test.ts`); "新增家族只需新增策略", "记录中的家族已不在注册表" (`policy-host.integration.test.ts`, injecting a synthetic `deepseek` through `apply(ctx, { strategies })`).
- [x] 2.2 Implement:
  - add an optional `strategies` field to `Config` in `index.ts`;
  - in `policy-host.ts`, take the provider check, family inference and `delegation` type from the registry;
  - `PolicyStore` takes the registry at construction and builds its provider/family enums from it;
  - the `settings-host.ts` catalog and allowlist filter by `registry.providers()`;
  - build the `route_subagent` `provider`/`family` enums from the registry.

  Make 2.1 pass.
- [x] 2.3 Write a failing test "家族知识只有一个来源" in `content.test.ts`. Remove the remaining family literals from source until it passes (including the locked-state copy in `client/index.ts` and `client/strategy-details.ts`).
- [x] 2.4 Refactor. Keep the full suite green.

## 3. Remove the legacy chain

- [x] 3.1 Write failing tests: "旧判档账本不再增长且标注参数被拒" (`host.integration.test.ts`); "提交旧映射字段被拒", "旧映射配置不影响路由并在保存时移除" (`settings.test.ts`, plus the settings-page message in `settings-section.dom.test.ts`).
- [x] 3.2 Delete the files and branches listed in design D4: `router.ts`, the four-tier `rubric.json`, `judgements.ts`, `client/route-picker.ts`, the mapping logic in `settings*.ts`, the mapping tabs in the settings page, the four-tier menu in `label.ts`, the legacy hooks and Router in `index.ts` and `endpoints.ts`, the legacy branch in `subagent-tool.ts`, `scripts/label-report.mjs` (and its `files` entry), and `eval/run.mjs` / `cases.json` / `baseline.json`. Rename `policy-v2-rubric.json` to `rubric.json` (keep the bytes identical). Add `deprecated` to settings reads. Make 3.1 pass.
- [x] 3.3 Delete the corresponding legacy tests (see test-plan Coverage Notes). Remove `previous` from `context.ts`'s `buildState` and make the first line a fixed string. Have `state.ts` read `previous` but never write it.
- [x] 3.4 Refactor. Keep the full suite green.

## 4. Remove version concepts and make old data read-only compatible

- [x] 4.1 Write failing tests:
  - "新写入不含版本字段" and "旧绑定的 label 响应不暴露历史版本键" (`host.integration.test.ts`);
  - "旧子会话记录恢复不比较版本", "决策记录只容忍已知的历史键", "绑定标记存在但记录缺失或损坏" (`policy-host.integration.test.ts`);
  - "新旧记录并存", "新旧事件格式混读" (`feedback.test.ts`);
  - "缺快照记录独立成组", "不带版本字段的绑定同样计入覆盖", "不带版本字段的绑定确定同一分界" (`usage-report.test.ts`).
- [x] 4.2 Implement design D5:
  - `PolicyStore` uses a whitelist of three historical keys, then strict parsing; new writes carry no historical keys;
  - delete the version gate at `policy-host.ts:117`;
  - make the version fields in feedback snapshots and events optional, add `strategy`, and stop writing version fields;
  - `label` responses use a public projection;
  - `usage-report` groups by `strategy` / historical group / `unknown` and drops `schema`;
  - delete `policyVersion` / `mappingVersion` / `rubricVersion`;
  - the state response drops `policy` / `history`;
  - keep the directory constant `CHILD_DECISIONS_DIR`.

  Make 4.1 pass.
- [x] 4.3 Write a failing test "源码与文案不含版本" (`package-output.test.ts`: dirty-output build + pack file list + text scans + rubric sha256).
- [x] 4.4 Change the `build` script to remove `lib/` with `fs.rmSync` first, then run `tsc`, then `tsdown` (`clean: false` stays). Rewrite the tool description, parameter descriptions, error messages and client copy so they mention no version. Make 4.3 pass.
- [x] 4.5 Refactor. Keep the full suite green.

## 5. Behavior requirements whose scenarios changed (rewritten or new scenarios)

- [x] 5.1 Write failing tests for the following (new or changed) scenarios:
  - "AUTO 只改 effort", "新会话按默认模式创建", "旧状态文件可读" (`host.integration.test.ts` / `state.test.ts`);
  - "AUTO 结果同步到官方选择", "AUTO 判档覆盖待生效手选" (`selection.integration.test.ts`, switched to the default-chain harness);
  - "非用户回合沿用上一 depth", "子会话不走主会话判断", "请求内容受限", "源码不含本地分类与其它出站";
  - "面板展示本回合状态且无历史", "悬停面板显示最近一次决策分布" (`client.test.ts`);
  - "主会话判断提示", "子任务判断提示", "主决策在请求前后的状态", "完全显式的子任务决策可见";
  - "保存普通设置", "策略说明来自规则文件与注册表";
  - "label 响应以绑定是否存在区分" (`label-button.dom.test.ts`);
  - "AUTO 下返回推荐且保留显式维度", "MANUAL 与不可用路由" (`subagent-tool.test.ts`);
  - "skill 只含当前用法" (`content.test.ts`).
- [x] 5.2 Implement whatever is still missing so that 5.1 passes. Rewrite `skills/subagent-model-routing/SKILL.md` to cover the ten rules in the spec. Remove `policy-v2` / `legacy` / version wording from `skills/auto-model-routing-report/SKILL.md`.
- [x] 5.3 Refactor. Keep the full suite green.

## 6. Carried-forward regression tests (behavior unchanged)

- [x] 6.1 For every row in test-plan marked "carried forward; regression", rename the existing test title to `spec Scenario "…"`, or move it onto the default-chain harness. Remove only `policy` config writes and version-field assertions. Expected values stay the same. Confirm each test was red under its old name or old harness (its name was not in the ledger) and is green after migration.
- [x] 6.2 Change the manifest version in `tests/auto-model-routing-sync.test.mjs` to 0.5.0. Confirm that "旧部署迁移无重复来源" and "插件禁用撤销 skill 与工具" pass, and that `tests/agent-instructions-dispatch.test.mjs` passes unmodified.
- [x] 6.3 Flip every row in test-plan from 🔴 to 🟢. Mechanically check that each row's test name appears exactly once in the test files and passes.

## 7. Docs, scripts, release metadata

- [x] 7.1 Rename `eval/policy-v2-live.mjs` and `eval/policy-v2-cases.json` and drop `rubricVersion` from their output. Make `scripts/magpie-live-acceptance.mjs` stop writing or returning `policy`. Rename `scripts/policy-v2-host-probe.mjs` to `scripts/host-probe-children.mjs`.
- [x] 7.2 Rewrite the source links, rubric links and `label-report` text in `README.md` / `README.zh.md`. Rewrite `docs/feedback-evaluation.md` to the version-free record format (keep a note that historical rows remain readable). Add a one-line historical-record note to the top of the historical acceptance docs and fix any links that broke after the renames. Add a relative-link check for in-package Markdown to `content.test.ts`.
- [x] 7.3 Bump `package.json` to 0.5.0. Add a 0.5.0 entry to `CHANGELOG.md` covering the deleted legacy chain, the deleted configuration fields, the remote-pin rollback method and the data boundary (design D7). Update `version` and `note` for this entry in `dsh.yaml`.
- [x] 7.4 Run inside the package: `npm run build`, `npm test`, and `npm pack --dry-run`. Run at the root: `npm test` and `npm run check:artifacts`. Record the actual results in `implementation-log.md`.

## 8. Deployment and acceptance

- [x] 8.1 Back up `$DSH_HOME/state/auto-model-routing/` and `$DSH_HOME/plugins/dsh-auto-model-routing/config.json` to a timestamped directory (design D7).
- [x] 8.2 Build an isolated preview inside the worktree (`dsh build` → `ws prepare-preview` → `dsh`). In the preview GUI, confirm: the settings page has no mapping tabs and shows the "旧映射不再生效" message; the AUTO chip and its panel; the reply-bar allocation feedback; an unsupported model locking to MANUAL. Record what was actually observed.
- [ ] 8.3 Once the user approves, merge and run `dsh build` twice from the main checkout (the second run must produce no changes). The user decides when to restart the Host.

## 9. Verification and archive

- [ ] 9.1 Generate `verify.md` according to the Anvil verify instructions: every test-plan row is green, the whole suite introduces no new skips, and the review is not stale. Report the strict validation exit code as it actually is.
- [ ] 9.2 After the delta specs are merged, rewrite the Purpose in `openspec/specs/auto-model-routing/spec.md`, together with lines 5–7 (remove the legacy rollback and the "前七条" explanation) and the Purpose in `openspec/specs/auto-routing-usage-report/spec.md`. Scan the merged main specs and confirm they impose no remaining obligations around legacy or version selection.
- [ ] 9.3 Archive only with the user's authorization.
