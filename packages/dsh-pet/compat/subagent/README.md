# Pinned-source Host compatibility runtime

English · [简体中文](README.zh.md)

## Current scope

DSH is pinned to `0.2.0-rc.2`, reviewed upstream commit `639ed015397290b3745d163aafe02ffee4aa3f84`. Only **team-membership** (one package) remains; model-display was retired separately on main. The historical directory name is retained for launcher callers; it no longer produces a subagent artifact.

The launcher uses official `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-agent-loop`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-tool-subagent`, `@deepseek-ai/dsh-tool-subagent-control`, `@deepseek-ai/dsh-tool-workflow`, and `@deepseek-ai/dsh-tool-ralph`. None is copied or overridden, and neither the final-guard capability marker nor managed-effect owner annotations are required.

The `locus-three-tier-structure` change retires settlement-notice, inquiry-isolation, newinquiry-tools-guard and native-managed-effects together with their templates and specialized verifiers. Three-tier Locus uses official default settlement to its Pet-owned locus main, first-prompt `startContinuable`, a locked `locus-base` parent preset, live-agent policy changes or deferred application, and `sessionQuery.observeSession` for cold reads. Inquiry history stays read-only; no inquiry execution resumes. See [design decisions 3–11 and Risks](../../../../openspec/changes/locus-three-tier-structure/design.md).

**Accepted risk, not equivalent protection:** removing the tools patch removes the final scoped-guard recheck. Mutable filesystem/binding state can change between the initial guard and body invocation, including asynchronous `tools/execute` wrappers and prepare→dispatch parallel scheduling. The owner accepted that window; ordinary scoped guards, restrict layers and managed finish remain separately enforced. Task 1.5 inspected the actual full preview profile: the official `session-checkpoint-policy` awaits a session flush after the guard and before the tool body; the owner accepted that window too ([audit](../../../../openspec/changes/locus-three-tier-structure/probes/full-profile-wrappers.md)). The compiled graph verifier below does not repeat that full-profile inspection.

## Retained extensions

### Team membership

`team-membership.patch` replaces only `@deepseek-ai/dsh-experimental-agent-team`, version `0.2.0-rc.2-team-membership.1`, SHA-256 `0f42cab5802bcc468ed05cdba5522abe9115cef858543d97c5300ef3d8f95bae`. Rostered active/provisioning teammates retain priority. Other provider-owned children with `header.origin === 'subagent'` do not become implicit Leads before their first descriptor, including during parent teardown. Ordinary roots and non-provider Host forks remain Leads. Session format, descriptor timing and actual Team tools are unchanged. Retire once official roster handling covers this unpublished-descriptor window and Team/one-shot isolation regressions pass on the installed graph.

## Build and verification

Run from this directory:

```sh
node --test test-packaging.cjs ../../test/team-membership-builder.test.cjs
DSH_COMPAT_SUBAGENT_CHECKOUT=/absolute/worktree/.compat-isolated/id/upstream \
  node build-launcher.cjs --isolated-output /absolute/worktree/.compat-isolated/id/output
PET_COMPAT_TEST_GRAPH=/absolute/worktree/.compat-isolated/id/output/launcher node --test test-packaging.cjs
node verify-official-runtime.mjs --graph /absolute/worktree/.compat-isolated/id/output/launcher
```

Use a clean independent checkout at the exact commit for isolated work. The output must be new/empty and outside compat sources and the upstream checkout. Isolation does not publish or move the formal `.launcher` pointer. `build.mjs` alone emits only the retained team-membership package; `build-launcher.cjs` assembles and verifies the staging graph and renamed final graph, including DSH `--version` and `npm ls --all`. Neither is live GUI acceptance.

The official-runtime verifier rejects extra file overrides, checks all seven retired owners use exact official releases and share physical subagent/loop/tools resolution, mounts actual native plugins with inert providers, checks absent owner markers and capability flags, and executes an ordinary scoped-guard denial plus allowed control. It makes no final-guard equivalence claim. `PET_COMPAT_TEST_GRAPH` is explicit: without it, the artifact-plane packaging test is reported skipped, never silently pointed at a daily launcher.

The source builder applies only the retained team patch, builds the native Host addon, runs the Team behavior tests, then builds the Host face. It verifies the hash before applying and restores tracked source on exit. Read upstream evidence from clean HEAD, not a potentially patched cache. A successful cache stamp covers the commit plus the patch/template; changed/unknown inputs scrub ignored output before rebuilding. Failed builds never earn a stamp.

Node must be `^22.19.0 || >=24.0.0`; builders pin `pnpm@11.7.0` and launcher `npm@11.19.0`. Registry access may be needed even with cached packages; failures are errors, not successful validation. No root-workspace dependency install is required by these commands.

## Selection, install policy and publication

The local Pet customization's `hostRuntimeCompatibility` declaration selects this whole long-running `dsh web` Host dependency root, not a Pet-local overlay. One-shot build/sync/plugin/config CLI calls still use the exact official `dshVersion`; `DSH_BIN` remains an explicit emergency override. Version mismatch fails closed and requires re-audit, not just a new version string.

`install-script-policy.json` is the exact-version reviewed npm script policy. Project scope and strict mode are forced; ignore/allow-all bypasses are disabled and conflicting environment keys stripped. Unknown script versions fail; new true grants require separate human review. Framework versions are derived from reviewed source; the existing reviewed undici compatibility pin remains separate from the retired Pet patches.

The shared build lock covers source and launcher stages and reclaims only a proven-dead owner with matching inode/token/PID. Missing/corrupt owner or reclaim residue fails after bounded waiting; never bypass a live/unknown lock. POSIX publication replaces the pointer atomically; Windows uses backup/publish/verify with rollback and a short absent-pointer interval. Host preparation holds the same lock through entry/version/fingerprint reads and returns the immutable generation. Unknown/dangling pointers or interrupted next/previous/restore residue fail closed. Generations are retained; cleanup is separate.

Fingerprint inputs include the team patch/template, builders, script policy, lock/publication helpers and the graph verifier. A prior isolated graph is not proof of changed inputs. Generated artifacts are not source truth and stay out of Git. Any failure leaves the prior formal launcher intact; Host startup does not silently fall back to official runtime.
