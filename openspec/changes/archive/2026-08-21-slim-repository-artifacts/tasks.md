## 1. Consolidate dependency installation

- [x] 1.1 Add npm workspace declarations for the maintained local packages to the root `package.json`, preserving each package's own dependency and publication metadata.
- [x] 1.2 Regenerate only the root `package-lock.json` with the repository's current Node/npm toolchain and verify it contains the local workspace dependency graphs.
- [x] 1.3 Remove `packages/worktree-session/package-lock.json` and `packages/sidebar-session-provider-icon/package-lock.json`, then update bootstrap/package development documentation to use root install commands.
- [x] 1.4 Run a clean root `npm ci` and confirm both TypeScript packages can typecheck, test and build from the workspace dependency installation.

## 2. Build local packages safely during sync

- [x] 2.1 Refactor `scripts/sync.mjs` local-package hashing into explicit build-input and install-content hashes that exclude `lib` from inputs and exclude locks, `node_modules`, VCS and transient evidence from install identity.
- [x] 2.2 Add local-package build readiness logic so missing outputs or changed source/config/assets run the package build before install-content comparison, while unchanged valid outputs skip rebuilding.
- [x] 2.3 Ensure a local build failure reports the package and failed command before any deployed package remove/reinstall action, retaining the previous working deployment.
- [x] 2.4 Persist or derive build-input state without adding tracked generated metadata, and garbage-collect state for disabled or deleted local packages.
- [x] 2.5 Add sync regression tests for clean checkout without `lib`, missing output, changed TypeScript source, changed bundled asset, unchanged repeated sync, build failure, and mixed local/remote materialization.

## 3. Stop tracking generated package output

- [x] 3.1 Add ignore rules for TypeScript local-package `lib/` output, declarations and source maps without ignoring native JavaScript source packages.
- [x] 3.2 Remove tracked `lib/` files from `worktree-session` and `sidebar-session-provider-icon`, keeping package exports, `files`, CLI and DSH client entries pointed at generated output.
- [x] 3.3 Update `packages/README.md`, package READMEs and `skills/ws/scripts/ws.sh` expectations so developers know root build/sync generates `lib/` before direct CLI use.
- [x] 3.4 From a state with ignored `lib/` deleted, run root install followed by sync/build and verify package exports, `dsh-ws`, typechecks, tests and both client bundles work.

## 4. Enforce repository artifact policy

- [x] 4.1 Extend `.gitignore` for nested package lockfiles, OpenSpec `checking/baselines/`, bulk `checking/screenshots/`, and disallowed duplicate architecture exports while preserving root lock and approved sources.
- [x] 4.2 Add a lightweight tracked-path policy check that fails on tracked package `lib/`, nested lockfiles, raw checking evidence or duplicate diagram formats, and wire it into an existing root verification command or documented pre-merge check.
- [x] 4.3 Document where exceptional executable fixtures belong and how checking reports record external or ephemeral raw-evidence retention.
- [x] 4.4 Add tests for policy-check pass/fail cases, including root `package-lock.json` and the selected architecture source/display allowlist.

## 5. Slim acceptance evidence

- [x] 5.1 Inventory current active and archived `checking/` content, preserve reports/trails/gates/reproduction scripts, and identify any baseline that is actually a reusable test fixture before deletion.
- [x] 5.2 Move any legitimate reusable fixture to an explicit test fixture path with provenance, then remove tracked raw session/history baselines and bulk screenshots.
- [x] 5.3 Update retained checking reports that reference removed files with either an external artifact locator and retention note or an explicit statement that raw evidence was ephemeral.

## 6. Consolidate architecture documentation

- [x] 6.1 Verify the theme-capable SVG renders on the primary repository host, then update `README.md` to embed/link that single display asset and retain the structured architecture graph source.
- [x] 6.2 Remove duplicate main-architecture PNG and interactive HTML exports after README references are migrated.
- [x] 6.3 Migrate `worktree-session-architecture.html` into maintainable Markdown with Mermaid or compact diagrams, preserving content referenced by active OpenSpec tasks, and update those references.
- [x] 6.4 Remove the generated Worktree Session HTML after validating the replacement documentation covers lifecycle, dependency modes, cleanup and ordinary-session recovery.

## 7. End-to-end verification

- [x] 7.1 Measure tracked file count and byte footprint before/after, and record the achieved reduction without rewriting Git history.
- [x] 7.2 Simulate a fresh checkout by removing ignored outputs, run root `npm ci`, all package typechecks/tests/builds, repository tests and the tracked-path policy check.
- [x] 7.3 Run sync twice in an isolated `DSH_HOME`; verify the first run builds/installs enabled local packages and the second run performs neither rebuild nor deployment change.
- [x] 7.4 Exercise an intentional local-package build failure against an existing installed package and verify sync leaves the deployed version usable.
- [x] 7.5 Run `openspec validate slim-repository-artifacts --strict` and `git diff --check`, then review that only root `package-lock.json`, source/config, summarized evidence and approved architecture assets remain tracked.
