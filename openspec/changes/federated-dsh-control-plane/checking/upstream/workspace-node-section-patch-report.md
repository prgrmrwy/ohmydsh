# rc.2 Workspace NodeSection extraction gate

## Patch contract

- Upstream source: `deepseek-ai/deepseek-harness` commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Required `WorkspaceBrowser.tsx` input blob: `08f22ed400ac3a80852df186e5a899bc8ba53c33`
- Patch: `rc2-workspace-node-section.patch`
- Patch SHA-256: `1a5338a83523a705b9357293a5ee2d2d7833971e3cff800c52c095a7f007860d`
- Patched `WorkspaceBrowser.tsx` output blob: `2f1bd71b888d21be97da6e8b3d24d4ac1fd36d75`
- Patched `Rows.tsx` output blob: `df2e7e7f5d627b3092e4b70e1469e566263e9379`
- Added `federation.ts` output blob: `e546ce6fd88c05bf42ba843e05ae5d25a401b4fa`

The patch is retained as source/provenance. No extracted upstream tree or generated JavaScript/CSS bundle is checked in.

## Extraction shape

The patch introduces an exported `Rc2WorkspaceNodeSection` over the real rc.2 boundaries:

- `SessionTree`
- `FlatList`
- `ProjectRowItem`, `SessionNodeItem`, and related Rows
- `deriveGroups` / `deriveFlat`
- official view-store hooks/actions
- official blank-session promotion and account retention
- official workspace/session rename and workspace delete Modals
- official archive, fork, show-more, status, subagent and drag behavior

It does not export or render:

- the section title/header;
- global search input/results orchestration;
- grouped/flat and manual/updated controls;
- collapsed rail controls;
- `WorkspacePickFlow`;
- a directory-flow slot;
- Cordis `apply()` or any slot registration.

`src/client/federation.ts` is a build-only entry exporting the NodeSection, its props, the official store factory and view mode types. The ordinary upstream `src/client/index.ts` remains unchanged.

## Shared official behavior

This is an extraction rather than a parallel reimplementation: the patched official `WorkspaceBrowser` delegates its non-search list/dialog area to `Rc2WorkspaceNodeSection` with the original hooks/actions. The official root retains header/search/rail/picker ownership. Therefore the official browser and federation embed execute the same tree/list/dialog code.

The only time behavior parameterization below that boundary is `now: number`: upstream's two direct `Date.now()` calls in `SessionTree` and `FlatList` become a caller-owned render instant. The ordinary `WorkspaceBrowser` still supplies `Date.now()` once per render; deterministic tests may inject a fixed instant.

Because rc.2 `Menu` and `Modal` render into `document.body`, the patch also threads a validated CSS-safe `overlayNamespace` into all NodeSection row menus and dialogs. The resulting `dsh-federation-node-overlay-<namespace>` class gives the Node shell an explicit ownership/arbitration and test seam while preserving the primitive implementations.

## Fail-closed builder

`scripts/build-rc2-workspace-embed.mjs` performs the following before replacing an output directory:

1. validates the checked-in patch SHA-256;
2. validates every selected upstream source file by size and Git blob;
3. copies into a staging directory;
4. runs `git apply --check` and then applies without shell interpolation;
5. validates every patched output by Git blob and SHA-256;
6. atomically swaps the verified staging directory, preserving/restoring an existing output on failure.

A changed `WorkspaceBrowser.tsx` fixture was rejected before patching, and a sentinel in the previous output remained intact. Patch/output mismatch similarly cannot be installed.

## Executed compile/build proof

A temporary package outside the repository installed the pinned rc.2 compile dependencies. The patched source passed strict TypeScript checking with TypeScript 5.9.3. An isolated browser ESM bundle from `src/client/federation.ts` then succeeded and exported only:

```text
Rc2WorkspaceNodeSection
createWorkspaceViewStore
```

Observed temporary output digests:

```text
federation.js  (ephemeral; recomputed after each patch revision)
federation.css (ephemeral; recomputed after each patch revision)d
```

These are spike evidence, not package release digests; task 2.5 will record final locked toolchain and package artifact provenance.

## Gate result

Task 1.4: **PASS**. The real rc.2 tree/list/Rows/store boundary can produce a standalone runtime export, the official browser shares it, and every target or output mismatch refuses a new artifact.
