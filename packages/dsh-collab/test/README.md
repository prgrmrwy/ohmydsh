# Isolated component probes

English · [简体中文](README.zh.md)

These are task 1.2 probes, not a deployed dsh-collab plugin or the task 1.3 released-Host shutdown tests.

Run existing-root probes without installing anything:

```sh
node packages/dsh-collab/test/run-components.mjs
```

For real SessionController/preset/file/Bash/approval probes, first obtain explicit permission to prepare test dependencies and run `ws promote`. Copy the exact dependency recipe to the ignored isolated directory, then install there only:

```sh
mkdir -p spike/collab-components
cp packages/dsh-collab/test/support/component-dependencies.json spike/collab-components/package.json
npm install --prefix "$PWD/spike/collab-components" --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund
npm ls --prefix "$PWD/spike/collab-components" --all
node packages/dsh-collab/test/run-components.mjs --controller
```

Verified toolchain: Node v24.20.0, npm 11.19.0; worktree-source transpilation uses TypeScript 5.9.3 from the existing root workspace dependencies (prepare those via the repository's normal dependency workflow first). The recipe preserves top-level exact versions and compatibility overrides, not a byte-for-byte lock of all transitive dependencies; inspect `npm ls --all` and record the actual graph before claiming a rerun. No second tracked lockfile is introduced.

The recipe pins DSH components to 0.2.0-rc.2, Cordis 4.0.4, loader 1.0.5, include 1.0.9 and group 1.0.4. The loader-family overrides prevent current registry patch releases from mixing a newer Cordis peer graph into this older compatibility experiment. Do not use `--force` or `--legacy-peer-deps`. An old partially resolved fixture may retain nested incompatible packages: preserve the recipe, verify the exact fixture dependency paths, then regenerate only its node_modules and lockfile. Never delete root-workspace or daily-profile dependencies.

The runner creates a temporary HOME/DSH_HOME, clears inherited credentials, starts only a Node test subprocess with ScriptedAdapter, and validates exact temporary paths before cleanup. No user session, external model, full DSH executable, webserver or daily profile is used. Credential backend initialization may create a new fixture-only browser auth secret; do not print or preserve it.

`component-seams.test.mjs` checks actual tool caller identity, idle/busy followup and physical JSONL reload. `controller-seams.test.mjs` resolves all runtime imports from one isolated graph and checks real service activation, P1→P2 selection persisted despite stale P1 header, fresh-Context official resolveAgent, real request tool schemas, read-only file and shell denial plus allowed controls, and actual never approval rejection.

The worktree case compiles four existing worktree-session source modules into the temporary fixture and installs their real recovery/guard functions from an agent/created hook. It uses a real throwaway Git repository/worktree. This is recovery/guard component coverage at official cold Agent publication, **not** a claim that the full worktree-session plugin's HTTP/archive/reconciliation assembly was installed. The fixture is removed with its owning temporary home.

All error/turn completion outcomes must be asserted; AgentLoop contains driver errors, so `whenIdle()` alone is not a success oracle. No consumer acceptance scenario should be marked complete solely because these probes pass.
