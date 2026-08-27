# rc.2 Workspace source bootstrap gate

## Immutable input

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Commit: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Tree: `53915efe4e2126cc7779b73dfc8a3bcec5318c44`
- DSH release: `0.1.1-rc.2`
- Archive format: deterministic `git archive` tar with prefix `deepseek-harness-b150a551/`
- Archive SHA-256: `a94d9b561d366f4d630ee5bc30a8b37eb8dd58ee284bb16bdde0409ecdfa84d6`
- Archive size: 163840 bytes

The per-file Git blob and size list is `rc2-workspace-source-manifest.json`. It contains every file under `packages/client/ui-workspace/src/client/**`, the CSS module declaration, package manifest, and upstream MIT license. The selected path list is the complete build-time source surface; package dependencies remain resolved by this repository's future package manifest/root lock rather than being vendored.

## Fetch algorithm

`scripts/fetch-rc2-workspace-source.mjs`:

1. reads the checked-in manifest;
2. uses a fresh temporary Git repository and fetches only the immutable commit;
3. verifies fetched commit/tree and every selected Git blob before archive creation;
4. creates the exact `git archive` path set and verifies archive SHA-256 and size;
5. atomically renames the owner-only temporary archive into a content-addressed cache;
6. on every use, re-verifies the cached archive;
7. extracts into a staging directory and verifies every extracted byte as a Git blob before replacing the requested output directory;
8. with `--offline`, refuses a missing/corrupt cache instead of contacting the network.

It never reads or writes npx cache, a DSH profile, `~/.dsh`, or an installed upstream package. Its default cache is `${XDG_CACHE_HOME:-~/.cache}/ohmydsh/dsh-federation/workspace-source`; tests pass an ephemeral cache explicitly.

## Executed verification

A fresh ephemeral cache and two ephemeral output directories were used:

```text
first run:  source=network
second run: source=cache with --offline
commit:     b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
archive:    a94d9b561d366f4d630ee5bc30a8b37eb8dd58ee284bb16bdde0409ecdfa84d6
```

Assertions that passed:

- first bootstrap created the manifest-pinned archive;
- offline repeat build succeeded from cache;
- `diff -qr` found no difference between the two extracted trees;
- extracted `WorkspaceBrowser.tsx` produced Git blob `08f22ed400ac3a80852df186e5a899bc8ba53c33`;
- before/after metadata for the active npx checkout and `~/.dsh` was unchanged;
- the ephemeral cache/output was deleted after verification.

Repository policy continues to reject `packages/*/lib/**`; no fetched archive, extracted upstream source, or generated upstream bundle is checked in. Only the manifest, attribution, fetcher, tests, and this summarized evidence are retained.

## Failure posture

- Cache miss/corruption in offline mode: clear bootstrap error, no output.
- Upstream commit/tree/blob mismatch: no cache artifact is committed.
- Archive digest/size mismatch: no extraction is accepted.
- Extracted file mismatch: staging is deleted and requested output is not replaced.

The future task 1.4 patch hash and task 2.5 build-toolchain provenance will extend the deterministic input set; they are not silently assumed here.

## Gate result

- Task 1.2 provenance/license/deterministic input manifest: **PASS**.
- Task 1.3 online bootstrap, offline replay, no npx/DSH mutation, no generated bundle tracked: **PASS**.
