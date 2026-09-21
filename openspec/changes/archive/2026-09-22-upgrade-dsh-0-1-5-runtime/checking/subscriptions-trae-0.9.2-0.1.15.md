# Subscriptions and Trae audit

## `dsh-plugin-subscriptions@0.9.2`

The exact npm artifact is:

- tarball `https://registry.npmjs.org/dsh-plugin-subscriptions/-/dsh-plugin-subscriptions-0.9.2.tgz`;
- npm integrity `sha512-QWlwbQmhFaT6Tl1D/oByixH+ut2HsBDxRkWmwM7vqqASolRbXqQzlqx780Adyj9aicZXOJK4b/GuYQUPGjRYbw==`;
- SHA-256 `caa0bc8df715762ac740c27ce9244b58bdb8272d19cb1a7d4cbfd920ef4fb94e`;
- registry `gitHead` `963e7bc9a92ca98853270a7c9c9be6442ec60a48`, annotated tag object `80b1d825d3552faa28003924b571a99657cefef0` for `v0.9.2`.

The four production DSH peers (`dsh-attachment`, `dsh-home-paths`, `dsh-llm`, `dsh-tools`) currently accept only the old ranges. The required minimal production patch appends exactly `|| ^0.1.5-rc.2` to those four lines and changes no runtime source, client inject or Cordis patch. The published runtime already contains the 18 `/api/subscriptions-auth.*` routes and command description resolver.

A fresh reproducible minimal compatibility artifact is now published from the exact upstream `v0.9.2` commit. The remote identity is `https://github.com/prgrmrwy/dsh-plugin-subscriptions` branch `compat/dsh-0.1.5-rc.2-peer-only-v0.9.2` at commit `c24abd94bf7d83d27602c91fa0d07292ccb5e46c`, with annotated tag `v0.9.2-dsh-0.1.5-rc.2-peer.1` (tag object `a23a3c7d3eb165134b58f8e1e02018ad47b88c65c`). The fixed release asset is [`dsh-plugin-subscriptions-0.9.2.tgz`](https://github.com/prgrmrwy/dsh-plugin-subscriptions/releases/download/v0.9.2-dsh-0.1.5-rc.2-peer.1/dsh-plugin-subscriptions-0.9.2.tgz), SHA-256 `885b0a5d7b7333e48a32e5ab81361fe653815c196fd42f1ff2f66738baa30fbf`, npm integrity `sha512-0ezy0cd5gmxSTwvw+tnC3yBuak6BtU8M6zm8bv8FgI4Dr/RA0/RvigK5Txm69awBJeGHYb2mmQc9tluqAaLn+Q==`; a fresh download matched a fresh local `npm pack` byte-for-byte. The commit has exactly the four production peer appends (`dsh-attachment`, `dsh-home-paths`, `dsh-llm`, `dsh-tools`, each adding `|| ^0.1.5-rc.2`), while `src/**`, `cordis.patch.yml`, and the `dsh.client.inject` declaration are unchanged from upstream `963e7bc9a92ca98853270a7c9c9be6442ec60a48`; dev/CI DSH dependencies (including explicit `dsh-agent`) and missing test/UI dependencies are updated only for reproducible build/test. `corepack pnpm install --frozen-lockfile`, `corepack pnpm run build`, and `corepack pnpm test` were run; the final suite passed 453 tests, skipped 7, failed 0. The existing PR #95 remains unsuitable: its current diff has three files (`README.md`, `README.zh.md`, and `package.json`) and uses the wider `|| ^0.1.3-alpha.1 || ^0.1.5-alpha.1` range rather than the exact rc.2 append; its head is based on commits after `v0.9.2`. Subscriptions remain mandatory; disabling it is not an accepted workaround.

## `@byted/dsh-traex-bridge@0.1.15`

Exact registry artifact:

- tarball `https://bnpm.byted.org/@byted/dsh-traex-bridge/-/dsh-traex-bridge-0.1.15.tgz`;
- integrity `sha512-zy1dFc1Sx3TvlVH+EOpMwxmLty4YUrj9uz1KiO4js/3FbK9cmiFXSnWkEJpiCK43zIUw8SdlNF4SFoRTtzXWvg==`;
- SHA-256 `b9e6ddc59647237d4aa35183162e8d66ea58752d91a389e6d44d0069944925b6`;
- registry `gitHead` `bd21ddde36955bd0186f1e60ad8c4ab85fc161d5` (not independently mapped to a public tag).

The target peer ranges explicitly cover `0.1.5-rc.2`. The artifact has no runtime dependencies or install scripts; its bundle injects the Trae client surface, default-model override and `web.searchProvider` override. The undocumented 0.1.14→0.1.15 delta includes target attachment image-dimension handling and suppression of empty internal reasoning/user messages. Auth lookup must be tested with both isolated `HOME` and `DSH_HOME`; the bridge falls back through `~/.trae` paths and uses global `fetch`, so target process-proxy behavior needs black-box proof.

The manifest decision remains exact `0.1.15`, `enabled: false`, `enabledEnv: DSH_TRAEX_BRIDGE`. A fresh profile must use public npm by default and add only `@byted:registry=https://bnpm.byted.org` when explicitly testing the enabled gate. Unset/`0` must not install or expose the package; `1` is devbox-only validation. Host/lumevm are manual handoff targets, not accepted machines.
