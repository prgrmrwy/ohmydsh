# Optional tools — bounded Responses compat repair (2026-10-26)

## Contract and authorization

This is the lead-approved minimal candidate, **not a full main-session symptom repair**. The earlier local investigation (`openspec/changes/add-dsh-magpie-plugin/optional-tools-investigation.md`) and bounded live proof (`openspec/changes/add-dsh-magpie-plugin/gateway-readonly-proof.md:50–65`) jointly justify emitting the standard function-tool `strict:false` field for Responses only. The live proof observed HTTP 200 and exactly one `bash_probe` call with argument keys `['command']`, while preserving the input schema; it is not a raw gateway→upstream forwarding capture or proof of the main-session root cause.

The ten optional-tool tests (`packages/dsh-magpie/test/optional-tools.test.ts`) are deliberately promoted from **current-omission observation** to the proven candidate contract: Responses ordinary function tools must explicitly carry false; Chat must retain its prior strict omission. Deep schema/context/input checks, omitted/empty tools, assembled call/result pairing and current complete tool-list semantics remain intact. No nullable/required rewriting, stripped sandbox/goal parameters, new product API/config, all-tools strict sampling or message-anchored tool-history feature is introduced.

## Exact new RED receipt (before adapter edit)

- Local time **2026-10-26 10:21:36 America/New_York** (`2026-10-26T10:21:36-04:00`).
- Working directory: `packages/dsh-magpie`; command: `npm test -- --reporter=verbose test/optional-tools.test.ts`.
- Exit **1**; **1 file, 10 tests: 3 failed / 7 passed**; duration 575ms.
- Exact failure: `AssertionError: expected undefined to be false // Object.is equality`, at `expectOrdinaryStrict`, test line 83, reached from lines 101 (bash and conditional goal) and 134 (new tools with assembled history).
- Failed titles: `/v1/responses: bash preserves optional schema with explicit strict:false`; `/v1/responses: update_goal preserves optional schema with explicit strict:false`; `/v1/responses: newly available optional tool coexists with assembled tool-call/result history`.
- All five Chat cases and both Responses omitted/empty-tool cases passed. The preceding schema/context/input assertions passed. No fixture-only failure occurred in this new RED. Earlier fixture mistakes and the original first RED remain recorded in the investigation, not erased or counted as repair failures.

## Implementation / final verification

[Adapter:128–130](<../../../packages/dsh-magpie/src/host/adapter.ts#L128-L130>) extracts the existing API selection into `const api` and adds **only** `...(api==='openai-responses'?{supportsStrictMode:true}:{})` to the existing compat object. Actual unstaged production diff: **1 file, 3 insertions /2 deletions**. No new helper, config or route. pi-ai's ordinary function default emits false; public DSH `ToolSchema` has no `constrainedSampling`, so this does not request strict sampling. Chat receives the same model API and identical compat properties as before; its SDK-produced function objects remain exactly unchanged in all five focused Chat regressions.

| Check (package working directory) | Time, America/New_York | Actual result |
|---|---|---|
| `npm test -- --reporter=verbose test/optional-tools.test.ts` | 10:22:56 | exit **0**, **1 file /10 passed**, 543ms |
| `npm run typecheck` | batch started 10:22:57 | exit **0**, source and test TypeScript |
| `npm run build` | same batch, after typecheck | exit **0**, package-local ignored `lib/` only |
| `npm test` | 10:23:29 | exit **0**, **30 files /189 passed**, 967ms |

Build emitted only the existing tsdown `external` deprecation and ESM-over-CJS recommendations. Empty/omitted tools still emit no tools/tool_choice field; no top-level strict or text-format field appears. Schema/context/input deep equality and assembled call/result pairing were retained, with exact ordinary function-object checks also covering the newly available list. These are genuine post-adapter-repair GREEN counts, distinct from the earlier observation-only GREEN.

## Scope and handoff

Only the adapter, optional-tool test, this report and the investigation stage conclusions/evidence were edited. Ignored build output remains local. The frozen proposal/design/spec/review/tasks, old AMD2 approval and every other ledger are unchanged. Final scoped `git diff --check` passed. A direct read-only Node assertion pass also checked **all four scoped files** (including untracked tests/reports that Git diff would skip): no trailing whitespace or extra terminal blank line, **11 repository-relative report links all resolve to tracked targets**, and the adapter equals the index baseline plus exactly the authorized tiny compat patch. Dependency/installed/generated and currently untracked evidence paths are inline code, not Markdown destinations. The repository-wide governance suite was not rerun; the scoped link check uses its actual Markdown helper functions. Actual production diff (`git diff -- packages/dsh-magpie/src/host/adapter.ts`), excluding only Git's header/context lines:

```diff
-      const model:Model<'openai-completions'|'openai-responses'>={id:entry.info.id,name:entry.info.name,provider:'dsh-magpie',api:entry.nativeEndpoints.includes('/v1/responses')?'openai-responses':'openai-completions',baseUrl:op.gen.baseUrl,reasoning:entry.efforts.length>0,thinkingLevelMap:{off:null,...Object.fromEntries(entry.efforts.map(e=>[e,e]))},input:entry.info.inputModalities?.includes('image')?['text','image']:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:entry.info.context?.contextWindow??128000,maxTokens:entry.info.defaultMaxTokens??16384,
-        compat:{supportsFinishReason:true,thinkingFormat:'openai',maxTokensField:'max_completion_tokens'} as never}
+      const api=entry.nativeEndpoints.includes('/v1/responses')?'openai-responses':'openai-completions'
+      const model:Model<'openai-completions'|'openai-responses'>={id:entry.info.id,name:entry.info.name,provider:'dsh-magpie',api,baseUrl:op.gen.baseUrl,reasoning:entry.efforts.length>0,thinkingLevelMap:{off:null,...Object.fromEntries(entry.efforts.map(e=>[e,e]))},input:entry.info.inputModalities?.includes('image')?['text','image']:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:entry.info.context?.contextWindow??128000,maxTokens:entry.info.defaultMaxTokens??16384,
+        compat:{supportsFinishReason:true,thinkingFormat:'openai',maxTokensField:'max_completion_tokens',...(api==='openai-responses'?{supportsStrictMode:true}:{})} as never}
```

All other model and dispatch properties are unchanged. Local executor inspection found the change bounded to the authorized compat behavior; **independent candidate review is still pending**, and prior AMD2 approval is not reused for this later repair. Parent should perform a fresh narrow review, then separately authorized sync/restart and initialized-host runtime/GUI tool-loop acceptance. Do not mark the complete goal or main symptom fixed from this local receipt.

**Not performed:** new real gateway requests, real credential access, sync/restart/deploy, host339/continuation161 reruns (host production code unchanged), hostcompat/manifest/lock edits, commit, or frozen planning/review/task/other-ledger edits. Existing main-session tool snapshots may remain stale; upstream forwarding/normalization and the symptom's full root cause remain unproven.
