# Shadow evaluation report baseline

Date: 2026-09-24

The router recorder now has a `report` command that computes a versioned aggregate report without exporting observation identifiers, timestamps, or raw rows. It includes:

- dataset count, labelled/unknown coverage, distinct working days and version/candidate-set counts;
- complete actual-to-recommended 4×4 confusion matrix for `auto-candidate` decisions;
- pre-registered weighted costs and high-cost misses, with `needs-review` cost fixed at zero;
- overall needs-review and provider-failure rates;
- nearest-rank p50/p95 latency;
- aggregate usage totals/means;
- breakdowns by intent, actual route, router version, and candidate availability;
- explicit coverage warnings against Phase 2 thresholds.

The record schema intentionally does not retain language or synthetic/real provenance. The report marks these dimensions unavailable rather than inferring them. External cost is also `null` until a reviewed provider pricing model exists.

After the replacement credential and ordinary-Agent tool surface were proven, the first prospective live record was added and labelled from the authoritative existing change. The active baseline now contains one labelled maintenance observation: recommendation and actual route are both `standard-openspec`, status is `needs-review`, normalized provider failures are zero, and aggregate usage is 2,189 input / 363 output tokens. Its admission state remains `not-established`: one sample on one working day is intentionally far below the Phase 2 sample/day/route/category thresholds, its 100% needs-review rate exceeds the 35% quality threshold, and no accuracy or promotion claim is made. The tool surface did not expose an independently measured latency for this call; the recorder's zero placeholder is excluded from percentiles, so p50/p95 and latency coverage are explicitly unavailable rather than falsely reported as 0ms.

The report implementation is validated with labelled, unknown, needs-review, failure, latency, usage, high-cost, corrupt-record, empty-dataset and privacy cases. Synthetic routing fixture coverage remains separately documented by the 16-case bilingual table-driven suite; it is not misrepresented as real Jev output.
