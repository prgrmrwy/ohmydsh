# macOS desktop boundary correction

## Finding

The separately authorized Mac scope excluded actual desktop/PWA/browser operations. `--no-open` suppresses opening only. The production `doStop` still calls `closeUi`, and on Darwin that always invokes bounded same-port Chrome AppleScript cleanup independently of server-match and opener settings, as required by the approved compatibility spec.

The earlier full-profile Host test (bash-537) called CLI stop with --no-open. Therefore earlier summaries asserting no desktop operation were inaccurate. Bounded inspection of existing logs (without querying the desktop) found `UI cleanup app=false tabs=true port=50939`. This proves the cleanup subprocess reported success, not that Chrome was running, that tabs existed, or that anything closed. No PWA quit was recorded. Actual desktop effects are unknown. It is not real UI acceptance and must not be treated as authorization for more desktop tests.

The real macOS lifecycle suite also calls fixture CLI stop. Its temp home avoids normal PWA discovery, but `CLOSE_TABS` addresses the current user's Chrome independently of HOME. Thus earlier native lifecycle/root invocations may also have attempted same-port tab cleanup for their fixture ports. Current review does not reconstruct closed tabs or query the user's browsing state. Reports of those tests remain valid for process behavior, but their scope statement must include the incidental cleanup attempts.

## Correction

- Corrected preflight/verify records and directly disclosed the issue.
- Updated only the acceptance runner Host cleanup to call `stopServer` at the process layer, preserving before/after identity and empty-port assertions.
- New receipt marker explicitly says PROCESS_ONLY_STOP. It is not a complete real macOS CLI stop/UI acceptance.
- No product change suppresses the approved stop cleanup behavior, no new CLI flag is invented, and no acceptance criterion is waived.
- Do not rerun real macOS CLI stop/restart or lifecycle/root suites without isolating the AppleScript execution boundary or obtaining the separate desktop permission. Direct process tests/PTY cleanup use process-layer stop and are distinct.

## Follow-up evidence

Round14 bash-623 completes isolated build1/build2, second-build no-change assertion, doctor and dump, then real Host start on port59409, samePID38545 after launcher exit and process-only stop with empty-port proof. All stages0. No new dependency script permission, PWA install, real CLI stop or desktop cleanup in this follow-up. Existing dirty checkout and3080 remain outside the test scope.

This correction concerns test execution authority and evidence accuracy, not a new product defect. The product's stop behavior is explicitly required; HOME isolation by itself is not desktop isolation.
