# patches/ — pure composition fragments and overrides

English · [简体中文](README.zh.md)

<!-- problem -->
Some DSH tweaks need no code at all, only a change to the composition: enabling a tool row, adjusting a setting, or working around a runtime defect. This directory holds those loader-patch fragments, so such tweaks stay declarative, reviewable and removable.

File name `<id>.yml`; the content is loader patch rows (patch-list YAML, `!!js` allowed).

Two uses:

1. **Pure tuning fragments**: no code, only a composition change (for example enabling a tool row or adjusting configuration);
2. **Overrides for remote packages**: personal configuration override fragments that correspond by id to a remote customization (for example a `cost-meter.yml` would override the configuration rows of cost-meter).

Sync merges the enabled patch fragments, in manifest order, into the profile's `cordis.patch.yml` (with a generated-marker header, overriding manual edits under `~/.dsh`). The current fragment is `connection-webserver.yml`, a composition-only fix for the Connection RPC channel registration defect of DSH 0.1.5; its manifest entry records the retirement condition.
