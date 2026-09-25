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

The active baseline contains zero prospective router records. Its admission state is therefore `not-established`; all sample/day/route/category coverage warnings are present, latency percentiles are null, and no accuracy claim is made. This is the correct conservative result before a replacement TypeSafe credential is configured locally and ordinary-Agent tool visibility is proven.

The report implementation is validated with labelled, unknown, needs-review, failure, latency, usage, high-cost, corrupt-record, empty-dataset and privacy cases. Synthetic routing fixture coverage remains separately documented by the 16-case bilingual table-driven suite; it is not misrepresented as real Jev output.
