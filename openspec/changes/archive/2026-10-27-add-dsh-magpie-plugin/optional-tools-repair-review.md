# Fresh bounded optional-tools source review — 2026-10-26

**OPTIONAL_TOOLS_SOURCE_REVIEW: APPROVE.** Independent non-author local inspection of the actual tiny repair found no blocking source defect within this candidate's boundary. This is **source-only approval**, not a fresh whole-package security audit, main-session root-cause proof, GUI acceptance, or replacement of the historical global VERDICT/CHANGES_APPLIED. No teammate review is invented: the lead's earlier shared Task4 approval is separate; the unavailable persistent teammate supplied no fresh review.

## Exact scope and identities

- Read [instructions](<../../../AGENTS.md>), [manifest](<../../../dsh.yaml#L5-L8>), integration pitfalls, [generation contract](<specs/dsh-magpie/spec.md#L148-L199>), [D2/D3](<design.md#L59-L91>), [tasks](<tasks.md#L170-L187>), [latest AMD2 review](<review.md#L555-L618>), investigation/repair/live reports, and connected implementation, not just a diff.
- [Adapter:128–130](<../../../packages/dsh-magpie/src/host/adapter.ts#L128-L130>): exactly +3/-2 relative to its previously staged implementation, extracting the existing ternary into `api`, then conditionally adding `supportsStrictMode:true` only for `openai-responses`. Adapter SHA-256 `6ff52a96f3608bbb68e23325b137810ceb177ac3cdd893289f4b0e477c31309e`.
- Read the complete [151-line test](<../../../packages/dsh-magpie/test/optional-tools.test.ts#L1-L151>); SHA-256 `0237da70e369ea75ae95dfa90128d8659e39e211b8b6d30dd44c245023c558a7`. No source/test edit by this reviewer.
- Frozen five planning hashes and production host patch match [review:574–579](<review.md#L574-L579>), including patch `0a9980ef…ae19`; no host input changed in this repair.

## Connected-source reasoning

Installed pi-ai `dist/api/openai-responses.js:51–63` defaults `supportsStrictMode` false. Its `openai-responses-shared.js:271–303` uses ordinary-tool default strict false, and emits that field only when support is enabled. `constrained-sampling.js:111–113,163–183` only rewrites parameters for strict true, which requires a tool's explicit `constrainedSampling` configuration. The actual DSH `ToolSchema` (`@deepseek-ai/dsh-llm/lib/types/types.d.ts:455–466`) has no such member. Consequently current ordinary tools send explicit false with original parameters, rather than requesting constrained sampling or requiring all optional properties. OpenAI SDK `src/resources/responses/responses.ts:805–819` documents FunctionTool strict default true; documentation is not proof of this gateway's upstream normalization.

Chat receives no new compat member and its existing conversion/detection stays unchanged (`openai-completions.js:1128–1157,1289,1307–1342`). The five Chat regressions assert exact function objects with strict omitted. Other dispatch, retry, timeout, routing, schema/context and replay behavior is unchanged. This approval does not extend to callers bypassing the typed DSH contract with pi-specific constrained-sampling members.

Tests retain deep schema/context/input equality, original required/optional fields, omitted/empty-tool behavior, complete newly available tool lists, BlockAssembler replay and public tool-result pairing. No assertion was weakened to satisfy governance. [Prior live evidence:65](<gateway-readonly-proof.md#L65>) is gateway acceptance + expected command-only behavior, **not** raw upstream forwarding or main-session causality; missing old Magpie Go checkout is therefore not an automatic block on this bounded source decision.

## Evidence tiers

- Reviewer actually ran `npm test --workspace=dsh-magpie -- --reporter=verbose test/optional-tools.test.ts`, **2026-10-26 10:47:09 -04:00**, exit0, **1 file/10 passed**, 510ms. Private log `/tmp/dsh-magpie-final-20261026/focused.log`, mode0600.
- [Author's repair receipt](<optional-tools-repair.md#L9-L29>): 10:21:36 -04:00 RED10 =3fail/7pass; 10:22:56 GREEN10; typecheck/build exit0; 10:23:29 full30files/189pass. These are author-reported unchanged-source receipts, not a reviewer full189 replay.
- No reason to repeat unchanged Host25/339/161 or whole package189. Their historical evidence remains distinct from this candidate and eventual live/deployment checks.

**Remaining:** deploy/sync idempotence, postrepair unmodified-wire standalone tool round, Chat compatibility probe, authorized runtime restart and human GUI acceptance are separate operational gates. Full workflow remains INTERIM FAIL while historical2.5 and GUI16.4/final16.3 are open. No commit/push/publish, current-spec synchronization, archive, pin/default/visibility/speed/cap/allowlist/permission change, old-plugin disablement or delegation occurred in this review.
