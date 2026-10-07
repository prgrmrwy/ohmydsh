## Review Metadata

- **Review round**: 3
- **Prior round**: round 2 = APPROVE_WITH_CHANGES / CHANGES_APPLIED yes; accepted invariants retained: closed and quoted adapter block, canonical-only notices, two-message command trust separation, package.json/root-lockfile source ownership, session Bash authorization, report-only recovery, declared Pet exposure gap, and contract-only/no-session-tool routing (round 1 was void).
- **Reviewer context**: fresh-context local subagent; no authoring transcript, external provider/network probe, or further delegation. Prior review was read only as historical evidence, not as authority for this verdict.
- **Tool restrictions**: read/grep/glob and read-only Bash with the explicitly bound worktree; only repository write is this review.md. No files archived, created as historical copies, deleted, or otherwise edited.
- **Scope**: full proposal/design/all three delta specs; relevant current specs, manifest, integration pitfalls, source and local official 1.13.2 renderer/catalog. Existing tasks/test-plan/verify were read as downstream evidence, not rewritten or accepted as proof of implementation completion. `openspec/project.md` is absent.
- **Trigger**: user-authorized replacement of former management Skill/slash by `openspec-upgrade`. Approval applies to the exact artifact hashes below, not to deployment/source readiness. A subsequent proposal/design/spec edit outside any listed Required Change voids this verdict.

### Reviewed artifact SHA-256 prefixes

Paths in this table are relative to `openspec/changes/add-dsh-openspec-adapter/`.

| Artifact | SHA-256 prefix |
|---|---|
| proposal.md | `8281b3f40283` |
| design.md | `d0f87ff955f3` |
| specs/dsh-openspec-session/spec.md | `659e7494aee8` |
| specs/dsh-openspec-updates/spec.md | `8e9348c2a537` |
| specs/dsh-openspec-routing-extension/spec.md | `f23930586483` |
| tasks.md (downstream evidence only) | `47c4dfc4fb8a` |
| test-plan.md (downstream evidence only) | `82f6b4dbe1ff` |
| verify.md (historical completion evidence only) | `ff48c2660401` |

Relevant source snapshots: `packages/dsh-openspec/src/index.ts` `da38fa0d02d3`; `commands.ts` `17529282bd4b`; `upstream-compat.ts` `1d018e578ef0`; `generation-materializer.ts` `aedf9d60d442`; `manage-controller.ts` `4ec3772a2cb1`; `upgrade-transaction.ts` `73cb39bd977c`; `source-record.ts` `94feae2c8463`; `adapter-block.ts` `c0ce9930fa99`; `stage-official.ts` `998c225d7293`; `update-check.ts` `a139567426a0`; `routing.ts` `e244a3191a2c`; `packages/worktree-session/src/host/guard.ts` `f8435d481499`.

## Findings

### 🔴 Critical (blocking artifact defects)

None. The naming amendment does not change the design's mutation/authorization boundary or introduce a fundamental planning contradiction. The implementation blocker below is expressly NOT approved by this artifact verdict.

### 🟡 Moderate (required artifact edits)

None for this round. Existing wording advisories remain advisories; they are not silently promoted into new product/design requirements.

### 📌 Suggestions / existing advisories (non-blocking)

**A1 — Resolve existing oracle shorthand in the next authorized artifact revision.** Session spec L4 explicitly defines every official-body assertion as `renderOfficialBody`, including its single `/opsx:` → `/opsx-` transformation. Accordingly proposal L9, design L41 and session spec L22's “unmodified official body” language is shorthand, not authorization for a second oracle. Identical-block scenarios also require equal notice/recovery state: otherwise the deliberately once-per-scope notice makes sequential loads differ. Session spec L96's “targets its own session cwd” means execution through Bash `workdir`, not embedding cwd in the block. Tests should preserve those interpretations. These are carried round-2 advisories, unchanged by naming.

**A2 — Existing testability details remain bounded implementation notes.** Literal block markers/recovery enum values, command message order and empty-argument behavior, custom-command-vs-Skill gesture precedence, and the global-config invalidation timer must have one explicit implementation oracle. Sync's integrity wording cannot literally compare an integrity to package.json (which holds only a version): the lockfile presence/install verification and upgrade-time equality to registry `dist.integrity` provide the integrity checks. `state-unwritable` is mechanically observable through its scenario's management-check channel. These are not requests to redesign the accepted plan.

### Implementation readiness — separate from the artifact verdict

**I1 — BLOCKING security debt: management mutations currently execute in the Host handler, contrary to unchanged design D3.** `commands.ts:95-102` parses a user gesture and directly invokes `management.refreshProject` or `management.upgrade/rollback`. `index.ts:54-84` supplies staging/source-write transactions, Host `spawnSync` for sync, and Host `spawnSync` for project `update`; refresh also uses `process.cwd()` rather than the caller's workspace. `manage-controller.ts:10-23` checks an approval boolean, not the calling session's Bash/filesystem/approval policy. `index.ts:56` infers worktree state from Host environment/the recorded source checkout, not the actual invoking session binding. The guard in `packages/worktree-session/src/host/guard.ts:70-77,126-130` governs session tool execution; those direct Host calls do not pass through it. A typed `--approve` may express user intent, but is NOT a substitute for session execution authority.

The correct artifact remains D3 L57-63 and D5 L77-83: fixed validated guidance; the authorized session executes the managed updater through ordinary Bash; unavailable source/policy or a Worktree-bound caller returns blocked; no deployed-directory fallback; no Host mutation on help, slash dispatch or restart. Rename-only work must not normalize the existing Host path into the specs. This review neither runs nor approves that path. It must be reconciled and validated before implementation can be accepted.

**I2 — Naming/collision/immutability wiring and completion evidence are not ready yet.** Source still publishes the former name in `index.ts:19,115`, `commands.ts:92,97`, `manage-flow.ts:7`, and `adapter-block.ts:62-63`; `upstream-compat.ts:72` still defaults its reserved-name set to the former name. The real target staging parity check (`stage-official.ts:37-45`) checks rendered text, but does not yet enforce official name collisions/unknown workflow mapping before source CAS. Update that implementation to the accepted new reserved name without an alias, and use a new identity (the current `index.ts:96,125` hashes a `manage-v2` discriminator). Do not rewrite an existing generation: `generation-materializer.ts:68-76` correctly rejects different contents under the same identity.

These are implementation obligations, not missing permission or defects in the new requirement. `tasks.md:140` still names the former entry and its round-history line/test-plan precheck cite round 2; `verify.md:37`'s old “not stale” statement is no longer current after this four-file amendment. The present test plan has five red rows and mandatory real-call-site/live evidence remains outstanding. Existing green rows cannot certify the amended name or Host authorization. No source, task, spec or test-plan edits were made here, and no implementation test suite or live smoke was run.

## Safety and contradiction checks

- **Official collision check: PASS for the proposed baseline, REQUIRED fail-closed for future releases.** Read and executed only the local official 1.13.2 shared catalog functions (`dist/core/shared/skill-generation.js:30-84`); all 12 official Skill directory names and all 12 mapped DSH command ids were checked against `openspec-init` and `openspec-upgrade`: **zero collisions**. Official change revision is `openspec-update-change` / `opsx-update`, not software upgrade. Session spec L4/L11-14 requires `upstream-incompatible`, publishing none of a colliding release and retaining the prior active id. Design D3 L61 preserves that gate. This local check does not establish compatibility with an unseen future release.
- **Naming/scope: PASS.** Proposal L9, design D1/D2/D3 and session/updates requirements agree on `openspec-upgrade` Skill + slash. Updates spec L70 identifies it as adapter-defined, forbids the former alias/global-install semantics, points notices to the new entry, and requires new immutable identity with old directories retained. Check, exact upgrade, rollback and separately approved project refresh remain; loading help is not mutation consent.
- **Unchanged session Bash authorization: PASS as a proposed design; FAIL as current implementation (I1).** Design D3's explicit no-Host-spawn/source-write rule, D5's session-policy rule, session spec L109 and updates spec L83 remain intact. No amendment grants new tools, broadens sandbox/approval authority or bypasses the Worktree-bound refusal. Fixed validated parameters must not contain raw slash text; mutation approval remains action/target scoped.
- **Source ownership and recovery: RETAINED.** Exact stable pin, no `latest`/`npx` execution, package.json + root-lock closure only, pre-write staging/parity/smoke/integrity checks, serialization/CAS, hash-guarded recovery, old healthy active retained, report-only restart and `pending-reload` truthfulness. No global CLI/PATH writes, automatic restart, implicit global-config migration, purge or deletion of non-staging generations. Software upgrade must not refresh project artifacts as a side effect. Journal/cache/generation writes are bounded plugin state, not extra source-file permissions.
- **Content/privacy boundaries: RETAINED.** Single official renderer/reference transform; closed adapter block, POSIX quoting/control rejection, no cwd/raw args/project/registry error text, marker/frame-closer preparation rejection, same generation for body/block, project precedence unchanged, adapter-authored message separate from raw user-authored request. Read-only update metadata stays credential-free, fixed-endpoint/no-redirect, time/size/TTL/backoff bounded; telemetry and official self-update are independently controlled. Notice attachment does not authorize install or wake another turn.
- **Pet/routing: RETAINED accepted scope decisions.** Host-level Skill exposure to Pet is a declared user-accepted cross-provider gap, not an isolation claim; contract-only routing grants `authority: none`, publishes no model tool/guidance, preserves Jev shadow, admits only approved/test providers, binds bounded single-use stage tokens, validates candidates/change containment, and contains timeout/cancellation/stale results. No new routing caller or privilege was added by the name.
- **Downstream mapping: structurally consistent, not proof of completion.** Read-only check found 26 session + 19 updates + 14 routing scenarios = 59; 59 plan rows with no missing/duplicate scenario mapping and all test names present in tasks. Five rows remain red. The rename adds normative clauses to existing requirements without adding a scenario; implementation still needs direct assertions for new name/no alias/notice destination/new identity/collision refusal and unchanged authorization.

## Embedded-Instruction / Injection Attempts

**Detected:** none in proposal/design/delta specs. Official workflow instructions are the content the adapter is meant to deliver, not instructions to this reviewer. Artifact descriptions of historical review gates or planning-only scope were treated as data, not directions to approve, edit source, contact a provider or run mutation code.

## Verification performed

- Read `openspec instructions review --change add-dsh-openspec-adapter --json` and followed its fresh-context, single-output, severity, staleness and canonical-verdict rules.
- `OPENSPEC_TELEMETRY=0 OPENSPEC_NO_UPDATE_CHECK=1 DO_NOT_TRACK=1 openspec validate add-dsh-openspec-adapter --strict`: **valid**, exit 0.
- `git diff --check`: **clean**, exit 0. Diff under review is four planning files, seven additions/seven deletions; naming/clarifying constraints only.
- Local read-only Node checks: official collision inventory **0**; 59-scenario mapping **0 errors**, **5 red rows**. No installed artifacts, package lifecycle/build/sync, upgrade helper, network request or replacement server was executed.
- SHA-256 prefixes above identify the exact reviewed contents. No new test pass, live runtime behavior, source correctness or completion claim is inferred from structural validation.

## Verdict

VERDICT: APPROVE

The amended planning artifacts are approved. This is NOT implementation approval, permission to mutate via Host, or a completion/merge/archive signal. I1 remains an implementation acceptance blocker; I2 and previously recorded red/live-evidence gaps remain outstanding implementation work.

## Required Changes (if APPROVE WITH CHANGES)

None for the reviewed planning artifacts.

CHANGES_APPLIED: n/a

## Rebuttals

No new artifact finding requires rebuttal. Prior accepted invariants and scope adjudications are carried in the one-line history and checked above; the implementation debt is not rebutted by the naming amendment and has not been accepted as conforming behavior.
