# Cross-platform launcher — current delivery

## Owner decision

User chose to keep external cockpit/PWA UI integration pending and receive the current result. No requirement waiver or full Anvil acceptance was requested. No further desktop operation, archive, deployment, merge or cleanup is authorized. This is the requested implementation/evidence handoff, not a Windows full-support announcement.

## Delivered

Four-stage migration implemented: equivalent Bash extraction and frozen oracle; shared/atomic contracts; one Node .mjs implementation with zx limited to fixed scripts; root npm bin/link and thin POSIX compatibility entries. Native variable argv remains shell:false. Strict literal env parsing, native process ownership, bounded startup, explicit Windows termination, portable package lifecycle and exact D8 script/rollback/lock policy are included.

Whole-range local source review PASS after repairs; prior independent focused reviews cover D8 and macOS path/ownership fixes. Latest reviewed code/config/test snapshot103 paths SHA256c7fb2efdc440707f5048c0de65d6a8244d538e71b717f4fb3f055f0a486a9788. Code remains uncommitted in ws/win; no merge or cleanup.

## Verified evidence

- Linux final root598tests/596pass/0fail/2existing MCP skips; artifact/strict/diffPASS.
- Native Windows updated root lane96/96,0skip (ordinary PATH); earlier separate noBash61/61 and lifecycle evidence retained, not conflated.
- Windows latest full manifest build×2/nochange/doctor/dumpPASS; real Host56083/PID31216 survives launcher exit and CLI stop/emptyPASS. Earlier human-assisted true terminal close retained.
- macOS root597/595/0/2 before last Windows-only cleanup repair; final lifecycle8/8. Latest full manifest build×2/nochange/doctor/dumpPASS; real Host59409/PID38545 survives launcher exit and process-only stop/emptyPASS. RealPTY close evidence retained. Existing3080 remains18148; dirty existing checkout unchanged.
- Exact standalone MCP bridge2/2,0skip; does not relabel root invocation skips. Pet typecheck/build/tests exit0,3432pass/8opt-in skips. Twelve affected workspace build/typecheck/test command checks previously36/36exit0.

## Pending, explicitly not passed

- Actual interaction with existing external dsh-cockpit PWA and Chrome target-port tabs; no PWA created/installed. Current approval keeps it pending, not waived.
- Strict Anvil zero-skip/historical RED receipts: missing historical receipts cannot be recreated as genuine history. Root2skips and package8opt-in skips are disclosed. ShellCheck unavailable; configured CI/Node22/24 matrix not observed running here.
- Current spec sync/archive and controlled version finish remain future steps after acceptance and explicit authorization.

## Boundary correction

Earlier Mac CLI stop --no-open attempted AppleScript same-port tab cleanup; diagnostic app=false/tabs=true does not prove any actual tab closed. Native lifecycle/root suites also use fixture CLI stop and may have attempted per-port cleanup. Claims of no desktop operation were corrected; effects remain unknown. New real-Host runner uses process stopServer only and does not rerun desktop operations. See desktop-boundary-correction.md; do not treat this as UI acceptance.

## Resume checklist

1. Obtain explicit permission and known existing cockpit/PWA target before desktop integration; never infer from HOME isolation or --no-open.
2. Resolve historical/zero-skip/ShellCheck completion treatment through explicit owner decision and proper reviewed artifacts, not checkbox inflation.
3. Reconcile final task ledger and current specs only under the required workflow. Canonical verify remains DECISION: FAIL.
4. Ask separately before deployment/restart/commit/merge/archive/worktree cleanup. Keep all runtime generations until separately authorized cleanup.
