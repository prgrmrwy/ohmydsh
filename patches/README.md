# patches/ — pure composition fragments and overrides

English · [简体中文](README.zh.md)

<!-- problem -->
Some DSH tweaks need no code at all, only a change to the composition: enabling a tool row, adjusting a setting, or working around a runtime defect. This directory holds those loader-patch fragments, so such tweaks stay declarative, reviewable and removable.

File name `<id>.yml`; the content is loader patch rows (patch-list YAML, `!!js` allowed).

Two uses:

1. **Pure tuning fragments**: no code, only a composition change (for example enabling a tool row or adjusting configuration);
2. **Overrides for remote packages**: personal configuration override fragments that correspond by id to a remote customization (for example a `cost-meter.yml` would override the configuration rows of cost-meter).

Sync applies enabled fragments in manifest order to the profile's `cordis.patch.yml`. It maintains its generated region and explicitly owned keys while preserving unrelated runtime configuration. `connection-webserver.yml` is a composition-only fix for the Connection RPC channel registration defect of DSH 0.1.5; its manifest entry records the retirement condition.

`websocket-heartbeat.yml` tunes the official DSH gateway to a 5000 ms heartbeat interval. The upstream missed-response limit remains two (roughly 10–15 seconds before disconnect). Its manifest entry uses `mergeConfig: true` to preserve unrelated configuration; disable the entry and run `dsh build` to retire the owned key. This does not change SSH keepalive or Cockpit health checks.
