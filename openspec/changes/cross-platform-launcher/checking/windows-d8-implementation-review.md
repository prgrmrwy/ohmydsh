# Windows D8 implementation review

VERDICT: REVISE

What this change does: D8 replaces blanket npm script approval with a repository-owned exact-version policy. It adds recoverable Windows pointer publication, keeps immutable generations, and extends the Host preparation lock through final runtime reads.

## Scope and evidence boundary

Reviewed the uncommitted D8 patch against [design D8](</openspec/changes/cross-platform-launcher/design.md#L78-L99>), [the delta spec](</openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md#L119-L138>), and [the approved planning follow-up](</openspec/changes/cross-platform-launcher/checking/windows-d8-planning-review.md#L49-L75>). Also read the manifest, proposal, D8 tasks, current runtime-provisioning spec, all named implementation/test files, connected supervisor/package-manager/server-bin/launcher consumers, nested builder, and pinned local npm policy implementation. Assumed cooperating concurrent builders and callers, plus explicit filesystem/configuration failure cases required by D8—not a malicious process with unrestricted ability to mutate arbitrary application files.

The parent changed product/test files during this review. Findings below bind to the inspected snapshot, not to later repairs. The complete publisher reproduction snapshot had Git blob hash `795a9af149d55033868507a339ed1ee81a0fe7a3` (69 lines). The final read at approximately 02:49 America/New_York showed identity variables being added, but the rollback condition still checked only the link target. A focused follow-up must inspect finished repairs rather than treating this report as approval of concurrent edits.

Only this report was written by this reviewer. No installation, network, native-platform execution, Host execution, script permission grant, product edit, or plan edit occurred. Checks were static inspection, `git diff --check`, JavaScript syntax checks, and read-only Node probes using the pinned npm resolver or an in-memory filesystem. Every executed check completed successfully; the probes intentionally demonstrated the defects below. No test suite was independently rerun by this reviewer.

## Must fix

### 1. Important — POSIX restore failure leaves no recovery backup or residual gate

**Evidence:** [publisher rollback](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L34-L67>), [residual gate](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L7-L18>), [D8 recovery contract](</openspec/changes/cross-platform-launcher/design.md#L84-L97>), [normative backup requirement](</openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md#L123>).

- **What this is:** POSIX atomically overwrites the old active symlink. Unlike Windows, it keeps the old target only in memory and creates a restoration link after verification fails.
- **Problem:** If publication succeeds, verification rejects the candidate, and creation of the restoration symlink fails, there is neither a saved old pointer nor any previous/next/restore residual. The thrown aggregate error tells the operator to preserve a backup that never existed. The next locked invocation accepts the failed candidate as a normal publication state, despite the promised recovery-failure gate.
- **Concrete reproduction:** With the real helper and an in-memory filesystem, begin with old `/virtual/.launcher -> /virtual/old`; publish `/virtual/new`; throw `verification rejected`; fail the second `symlinkSync` with `restore symlink denied`. The helper reports both errors but leaves only `.launcher -> /virtual/new`. Calling `assertPublicationState` immediately afterward succeeds (`NEXT_CALL_GATE_ACCEPTS_FAILED_PUBLICATION`). No disk was written and no installer or runtime was executed.
- **Smallest fix:** Preserve a proven old-pointer recovery artifact before POSIX replacement without introducing an active-pointer gap. Restore from it on failure; if restoration fails, retain it and report its actual path. Add failure injection for restore-link creation and restore rename, then assert the next invocation refuses and both generation contents survive.
- **If skipped:** An unsuccessful publication loses its recoverable pointer state and silently bypasses the agreed next-call recovery boundary. POSIX atomic visibility alone does not satisfy rollback safety.

### 2. Important — rollback proves a target string, not ownership of the current link

**Evidence:** [target-only comparison and destructive rollback](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L27-L64>), [D8 changed-link rule](</openspec/changes/cross-platform-launcher/design.md#L95-L96>), [planning follow-up](</openspec/changes/cross-platform-launcher/checking/windows-d8-planning-review.md#L61-L65>).

- **What this is:** Rollback may unlink only the link created by this attempt. A different filesystem entry is not owned just because its destination string is equal.
- **Problem:** `sameLink` checks symbolic-link type and normalized target only. If a failed verification encounters a replacement symlink to the same candidate target, rollback deletes that replacement, restores the old pointer, and removes the backup instead of preserving unknown state and reporting recovery failure. The same target-only rule also governs cleanup of `next`.
- **Concrete reproduction:** The real helper with an in-memory filesystem creates old link id 1 and candidate link id 2. During `verify`, replace the active link with id 3 pointing to the same candidate, then throw. The observed outcome is old link id 1 restored, id 3 deleted, no backup residual, and only the original verification error. Distinct identity is deliberately supplied by the fixture; no filesystem race is needed to reproduce the wrong ownership decision.
- **Smallest fix:** Record non-following identity for the links this invocation creates and require both identity and target agreement before removing or overwriting them. Unknown replacements must survive with the old backup and both errors. Add a same-target/different-identity replacement test, not just a different-target test. At the final read, `sameIdentity` and `publishedIdentity` had been introduced but were not yet used by the rollback guard; that unfinished edit is not evidence of repair.
- **If skipped:** Rollback overwrites an entry it cannot prove it owns, contrary to the explicit fail-closed contract. This is a filesystem ownership/spec defect, not a claim that unrestricted external file mutation can be fully prevented.

## Should fix before D8 acceptance

### 3. Important — subprocess test bypasses the production lock-lifetime integration

**Evidence:** [stubbed preparation test](</tests/dsh-host-runtime.test.mjs#L135-L157>), [manual inheritance test](</tests/dsh-host-runtime.test.mjs#L159-L181>), [production preparation](</scripts/lib/dsh-host-runtime.mjs#L139-L189>), [required integrated evidence](</openspec/changes/cross-platform-launcher/design.md#L99>), [approved follow-up](</openspec/changes/cross-platform-launcher/checking/windows-d8-planning-review.md#L55-L59>).

- **What this is:** The critical regression was an outer preparer holding a lock while waiting for a builder that did not receive the new owner's token. The approved test must cover the real preparer, supervisor, nested lock users, and final reads together.
- **Problem:** The subprocess test acquires the lock directly and manually constructs the correct token overlay, then runs two inline lock consumers. It never calls `prepareDeclaredHostRuntime` or its default runner. It therefore still passes if production preparation omits its token overlay, releases before final reads, or breaks failure cleanup. The separate preparation test uses a runner stub and checks the lock during its two runner calls, not a competitor through the final fingerprint read. Prior-token restoration and builder/probe/fingerprint failure cleanup are not asserted.
- **Smallest fix:** Add one isolated fixture invoking the actual preparer with an independent env copy and its real bounded runner. Fixture builders can be inert and use the real lock module. Coordinate a competitor through the final physical-path/version/fingerprint phase, and check lock release plus prior-token restoration for builder, probe, and fingerprint failures. Assert the returned physical bin remains usable after a later pointer switch. No real installation or Host execution is needed.
- **If skipped:** Passing counts do not establish the specific concurrency/deadlock acceptance contract. Static inspection shows the intended overlay and `finally`, but cannot substitute for the explicitly approved integrated regression.

## Findings repaired during review / positive checks

- **Earlier npm context escape repaired in the live patch.** Initially, inherited `npm_config_global=true` or `location=global` caused pinned npm to skip root `package.json#allowScripts` and use user/global npmrc grants instead. A read-only call to the pinned resolver demonstrated a user-config `unreviewed@1.0.0` becoming `true`. The later [policy helper](</packages/dsh-pet/compat/subagent/compat-script-policy.cjs#L1-L18>) forces `--global=false --location=project` and removes context selectors from the environment. A second read-only probe against npm's actual `global` getter returned false with these flags; unrelated registry/userconfig values survived sanitization. This earlier defect is **not** an outstanding blocker in the final observed policy helper. Effective npmrc regression evidence for those final bytes still needs to be collected by the parent.
- [The repository policy](</packages/dsh-pet/compat/subagent/install-script-policy.json>) contains only two exact `false` entries and no new execution grant. [The builder](</packages/dsh-pet/compat/subagent/build-launcher.cjs>) removes blanket approval, verifies exact cache policy before graph execution, fingerprints all new helpers/policy, uses the sanitized supervisor environment for npm checks, and no longer performs keep-two generation garbage collection.
- [The supervisor boundary](</packages/dsh-pet/compat/subagent/compat-run.cjs#L11-L20>) supplies the sanitized environment to the supervisor itself, so [the supervisor's overlay](</scripts/lib/run-bounded.mjs#L40-L45>) does not resurrect stripped keys.
- [Runtime preparation](</scripts/lib/dsh-host-runtime.mjs#L139-L189>) refuses inherited caller ownership, explicitly forwards the acquired token, returns the physical bin, and holds the owned lock through version/fingerprint checks. [The server-bin protocol](</scripts/dsh-server-bin.mjs#L71-L84>) and [launcher consumer](</scripts/launcher/main.mjs#L89-L111>) preserve that returned path rather than rebuilding a `.launcher` alias after unlock. No additional ordinary-path deadlock was found in this source inspection.
- [Publication tests](</tests/compat-launcher-publish.test.mjs>) were expanded during review to inject create-next/backup/publish/cleanup failures. Existing cases cover Windows restore failure, dangling/residual refusal, empty startup and four retained generations. They do not cover the two publisher defects above.
- Earlier [Windows npx cache-default repair](</scripts/lib/dsh-cli.mjs#L62-L71>) and [verifier `createRequire` path repair](</packages/dsh-pet/compat/subagent/verify-isolated-loop.mjs#L3-L17>) are narrow and consistent with their consumers. No material additional defect was found there. This is not a new native execution result.

## Verification accounting and conclusion

Native 15/15, Linux 15/15, the hostile-npmrc offline denial probe, and the earlier root source-regex correction were supplied by the parent as existing context, not independently executed here. Tests changed during review, so those counts must not be relabeled as coverage of the final patch. Fresh root rerun was pending at delegation; no later result is asserted by this report. The source-only syntax and whitespace checks passed on the inspected bytes.

**Verdict: fix findings 1–3, then perform one focused follow-up on the settled patch.** No broader implementation redesign or new script grant is requested. D8 patch approval would still not imply whole-change/native Windows support or authorize a real Host run.

Not checked: installation, live npm execution, fresh root regression, native Windows/macOS behavior, real Host lifecycle, and deployment. Generation retention intentionally accepts disk growth until separately authorized cleanup exists.

## Focused implementation follow-up — settled D8 repairs (2026-10-25)

FOLLOWUP_VERDICT: REVISE

What this change does: The settled repairs preserve a POSIX recovery symlink before replacing the active pointer, add identity checks to active-pointer rollback, and exercise the actual preparer with its default supervisor runner and inert nested builders. These close the original POSIX backup defect and most of the integration gap. Two narrow parts of findings 2 and 3 remain; the original findings and verdict above are preserved as historical evidence.

### Finding 1 — resolved in the inspected implementation

[The POSIX publication path](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L36-L45>) creates `.previous-*` before atomically replacing the active pointer. [Rollback](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L54-L64>) restores with a backup rename, not a newly created restore link. Restore failure retains the backup and both errors; the residual gate blocks another invocation. [The new POSIX failure test](</tests/compat-launcher-publish.test.mjs#L77-L91>) passes independently. This fixes the former no-backup restore-link-creation failure without introducing an active-pointer gap.

### Finding 2 — Important, partially repaired: next-pointer cleanup still lacks identity proof

- **What this is:** [Active rollback now checks identity and target](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L45-L55>), and [the same-target active replacement test](</tests/compat-launcher-publish.test.mjs#L59-L75>) passes. However, [cleanup of `next`](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L66-L68>) still uses only the target string.
- **Problem / concrete case:** Run the real helper with an in-memory filesystem. After it creates next link identity 2, replace that entry with identity 3 pointing to the same candidate while injecting failure in the Windows old-pointer backup rename. Cleanup deletes identity 3, throws only the original backup error, and leaves no residual. A subsequent `assertPublicationState` accepts. This is the same ownership failure already included in original finding 2, now limited to the staging pointer; no unrestricted adversary or real disk race was required.
- **Smallest fix:** Record the created next link's non-following identity and require both identity and target before unlinking it. An unknown replacement must remain as a residual with an aggregate cleanup error. Add a same-target/different-identity staging replacement regression, including the next-call refusal assertion.
- **If skipped:** Failure cleanup still deletes an entry it cannot prove this attempt owns, contrary to [the stage-failure rule](</openspec/changes/cross-platform-launcher/design.md#L94-L96>). The new active-pointer guard does not cover this second destructive path.

### Finding 3 — Important, partially repaired: final-read lock coverage is still untested

- **What this is:** [The new integration test](</tests/dsh-host-runtime.test.mjs#L184-L214>) genuinely calls `prepareDeclaredHostRuntime` without a runner stub. Its copied environment carries a spoofed prior token; the real supervisor, inert builder and nested lock user must inherit the actual owner token. It checks success plus builder/version-mismatch/fingerprint failures, outer-lock release, and restoration of both process and caller environment. All these checks pass independently.
- **Problem / concrete case:** The only competitor runs [inside the version script](</tests/dsh-host-runtime.test.mjs#L191>), before [the final generation/fingerprint reads](</scripts/lib/dsh-host-runtime.mjs#L174-L176>). A review-only in-memory mutation inserted `lock.release()` immediately before those final reads; the entire new integration test still passed, including all four outcomes. No product or test file was changed for this mutation check. Thus the test name overstates its final-read coverage. Production source itself still correctly keeps these reads in the `try` before `finally`; this is an explicit regression-evidence gap, not a newly observed production early unlock.
- **Smallest fix:** Add a deterministic observation/challenge at the actual final fingerprint read, so the premature-release mutation fails. Also switch the publication pointer after a successful prepare and assert that the returned physical entry remains usable, as required by [the original follow-up request](</openspec/changes/cross-platform-launcher/checking/windows-d8-implementation-review.md#L45>) and [the physical-generation scenario](</openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md#L135-L138>); currently the test checks path equality but never performs that later switch.
- **If skipped:** The integrated test can stay green if the outer lock is released after the probe but before fingerprint selection, exactly the boundary [D8 requires it to cover](</openspec/changes/cross-platform-launcher/design.md#L99>).

### npm policy follow-up — source inspected only

[The offline probe](</openspec/changes/cross-platform-launcher/checking/npm-exact-policy-verification.mjs#L28-L41>) now supplies hostile project/user/global npmrc entries for global mode, location, allow-scripts, blanket approval, ignore-scripts and strict=false, and hostile blanket-approval environment input. It applies [the policy helper's project-mode flags and environment sanitizer](</packages/dsh-pet/compat/subagent/compat-script-policy.cjs#L1-L18>). Its source still tests registry-version matching separately from strict offline file-tarball denial, rather than mislabeling the file source as an exact registry denial. No new policy defect was found in this focused inspection. The installer/probe script was **not executed** under this review's restrictions, so this is not an independently observed effective-npmrc pass or a script grant.

### Independently executed checks and snapshot binding

- Bounded pure tests: `node --test --test-timeout=20000` on [publication tests](</tests/compat-launcher-publish.test.mjs>), [policy unit tests](</tests/compat-launcher-policy.test.mjs>), and [preparation tests](</tests/dsh-host-runtime.test.mjs>): **19/19 pass**, zero failures/skips. These launch only isolated Node fixture children/supervisors; they do not install or start a real Host.
- The in-memory publisher reproduction above completed and asserted `sameTargetReplacementDeleted=true`, `nextResidualPreserved=false`, and next-call gate acceptance.
- The in-memory early-unlock mutation above completed: the new integrated test remained **1/1 pass**, demonstrating the missing final-read assertion.
- `git diff --check` passed. Reviewed Git blob hashes: publisher `692734dabc530294b5bde671fcf5c13ee2066a17`; preparation tests `06842cd5ecd4e6fd59e69b0983319917617cbaec`; publication tests `f8bb23b2857c599e19f469d3c43601671ed3da85`; offline policy probe `b21825fd8bdb5232862b7468f30f11dcaf5331fc`.

**Verdict: finish the next-pointer identity guard and the final-read/returned-path regression assertions, then re-review those focused repairs.** Only this report was edited. Not checked or authorized: installation, npm/probe-script execution, network, script grants, native Windows/macOS execution, full root regression, deployment, or real Host lifecycle. This is a focused implementation review, not whole-change acceptance or platform/Host approval.

## Final focused implementation follow-up — frozen repairs (2026-10-25)

FINAL_FOLLOWUP_VERDICT: PASS

What this change does: The final repairs prove ownership before staging-pointer cleanup and challenge lock ownership at the actual final physical fingerprint read. The successful preparation fixture also runs its unchanged returned physical entry after repointing `.launcher`. **Accepted focused repairs:** no remaining blocker was found in the requested remaining parts of findings 2 and 3. The original and first follow-up verdicts above remain historical; this does not expand acceptance scope.

### Finding 2 — resolved, including staging-pointer identity

[The publisher](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L31-L52>) captures `nextIdentity` immediately after creation and before backup/handoff. [Failure cleanup](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L75-L80>) requires both target and non-following identity before unlinking `next`; an unknown same-target replacement is retained and reported as recovery failure. [The regression](</tests/compat-launcher-publish.test.mjs#L59-L79>) replaces next with a distinct same-target symlink during failed Windows backup, asserts the replacement survives, and checks subsequent publication refuses the residual. It passes independently.

[Published-pointer rollback](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L60-L73>) and [backup checks](</packages/dsh-pet/compat/subagent/compat-publish.cjs#L38-L56>) retain identity-plus-target guards. The earlier finding 1 repair remains intact: POSIX creates the on-disk previous-pointer backup before atomic replacement and renames that backup for restoration, retaining it on restore failure. These are conservative ownership checks within the previously stated cooperating-caller/failure-injection boundary, not a claim of protection against arbitrary unrestricted filesystem mutation.

### Finding 3 — resolved at final fingerprint read and after pointer switch

[The integrated fixture](</tests/dsh-host-runtime.test.mjs#L184-L214>) invokes the actual preparer without a runner override. Source tracing confirms [the production preparer](</scripts/lib/dsh-host-runtime.mjs#L133-L189>) uses [the default bounded runner](</scripts/lib/dsh-cli.mjs#L99-L121>) and [real supervisor](</scripts/lib/run-bounded.mjs#L40-L45>); inert builder and nested lock consumers must inherit the newly owned token despite the independent environment copy carrying an untrusted prior token.

[The deterministic fs hook](</tests/dsh-host-runtime.test.mjs#L198-L212>) uses `syncBuiltinESMExports` to intercept the preparer's read of the selected physical generation's fingerprint. At that exact read it asserts the outer lock exists and an independent competitor times out. The test requires the hook to be reached for success and fingerprint failure, and [checks release plus prior-token restoration](</tests/dsh-host-runtime.test.mjs#L226-L237>) for success, builder failure, version-probe mismatch and invalid fingerprint. This closes the specific final-read regression gap; production still keeps those reads before its `finally` release.

[The success branch](</tests/dsh-host-runtime.test.mjs#L215-L225>) repoints `.launcher` to another generation, then executes the unchanged `result.bin` with the inert fixture's `--usability-probe` and requires its success marker. This now demonstrates usability after pointer change rather than path-string equality alone. No actual DSH Host is executed.

### Independent verification and mutation checks

- Bounded pure tests: `node --test --test-timeout=20000` on [publication tests](</tests/compat-launcher-publish.test.mjs>), [policy unit tests](</tests/compat-launcher-policy.test.mjs>), and [preparation tests](</tests/dsh-host-runtime.test.mjs>): **20/20 pass**, zero failures/skips, Node `v24.20.0`, exit 0. Only isolated Node fixtures and supervisors ran; no install or real Host ran.
- Review-only in-memory early-unlock mutation: a `registerHooks` loader inserted `lock.release()` immediately before the final generation/fingerprint reads. The focused integration test now **fails**, at its fingerprint hook's lock-presence assertion (line 204). The harness required that nonzero result and completed successfully. This specifically reverses the first follow-up's false-green mutation result.
- Review-only in-memory target-only cleanup mutation: a loader removed only the next-pointer identity condition. The same-target next-replacement test now **fails**, at its required recovery-failure assertion (line 76), because the defective variant throws only `backup interrupted`. The harness required that nonzero result and completed successfully. Neither mutation changed any product or test file.
- `git diff --check` passed before and after the report append; the four inspected source hashes were unchanged on final recheck. Frozen inspected Git blob hashes: publisher `1ef0f0d5bf549da24f28ad4cd033c303142c6a64`; publication tests `9a081bf5580e94cd224ce41475dc7f4d743dacf7`; preparation tests `425eef799171f558b847461568984ef35369b92a`; production preparer `cac2290f44acb36daa603f72c2c3d42bb551b644`.

**Verdict: accepted focused repairs.** No new implementation scope or script grant is requested. Only this report was edited. Not checked or authorized: installation, npm/offline-probe-script execution, network, native Windows/macOS execution, full root regression, deployment, or real Host lifecycle. This is not full D8/whole-change/platform acceptance and does not authorize those operations.
