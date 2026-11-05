# Deleted and rewritten tests: pet-locus-purge-previous-model

Complete list, taken from `git diff` of `packages/dsh-pet/test` against `HEAD`.
"Deleted" means the assertion is gone; "Rewritten" means the test now asserts the
new contract under the same or a new name. Nothing was deleted or loosened for any
reason other than asserting L2 (two-tier model) behaviour that this change
removes. L1 (`chat_bindings`) tests are untouched.

## Deleted

| File | Test | Why it went |
|---|---|---|
| `test/locus-legacy-retire.test.ts` (whole file) | `旧模型入口按退休规则处理 › 升级只加表` | Asserted `PET_DOMAIN_VERSION === 18` and a v17→v18 restamp that only added `locus_mains`. v19 purges instead; covered by `migrate-cli.test.ts` scenarios 「从更早版本迁移时全部 locus 行都是旧模型」 and 「升级需离线迁移并先备份」. REMOVED requirement 「旧模型入口按退休规则处理」. |
| same | `旧入口首个授权 at` | Asserted the read-time retirement of a previous-model row by its successor (`previousModelRow`, `establishFromPreviousModelLocked`, admission `legacy: true`). All removed (D7.1, D7.4, D7.5). After the purge such an entry has no row and is built the ordinary auto way. REMOVED requirement. |
| same | `旧入口非授权 at` | Same previous-model admission path (`legacy` → `uninitialized/previous-model`). REMOVED requirement. A non-allowlisted @ on an entry with no row is covered by the existing `not-allowed-sender` admission tests. |
| same | `旧入口里所有者已停止的行不会被 at 复活` | Asserted the stop marker of a previous-model row survives. The owner accepted that these markers are not kept (proposal). REMOVED requirement. |
| same | `旧话题入口在群先建立三层结构后建在同一 locus 主会话下` | Asserted topic re-establishment over a previous-model topic row (`entry.previousModel`). REMOVED requirement. |
| `test/locus-reconcile.test.ts` | `startup reconciliation › leaves retired legacy rows unchanged before any child liveness probe` | Asserted the silent skip of non-`tier3` active rows in `reconcileLocusChildren` (D7.7). Such a row can no longer exist; the branch is gone. |
| `test/locus-tool-tier-mutation.test.ts` | `safe-v1 入口请求 shell` | Asserted `{ ok: false, reason: 'legacy-composition' }` for `safe-v1`/`safe-v2`/unmarked rows (D7.8). The reason no longer exists. Replaced by `locus-control.test.ts › spec Scenario "safe-v1 入口请求 shell"` (the entry has no row). |

## Rewritten

| File | Old test | New test | What changed |
|---|---|---|---|
| `test/locus-control.test.ts` | `answers a tier request for a retired-model entry without switching anything` | `spec Scenario "safe-v1 入口请求 shell"` | Old: code `LOCUS_LEGACY_COMPOSITION` → receipt `tools-legacy-composition`. New: no row → code `LOCUS_NOT_FOUND` → receipt `not-found` 「当前入口不存在或已失效。」, nothing built or switched. |
| `test/locus-persistence.test.ts` | `keeps legacy rows readable while round-tripping additive composition and tier facts` | `round-trips the tier3 marker and tier facts; only tier3 is representable` | Old asserted `safe-v1`/`safe-v2` rows parse. New asserts they are rejected and that an `active` row needs the marker. One old assertion (`toolTier.effective: 'shell'` with `desired: 'safe'` is rejected) was dropped because the row schema never checked `desired`; it only failed before because the marker was missing. |
| `test/locus-composition.test.ts` | `safe-v1 行继续服务` | `defence in depth: a row marked with anything but tier3 is never composed` | Renamed only; assertions unchanged. The scenario name now belongs to the v19 test below; this test keeps the composer's own fail-closed gate covered. |
| same | `升级前的 legacy child 不可恢复服务` | `defence in depth: a row with no marker is never composed or resumed` | Renamed only; assertions unchanged. |
| same | `冷恢复不回落到父组合` | (same name) | Assertion **added** (resumed child whose own preset fell back to `locus-base` is refused). Nothing removed. |
| `test/locus-child-context.test.ts` | `旧 fork child 不受影响` | (same name) | New THEN: no locus row references the fork child, so it is not composed and nothing is installed on it. Asserts the lookup was made and the scope untouched. |
| `test/migrate-cli.test.ts` | whole file | whole file | The restamp contract (v2..v18 → 18, rows byte-identical) became the purge contract (→ 19). Kept as-is: unconfirmed write, ambiguous args, lock held by a Host-like owner, unsupported versions v1/0/-1/20/999. Reworded for the new output (`Would migrate`, `Migrated`): the v14/v15/v17 (+ v5, merged in) `--dry-run` tests, `升级需离线迁移并先备份` (now a snapshot-first test that also expects the v15 locus rows purged). Merged: `backs up v% … idempotent` (v2–v17, now all 16 versions) and `… preserving opaque inquiry/result history` (v14–v16) into one loop that keeps non-locus tables byte-identical; the seeded `loci`/`locus_operations` history is now purged by design. |
| `test/intent-triage-domain-contract.test.ts` | `PET_DOMAIN_VERSION is 18 …` | `PET_DOMAIN_VERSION is 19 …` | Version number only. |
| `test/route-groups.test.ts` | `… for a safe-v2 entry` | `… for a tier3 entry` | Title only (fixture default marker `safe-v2` → `tier3`). |

## Fixture-only changes (no test removed or loosened)

`safe-v1`/`safe-v2` → `tier3`, active rows given a marker, and a `locus_mains`
pairing added where the new startup check or adapter needs one:
`collab-todo-availability`, `collab-todo-lifecycle`, `fixtures/locus-snapshot.ts`,
`locus-controller-persistence-adapter` (`pairedMedium`, `projectLocusRecord(…, main)`,
default-Q&A lookup by work session), `locus-delivery-prompt`, `locus-doc-redelivery`,
`locus-persistence` (`pairedMedium`), `locus-preamble-durability`, `locus-view`,
`locus-context` (marker only), `locus-controller` (in-memory repository no longer
special-cases `previousModel`), `support/pet-host-fixture.ts` (default marker;
new `expectDegraded` option).

## Kept on purpose

`test/loader-composition.test.ts › does not resume retired safe-v1/safe-v2 children`
still passes unchanged: it drives the composer's non-`tier3` gate through a row
written after open (the Domain only validates on open). The gate stays because the
requirement "MUST NOT adopt or cold-resume any child without a `tier3` marker" is
still in the spec.
