# Private manifest overlay (`dsh.yaml.local`)

The public `dsh.yaml` is the single switch surface for customizations, but some customizations cannot be published: internal npm packages, internal collectors, patch fragments with machine-absolute paths. A **private overlay** appends such entries from outside the public repository, while sharing the exact validation path of public entries. The overlay is described by OpenSpec capability `repo-layout` (`openspec/specs/repo-layout/spec.md`, requirements on the local manifest overlay and on declared npm scopes); design rationale is in the archived changes `local-manifest-overlay` and `internal-overlay-repository`.

## Why not `enabled: false`

A disabled entry gated by `enabledEnv` keeps the package off by default, but it does not keep it private: the public manifest still names the internal package, its registry, maintainer and service description. An overlay keeps those facts out of the public repository altogether.

## Format

The default location is `dsh.yaml.local` at the repository root (gitignored). Its `customizations` list is structurally identical to the public one, including `note`, `brief` and `enabledEnv`; review records stay with the entries in that file.

```yaml
customizations:
  - id: some-internal-package
    type: package
    source: remote
    spec: '@scope/pkg@1.2.3'
    version: 1.2.3
    enabled: true
    brief: short description
    note: 'source, review date, trust surface, ...'
```

## Boundaries (all fail closed)

The overlay can only append customization entries.

| Overlay content | Result |
|---|---|
| New customization id | accepted; indistinguishable from a public entry |
| Id duplicating a public id | error (public entries cannot be overridden) |
| Duplicate id inside the overlay | error |
| `dshVersion`, `autoUpdate`, `web`, `agentInstructions` or `dependencies` | error |
| File absent | silently ignored (the normal case) |
| File present but unreadable or not a mapping | sync errors; the startup listing degrades without blocking |

Overlay entries go through the same checks as public ones: required fields, exact version pins for `source: remote`, `deps` integrity, `enabledEnv` naming, and the `hostRuntimeCompatibility` version fence, whose "at most one owner" assertion counts public and overlay entries together.

## Overlay root (isomorphic private repository)

The directory holding the overlay file is its **root** (`dirname(realpath(overlay file))`). Overlay entries take their sources from that root, using the same layout as the public repository:

```text
<R>/                      # e.g. a private repository next to the public one
├── dsh.yaml              # the overlay itself (DSH_LOCAL_MANIFEST points at it)
├── package.json          # workspaces: ["packages/*"], with its own lockfile
├── package-lock.json
├── packages/<id>/        # local packages of the overlay
├── patches/<id>.yml      # patch fragments of the overlay
└── skills/<id>/          # skills of the overlay
```

- Public entries only read sources from the public repository; overlay entries only from `<R>`. Neither falls back to the other.
- Local packages of `<R>` are built with `npm run build --workspace <name>` using `<R>` as the working directory; build dependencies live in `<R>`'s own `node_modules`. There is one lockfile per root, and the public `package.json`/lockfile are unaffected.
- `buildInputs` and `compatDependencies` paths are relative to the owning root and their realpath may not leave it.
- If `dsh.yaml.local` in the public checkout is a symlink to `<R>/dsh.yaml`, the owning root is the link **target's** directory.

**Trust model.** The overlay root is as trusted as the public repository: it can declare local packages, which run build scripts on the machine and are loaded by DSH. Only use a repository you control.

## Wiring a machine

`DSH_LOCAL_MANIFEST` holds the **absolute** path of the overlay. It replaces (does not add to) the default path; relative paths are rejected.

```bash
git clone <private-repo-url> ~/opensource/<private-repo>
(cd ~/opensource/<private-repo> && npm ci)
# in the public checkout's .env.local (gitignored, sourced by bin/dsh):
echo "export DSH_LOCAL_MANIFEST=$HOME/opensource/<private-repo>/dsh.yaml" >> .env.local
# if overlay entries declare npmScopes, configure the scope registry (sync never writes it):
echo "@example:registry=https://registry.example.com/" >> ~/.dsh/profiles/web/.npmrc
dsh build
```

Running `node scripts/sync.mjs`, `scripts/plugin-list.mjs` or `scripts/plugin-update.mjs` directly (without `bin/dsh`) also works: the scripts read the repository's `.env.local` themselves, but only two kinds of variable: `DSH_LOCAL_MANIFEST` and the variables named by `enabledEnv` declarations. Everything else (for example `DSH_HOME`) is still owned by `bin/dsh`. Two rules apply: a value already present in the caller's environment wins (an empty string counts as set), and values are parsed literally with no shell evaluation, so a leftover `$HOME`, `~` or backtick makes sync report the line number and refuse to run. Without this reading, a bare sync would not see the overlay and would silently uninstall overlay packages while still exiting 0.

**Moving the private repository.** After changing `DSH_LOCAL_MANIFEST`, sync rewrites the `file:` paths in the profile `package.json`, but the profile's `pnpm-lock.yaml` still records the old path, so pnpm fails with `ENOENT` while refreshing and sync rolls back. Create a temporary symlink from the old path to the new location, run `dsh build` once so pnpm rewrites the lockfile, remove the link, then run it twice more to confirm idempotence.

After `git pull` in the private repository, run `dsh build` again to keep machines consistent. Do not expect cockpit to distribute an overlay: multi-machine routing never synchronizes files, and each machine builds its own configuration.

## `npmScopes`

A `type: package` entry may declare the npm scopes it needs to install:

```yaml
  - id: some-internal-package
    type: package
    source: remote
    spec: '@example/pkg@1.2.3'
    version: 1.2.3
    enabled: true
    npmScopes: ['@example']
```

- Load-time validation: allowed on `type: package` only, as a list of `@scope` values.
- After the profile skeleton exists and before any customization is materialized or ledger migration runs, sync executes `npm config get <scope>:registry` with the profile directory as cwd (the same resolution npm uses at install time: user `~/.npmrc`, the profile `.npmrc`, `npm_config_*`). A missing registry is an error naming the scope, the entry id and the profile directory.
- Sync only validates; it never writes registry configuration. Disabled entries are not validated. `npm_config_registry` (the default registry) does not satisfy the scope check.
- For scoped packages the update check uses `npm view` with the profile directory as cwd when the scope has a registry there, so metadata comes from the same registry and credentials as the install; otherwise it uses the default registry. Every row carries `fromOverlay`. `plugin-update` rewrites only the public `dsh.yaml`; for overlay entries it only prints that a manual upgrade in the overlay is needed.

## Source preflight and rollback

A regular sync first runs a **source preflight** before writing to `$DSH_HOME`: every enabled entry's source files (patch fragments, skill directories, local packages, compat dependencies, `buildInputs`, the runtime builder) must exist and their realpath must stay inside the owning root. All problems are listed at once and `$DSH_HOME` is left unchanged. It then resolves every package's npm name and checks that names are unique among the profile `package.json` keys of packages, top-level `dependencies` and `compatDependencies`, so an overlay cannot shadow a public package under a different id.

- **Disabled private plugin while the private repository is absent:** a disabled local entry without a `package.json` counts as absent from the manifest; sync removes it from the deployment ledger without needing the source.
- **Revoking everything:** `node scripts/sync.mjs --reset` skips the source preflight and name resolution, so it works even when the private repository or runtime builder is missing.
- **Leaving the overlay entirely:** delete the `DSH_LOCAL_MANIFEST` line from `.env.local` (and `dsh.yaml.local` from the repository root), then `dsh build`; overlay entries are uninstalled as if removed from the manifest.

## Known constraints

- **Review records leave version control.** An overlay entry's `note` has no git history in the public repository; the private repository is the mitigation. Keeping internal facts out of the public repository is the intended trade-off.
- **Worktrees have no overlay by default.** Gitignored files are not copied by `git worktree add`, so a sync inside `.worktrees/*` follows the public manifest without error. Point `DSH_LOCAL_MANIFEST` at a stable path outside the repository when needed.
- **Repository tests are isolated from the machine's overlay.** `npm test` sets `DSH_LOCAL_MANIFEST` to a nonexistent absolute path; tests that need an overlay bring their own temporary fixture.
- **Generated files never name the overlay location.** The marker header of `cordis.patch.yml` only says "plus the local manifest overlay, if any".
- **The public repository does not reveal that an overlay exists.** This is deliberate: which internal tools a machine carries should not be published, so no counts or existence claims appear.
