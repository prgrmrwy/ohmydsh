# Enable / rollback rehearsal (task 10.6, pre-enable portion)

Automated as `tests/federation-sync-rollback.test.mjs`. This is the dress
rehearsal for flipping `dsh.yaml` to `enabled: true`, executed against the
**real** `scripts/sync.mjs` and the **real** `dsh-federation` package inside an
isolated `DSH_HOME` with a fake `dsh` CLI. The operator's `~/.dsh` and the live
Web Host are never touched.

## What is proven

| Step | Result |
| --- | --- |
| `enabled: true` → sync | package builds and deploys into the isolated profile, carrying built `lib/` and the correct manifest name |
| sync again, unchanged | **idempotent**: zero further CLI actions, deployment intact |
| `enabled: false` → sync | sync itself issues `remove dsh-federation`; the deployment is gone |
| sync again, still disabled | no-op |
| `enabled: true` again | deployment restored — the switch is genuinely reversible |

The rollback assertion deliberately checks the **action the sync issued**, not
merely that the directory disappeared: the fake CLI is what performs the
removal, so asserting only on the filesystem would pass even if sync never asked.

## Mutation checks

Both guarantees were re-verified by breaking the real implementation and
confirming the test fails, then restoring `scripts/sync.mjs` (verified clean, no
mutation markers left):

| Mutation in `scripts/sync.mjs` | Test result |
| --- | --- |
| skip the `remove disabled package` call | **failed** ✓ |
| treat local content as always changed (breaks idempotence) | **failed** ✓ |

An earlier mutation attempt on two *other* removal call sites did **not** fail
the test, which correctly showed those paths are not the ones a disabled local
package takes — the mutation hunt is what located the real path
(`sync.mjs`, "remove disabled package").

## Test-isolation defect found and fixed

The first version of this test symlinked, then copied, the live
`packages/dsh-federation` directory. Under the full `npm test` run it failed
intermittently in two different ways:

1. a sibling test (`federation-package-build.test.mjs`) rebuilds `lib/`, which
   changed the package content hash **between** the two sync runs, so sync
   correctly reinstalled and idempotence became unmeasurable;
2. the same sibling deletes `lib/` mid-copy, so `cp -R` aborted.

Both were defects in this test, not in `sync.mjs`. The fixture now copies only
version-controlled sources (`git ls-files`, excluding `lib/` and `.generated/`)
and lets the build produce its own output, so the test is independent of
concurrent siblings. Verified: `npm test` → **84 passed, 0 failed**.

## Incidental confirmation of fail-closed behaviour

While building the fixture, the embed build refused to run without its pinned
upstream provenance
(`checking/upstream/rc2-workspace-source-manifest.json`), reporting
`build failed before deployment` rather than emitting an unverified artifact.
That is the required build-time posture: no provenance, no artifact, and the
previously deployed package is left untouched.

The second test in this file additionally asserts the pinned-source contract
directly: an immutable 40-hex `releaseCommit`, per-file git blob ids and sizes,
and that driving the real embed builder against a tampered source stage fails
without producing any output.

## Scope

This covers the **pre-enable, isolated** half of task 10.6: build, deploy,
idempotence, rollback and re-enable all behave correctly for this package.

Still requires the operator and is **not** claimed:

- running `node scripts/sync.mjs` / `dsh build` against the real `~/.dsh`;
- flipping the actual `dsh.yaml` entry to `enabled: true`;
- task 10.7 (restart the existing Web Host and verify the injected GUI at the
  existing `http://127.0.0.1:3080`);
- task 10.8 final sign-off.

`dsh.yaml` therefore still carries `dsh-federation: enabled: false`.
