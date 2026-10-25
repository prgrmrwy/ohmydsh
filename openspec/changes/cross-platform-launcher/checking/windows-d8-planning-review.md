# Windows D8 focused planning review

VERDICT: REVISE

Scope: D8 planning only. This is not patch approval, a rerun of the original Anvil review, whole-change acceptance, or native-platform evidence. Only this report was written; product code and the original review were not changed.

What this change does: D8 replaces blanket npm script approval with an exact repository policy. It permits rollback-safe, non-atomic Windows pointer publication and requires callers to consume immutable physical generations. These user-approved choices are sound; three operational contracts need to be made explicit before implementation.

## Must fix — concrete planning blockers

### 1. Define lock inheritance across the Host caller and builder chain

**Evidence:** [D8:80–82](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L80-L82), [runtime preparation:131–167](/home/prgrmr/opensource/ohmydsh/.worktrees/win/scripts/lib/dsh-host-runtime.mjs#L131-L167), [lock inheritance/acquisition:31–56](/home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/compat-build-lock.cjs#L31-L56), [nested builder:75–76](/home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/build.mjs#L75-L76).

- **What this is:** The caller will acquire the same lock already acquired by both builders. Existing re-entry works only when the live owner's token reaches the descendant environment.
- **Problem:** Acquisition currently writes `DSH_PET_COMPAT_BUILD_TOKEN` into `process.env`, while runtime preparation passes its independent `env` argument to the runner. With `env = { ...process.env }` captured before acquisition, adding the planned outer lock without an explicit token overlay leaves the parent waiting for its builder and the builder waiting for its live parent. The inherited handle's release must also remain a no-op, not release the outer owner's lock.
- **Smallest planning fix:** Specify one lock acquisition around build plus physical-path/version/fingerprint reads, forwarding the acquired token after merging the supplied environment through supervisor → launcher builder → nested builder. Release only the owned handle in `finally`; do not leak the temporary token into the returned Host environment. Keep direct builder invocation supported.
- **Required evidence:** Add a bounded subprocess test with an explicit environment copy, the real inherited-lock seam, and a nested builder. Assert no deadlock, a competing publisher stays excluded through the final read, and builder/probe/fingerprint failures release the outer lock. A runner stub alone cannot prove inheritance.

### 2. Specify interrupted publication and rollback-failure states

**Evidence:** [publication requirement/scenarios:123–138](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md#L123-L138), [D8 publication design:82](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L82), [current publication/catch:436–480](/home/prgrmr/opensource/ohmydsh/.worktrees/win/packages/dsh-pet/compat/subagent/build-launcher.cjs#L436-L480).

- **What this is:** Windows needs separate old-pointer backup and new-pointer publication operations. The shared lock hides the gap from cooperating live readers, not from a later process after interruption.
- **Problem:** The plan promises recovery and preserved backups but does not say what happens after termination between those operations, or when removing the new pointer/restoring the old pointer fails. A subsequent builder could see no active pointer, or a failed candidate plus an orphan backup, and publish again without recognizing unfinished recovery. The current catch assumes replacement rename works, and uses `existsSync`, which cannot distinguish a missing pointer from a dangling link; those assumptions must not define the new helper's recovery contract.
- **Smallest planning fix:** Add a short state table for absent/verified-old/verified-new pointers, dangling links, unknown files/directories, and leftover backup/next entries. Use non-following entity classification. For each mutation failure and interruption, specify which pointer may be removed or moved, which backup remains, and whether the next locked invocation restores a uniquely proven old pointer or refuses with actionable recovery instructions. Either conservative recovery choice is acceptable; guessing among backups or recursively deleting link targets is not. Define the supported legacy-directory case or explicitly reject it.
- **Required evidence:** Map failure injection before/after each handoff step, post-publication verification failure, restoration failure, and next-call handling of interrupted states. Include no-old-pointer startup and dangling/unknown entities. Assert both generation contents survive, recovery failure stays nonzero, and POSIX keeps atomic replacement without an introduced visibility gap.

### 3. Make repository policy authoritative over npm configuration, not just environment variables

**Evidence:** [policy design:80](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L80), [policy requirement:121](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md#L121), inspected local npm 11.19.0 [strict preflight:5–18](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/checking/baselines/npm-policy/package/lib/utils/strict-allow-scripts-preflight.js#L5-L18) and [configuration definition:2375–2387](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/checking/baselines/npm-policy/package/node_modules/@npmcli/config/lib/definitions/definitions.js#L2375-L2387).

- **What this is:** Exact `allowScripts` plus strict preflight is the approved execution boundary. Explicit `false` entries deny only their matched version; they are not new execution grants.
- **Problem:** Removing the named environment variables and passing `--strict-allow-scripts` does not neutralize a user/global npm configuration containing `dangerously-allow-all-scripts=true` or `ignore-scripts=true`. npm explicitly lets both override strict checking. The former permits forbidden scripts; the latter suppresses the required unknown-version failure and can produce an incomplete graph.
- **Smallest planning fix:** Require effective install and cache-verification settings to force strict mode on and both bypasses off, independent of npmrc sources, while preserving unrelated registry/auth configuration. Reject unsupported policy keys and values before npm runs. Keep cache checks read-only: exact policy equality plus fingerprint invalidation, never approve/prune/repair approvals on a cache hit.
- **Required evidence:** Add isolated user/global npmrc fixtures alongside mixed-case environment fixtures. Prove an unknown script still rejects with no sentinel execution, an exact denial remains denied, a newer version does not inherit that denial, and altered/extra cached approvals reject cache reuse. No new `true` permission is authorized by this review.

## Accepted direction / non-blockers

- Proposal, design and delta spec consistently preserve POSIX atomic replacement and explicitly do **not** promise Windows atomic visibility.
- Physical generation consumption is correct: resolve once under the shared lock, derive the bin, version probe and fingerprint from that same generation, then return its real entry. The later launcher must not re-follow `.launcher`.
- Retaining every published generation is the right safety choice without leases. Remove the existing keep-two cleanup during implementation; test retention across at least three publications and a failed publication, including an already-returned old entry. Disk growth is an accepted trade-off, not a reason to add automatic GC.
- Policy/helper fingerprinting and exact cache-policy verification are required in the plan. Add the negative cases above to the current three broad D8 test mappings and tasks; historical GREEN rows do not cover D8.

## Review boundary

Static inspection only. No installation, network, Host start, native Windows/macOS execution, or product tests were performed. No new execution permission was granted. Existing implementation differences are cited only to expose planning seams, not reported as evidence that the unimplemented D8 patch failed. After these three planning amendments, perform the focused follow-up review before implementing D8; full regression and native acceptance remain later gates.

## Focused follow-up — revised D8 planning (2026-10-25)

FOLLOWUP_VERDICT: APPROVE

What this change does: The revised D8 now defines the three previously missing operational contracts. This follow-up accepts that planning only; the original `VERDICT: REVISE` above remains the historical verdict on the earlier text. No implementation, whole-change, or native-platform approval is implied.

### 1. Owned token and lock lifetime — resolved in planning

[Design D8:82](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L82) explicitly overlays the current owner's token onto the supervisor/builder environment, rejects reliance on a caller's earlier environment copy or injected token, and specifies propagation through the nested builder. Its `finally` contract restores the prior process environment and releases only the lock owned by this invocation. Together with [the locked final reads:84](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L84) and [the normative token requirement:123](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md#L123), this closes the stale-env deadlock and ownership ambiguity from blocker 1.

[Design D8:99](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L99) requires real subprocess inheritance through the supervisor and both builders, an independent env copy, competitor exclusion until the final fingerprint read, and failure-path release. [Task 12.4](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/tasks.md#L209) and [the physical-generation test mapping](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/test-plan.md#L61) remain unimplemented acceptance work. They must demonstrate the stated contract, including prior-token restoration and no owned token leaking into the returned Host environment; this review does not claim those outcomes have been tested.

### 2. Interrupted publication and recovery failure — resolved in planning

[The lstat state/failure table:86–97](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L86-L97) distinguishes absent and verified-old pointers, dangling links, files, real directories including legacy directories, and previous/next/restore residuals. It chooses the acceptable conservative recovery policy: any residual blocks the next locked publication and requires explicit human recovery, rather than guessing or cleaning automatically. Only a proven current-attempt link may be removed during rollback; unknown replacements are not overwritten, generation targets survive, and recovery failure retains both errors and the backup. Even backup-cleanup failure after successful verification stays nonzero and leaves the residual gate active. [The spec:123](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md#L123) makes interrupted-state refusal normative; POSIX atomic replacement remains unchanged.

[Design D8:99](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L99), [task 12.3](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/tasks.md#L208), and [the publication test mapping](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/test-plan.md#L60) retain failure injection, restoration failure, interrupted residuals, no-old-pointer startup, unknown/dangling entities, generation retention, and POSIX non-regression as later evidence, not already-passed checks.

### 3. Effective npm policy and supervisor environment — resolved in planning

[Design D8:80](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L80) now requires explicit `--ignore-scripts=false --dangerously-allow-all-scripts=false --strict-allow-scripts=true` for authoritative effective settings despite user/global/project npmrc bypasses. It also requires case-insensitive environment cleanup and forbids the supervisor from resurrecting removed keys by overlaying the original process environment. Cache verification must use the same policy, while unrelated registry settings remain intact. [The spec:121](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/specs/cross-platform-launcher/spec.md#L121) states the same boundary. No new `true` permission is granted.

[Design D8:99](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/design.md#L99) requires isolated npmrc and mixed-case env fixtures, rejection without script sentinel effects, version-specific denial behavior, and refusal of extra cached approvals. [Task 12.2](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/tasks.md#L207) and [the policy test mapping](/home/prgrmr/opensource/ohmydsh/.worktrees/win/openspec/changes/cross-platform-launcher/test-plan.md#L59) remain RED pending. Their eventual implementation evidence must exercise the effective subprocess environment, not only a sanitizer stub.

### Follow-up boundary

No remaining planning blocker was found within these three issues. The broad D8 test-plan rows and tasks are read together with the explicit cases in design D8:99; historical GREEN rows are not evidence for them. This permits implementation of the revised D8 plan, not installation, a Host run, added script grants, or a Windows support claim. Review used local planning documents only. No product code was inspected for verification, no tests or installation ran, and no network, Host, or native-platform operation was performed. Only this report was edited.
