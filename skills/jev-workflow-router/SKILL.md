---
name: jev-workflow-router
description: Advisory routing at the point where work might stay direct or enter a formal workflow. Use it after independently reaching that decision to get one non-blocking suggestion line with a confidence value; never use it to detect intent, and never let it block, question the user, or decide anything on its own.
whenToUse: You have independently determined, using the conversation and existing project rules, that you must now decide whether to continue directly or enter a formal planning/change workflow, and no explicit user choice or existing change already settles it. Do not apply for ordinary explanation, research, or implementation steps that have not reached that decision.
---

# Jev workflow router — advisory only

This skill informs a decision you already had to make. It never makes that decision, and it never turns into a question the user must answer.

## Non-negotiable boundary

- The advice is one line in your own reply. It is never a question, an options card, or a request for confirmation, and it never delays or blocks the work that follows.
- Never because of a Jev result: create a change, select or change a schema, invoke `ssf`, start apply/implementation, mutate files, authorize tools, reduce a safety gate, merge, archive, or clean.
- Never wait for Jev. If the call fails, times out, or returns something unusable, say nothing about routing and continue with existing behavior.
- Never apply this skill before independently reaching the workflow decision point. It is not an intent detector and must not turn explanation, research, or casual conversation into a formal workflow.
- The candidate set is exactly `direct`, `standard-openspec`, `anvil`, and `spec-superflow`. Do not invent, fork, combine, rename, or silently modify candidates.
- Anything beyond giving advice (auto-creating a change, switching a schema, invoking `ssf`, acting on high confidence) needs a separate approved change.
- Do not collect, infer, persist, report, or gate on request language.

## Skip first: zero calls when the answer is already decided

Make no Jev call at all, and emit no advice line, when any of these holds:

1. The user has explicitly chosen a route ("just fix it", "use Anvil", "open a change for this").
2. The task already belongs to an existing OpenSpec or spec-superflow change.
3. The request is not implementation work at all (explanation, research, review of unrelated material).

These are the common cases. The router exists for the genuinely open decision, not for every turn.

## Versioned candidate catalog

Catalog version: `1`. These descriptions, rather than names alone, are the criteria sent to Jev.

| Candidate | Stable meaning |
|---|---|
| `direct` | Continue the current conversation or small/local change without creating a formal change. |
| `standard-openspec` | Use the repository's standard OpenSpec `spec-driven` workflow for an ordinary change. It is the conservative formal-workflow fallback. |
| `anvil` | Use the pinned, unmodified Anvil OpenSpec schema for work whose safety, migration, persistence, concurrency, or independent verification needs justify its stronger ledger and gates. |
| `spec-superflow` | Use pinned, unmodified spec-superflow for scoped work that benefits from one scope confirmation, planned implementation/recovery, and final review, without requiring Anvil's full assurance gates. |

A candidate that is not installed, supported, and healthy is not eligible. `standard-openspec` remains the formal fallback. When a managed DSH Worktree Session binding is active, treat `spec-superflow` as unavailable as an executable candidate unless a separately verified external firewall mechanically prevents both `ssf isolate` and `ssf finish`; remove it from the eligible set and retain `standard-openspec`. A warning or prompt instruction is not such a firewall.

## Deterministic rules run first

Determine the actual route from existing instructions and reasoning before interpreting any Jev result. These rules override Jev:

1. An explicit user choice of one of the four routes controls.
2. An existing change keeps its recorded control plane/schema; never re-route it.
3. A non-implementation request is not forced into a change.
4. Remove unavailable or unhealthy community candidates from the eligible set. In an active managed Worktree Session, remove `spec-superflow` unless a verified external firewall mechanically blocks both `ssf isolate` and `ssf finish`; instructions or warnings alone do not qualify.
5. Existing security, permission, dependency, Worktree Session, verification, merge, archive, and cleanup rules are minimum gates. A lighter recommendation cannot weaken them.
6. Conflicts, ambiguity, or missing authoritative context preserve existing behavior. They are never permission to choose `direct`.

The actual route is whatever you, the user, or an existing change eventually selects under those rules, not the Jev recommendation.

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

## Bounded calls

If `DSH_JEV_WORKFLOW_ROUTER_DISABLED` is `1`, `true`, `yes`, or `on` (case-insensitive), make no Jev calls, write no records, and emit no advice.

Otherwise, after the skip rules above and the deterministic rules are known:

1. Call `mcp__jev__jev_classify` to classify `direct` versus `formal-workflow`. Include only the enum/numeric/boolean features above, the two fixed class descriptions, the fixed `manual-review` escape, and a bounded timeout. Do not include prose evidence.
2. Only when the first result recommends `formal-workflow`, call `mcp__jev__jev_decide` over the eligible subset of `standard-openspec`, `anvil`, and `spec-superflow`, using catalog-version-1 descriptions and the same bounded features.

Do not retry ambiguous failures. The error category closed set is `none`, `missing-credential`, `unauthorized`, `rate-limited`, `region-blocked`, `provider-5xx`, `network`, `timeout`, `cancelled`, `malformed-response`, and `unknown`. Never put raw error messages/bodies in command arguments, records, or user output.

### Call projections (`jevCalls`)

The recorder, not you, derives the service provider (`jevProvider`) and the transport error category. For each Jev call you actually made (at most two, in order), add one bounded projection to `jevCalls`:

- Successful call: `{"outcome":"success","provider":P,"semantic":S}`. `P` is the `provider` field of the tool result JSON (`typesafe`, `openrouter`, or anything else, which becomes `unknown`). `S` is `invalid-response` when the result cannot be fully parsed, was truncated, lacks the required classify/decide structure, or has any classify `results[].status` or decide `recommendation.status` equal to `invalid_response`; otherwise `ok`.
- Failed call: `{"outcome":"error","message":M}` where `M` is the tool error text cut to 512 characters.

When every call succeeded, set `"errorCategory":"none"` explicitly; when you observed a failure that is not a call result (missing credential, cancellation), set that category and include only the calls that ran. Do not copy any other result content.

This is the only place raw error text may appear, and only on the recorder's stdin. Never interpolate, paste, or splice tool output into a shell command, heredoc, or command argument.

## What to say, and when to say nothing

Show advice only when the classify/decide result is unambiguous: the recommendation is a closed candidate, confidence and winner margin are at or above the MCP's conservative defaults, no escape hatch was selected, and no requirement check failed.

One line, in Chinese, in your normal reply. For example:

```
（Jev 路由建议：standard-openspec，置信度 0.91；可无视，按你的判断走。）
```

Rules for that line:

- One line, no bullet list, no table, no follow-up question.
- Include the candidate and the confidence. Say explicitly that it can be ignored.
- Never present it as a requirement, a gate, or a blocker.
- When any check fails, when an escape hatch is chosen, when a call errors, or when confidence/margin is below the conservative default: say nothing about routing and simply continue. Uncertainty is not permission to pick `direct`.

## Local recorder

Use the zero-dependency Node >=22 recorder next to this file. Pass JSON only on stdin; never put observations in command arguments. Write the record JSON with the file-writing tool to a temporary file readable only by the current user (under the system temp directory with mode 0600), run `node recorder.mjs record < <that file>`, and delete the temporary file afterwards whether the command succeeded or failed.

Every record must include one bounded local provenance value: `real-vibe` for an ordinary decision point, `synthetic-fixture` for an explicit test/offline fixture, or `unknown` when neither is provable. Synthetic and unknown records never count toward health metrics derived from real use.

The shaped minimum, with the window described below:

```json
{
  "sampleProvenance": "real-vibe",
  "observedWindow": { "from": 1793246299793, "to": 1793246310000 },
  "features": { "intent": "feature", "scope": "multi-module", "behaviorChange": true,
                "persistence": false, "concurrency": false, "existingChange": false,
                "safetyGateConflict": false, "externalSystems": 1,
                "safetyRisk": "low", "migrationRisk": "reversible", "explicitRoute": "unknown" },
  "eligibleCandidates": ["direct", "standard-openspec", "anvil", "spec-superflow"],
  "recommendation": { "changeNecessity": "formal-workflow", "workflow": "standard-openspec",
                      "classificationProbabilities": { "direct": 0, "formal-workflow": 0.85, "manual-review": 0.15 },
                      "workflowProbabilities": { "standard-openspec": 0.91, "anvil": 0.05, "spec-superflow": 0.02,
                                                 "ask_user": 0.01, "investigate": 0.005, "none": 0.005 },
                      "confidence": 0.85, "margin": 0.7, "escape": false, "status": "auto-candidate",
                      "requirementChecks": { "eligibleChoice": true, "completeProbabilities": true,
                                             "confidenceMet": true, "marginMet": true, "safetyCompatible": true } },
  "jevCalls": [{ "outcome": "success", "provider": "openrouter", "semantic": "ok" }],
  "errorCategory": "none",
  "metrics": { "usage": { "input": 513, "output": 43, "total": 556 } }
}
```

Never send a `metrics.latency` value you measured yourself; omit it and let `recorder.mjs latency` fill it from the log. Never reuse the legacy `latencyMs` field.

```sh
node recorder.mjs record < "$RECORD_JSON_FILE"
node recorder.mjs latency OBSERVATION_ID
node recorder.mjs label OBSERVATION_ID ACTUAL_ROUTE SOURCE
node recorder.mjs summary
node recorder.mjs report
node recorder.mjs clear
```

### Latency comes from the session log, not from you

Do not time the calls yourself. Differencing two `Date.now()` readings taken around separate tool calls measures your own model round-trips (observed: ~32 s) rather than the Jev request (observed: ~1.7 s), so it is off by roughly an order of magnitude.

Instead, record the window that scopes this judgement and let the recorder read the timestamps the session log already holds:

1. Before the first Jev call, run `node -e "console.log(Date.now())"` once to capture `from`.
2. After the sequence settles (success, error, timeout, or cancellation), capture `to` the same way.
3. Include `"observedWindow":{"from":FROM,"to":TO}` in the record.

Then run `node recorder.mjs latency OBSERVATION_ID`. It pairs each `mcp__jev__*` `tool/call` with its `tool/result` in that window, sums the gaps, and writes the result. If the log is missing, undecodable, or has no matching calls, it stores `availability: "unavailable"` with a specific reason instead of guessing — that is a normal outcome, not an error to work around.

`label` is retrospective only. Allowed sources are `user-explicit`, `agent`, and `existing-change`. Label only when the actual route is known from one of those sources. Otherwise leave it `unknown`; never infer it from the recommendation.

Records default to `$DSH_HOME/state/jev-workflow-router/records.v1.jsonl` (falling back to `~/.dsh` only when `DSH_HOME` is unset), remain bounded and local, and are not conversation context. `summary` emits aggregate counts only. `report` emits confusion, cost, reliability, mismatch rate, and event-timestamp latency for ongoing health; it has no admission gate, because advisory is already approved and any further automation needs its own change. `clear` removes recorded samples.
