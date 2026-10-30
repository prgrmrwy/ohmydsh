## Review Metadata

- **Review round**: 5
- **Prior round**: round 4 = APPROVE; round 5 re-opened because lean cuts changed proposal/specs/design/test-plan/tasks after that verdict
- **Reviewer context**: fresh-context subagent (no cross-model CLI installed)
- **Tool restrictions**: read-only, single write = this review.md
- **Artifacts reviewed**: proposal.md, design.md, specs/*, test-plan.md, tasks.md, canonical specs, source/tests listed above
- **Validation**: `node /data00/home/prgrmr/opensource/ohmydsh/node_modules/@fission-ai/openspec/bin/openspec.js validate magpie-line-panel-polish --type change` → `Change 'magpie-line-panel-polish' is valid`, exit 0; two known/accepted `Requirement text is very long (>500 characters)` warnings on ADDED `线路展示与展开` and `线路延迟展示`. Independent counts: 25 scenarios in `specs/magpie-line-selection/spec.md` + 16 in `specs/dsh-magpie-connector/spec.md` = 41; test-plan has exactly 41 `| specs/...` rows; the two scenario-title sets are identical (no missing, no duplicate, no extra row).

## Findings

### 🔴 Critical (blocking)

None. Re-verified the four historical failure modes from ground truth rather than from the prior review's claims:

- **Trust boundary / GET-only is real, not asserted by fiat.** `createSharedFetchHandler` routes only when `route.methods.has(request.method)`, otherwise falls to the shared-channel interceptor and finally `new Response("not found", { status: 404 })` (`node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:607-624`); `assertFetchRoute` only rejects empty/duplicate methods (`:758-762`), so `methods:['GET']` is legal. Canal `FetchRegistration.methods` is already typed `('GET'|'POST')[]` (`src/host/routes.ts:49`), so the fourth resource needs no type widening.
- **Measurement cannot reach selection.** `runtime.config()` is `loadConfig().lines` only (`src/host/runtime.ts:511`), `probePort` has no cache of its own (`src/host/selection.ts:35-55`), and the caches live inside `LineSelector` (`:77+`). A controller built on `config()` can neither read nor write them.
- **Dependency plan is executable as written.** Installed `@deepseek-ai/dsh-client-ui-primitives` is `0.2.0-rc.2` (`node_modules/.../package.json`), exports exactly `IconChevronUpOutlineRegular`, `IconChevronDownOutlineRegular`, `IconTrashOutlineRegular`, `IconTriangleRightFillRegular` and `Tooltip`; `dsh.yaml:5` pins `dshVersion: 0.2.0-rc.2`; `tsdown.config.ts` already externalizes `@deepseek-ai/*`; `auto-model-routing` imports primitives at client module top level (`src/client/index.ts:11,13`) **without** listing it in `dsh.client.inject`, so the plan needs no inject change; `ws promote` precedes the edit (`design.md:150`).
- **All four user constraints still covered**: collapsed-by-default with new/first-line expansion and no collapse-on-save incl. new-id / reorder-before-save (`specs/magpie-line-selection/spec.md:67-125`, `design.md:36-50`), always-on DSH product icons (`:69`), one measure per open with `measuring` placeholder then point-in-time readings (`:127-199`, `dsh-magpie-connector/spec.md:95-131`), still one anvil change (`.openspec.yaml` `schema: anvil`).

### 🟡 Moderate

None. Two candidates were considered and deliberately kept non-blocking:

- The stale "自动选择规则 is untouched" bookkeeping after the D2 decline (Suggestion 1 below): the normative text is self-consistent and the merge source is the delta, so this is documentation drift, not an implementable-behaviour defect.
- `线路测速资源接口` still states the harness seam inside the requirement (`dsh-magpie-connector/spec.md:97`). Round 3 asked for exactly that, and the "POST → 404" half is production-true per the dispatch code above; no test has to fake a plugin-local 404.

### 📌 Suggestions

1. **D2's kept MODIFIED block is still unbookkept in proposal/design (round-4 Suggestion 1, unapplied).**
   - Evidence: the delta modifies `自动选择规则` (`specs/magpie-line-selection/spec.md:33-37`), but `proposal.md:24` enumerates the modified `magpie-line-selection` requirements without it, and `design.md:21` lists "线路 schema / 凭据 / 自动选择规则变更" as a Non-Goal. `specs/magpie-line-selection/spec.md:175` also still quotes the retired wording 「只有一条完整线路时不探测」, which no longer exists verbatim at `:35`.
   - Why: an archiver reading proposal+design concludes canonical `自动选择规则` is untouched while the merge will edit it; the quote at `:175` is then unmoored.
   - Fix: one bullet in `proposal.md:24` ("修改「自动选择规则」：把「SHALL NOT 探测」限定为「为选择目的」，行为不变，消除与线路测速的字面冲突"), reword `design.md:21` to "不改自动选择行为（仅收窄措辞）", and make `:175` quote the new sentence. Same pass: `design.md:48` and `:99` cite "本轮 review 的 finding 3 / 2", which is meaningless once archived — replace with the substance.

2. **Changing the info icon's `aria-label` breaks the existing selector, and only the `title` assertion is planned.**
   - Evidence: today the icon is `aria-label: '线路优先级说明'` (`src/client/SettingsPage.ts:260`) and `test/line-silent-ui.test.tsx:41` selects it by that exact value; `design.md:72` replaces the whole value with the five-item `INFO_TEXT`. `proposal.md:31` / `design.md:135` only say the `title` assertion needs syncing plus "补一条 `aria-label` 断言".
   - Why: the test fails on a missing node before any new assertion runs, and the cheap "fix" (keep the short name) violates `specs/magpie-line-selection/spec.md:13,25`.
   - Fix: pin a stable anchor in D9 (`.dmg-info`, or `[title^="线路按序号"]`) and state that the accessible name becomes the full `INFO_TEXT` while both attributes are asserted through the new anchor.

3. **The latency-silence baseline names only the save banner, but a line save also re-reads usage, which renders its own `role="status"`.**
   - Evidence: `specs/magpie-line-selection/spec.md:31` says "除保存成功本身已有的 `<p role="status">已保存</p>` 之外…不新增…". A `{lines}` write is an `identityWrite` (`src/client/SettingsPage.ts:77-78`) → `clearUsage()` → `UsageStatus` renders `<p role="status">正在读取用量…</p>` (`:169`), or the persistent empty hint. A literal status-node diff fails on correct code.
   - Fix: widen the baseline to "除保存成功与用量重读本身已有的状态提示外" or compare the *set* of status nodes before/after the failed re-measure.

4. **The collapse half of the toggle and the icon-on-a-collapsed-row case are still unasserted (round-4 Suggestion 4).**
   - Evidence: `specs/magpie-line-selection/spec.md:69` requires "点击该控件 SHALL 切换展开/收起" and "点击操作按钮 SHALL NOT 改变展开状态"; the only toggle scenario (`:109-113`) expands once and then clicks 上移 on an *expanded* row. `onToggle` is `current === draftId ? null : draftId` (`src/client/SettingsPage.ts:265`), so a regression that only ever re-expands would pass.
   - Fix: add "再次点击切换控件 → `data-expanded="false"`" and one click on 上移 in a collapsed row, both one-liners in `test_line_expand_toggle`.

5. **Unsaved-draft rows have no `data-line-id`, and one scenario says "重新读取设置" where the client only commits the POST view (round-4 Suggestion 5).**
   - Evidence: row root emits `'data-line-id': draft.id` (`src/client/SettingsPage.ts:286`), so a new draft row is unaddressable by id, yet scenarios `specs/magpie-line-selection/spec.md:85-107` locate it; `:124` says "保存成功并重新读取设置" while `mutateSettings` commits the POST response and the only `GET settings` is the mount effect (`:57-67`, `:77-88`).
   - Fix: pin the draft locator in D9 (`.dmg-line:last-child` / 「（未保存）」 or a `data-draft` hook), and change `:124` to "保存成功并刷新设置视图" (`:95` is already worded that way).

6. **The action-icon clauses in the requirement have no assertion anywhere in the 41 rows.**
   - Evidence: `specs/magpie-line-selection/spec.md:69` requires the up/down/delete buttons to be 常驻 (not hover-gated), each with an accessible name (`aria-label="上移线路 2"`), and disabled ones to state the reason. No scenario or test-plan row asserts an `aria-label`, a disabled reason, or that the buttons exist on a collapsed row.
   - Why: user constraint (2) is "always-visible action icons"; a hover-only or unlabeled regression passes all 41 mapped tests. jsdom can at least pin "rendered while collapsed" + the accessible names; true visibility belongs to preview.
   - Fix: extend `test_line_expand_toggle` with `[aria-label^="上移"]` presence on a collapsed row and a disabled-reason check (e.g. line 1's 上移 contains 「已是第一条」), and note the visual half for `verify.md`.

7. **One scenario's THEN mixes a client observation with a host observation, but maps to a pure UI test.**
   - Evidence: `specs/magpie-line-selection/spec.md:177-181` THEN "客户端只发出一次 `GET latency`；host mock 观察到对前三条线路地址各一次连接尝试…" is mapped to `packages/dsh-magpie-connector/test/line-latency-ui.test.tsx :: test_line_latency_scope_ui` (`test-plan.md:28`). A jsdom test injects `fakeApi` (`test/client-support/fake-api.ts:6-16`); it cannot observe TCP connections to the three line addresses.
   - Why: the implementer will either assert on a hand-written fake (tautology) or discover the gap mid-task. Real connection observation already exists at the transport layer (`test/line-transport.test.ts:89`, to be extended per `tasks.md:42`).
   - Fix: say in the test-plan row that the UI test owns "one `GET latency` + a reading for the key-less line" and that the connection-count half is delegated to `test_line_transport_06` / `test_latency_*`.

8. **A1's surviving isolation clauses are vague enough to be unassertable as written.**
   - Evidence: after removing the duplicate `测速失败不阻止页面其余功能`, isolation survives only as "线路与用量区域不受影响" (`specs/magpie-line-selection/spec.md:163`), "页面其余功能（设置、用量、线路操作）正常" (`:169`) and "页面其余部分正常渲染" (`:151`). `tasks.md:51` (5.4) does not mention asserting isolation at all; it appears only under 5.6's silence test.
   - Why: the cut is sound (the remaining scenarios do cover the 500/404 → `failed` + `idle` behaviour), but "不受影响"/"正常" cannot be written as a THEN without picking concrete nodes, which is exactly where a regression (e.g. latency failure unmounting the lines block) would slip through.
   - Fix: name the nodes, e.g. "两张 `[data-line-id]` 卡片与 `[aria-label="用量"]` 节点仍在、`data-usage-state` 不变", and mention the isolation assertion in 5.4 rather than only 5.6.

## A1–A3 Verification

- ✅ **A1 — duplicate failure scenario removed, coverage kept.** `测速失败不阻止页面其余功能` is gone from both delta specs and from proposal/design/test-plan/tasks (the only remaining hits are review-round*.md history and Suggestion 8 above), and `测速请求失败静默降级为破折号` (`:159-163`) asserts the same 500/network-error → `failed` + 「—」, empty-address → `idle`, no new `role=alert/status`/`aria-live`, and isolation. `旧 host 没有 latency 资源时静默降级` (`:165-169`) keeps the 404 path. No test-plan row and no tasks line references the removed title; scenario↔row count is 41↔41.
- ✅ **A2 — `measuredAt` fully dropped and every artifact agrees.** Zero hits for `measuredAt` in any change artifact (proposal/design/specs/test-plan/tasks) or in the package source/tests; the only mentions left are review history and this review. Response shape is `{lines: [{id, ms}]}` in `proposal.md:14`, `design.md:99` (`ms: number|null`), `specs/dsh-magpie-connector/spec.md:97`, `test-plan.md:43-44` and `tasks.md:32`; `design.md:99` records why ("不该被 UI 或测试消费的时间戳不放进响应"). The single-flight scenario now asserts "每条线路只出现一次 TCP 连接尝试；两次响应状态都是 200 且 `lines` 相同" (`:119`) with `tasks.md:35` and `test_latency_single_flight`, so no assertion silently lost its evidence.
- ✅ **A3 — planned `line-expand-ui.test.tsx` merged, no reference survives.** Zero hits for `line-expand-ui` in any change artifact or in the package (only review history and this review name it). All nine `线路展示与展开` scenarios map to `test/line-active-ui.test.tsx` (`test-plan.md:14-22`), tasks 3.1/3.4/3.7/3.10 write into the same file, and `test-plan.md:51` states the merge explicitly ("就地扩写…不再新开一个同构文件"). No test-plan row names a file or test that cannot exist: the five existing files/ids exist (`line-active-ui`, `line-silent-ui`, `line-selection`, `cards-render`, `line-transport`), the planned ones (`latency.test.ts`, `line-latency-ui.test.tsx`, `primitives-stub.ts`, `expandLine`) are listed in tasks 1.3/4.1/5.1/6.4, and every `test_*` id used in tasks exists in the plan.

## D1–D5 Consistency Check (declined lean suggestions)

- ✅ **D1 (no inline SVG copy)** — no requirement constrains icon provenance; `design.md:81` records the rejection reason (decoupling + art attribution + no-vendor rule) and `proposal.md:29-30` pins peer/dev + vitest alias + tsdown externals + `ws promote`. `THIRD-PARTY-NOTICES` only enumerates vendored code, so importing icons adds no notice obligation — consistent with declining the copy.
- ⚠️ **D2 (keep MODIFIED `自动选择规则`)** — the normative text is correct and self-consistent (`specs/magpie-line-selection/spec.md:35-37`: "SHALL NOT 为选择目的发起探测" + measurement delegated to `线路测速范围与独立性`; all four canonical scenario titles preserved verbatim against `openspec/specs/magpie-line-selection/spec.md:115-143`), but the scope bookkeeping in `proposal.md:24` / `design.md:21` still claims the rule is untouched, and `:175` quotes the retired wording. See Suggestion 1; not a contradiction in the normative text itself.
- ✅ **D3 (keep 4-bar meter)** — the spec mandates `data-latency-level` 0–4, per-level colours and `aria-hidden` bars (`specs/magpie-line-selection/spec.md:129-139`), `design.md:105-113` defines thresholds/tokens, and user constraint (3) asks for the FPS-style meter; nothing in the plan proposes plain ms text.
- ✅ **D4 (keep single-flight + dispose abort)** — `specs/dsh-magpie-connector/spec.md:113` requires "同一时刻 SHALL 最多只有一组测量" and dispose to abort hanging measurements; `design.md:97,119-120`, `tasks.md:35-39` and rows 45–46 all keep them. No artifact mentions dropping them.
- ✅ **D5 (info icon hover-only + `tabIndex` + full `aria-label`)** — `specs/magpie-line-selection/spec.md:13` ("hover 时显示说明文本，键盘聚焦时 SHALL 通过可访问名称提供同一说明") and `:25` (`title` **and** `aria-label`) match `design.md:72` exactly; no `:focus` tooltip or second visual affordance is promised anywhere.

## Embedded-Instruction / Injection Attempts

**Detected:** none

Scanned proposal.md, design.md, both delta specs, test-plan.md, tasks.md, canonical specs and the source/test excerpts. Only normative spec prose, code, and UI copy are present; the info-icon string and latency labels are UI descriptions, not instructions to an agent, and no file asks the reviewer to skip, approve, or run anything.

## Verdict

VERDICT: APPROVE

## Required Changes (if APPROVE WITH CHANGES)

none

CHANGES_APPLIED: n/a
