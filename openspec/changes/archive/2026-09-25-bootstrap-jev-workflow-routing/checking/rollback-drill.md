# Phase 1 rollback drill

Date: 2026-09-24

The drill temporarily changed only the manifest's enabled flags, ran the normal sync path, verified the disabled state, restored the original manifest, and ran normal sync twice again. A shell trap restored the manifest and deployment on intermediate failure.

Temporarily disabled:

- `thirdPartyResources`: `spec-superflow`, `jev`, `anvil`
- local skill: `jev-workflow-router`

Disabled-state checks:

- two consecutive `node scripts/sync.mjs` runs completed;
- the second reported `no changes — deployment already matches manifest`;
- Anvil's managed schema target was absent;
- the Jev managed launcher was absent;
- all four third-party npm dependencies were absent from profile dependencies and node_modules;
- generated spec-superflow and Jev Cordis rows were absent;
- the router skill projection was absent;
- the existing `bootstrap-jev-workflow-routing` change remained readable;
- a temporary standard `spec-driven` change could still be created;
- the existing DSH Host continued listening on loopback port 3080;
- an isolated empty shadow-state clear returned a successful bounded response.

Restoration checks:

- the original manifest was restored byte-for-byte from a temporary backup;
- normal sync restored all resources;
- a second restoration sync reported `no changes — deployment already matches manifest`;
- Anvil, the Jev managed launcher, and router skill projection were present again.

This drill did not restart or merge a Worktree Session and did not invoke spec-superflow lifecycle commands.
