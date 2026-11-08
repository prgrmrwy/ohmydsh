# Verification — 2026-11-08

## Delivered behavior

Plugin 0.2.0 shows the Host-resolved remote path for each produced file, copies it, opens that path in the editor, and requests a browser download through the official Session file reader and fileActions owner. Native paths are passed as strings; bytes are not text-decoded and unknown MIME is left empty so PDF/ZIP suffixes survive the official filename policy. Busy operations cannot duplicate, and Session changes cancel unfinished reads.

The Host baseline now shares the existing first-party mutation parser with the live transcript when Agent-scoped tool presenters are unavailable. Only successful completed calls are included. This restores the existing intended file set rather than adding a new discovery vocabulary.

## Passing checks

- `npm test --workspace dsh-sidebar-session-resources`: **89 passed** across eight files, including DOM interactions, actual Panel Session switching, scoped service proxies, binary preservation and the published official browser save implementation.
- `npm run typecheck --workspace dsh-sidebar-session-resources`: passed.
- `node --test tests/local-package-peers.test.mjs`: **14 passed** after aligning the runtime interval and explicit prerelease peer tail. DSH 0.2.2-rc.1 is required by the fileActions dependency.
- `dsh build` twice on the final source: passed; the second run explicitly reports **no changes**.
- `openspec validate sidebar-resources-file-download --strict`: passed.
- Main specs validation: 55 passed, zero failed; pre-existing long-requirement/placeholder warnings remain elsewhere.
- Tracked artifact policy and diff whitespace checks passed before closure; generated outputs are not committed.

## Whole-repository result

The first `npm test` run reported 777 cases: 772 passed, three failed, two skipped. Two failures were this change's runtime compatibility declarations; they were corrected and the affected 14-case suite passes. The remaining failure reproduces independently in the unchanged `tests/launcher-session-restart-detach.test.mjs:49`: `systemctl --user kill --signal=SIGKILL <fixture-scope>` returns status 1 instead of 0. Its POSIX fallback passes. No restart implementation or test was changed for this unrelated failure. The entire slow suite was not rerun after the focused compatibility repair.

## Browser evidence and activation boundary

An authenticated Chromium instance opened the existing daily GUI, confirmed the new resources client bundle was served, opened the current Session and reached the Docs/Resources panel. The live Host's baseline returned links but no produced files: its old extractor depends on unavailable Host tool presenters. That observation led to the shared-parser Host fix and its regression test.

The Host baseline fix was built and deployed before the separately authorized restart. The restart receipt subsequently reached ready at 2026-11-08T04:55:36Z. End-to-end path copy specifically through the workbench's historical-produced-files list was not separately repeated after activation; its parser and lifecycle behavior remain covered by the passing tests. The workbench picker additionally required pane focus before its programmatic click during automation; no third-party workbench code was modified.

The requested official conversation-card extension has separate, passing live verification on the existing GUI without restarting: an authenticated Chromium page loaded the new bundle and found four delivery cards with four download buttons. A real DOCX downloaded from its card while Host desktop availability was false; downloaded bytes exactly matched the Host original, its Chinese filename and .docx suffix were retained, the card's independent preview button remained present, and there were no client page errors. The card action resolves the official declaration directly and does not depend on the historical-output baseline.

The live check first caught a missing Cordis remote.workspaceFiles injection. The plugin now declares the required services and uses its own injected Context for both card and workbench file operations; the regression fixture enforces those service declarations. A second apparent filename failure was isolated to headless Chromium's inherited POSIX locale: even a plain Blob download in an empty page turned a Chinese name into `download`. Launching the verification browser with LANG/LC_ALL=C.UTF-8 preserved the exact Chinese name in both the empty-page control and final actual-card check. No product naming workaround or core patch was introduced.

## Review

Reviewed all changed source, package/manifest/lock metadata, tests and specification deltas. Confirmed Session identity on both metadata and byte reads, no new Host filesystem endpoint, no external file transfer destination, no guessed local download path, and cancellation independent of Cordis proxy identity. Known limits: official complete-read cap defaults to 32 MiB; no directory archives or bulk downloads. Implementation was committed as f0249381. A subsequent Cockpit iframe-only download failure was isolated to its missing allow-downloads sandbox token and repaired in the Windows Cockpit repository as 35e9310, with 161 Web tests, typecheck, lint and production build passing. The user confirmed the final Cockpit download workflow works after refreshing the shell and authorized archive and push. Current specifications already contain the delta requirements; archive therefore skips reapplying them.
