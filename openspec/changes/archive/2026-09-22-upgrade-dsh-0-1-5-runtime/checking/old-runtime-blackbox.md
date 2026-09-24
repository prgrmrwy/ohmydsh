# Old Runtime Black-Box Baseline

Environment: task-local `DSH_HOME`, profile `web`, `DSH_SKIP_UPDATE=1`, and an OS-assigned non-production port. The existing local 3080 Host and GUI were not touched.

- `@deepseek-ai/dsh@0.1.2-rc.1 --profile web --help`: exit 0; official web flags include `--host`, `--no-open`, `--port`, and `--trusted-host`.
- `--profile web --dump-config`: exit 0; the composed loader manifest was captured only as a summarized, non-secret list.
- `--profile web --port 0 --no-open`: Host started on a random loopback port and printed its tokenized URL. The process emitted the expected cost-meter and Pet startup diagnostics, then was terminated with SIGTERM and was no longer running.
- Pet's old-runtime baseline explicitly reported inquiry and independent-continuable-child seams unavailable; this is a known current baseline condition, not an upgrade pass.

Automated package checks are recorded in `baseline-0-1-2.md`. Manual/GUI scenarios not covered by this run are Worktree first-send, Session cold resume, Memex UI, guard UI, clock UI, session-links/title/provider-icon UI, Cockpit, remote Web features, and Feishu entry/media flows. Those remain required target-runtime/devbox scenarios.
