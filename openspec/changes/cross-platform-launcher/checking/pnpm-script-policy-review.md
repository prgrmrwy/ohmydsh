# pnpm 11.7.0 build-policy source review (read-only)

2026-10-24. User authorized script/source inspection only, with a separate confirmation required before execution or policy changes. No downloaded program was executed, no lifecycle was approved, no build repeated.

## Source identity

Fetched registry metadata and tarball from `https://registry.npmjs.org/pnpm/11.7.0`; verified actual tarball SHA512 equals dist.integrity before inspection. Read `package/dist/pnpm.mjs` as text; did not import/execute it. Initial expected `dist/pnpm.cjs` path was absent; inspected archive names and found the actual `.mjs` bundle. This was a layout lookup error, not an integrity failure.

Verified pnpm tarball integrity: `sha512-GcyFLBIMcSV2DyRD7mvgyltA+fUFmN4aCaHxd1A+AQ5Xwjx3ZG4B52HeWb+HT7IqM5jDOrlpH8E+uUa28PTWIA==`.

## Exact semantics in published source

- `../building/policy/lib/index.js`, bundle lines153948–153994: `createAllowBuildFunction` separates true and false rules; false is checked before true. Identity checks use package name or `name@version`, so exact selectors are supported. `false` returns false; unspecified returns undefined. `dangerouslyAllowAllBuilds` would return true for everything and is NOT proposed.
- Dependency build path, bundle lines179395–179414: `case false` sets ignoreScripts=true without adding to ignoredBuilds. `case undefined` also blocks scripts, but adds dependency to ignoredBuilds.
- `handleIgnoredBuilds`, lines194195–194219: strictDepBuilds throws ERR_PNPM_IGNORED_BUILDS only for the collected unreviewed ignoredBuilds; unrecognized rules are written as placeholder text, not permission.
- Registry dependency lifecycle helper `runPostinstallHooks`, lines132448–132462, executes preinstall/install/postinstall only. It does NOT call prepare. Git-hosted/source-package preparation has a separate path (scripts.prepare detected at133580). Therefore a prepare declaration whose source is absent from a registry tarball must not be treated as a runtime artifact generation requirement for this registry installation.

## Minimal candidate policy (NOT APPLIED)

After the actual package script review confirms neither script is necessary for runtime, prefer explicitly denying these exact versions rather than allowing needless execution:

```yaml
allowBuilds:
  '@google/genai@1.52.0': false
  'protobufjs@7.6.6': false
```

This is a reviewable two-version decision, not ignore-all, not disabled strictDepBuilds, not allowance for future versions. Existing unrelated keys/placeholders must be preserved. A future version remains unreviewed/fail-closed. The gate profile scaffold owns pnpm-workspace.yaml; any experiment must be restricted to the approved scratch profile with a diff recorded, and permanent repository management requires an explicit ownership/idempotence design, not hand-editing user's generated ~/.dsh.

No configuration was written. Source inspection proves intended pnpm semantics, not that a future full gate will pass or that other blocked dependencies cannot appear. Approval is still required before the isolated experiment.
