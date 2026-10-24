# P3 builtin package-manager and bootstrap evidence

## Scope

Implemented only `scripts/lib/package-manager.cjs`, `scripts/bootstrap.mjs`, the thin `scripts/bootstrap.sh` wrapper, and the three scoped test files. Package/lock and command-closure integration remain lead-owned. No real install, global link, commit, deployment or Host restart was performed here.

## Fixed synchronous interfaces

- `resolvePackageManager(tool,{env,nodePath,platform}) -> {command,argsPrefix}`.
- `resolveExecutable(command,args,options) -> {command,args}` (complete argv).
- `resolveDshCommand(bin,args,{platform,nodePath,managed=false}) -> {command,args}`. Managed runtimes always use current Node; explicit POSIX executable paths remain direct; Windows explicit JS uses current Node, exe is direct, other/shim forms reject.

CJS exports are synchronously require-able and available as an ESM default. Only Node builtins are loaded. Windows npm/npx candidates validate real file readability, real package root/name and contained JS entry. Current Node install directory is first, validated npm_execpath is fallback, and explicit npm prefix is also supported. Native PATH pnpm.exe precedes pnpm package JS, then Corepack JS. Shim source is never parsed/executed; there is no shell or install fallback. Explicit compat calls keep caller npm/pnpm version arguments unchanged. POSIX logical package-manager names retain existing native PATH behavior.

## Bootstrap

`checkToolchain` reads caller-provided engines values, treats recommendation as a warning and rejects unavailable/old toolchains. The CLI reads root engines and `.nvmrc`, validates npm via the shared resolver, and uses root `npm ci` only when forced or dependency health fails. It never automatically registers npm bin.

`dependenciesHealthy(repo)` checks actual package identity and versions against root lock entries for zx/js-yaml/yaml/semver/TypeScript, and ensures the package's resolvable entry is an existing contained file. Directory existence alone is insufficient. The thin POSIX wrapper checks missing Node before invoking any dirname/readlink tools, emits the minimum versions and Node download URL, then only forwards to the Node implementation.

Import-only test seam `bootstrap({repo,force,env,npmCommand,quiet})` returns `{status,message}`. CLI does not expose a repo/tool override. Integration tests supply an independent Node npm recorder, never run real installs, and validate repeat/force/corrupt-version/missing-entry/failure semantics. Missing Node wrapper verification is explicitly POSIX-specific; universal Node checks are not skipped on Windows.

## RED before implementation

1. Module-not-found was replaced with minimal exported capability skeletons, then `node --test tests/package-manager.test.mjs tests/launcher-bootstrap.test.mjs` ran: 12 tests, 3 pass / 9 fail. Layout cases failed with `package-manager resolution not implemented`, and toolchain cases failed actual expected ok/diagnostic assertions, not import/syntax errors.
2. `node --test tests/launcher-exec.test.mjs`: 3/3 RED against unimplemented executable/DSH classification. Inputs included empty, quotes, Unicode, whitespace, shell metacharacters and trailing backslashes.
3. Before bootstrap implementation, repeat/install failure integration failed because bootstrap did not exist; missing-Node wrapper test demonstrated old dirname error before Node diagnosis. These were resolved by the builtin Node implementation and thin wrapper.
4. Managed-runtime caller integration added a concrete assertion first: POSIX managed JS initially returned the JS file as executable rather than node+argv; the targeted explicit-DSH test failed. Then managed:true handling was implemented.

## Fresh GREEN

```sh
node --test tests/package-manager.test.mjs tests/launcher-bootstrap.test.mjs tests/launcher-exec.test.mjs
```

Result: **19 passed, 0 failed, 0 skipped, 0 todo**, Linux current Node. Covers npm/npx adjacent Node layout; validated npm_execpath fallback; native pnpm precedence; pnpm/Corepack JS; Corepack pinned argv; malformed/package-name mismatches; shim-only rejection; POSIX command contract; CJS/ESM compatibility; actual spawned Node and npm fixture argv/streams/status; real native Git config quoted/empty/NUL roundtrips without alias; DSH JS/exe/shim classification including managed POSIX; initialization minimum/recommendation, repeated health and installation failure; wrapper missing-Node diagnosis.

Read-only actual-root health probe:

```sh
node --input-type=module -e 'import {dependenciesHealthy} from "./scripts/bootstrap.mjs"; console.log("actual-lock-health="+dependenciesHealthy(process.cwd())); if(!dependenciesHealthy(process.cwd()))process.exitCode=1'
```

Result: `actual-lock-health=true`, exit 0, after lead completed root zx installation. This probe performs no install. `bash -n scripts/bootstrap.sh` and `git diff --check` passed.

## Remaining integration/platform boundaries

Windows layout tests here execute against synthetic on-disk trees; this is not a native-Windows smoke. Lead has separately identified a native Windows Node/npm/Git runtime and owns that evidence. Real Windows npm prefix/entry resolution, closure runners, full build and terminal lifetime gates remain required. The managed flag is explicit because arbitrary POSIX DSH_BIN may be a native executable; defaulting every explicit path to Node would break its existing contract. No P2 oracle or shared command assertion was modified during this task.
