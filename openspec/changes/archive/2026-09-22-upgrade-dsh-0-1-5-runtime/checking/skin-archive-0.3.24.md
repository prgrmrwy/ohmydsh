# `skin-center` / `session-archive@0.3.24` audit

## Provenance and engine gate

Current rollback pins are `@linxin666/dsh-client-ui-skin-center@0.3.16` and `@linxin666/dsh-session-archive@0.3.16`.

Candidate tarballs are the npm registry artifacts:

- skin center `0.3.24`: integrity `sha512-kYzBJUA45jnw6nEgDnRUCMFKIfb2RDbMFO/Ur3M3zx2QoFZWIrwHFcwn1XGBJ4mv1MpFA1R5dMGdr81A9Z+a9Q==`, shasum `dd99461ea787e4a2cdb46a80dc142e59020c234e`;
- session archive `0.3.24`: integrity `sha512-S7I4QovtSAnNLVr6IFuuDD8FAbjnKZH30w+xI/hdRGwxjop/kC0MZJvulRhrX83U/nvM4Y4g1SNEkux+4IBWUw==`, shasum `04a4b1f287551cd9de156f0530be322ea70edb9b`.

Both candidates declare `dsh.engines.dsh >=0.1.5-rc.1`. Therefore neither candidate is independently loadable under the current `0.1.2-rc.1` manifest and both belong to the DSH runtime atomic batch. `0.1.5-rc.2` satisfies the engine range. Archive's Node engine remains `^22.19.0 || >=24.0.0`; the repository Node policy/`.nvmrc` is compatible.

Rollback artifacts remain exact `0.3.16` pins with previously recorded integrity values. If `0.3.16` is not independently proven on target runtime, a failure after migration must roll back the whole runtime/plugin/data group rather than mixing an old plugin with a new runtime.

## Loader and behavior

The bundle patch and client inject IDs remain unchanged and should each occur exactly once. Skin 0.3.24 is not a metadata-only release: it adds bubble-blur settings, built-in blueprint provenance, safer Wallpaper Engine path encoding, background/shell reconciliation and observer cleanup. Its security surface includes same-origin routes, skin-directory containment, CSS URL/import checks, trusted hooks, local Wallpaper/Steam reads, and the upstream-declared daily telemetry heartbeat.

Session archive retains the SessionController, workspaceRegistry and sessions seams. Its archive/unarchive/preview/delete paths protect live/current/running sessions, use loopback/same-origin guards, realpath/symlink fences, atomic ledgers and ordered deletion. Candidate client changes are mostly dialogs/selection UI, but the target Session ABI must still be tested against cold inventory, inspect, durable archive state and deletion.

## Decision

Place both candidates in the DSH `0.1.5-rc.2` runtime atomic batch. They are **not** approved for an old-runtime pre-upgrade. Target Host/Web loader activation, skin/wallpaper behavior, archive/preview/restore/delete, migration consistency and rollback remain required before task completion.
