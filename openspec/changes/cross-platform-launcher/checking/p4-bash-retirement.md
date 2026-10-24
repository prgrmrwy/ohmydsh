# P4 product Bash retirement evidence

## Preconditions and RED

Lead authorized retirement after P3 Node command contracts were GREEN. A new ordinary test, `product legacy entry forwards only to Node and no Bash dispatch modules remain`, was added first. It failed against the full Bash entry because no Node forwarding exec existed. No existing behavior assertion was removed or weakened.

## Product cutover

`bin/dsh` is now a thin POSIX compatibility link wrapper: missing-Node diagnosis, historical symlink resolution, then `exec node .../dsh.mjs` with unchanged argv. npm bin directly targets `dsh.mjs`. There is no command routing, environment sourcing, runtime provision, Host lifecycle or UI logic in the wrapper.

The five temporary `scripts/launcher/*.sh` product modules and `scripts/lib/dsh-runtime.sh` were deleted. Before any unlink, the exact managed root was verified, every resolved absolute filename was checked against the intended non-symlink path, and each file's bytes were compared with the frozen P1 oracle. Only those six exact verified files were deleted. No MJS file or oracle file was touched.

Reference search found no live product consumer of the retired runtime shell helper; only historical tests referenced it (now moved) and one explanatory comment in dsh-server-bin mentions its previous identity matching. No product shell fallback remains.

## Historical test preservation

The six suites below explicitly read/copy the frozen test-only Bash oracle:

- launcher-cli-routing
- launcher-host-prerequisites
- launcher-npm-env
- launcher-modules (historical source purity plus the new product-retirement assertion)
- launcher-atomic (explicit Bash fixture adapter)
- dsh-runtime (historical Bash owner/signal behavior)

All previous assertions are retained. The three legacy regex-based subprocess replacements remain confined to the historical test oracle; they are **not** Node migration proof. Existing Node shared contract, strict environment and lifecycle suites separately verify the new product. The frozen seven-file oracle is not an installed platform branch or executable fallback.

## Fresh verification

```sh
node --test tests/launcher-cli-routing.test.mjs tests/launcher-host-prerequisites.test.mjs tests/launcher-npm-env.test.mjs tests/launcher-modules.test.mjs tests/launcher-atomic.test.mjs tests/dsh-runtime.test.mjs
```

Result: **60 passed, 0 failed, 0 skipped, 0 todo**, exit 0. `bash -n bin/dsh` and `git diff --check` passed in the same run.

```sh
node bin/dsh.mjs --help
bash bin/dsh --help
node --test tests/launcher-contract.test.mjs
```

Both entrypoints printed the same Node command help, exit 0. Actual current Node shared command contracts: **23 passed, 0 failed, 0 skipped, 0 todo**, exit 0, including the former invalid-input RED cases. No live Host or production deployment was started by these help/contract checks.

## Boundaries

This task does not claim native Windows/macOS full gates, terminal-close acceptance, full public manifest support or final root-suite approval. Lead owns CI/docs and global integration. Historical Bash tests passing are explicitly not reported as Node implementation coverage. No snapshot rewrite or broad compatibility branch was introduced.
