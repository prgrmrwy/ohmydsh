# Local affected workspace verification

## Scope

Automatic goal continuation after the read-only dependency script review. PC/devbox target confirmation and exact-version script-denial approval remain pending; no remote connection, profile policy change, dependency installation, full-manifest retry or production restart was performed in this round.

Current local environment is the existing managed Linux worktree, not the requested devbox. Results must not be relabeled as devbox or native Windows.

## Checks

- Mechanical test-plan audit: exactly47 rows; every referenced file exists and its exact test name is present. This checks mapping only, not real-platform success.
- `node --check scripts/test.mjs`, `node --check scripts/launcher/main.mjs`, `git diff --check`: exit0.
- Root npm bin metadata agrees between package.json and root lock; zx remains exact8.8.5. Root lock SHA256 remains `dc1f87d3b8531a54fd0544e8d8b37502022b4e0ca2855f937fa342ff977f64d6`, matching the recorded native candidate. A preliminary HEAD diff check was nonzero because the authorized migration lock is intentionally uncommitted; follow-up diffstat/hash confirmed no new dependency change.

## Workspace command scope

Run existing `npm run build`, `npm run typecheck`, `npm run test` for each of these twelve changed workspaces, sequentially under its exact package cwd: sidebar-session-provider-icon, worktree-session, cockpit-memex-browse-shim, session-title-copy, collab-kernel, sidebar-session-resources, home-network-model-guard, system-clock, dsh-openspec, dsh-memex, cockpit-worktree-open-shim, dsh-pet.

Before executing a package build, resolve its absolute cwd to the expected worktree package root and reject a symlinked lib clean target. No dependency installation or profile sync occurs. Standard ignored package build output may be regenerated.

Execution job `bash-322` completed and was collected: **36/36 commands exited0** (twelve workspaces × build/typecheck/test). Every row reports signal:null; no spawn error or nonzero command was observed. This is command-level evidence, not a fabricated aggregate of individual test-case counts. It closes the local affected-workspace command gap only; it does not satisfy devbox, native-platform surface or full-manifest gates.

## Follow-up acceptance-harness repair

Source review found that the gate executed build-2 without asserting its no-change report. Added a small pure assertion and wired it into the driver. The test fails against an exit-code-only skeleton (Missing expected exception) and then passes with the real sync marker; nonzero/empty/changes-applied/contradictory output are rejected. Targeted gate/acceptance tests2/2, syntax/diff/strict checks pass. This changes no script policy and runs no full build. Goal rounds1–3 still lack the requested devbox connection/PC target confirmation and separate exact-version policy authorization; those are not inferred from automatic continuation.
