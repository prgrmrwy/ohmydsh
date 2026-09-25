---
name: jev-workflow-router
description: Observation-only Phase-1 shadow routing for the already-reached decision whether work should stay direct or use a formal workflow. Auto-apply only after the agent has independently reached that workflow decision point; never use it to detect intent, replace ordinary reasoning, or interrupt the user.
whenToUse: The agent has independently determined, using the conversation and existing project rules, that it must now decide whether to continue directly or enter a formal planning/change workflow. Do not apply for ordinary explanation, research, or implementation steps that have not reached that decision.
---

# Jev workflow router — Phase 1 shadow only

This skill observes a decision that the agent already had to make. It never makes that decision authoritative and never adds a new decision point.

## Non-negotiable Phase-1 boundary

- Keep the actual control flow exactly as it would have been without this skill.
- Never create a change, select or change a schema, invoke `ssf`, start apply/implementation, mutate files, authorize tools, reduce a safety gate, merge, archive, clean, or otherwise act because of a Jev result.
- Never show a recommendation as a question or a user-visible interruption. Do not wait for Jev. If a bounded call fails or is unavailable, continue existing behavior.
- Never use this skill before independently reaching the workflow decision point. It is not an intent detector and must not turn explanation, research, or casual conversation into a formal workflow.
- The closed candidate set is exactly `direct`, `standard-openspec`, `anvil`, and `spec-superflow`. Do not invent, fork, combine, rename, or silently modify candidates.
- Phase 1 is observation-only regardless of confidence. Promotion requires a separate change and explicit user approval.

## Versioned candidate catalog

Catalog version: `1`. These descriptions, rather than names alone, are the criteria sent to Jev.

| Candidate | Stable meaning |
|---|---|
| `direct` | Continue the current conversation or small/local change without creating a formal change. |
| `standard-openspec` | Use the repository's standard OpenSpec `spec-driven` workflow for an ordinary change. It is the conservative formal-workflow fallback. |
| `anvil` | Use the pinned, unmodified Anvil OpenSpec schema for work whose safety, migration, persistence, concurrency, or independent verification needs justify its stronger ledger and gates. |
| `spec-superflow` | Use pinned, unmodified spec-superflow for scoped work that benefits from one scope confirmation, planned implementation/recovery, and final review, without requiring Anvil's full assurance gates. |

A candidate that is not installed, supported, and healthy is not eligible. `standard-openspec` remains the formal fallback. When a managed DSH Worktree Session binding is active, treat `spec-superflow` as unavailable as an executable candidate unless a separately verified external firewall mechanically prevents both `ssf isolate` and `ssf finish`; remove it from the eligible set and retain `standard-openspec`. A warning or prompt instruction is not such a firewall, and the unmodified upstream planned workflow must not be claimed safe merely by warning against those mandatory paths.

## Deterministic rules run first

Determine the actual route from existing instructions and reasoning before interpreting any shadow result. These rules override Jev:

1. An explicit user choice of one of the four routes controls.
2. An existing change keeps its recorded control plane/schema; never re-route it.
3. A non-implementation request is not forced into a change.
4. Remove unavailable or unhealthy community candidates from the eligible shadow set. In an active managed Worktree Session, remove `spec-superflow` unless a verified external firewall mechanically blocks both `ssf isolate` and `ssf finish`; instructions or warnings alone do not qualify.
5. Existing security, permission, dependency, Worktree Session, verification, merge, archive, and cleanup rules are minimum gates. A lighter recommendation cannot weaken them.
6. Conflicts, ambiguity, or missing authoritative context preserve existing behavior. They are never permission to choose `direct`.

The actual route is whatever the agent/user/existing change eventually selects under those rules, not the Jev recommendation.

## Privacy-bounded feature projection

Construct features locally and only from these fields:

- `intent`: `explanation`, `research`, `bugfix`, `feature`, `maintenance`, `migration`, `security`, or `unknown`
- `scope`: `none`, `small`, `single-module`, `multi-module`, or `unknown`
- booleans: `behaviorChange`, `persistence`, `concurrency`, `existingChange`, `safetyGateConflict`
- `externalSystems`: integer `0..20`
- `safetyRisk`: `none`, `low`, `high`, or `unknown`
- `migrationRisk`: `none`, `reversible`, `irreversible`, or `unknown`
- `explicitRoute`: one closed candidate or `unknown`
- eligible candidate names from the closed set

Use `unknown`/conservative values when evidence is absent. Never include or derive a prose summary. Never send or record the full prompt, conversation, source, source fragments, diff, paths, URLs, emails, identifiers, attachment names/metadata/content, credentials, token-like strings, provider errors, or arbitrary user text.

## Two bounded shadow calls

If `DSH_JEV_WORKFLOW_ROUTER_DISABLED` is `1`, `true`, `yes`, or `on` (case-insensitive), make no Jev calls and write no records.

Otherwise, after deterministic rules are known, make these observation-only calls with only the bounded feature projection:

1. Call `mcp__jev__jev_classify` to classify `direct` versus `formal-workflow`. Include only the enum/numeric/boolean features above, the two fixed class descriptions, the fixed `manual-review` escape, and a bounded timeout. Do not include prose evidence. Preserve the complete closed-key classification distribution: `direct`, `formal-workflow`, `manual-review`.
2. Only when the first shadow result recommends `formal-workflow`, call `mcp__jev__jev_decide` over the eligible subset of `standard-openspec`, `anvil`, and `spec-superflow`, using catalog-version-1 descriptions and the same bounded features. Preserve confidence, winner margin, requirement-check booleans, and the complete closed-key workflow distribution: all three workflow keys plus the fixed escape keys `ask_user`, `investigate`, and `none`. Ineligible workflow keys remain bounded fields with probability zero; never discard an escape probability.

Do not retry ambiguous failures. Normalize provider/MCP failures to one of: `missing-credential`, `unauthorized`, `rate-limited`, `provider-5xx`, `network`, `timeout`, `cancelled`, `malformed-response`, or `unknown`. Never put raw error messages/bodies in arguments, records, or user output.

## Conservative post-call policy

The shadow status is `needs-review` if any of these holds: escape was selected; response structure is invalid; the choice is unknown/ineligible; any required probability/confidence is missing or non-finite; confidence is below the MCP's conservative default; winner margin is below the MCP's conservative default; a requirement check fails; or any call errors. Do not reinterpret `needs-review` as `direct` or as any executable route.

A result may be labelled `auto-candidate` only for offline evaluation when all checks pass. Even then it has zero authority and causes no action or user interruption.

## Local recorder

Use the zero-dependency Node >=22 recorder next to this file. Pass JSON only on stdin; never put observations in command arguments.

```sh
printf '%s' "$BOUNDED_JSON" | node recorder.mjs record
node recorder.mjs label OBSERVATION_ID ACTUAL_ROUTE SOURCE
node recorder.mjs summary
node recorder.mjs report
node recorder.mjs clear
```

`label` is retrospective only. Allowed sources are `user-explicit`, `agent`, and `existing-change`. Label only when the actual route is known from one of those sources. Otherwise leave it `unknown`; never infer or guess it from the recommendation.

Records default to `$DSH_HOME/state/jev-workflow-router/records.v1.jsonl` (falling back to `~/.dsh` only when `DSH_HOME` is unset), remain bounded and local, and are not conversation context. `summary` emits aggregate counts only. `report` emits only a versioned aggregate confusion/cost/coverage/latency/usage report; language and external cost remain explicitly unavailable rather than being inferred. `clear` explicitly removes recorded samples.
