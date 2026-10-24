# P3 direct subprocess closure evidence

## Changed boundary only

The shared builtin `resolveExecutable(command,args,options) -> {command,args}` is now used at the npm/Corepack launch boundaries in:

- sync local workspace build: npm run/build argv, **item.sourceRoot** cwd retained; scope registry probe retains profile cwd.
- host prerequisites: global-root probe and bounded install argv; unsupported install layout becomes a structured diagnostic rather than an uncaught exception, preserving the install helper's never-throw contract.
- plugin updates: asynchronous execFile retained, with merged env and authenticated profile cwd; resolver failure becomes the existing nonzero npm diagnostic.
- third-party resources: integrity npm invocation resolves before the existing injectable spawn boundary; response-shape checks unchanged.
- Pet compat CJS runner: resolves npm/Corepack before creating the bounded supervisor request, preserving cwd, env overlay, timeout, kill grace and capture/throw behavior. npm@11.19.0 and pnpm@11.7.0 arguments are untouched.

No tar extraction, process ownership, runtime policy, package/lock, launcher/main, dsh-cli or run-bounded implementation was edited by this task.

## Concrete boundary RED

`node --test tests/subprocess-closure.test.mjs` initially ran four tests: 0 passed / 4 failed.

1. Integrity spawn still received logical `npm` instead of current Node + resolved JS argv.
2. Scoped plugin metadata attempted real unresolved npm instead of the independent JS recorder and returned skipped rather than up-to-date.
3. Prerequisite global-root probe bypassed the resolver and inspected the wrong global root, reporting the synthetic kernel missing.
4. Pet bounded JSON still contained `corepack` instead of Node + verified JS entry, despite preserving other wire fields.

Tests use copies of actual scripts with one independent resolver-module recorder and JS executable fixtures. They do not alter production source text or add production environment escape hatches. Profiles, npm env markers and files are synthetic.

A later explicit unsupported-layout test was RED with an uncaught resolver stack in prerequisites install. Returning the diagnostic from the install helper fixed the actual root cause without changing best-effort launcher behavior.

## Local-build regression fixture

The task referenced tests/sync-local-build.test.mjs, which did not exist; a focused file was added. It uses the existing overlayFixture, with an independent resolver npm boundary and Node recorder. It proves build argv runs under external overlay sourceRoot, build precedes installation, unchanged second sync does not rebuild, and failed build never installs/removes the package. The initial successful fixture needed to preserve the rest of the real resolver exports after lead concurrently integrated resolveDshCommand into dsh-cli; this fixture-only missing-export failure was fixed without weakening assertions.

## Fresh verification

```sh
node --test tests/subprocess-closure.test.mjs tests/sync-local-build.test.mjs tests/host-prerequisites.test.mjs tests/plugin-update-overlay.test.mjs tests/third-party-resources.test.mjs
```

Before the extra unsupported-layout case: **39 passed, 0 failed, 0 skipped, 0 todo**. Final fresh run including it: **40 passed, 0 failed, 0 skipped, 0 todo**, exit 0; `git diff --check` also passed.

Existing prerequisite tests still prove declared exact pin, registry precedence, no install on ready/disabled/check/skip, failure diagnostics and bounded timeout. Existing scoped metadata test exercises a real local HTTP registry and profile auth asynchronously; no remote registry is needed. Existing third-party integrity/hash/ownership/atomicity/safe archive tests remain unchanged.

Syntax checks for the five changed scripts and `git diff --check` passed in the same fresh run. Native Windows/macOS full manifest execution, real compat builds and terminal lifetime acceptance remain lead-owned; the fixtures are not substitutes for those gates. No real install, global npm operation, deployment or production restart was performed.
