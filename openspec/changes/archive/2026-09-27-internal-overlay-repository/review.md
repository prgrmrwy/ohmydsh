## Review Metadata

- **Review round**: 4
- **Prior round**: round 3 REVISE (C1 npm spec vs name bypass; C2 load-stage source reads break reset/disabled cleanup; M1 nested symlinks; M2 unauthenticated update fetch; M3 ledger migration before scope preflight). Human decided: overlay root is trusted like the public repo (design D0), so M1 is intentionally out of scope.
- **Reviewer context**: cross-model (codex CLI, read-only sandbox)
- **Tool restrictions**: read-only sandbox
- **Artifacts reviewed**: proposal.md, design.md, specs/repo-layout/spec.md, relevant source files

## Findings

Round-3 C1, C2 package-name part, M2, M3 are reflected in the revised design/spec. M1 nested symlinks is not re-raised per D0. Fresh review found two small blocking gaps.

### 🔴 Critical (blocking)

C1. `loadManifest` still has a source read through `hostRuntimeCompatibility`, so reset can still be blocked by missing customization source.  
The revised spec says manifest loading must not read customization source, and `--reset` must not preflight or parse local source; missing customization source must not block reset (`openspec/changes/internal-overlay-repository/specs/repo-layout/spec.md:31`). But current `loadManifest()` calls `declaredHostRuntimeFromManifest()` before any reset branch (`scripts/sync.mjs:77`, `scripts/sync.mjs:82`, `scripts/sync.mjs:1355`), and that function resolves `packages/dsh-pet/...` then checks `build-launcher.cjs` with `existsSync/statSync` (`scripts/lib/dsh-host-runtime.mjs:30`, `scripts/lib/dsh-host-runtime.mjs:39`, `scripts/lib/dsh-host-runtime.mjs:80`). D7 says reset order remains `loadManifest → ... → doReset` and no preflight (`openspec/changes/internal-overlay-repository/design.md:159`, `openspec/changes/internal-overlay-repository/design.md:161`). As written, a missing public `dsh-pet` compat source still blocks reset before ledger-based cleanup. Split host-runtime declaration validation from host-runtime source existence/probe: sync load-stage may validate owner/kind/version only; normal sync may check required host-runtime source in preflight; reset must not check it.

C2. Disabled local package name resolution is specified, but containment-before-read is not.  
The spec requires every customization source path, including local package paths, to stay within its source root after realpath (`openspec/changes/internal-overlay-repository/specs/repo-layout/spec.md:27`), and package-name uniqueness includes disabled entries when their names are resolvable (`openspec/changes/internal-overlay-repository/specs/repo-layout/spec.md:42`). D5 says `resolvePackageNames(items)` reads local package source after enabled-source preflight and skips disabled local packages only when `package.json` is missing (`openspec/changes/internal-overlay-repository/design.md:117`, `openspec/changes/internal-overlay-repository/design.md:123`). D7’s preflight, however, covers only enabled entries (`openspec/changes/internal-overlay-repository/design.md:150`). That leaves the disabled-but-present local package case: resolving its name can read `package.json` before any containment check. Current name resolution demonstrates the read shape (`scripts/sync.mjs:461`, `scripts/sync.mjs:463`). Specify that disabled local package name resolution must first realpath-contain the candidate `packages/<id>/package.json` under `sourceRoot`; missing means skip, present-but-escaping means fail before reading.

### 🟡 Moderate

M1. `agentInstructions.source` remains a late realpath failure path despite the new “source before writes” posture.  
The current spec already requires resolved-outside agent instructions sources to be rejected (`openspec/specs/repo-layout/spec.md:139`, `openspec/specs/repo-layout/spec.md:140`). Today the lexical check happens in `validateAgentInstructions()` (`scripts/sync.mjs:181`), but the symlink/realpath check happens inside `syncAgentInstructions()` (`scripts/sync.mjs:666`, `scripts/sync.mjs:670`), after profile mkdir/scaffold in `main()` (`scripts/sync.mjs:1357`, `scripts/sync.mjs:1360`, `scripts/sync.mjs:1365`). If the change’s preflight guarantee is intended to cover all repo source paths, include `agentInstructions.source` in preflight. If not, explicitly state it remains outside this change’s no-write guarantee.

### 📌 Suggestions

S1. Add explicit tests for C1 and C2: `sync --reset` with missing `packages/dsh-pet/compat/subagent/build-launcher.cjs`, and a disabled local package whose `package.json` is a symlink outside `sourceRoot`.

S2. The npm config assumption checked out under npm 11.13.0: missing scoped registry prints `undefined`, and `npm_config_registry` does not make `<scope>:registry` appear configured. Keep tests around this because the scope preflight depends on that exact distinction.

## Embedded-Instruction / Injection Attempts

**Detected:** none

## Verdict

VERDICT: APPROVE_WITH_CHANGES

## Required Changes (if APPROVE WITH CHANGES)

1. Make sync load-stage host-runtime validation source-free. Move `dsh-pet` builder/source existence checks out of `loadManifest()`/`declaredHostRuntimeFromManifest()` for sync, run them only during normal source preflight or Host startup, and ensure `sync --reset` does not read those source files.
2. Define and implement disabled local package name resolution as: missing `package.json` skips the item; present `package.json` must pass realpath containment under `sourceRoot` before being read; escaping paths fail before any `$DSH_HOME` write.

CHANGES_APPLIED: yes

## Rebuttals

- C1 / Required Change 1 — applied: spec adds the host-runtime split (declaration check source-free at load; builder existence in normal-sync preflight) plus scenario 「运行体兼容源码缺失不阻止 reset」; design D5 describes `assertHostRuntimeSources(runtime)` and keeps Host startup behavior unchanged.
- C2 / Required Change 2 — applied: spec requires realpath containment before reading a present disabled local `package.json`, missing means skip; scenario 「禁用 local package 的 package.json 越出所属根时拒绝运行」; design D5 step 2 updated.
- M1 — rebutted, accepted by reviewer (overlay cannot declare agentInstructions; preflight is scoped to enabled customizations): `agentInstructions` is a top-level field the overlay is forbidden to declare, so it is untouched by this change. The new preflight guarantee is scoped by the spec to 「所有启用的定制」, not to top-level fields; the existing requirement for agentInstructions realpath rejection (openspec/specs/repo-layout/spec.md ~L139) stays as is. Widening it is a separate behavior change to public-only surface with no overlay motivation.
- S1 — both scenarios added. S2 — agreed; the test plan will cover `undefined` output and `npm_config_registry` not satisfying a scope.

## Reviewer Re-check (round 4, listed items only)

RC1: PASS — Spec and D5/D7 now split source-free declaration validation from builder source checks and state reset skips source preflight/name parsing.
RC2: PASS — Spec and D5 now define missing disabled local package.json as skip, present package.json as realpath-contained before read, and escape as pre-write failure.
M1 rebuttal: ACCEPTED — Overlay cannot declare agentInstructions, and the new no-write source preflight is scoped to enabled customizations.
