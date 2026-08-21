## Context

See `proposal.md` for motivation. The repository currently installs enabled local packages with `dsh plugin add file:<package-dir>`. Their manifests and executable entries point to `lib/`, while `scripts/sync.mjs` hashes the whole package directory and directly reinstalls changed bytes without first building. Consequently, removing tracked `lib/` requires making build readiness an explicit precondition of local installation.

The repository is currently a root npm project, but the two TypeScript packages each carry a separate devDependency graph and lockfile. Worktree Session separately depends on the root `package-lock.json` hash for lean dependency reuse and uses root `npm ci` during promotion. Any consolidation must preserve that root lockfile contract.

The largest tracked assets are not source code: archived checking baselines/screenshots and multiple formats of generated architecture diagrams. These need retention rules, not a new runtime subsystem.

## Goals / Non-Goals

**Goals:**

- Make a clean checkout build and install every enabled TypeScript local package without tracked `lib/` files.
- Ensure sync never replaces a working deployed package with an unbuilt or failed local package.
- Establish one root dependency lock and one root installation path for repository development.
- Reduce tracked content materially while preserving reviewable OpenSpec outcomes and maintainable architecture documentation.
- Make the repository rules enforceable through ignore rules and automated checks.

**Non-Goals:**

- Converting the native-JavaScript `subscriptions-sandbox-shim` package to TypeScript.
- Rewriting DSH's package installation mechanism or changing package exports away from compiled JavaScript.
- Removing the root `package-lock.json`, changing Worktree Session dependency modes, or replacing npm.
- Rewriting Git history; the change reduces the current tree and future growth only.
- Designing a permanent external artifact hosting service. Existing CI/hosted artifacts may be used where available; otherwise reports may state that raw evidence is ephemeral.

## Decisions

### 1. Use npm workspaces and the root lockfile as the dependency boundary

The root `package.json` will declare the maintained local packages as workspaces. Dependencies remain declared in each package manifest, while a single root install produces and locks the complete workspace graph in the root `package-lock.json`. Package READMEs will direct developers to install from the repository root rather than running package-local `npm install`.

This preserves package ownership of dependency declarations while eliminating two near-identical 187 KiB lockfiles. It also keeps Worktree Session's existing root-lock fingerprint meaningful.

Alternatives considered:

- **Delete nested locks without workspaces:** smaller diff, but the root install would not guarantee package build/test dependencies, so a clean checkout could not reliably auto-build.
- **Keep independent package locks:** maximizes package-level isolation but retains duplicate graphs and conflicts with the requested repository-wide lock source.
- **Move all package dependencies into the root manifest:** loses self-contained package manifests and makes future publication harder.

### 2. Build enabled TypeScript local packages before calculating install content and before removal

For each enabled local package, sync will determine whether it has a build script and whether its source/build inputs require rebuilding. It will run the package build from the workspace context before computing the directory hash used for reinstall decisions. Only after a successful build may sync compare/install/reinstall package bytes.

The safe order is:

```text
validate manifest/package
        │
        ▼
resolve root-installed build dependencies
        │
        ▼
build local package into ignored lib/
        │ success
        ▼
compute install-content hash
        │
        ▼
remove old deployment → install new package
```

A failed build stops that package before any remove action, retaining the last working deployment. `lib/` remains the runtime/package boundary so DSH and the `dsh-ws` CLI do not need TypeScript loaders.

Build invalidation will be based on deterministic input/output checks rather than simply executing every build on every sync. At minimum, missing outputs force a build; source, package manifest, TypeScript/tsdown configs and asset changes must invalidate outputs. The implementation may persist a build-input hash in ignored output metadata or compare a pre-build input hash with managed sync state. The hash must exclude `lib/`, `node_modules`, VCS metadata and transient checking outputs.

Alternatives considered:

- **Rely on npm `prepack`:** installation behavior for local file dependencies is tool/version-sensitive, and sync cannot guarantee failure occurs before replacement.
- **Commit `lib/`:** simplest deployment but preserves source/output drift and review noise.
- **Run TypeScript directly:** incompatible with current DSH package loading and CLI entry expectations.
- **Always build every enabled local package:** correct but makes an otherwise idempotent sync unnecessarily slow and noisy.

### 3. Separate build-input identity from install-content identity

The existing `dirHash(localDir)` includes every package file. Once `lib/` is ignored but generated locally, hashing the entire directory can make output timestamps/maps or transient files trigger reinstalls. Sync will use:

- a **build-input hash** over source, package manifest, build configs and bundled static assets to decide whether `lib/` is current;
- an **install-content hash** over the publishable package content (`package.json`, bundle patch, `lib/`, README/license/notice as applicable), excluding `node_modules`, locks and transient files, to decide whether deployed bytes changed.

This makes repeated sync a true no-op while still detecting rebuilt output changes.

Alternative considered: keep one whole-directory hash. It is simpler but couples deployment churn to irrelevant files and nested lock removal.

### 4. Retain summarized acceptance evidence, not raw captured sessions

For both active and archived OpenSpec changes, Git may retain `checking/report.md`, trail definitions, gates and small reproduction scripts. `baselines/` raw histories and bulk `screenshots/` will be untracked and ignored by default. A report that relies on externally retained evidence will record its artifact locator and retention note; if no durable host exists, it will state that raw evidence was ephemeral rather than pretending Git is the artifact store.

Exceptional small fixtures that are executable test inputs belong under an explicitly named fixture directory, not `checking/baselines/`, and must be reviewed as test data.

Alternative considered: compress evidence into archives. That reduces working-tree size but leaves opaque binary churn and does not improve reviewability.

### 5. Keep one architecture display plus an editable source

The main repository architecture will keep the small structured graph source and a single theme-capable SVG for README display. Duplicate light/dark PNGs and self-contained interactive HTML exports will be removed. The README will link/embed the SVG only.

The Worktree Session architecture document will be migrated from a 628 KiB generated HTML file to a maintainable Markdown document with Mermaid or compact inline diagrams. This preserves the design information referenced by active tasks without retaining a generated application-sized artifact.

Alternatives considered:

- **Keep one PNG:** broadly rendered but larger, raster-only and does not support dark/light adaptation as cleanly.
- **Keep interactive HTML only:** rich locally but not directly useful in ordinary source review and costly to diff.
- **Delete all diagrams:** maximizes size reduction but loses useful architecture documentation.

### 6. Enforce policy at ignore and verification layers

`.gitignore` will cover package build directories, nested package lockfiles, raw checking evidence and disallowed generated architecture formats. A lightweight repository check will inspect tracked paths, because `.gitignore` alone does not reject already-tracked or force-added files. The check will also verify that the allowed root lock and selected architecture assets remain present.

## Risks / Trade-offs

- **[Root workspace lock changes substantially]** → Regenerate it once with the existing npm major, review package versions, and verify root `npm ci`, package tests and Worktree Session fingerprint behavior.
- **[sync build slows normal startup]** → Cache by build-input hash and skip builds when outputs are present and current.
- **[stale output is incorrectly reused]** → Include all source, config and bundled asset inputs in invalidation; test clean, changed-source, changed-asset and missing-output cases.
- **[build succeeds but install fails after old package removal]** → Build before removal eliminates the new risk introduced here; existing remove/add installation atomicity remains unchanged and should be covered by regression tests.
- **[package-local developer workflow changes]** → Document root commands and provide root scripts for per-package build/test where helpful.
- **[loss of historical raw acceptance evidence]** → Preserve conclusions and reproduction steps in reports; use external artifacts when audit retention is actually required.
- **[ignore patterns hide a legitimate fixture]** → Keep executable fixtures outside ignored baseline/screenshot paths and require an explicit naming/review convention.
- **[README SVG rendering varies by host]** → Verify rendering on the repository's primary host; fall back to one optimized PNG only if the host cannot render the chosen SVG.

## Migration Plan

1. Add workspace metadata and update the root lockfile using the current Node/npm toolchain; verify a clean root `npm ci` exposes package build tools.
2. Implement and test local-package build/input/install hashing in sync while tracked `lib/` still exists, including build-failure-before-remove behavior.
3. Update `ws.sh`/developer documentation as necessary so generated CLI output is expected after root build or sync.
4. Add ignore rules and tracked-path policy checks.
5. Remove nested locks and tracked `lib/`, then simulate a clean checkout by deleting ignored outputs and running root install, package checks and sync twice.
6. Replace architecture exports and README references; migrate Worktree Session architecture content to Markdown/lightweight source.
7. Remove raw checking baselines/screenshots while retaining reports and reproduction metadata; run OpenSpec validation and repository policy checks.

Rollback is a normal Git revert. If local auto-build proves unreliable, restore tracked `lib/` and nested locks together with the previous sync behavior; do not revert only one side of the source/output contract.
