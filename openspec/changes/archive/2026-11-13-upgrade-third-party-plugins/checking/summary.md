# Third-party plugin upgrade — redacted historical summary

## Retention boundary (2026-10-27)

This summary preserves conclusions and limitations from the former three checking reports, not their full evidence. The detailed static audits and independent verification report were removed under the no-grandfather checking-artifact policy. They remain historical Git material at revision `120f9140` in this change's former checking paths; use `git show 120f9140:<repository-relative-path>` for exact old content. This cleanup performed no network audit, install, sync, runtime restart or user acceptance, and does not revalidate old package versions against today's registry or runtime.

## Historical upgrade verification

The 2026-10-10 independent verification reported exact declared pin/integrity agreement, isolated two-run sync idempotence, installed-version checks, unique width-tiers wiring and a single better-sidebar instance. The four initial upgrades and subsequent archify/jev batch were distinguished; unrelated manifest entries were checked unchanged. The full root result was **426 tests / 416 pass / 8 fail / 2 skipped**, with the eight failures reported as the same existing/environment failures before and after the change. That is a no-new-failure conclusion, not an all-green suite. Artifact checking passed. Real DSH Host startup smoke and offline behavior were explicitly unverified in that independent report. The proposal separately records later user acceptance and removal of skin-center; those later statements are not evidence that the independent verifier restarted the Host.

## Archify 1.0.0 audit conclusions

- The inspected package added an anonymous static-manifest update GET with bounded timeout/cache/failure handling and an `ARCHIFY_UPDATE_CHECK_DISABLED=1` opt-out. No machine identifier, local path or diagram-content request payload was identified in that audit.
- Browser checking used headless Chrome, not a visible browser window. Missing Chrome caused finalize exit 2 while retaining generated HTML. No browser-check bypass switch was found.
- The child used a debugging pipe rather than an exposed CDP socket; existing cockpit port forwarding was not a demonstrated integration path. Runtime/provider environment propagation and broader compatibility were not fully verified.

## Jev 0.14.1 audit conclusions

The inspected new agent-tools dependency used a floating `^0.2.0` range, resolving to 0.2.0 at audit time. Exact top-level pins did not make that transitive resolution immutable, and the existing update detector did not track the dependency's future drift. The inspected dependency had no install hook, child-process or filesystem capability; credentials came from injected environment and were used for outbound authentication. Those bounded static findings were not a full transport/runtime security guarantee. The then-current launcher selected TypeSafe explicitly; that is a historical version/configuration fact, not a claim about today's provider setting. A real service handshake remained a follow-up risk.

Exact integrities, source excerpts, machine-specific temporary paths and raw verification receipts are intentionally omitted here. Consult the historical Git reports for the original scope and evidence; this concise summary is not a substitute for a new version-specific audit.
