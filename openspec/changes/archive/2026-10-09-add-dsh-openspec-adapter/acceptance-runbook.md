# Remaining real acceptance — add-dsh-openspec-adapter

Status: WIP, not acceptance evidence. Round18 semantic audit reopened10 implementation tasks: **180/194 tasks checked,14remaining**. Repair Important findings IR18-ROUTE/DIAG/INIT in implementation-review.md before final live acceptance; the original14 live/final tasks remain. Latest implementation must be deployed before any live surface conclusions. User selected corp-mac-vm's real main profile, not an isolated/replacement server; report that override explicitly rather than editing approved design/specs to disguise it.

## Prerequisites and limits

- User is repairing VM DNS. Do not modify DNS/proxy settings or retry deployment until they confirm repair.
- Last proven VM state: clean detached de0b93d, real Host PID41466 port3080, HTTP401 authentication reachable, active d9734b69dff2e2f9b6b50a9b official1.13.2. Reinspect dynamic facts before use.
- Task branch push authorized; main merge/archive/cleanup not authorized.
- Source-build hardlinks can update existing deployed JS before new files arrive. No restart until full sync succeeds. If offline deploy fails, restore known-good source/build via authorized launcher procedure, not deployed-file surgery.
- Real model-session method remains undecided: API fixture sessions with explicitly mounted normal preset versus user-operated GUI. Automatic goal rounds do not authorize either model traffic or disabling main profile.
- Disable test separately needs explicit consent; user asked why it was necessary but did not consent. It checks approved reversible removal/no unrelated byte changes, not network repair.

## Deployment and repeated sync (10.2)

1. Read-only registry HTTPS and GitHub task fetch verify with bounded timeouts. No credentials output.
2. Confirm clean VM source and task branch identity. Switch from detached known-good to authorized task branch; ff-only update. Do not change main.
3. Run sync to completion with actual integrity/install checks before DSH restart; record normalized summaries, exit code and intended local package refresh. No bypass, --reset, cache surgery or replacement profile.
4. Run sync again; must report no changes. Keep10.2 pending on any failure.
5. `dsh stop` then `DSH_SKIP_UPDATE=1 dsh --no-open` to avoid unrelated version changes. Verify stable listener and authenticated GUI via user or approved transport. HTTP401 proves reachability only, not UI/Skill acceptance.
6. Inspect actual deployed dependency graph. Main Pet launcher previously resolved dsh-tool-skill0.1.5-rc.3 despite declared Hostrc.2; byte-identical caller behavior passed diagnostic but identity discrepancy is not silently accepted.

## Cross-workspace discovery and caller cwd (9.1–9.3)

- Obtain authorized interactive method. Use real normal sessions A and B in distinct temporary workspaces, normal preset actually mounted (meta.agentPreset alone does not mount tools).
- Both discover managed Skills and opsx commands without project-local skill duplication. List must not request updates.
- Invoke init/Skill/workflow in B and verify durable session.header.cwd controls target; only fixture projectB may change for any separately approved action, never Host cwd/projectA.
- Header cwd fix now has real CommandService integration regression, but not actual main GUI/session proof.
- Record body+block parity, old alias absence, official workflow optional-branch selection, local project override winner if applicable. Keep raw prompts/events/screenshots out of Git.

## No-provider request headers (9.7–9.12)

- Capture baseline and adapter-enabled actual request/header tools and guidance for each producible ordinary/subagent/fork/Pet/Locus kind only with approval.
- No OpenSpec routing tool, provider guidance or fabricated default formal decision. Compare normalized header sets exactly against relevant baseline (account only intended Skill catalog changes).
- Non-producible kinds remain explicit named gaps, not vacuous passes. Do not start an unauthorized Pet task or model call to manufacture coverage.
- Contract registry unit tests and fixture caller modules do not count as header-level evidence.

## Reversible disable (9.13–9.15)

- Obtain explicit permission to toggle only adapter manifest entry and sync/restart main profile.
- Snapshot hashed unrelated managed files and adapter journal/generation/reference state; no secrets/raw file contents retained.
- Disable through source manifest then sync; native Skill/commands and managed references gone, unrelated bytes identical. Generations/cache/journal retained, no purge.
- Restore exact prior source switch, sync and approved stop/start; surface returns, old healthy generation retained. Record any unrelated sync changes as failure/investigation rather than auto-accepting them.

## Final acceptance (10.3)

Fresh full repository+package tests, build/typecheck/artifacts/strict validation; full-range local implementation review against merged-main base c9e927e5af93ee6122ff401942fc26489391c494 (include every adapter repair, don't use HEAD~1). Reconcile all59 scenario rows with actual tests, don't blindly trust historical green flags. Resolve critical/important findings first. Only then mark tasks and verify PASS; no archive/merge without user authorization. Goal complete only with whole-objective evidence.
