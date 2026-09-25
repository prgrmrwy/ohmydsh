# Live Jev acceptance

Date: 2026-09-25

## Runtime surface

After the user configured a replacement TypeSafe key outside chat and restarted the existing Host, the ordinary Agent's latest v3 request header contained 50 tools, including all ten `mcp__jev__jev_*` tools. Both required routing tools were present:

- `mcp__jev__jev_classify`
- `mcp__jev__jev_decide`

The router skill and all nine upstream spec-superflow skills remained present. Exact Jev, bridge, spec-superflow, and skill-provider package checks and both generated insertion rows remained healthy.

The readiness script originally required the probing shell to see `TYPESAFE_API_KEY`, even though credentials correctly belong to the restarted Host and the worktree shell need not inherit them. That produced a false-negative `liveProbeReady:false` alongside authoritative positive request-header evidence. The probe now treats the post-restart ordinary-Agent tool surface as the readiness authority while continuing to report credential-presence booleans and `valueInspected:false` diagnostically.

## Privacy-bounded live calls

Only closed enum, numeric, boolean, candidate-name, fixed-description, and fixed-requirement fields were sent. No user prose, conversation, source, diff, path, URL, email, identifier, attachment metadata, credential, or raw provider error was sent or retained in evidence.

### Classification

`jev_classify` (`model=jev-latest`, `provider=typesafe`) returned a structurally valid complete distribution:

- formal-workflow: 0.68
- direct: 0.28
- manual-review: 0.04
- confidence: 0.52
- winner margin: 0.40
- decision: review

The configured thresholds were 0.85 probability and 0.50 margin, so the conservative policy correctly retained `needs-review` rather than treating this result as executable.

### Workflow decision

Because classification selected formal-workflow, `jev_decide` ran over only the eligible formal subset. `spec-superflow` was excluded because the current managed Worktree Session has no external mechanical firewall for upstream `isolate`/`finish`.

The typed response selected `standard-openspec`:

- standard-openspec: 0.93
- anvil: 0.05
- none: 0.01
- investigate: 0
- ask_user: 0
- confidence: 0.91
- escaped: false

All three requirements for `standard-openspec` were `supported`. Total usage across both calls was 2,189 input tokens and 363 output tokens.

## Shadow record and authority

One normalized local record was written and retrospectively labelled from the existing change authority:

- status: needs-review
- recommendation: standard-openspec
- actual route: standard-openspec
- override source: existing-change
- normalized error: none

The recorder retained no raw provider response. The existing OpenSpec change remained `spec-driven`. The Jev result did not create a change, select/change a schema, invoke spec-superflow, apply work, merge, archive, clean, or otherwise alter control flow.
