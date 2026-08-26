# Deployed-artifact load conformance

Automated as `tests/federation-artifact-load.test.mjs`.

## Gap this closes

`dsh build` deploys two artifacts, and neither was ever loaded by a test:

- `lib/client.js` — the bundle DSH serves to the browser. The existing build
  test only ran **regex assertions on its text** (`assert.match(client, /…/)`).
- `lib/index.js` — the package `main`, i.e. the host entry Cordis imports. It
  was not checked at all.

A bundle that builds successfully but cannot *load* would therefore have passed
every other test in this repository. That is exactly the class of failure the
operator would only discover after enabling.

## Host entry (`lib/index.js`)

Loaded directly, as DSH does, and driven with a real Cordis `Context`:

- `main` really is `./lib/index.js`; `name`, `inject` and `apply` match the
  plugin contract (`inject: ['webServer', 'connection']`);
- the whole public surface is reachable **from the built artifact**, not just
  from TypeScript sources: id codec, `CommandRouter`, `NodeRegistryModel`,
  `WriteLedger`, `NodeReconciler`, `aggregateProjection`, `HttpUnaryCarrier`,
  `DualEventCarrier`, `DshRc2NodeAdapter`, `CentralUplink`,
  `HostActivationCoordinator`, `OpenSshTunnelManager`, `NodeRegistryStorage`;
- every entry in `RC2_FORBIDDEN_METHODS` is absent from `RC2_ALLOWED_METHODS`
  **in the shipped build**;
- `apply(ctx)` registers **no** route and throws nothing — M1 ships inert;
- the built core actually works (`encodeSessionId` → `decodeSessionId`
  round-trip), not merely imports.

## Client bundle (`lib/client.js`)

Evaluated inside JSDOM against the real loader contract. Reading the artifact
showed the real shape is `load({ id, factory: (require) => … })` — the factory
builds its own `module` object and resolves peers through an injected
`require`, so the stub had to match that rather than a guessed
`(module, exports)` signature.

Verified:

- the bundle evaluates without throwing;
- it performs exactly **one** `ModuleLoader` registration, with id
  `dsh-federation`;
- it requires only the expected externals (`react`, `react/jsx-runtime`,
  `clsx`, `@deepseek-ai/dsh-client-ui-primitives`,
  `@deepseek-ai/dsh-client-runtime/client`) — an unexpected peer fails the test;
- it injects its own DSH-owned `<style>` tag
  (`data-plugin="dsh-federation"`, `data-plugin-css="dsh-federation/workspace-embed.css"`)
  with non-empty CSS, and ships **no** sidecar `lib/client.css`.

One environment note: the bundle uses `TextEncoder` at module scope. Real
browsers provide it; JSDOM does not, so the fixture supplies the standard
globals (`TextEncoder`, `TextDecoder`, `btoa`, `atob`). This is a JSDOM gap, not
a product defect — the same code path is already exercised in the browser-safe
`fed1` codec tests.

## Mutation checks

| Mutation in `lib/client.js` | Test result |
| --- | --- |
| change the owned style tag to `data-plugin="wrong-owner"` | **failed** ✓ |
| make the bundle throw during factory evaluation | **failed** ✓ |

The artifact was restored and rebuilt afterwards; both artifact tests and the
existing build test pass together.

## Verification

`npm test` → **89 passed, 0 failed**. Nothing touches `~/.dsh`; `dsh.yaml` keeps
`dsh-federation: enabled: false`.
