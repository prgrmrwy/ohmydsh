# Read-only dependency lifecycle review — exact registry artifacts

## Decision boundary

**Review completed for the published bytes of `@google/genai@1.52.0` and `protobufjs@7.6.6`; no execution approval is implied.** Neither package's install hook builds runtime artifacts. The least-privilege proposal is to **explicitly decline/ignore both exact versions' install hooks**, subject to a separate user decision and confirmation of the pinned package manager's version-selector/configuration mechanism. An alternative is narrowly allowing those exact versions' reviewed install hooks; that executes an unnecessary shell/Node process and provides no identified runtime benefit. Do not approve whole package names across future versions, all dependencies, source/Git installs, or the development/publishing commands.

No package manager, lifecycle script, package import, install, build, approve-builds, pnpm-policy change, product/pin change, or real user config/environment inspection was performed for this review. Only this report is a durable repository write. Downloads and decoded evidence are under the already ignored checking/baselines directory; no raw logs/tarballs/source vendor copy is added to Git. The review does **not** make the complete-manifest gate pass.

## Why this review exists

The first-cause chain is recorded in [full-manifest-evidence.md:56–82](./full-manifest-evidence.md#L56-L82): initial Windows root install hit an owned POSIX clean hook (subsequently repaired); Linux initially lacked direct pnpm on PATH. After scratch-local pnpm 11.7.0 provisioning and Windows workspace fixes, the next visible blocker is `ERR_PNPM_IGNORED_BUILDS` for these two exact packages. The documented dependency chain is dsh-magpie-connect 0.4.1 → pi-ai ^0.82.1 (inspected 0.82.1) → genai 1.52.0 → protobufjs ^7.5.4 (gate resolution 7.6.6). Metadata naming a script was explicitly not considered a script-source safety review. This report closes the bounded published-script inspection, not all transitive package/runtime security.

## Acquisition and integrity

Two public version metadata responses and their metadata-selected registry tarballs were fetched with Python urllib, without npm or package execution. Each metadata name/version was checked; SHA-512 `dist.integrity` and SHA-1 `dist.shasum` were recomputed over the **actual downloaded compressed bytes** and matched. Metadata and tarball package.json script maps agree exactly. Tar member names were checked to be relative under `package/`, without `..`; names are unique, all members are regular files, and selected files were copied by `tarfile.extractfile` byte reads to fixed scratch paths (no extractall, symlink following, or tar-controlled execution). Neither tarball includes binding.gyp. External source/provenance text was screened as untrusted data, not followed as instructions.

| Exact artifact | Bytes / entries | License evidence | Declared source |
| --- | --- | --- | --- |
| `@google/genai@1.52.0` | 2,267,821 / 25 | Apache-2.0 in package.json:183 and bundled LICENSE (Apache License 2.0 text) | googleapis/js-genai, package.json:174–181; metadata has **no gitHead and no dist.attestations** |
| `protobufjs@7.6.6` | 641,865 / 79 | BSD-3-Clause in package.json:7 and bundled LICENSE:7–32 (license explicitly excludes separately licensed files/subdirectories) | protobufjs/protobuf.js; metadata gitHead `795704d36c4d7de5c12f10e08836697e9d3011b2` |

Exact registry references:

- genai [version metadata](https://registry.npmjs.org/%40google%2Fgenai/1.52.0), [tarball](https://registry.npmjs.org/@google/genai/-/genai-1.52.0.tgz)
- protobufjs [version metadata](https://registry.npmjs.org/protobufjs/7.6.6), [tarball](https://registry.npmjs.org/protobufjs/-/protobufjs-7.6.6.tgz), [registry attestations](https://registry.npmjs.org/-/npm/v1/attestations/protobufjs@7.6.6)

```text
@google/genai@1.52.0
  integrity sha512-gwSvbpiN/17O9TbsqSsE/OzZcpv5Fo4RQjdngGgogtuB9RsyJ8ZHhX5KjHj1bp5N9snN2eK8LDGXSaWW2hof8Q==
  sha1      0dc2544b5ac93bdabfd313482d9a5c12623cbc7a
  sha256    0509f4c2b2de108e4741776b67c21c03fcb174e399ee6058b7c7601b895c1981
protobufjs@7.6.6
  integrity sha512-dYDWdjSl5RNb7SgPxGQcRU+GtvP7s2fpkrY0r432PcOIaZ0/rBcxEZnQN67iJhFuQiVw754JDoPruPCNdGsbjg==
  sha1      7a3923e8e32b0ee2ff689f8eed6e455c090ac67e
  sha256    df0241b3046b505d27396da6eef107f14dffb108f77aa89cfd9611a928eb6dfe
```

Both metadata responses include registry signatures, but **signature/key trust verification was not performed**. protobufjs' fetched DSSE publish and SLSA v1 statements both name the same artifact and SHA-512 digest as the downloaded bytes. The decoded provenance claims GitHub Actions, repository protobufjs/protobuf.js, workflow `.github/workflows/release.yaml`, ref `refs/heads/protobufjs-v7.x`, and the same gitHead above. These fields and digest agreement were inspected; the Sigstore/certificate/transparency trust chain was **not** verified. Registry byte integrity and mutually consistent provenance claims are not proof that a publisher, repository, or all runtime code is trustworthy. No cryptographically authenticated source-commit mapping is claimed for genai.

## 1. `@google/genai@1.52.0`

### Actual declared lifecycle hooks

The integrity-verified published package.json (lines62–92 inside the integrity-verified genai tarball linked above) declares the following lifecycle/implicit pre-hooks (ordinary build/test/doc commands are not install hooks):

| Hook | Exact command | Reachability / meaning |
| --- | --- | --- |
| preinstall | `echo 'preinstall: no-op'` | Only declared normal dependency-install hook. No imports, recursion, file mutation, network, or Node work. |
| prepare | `node scripts/prepare.js` | Declared, but **target and entire scripts directory are absent from the 25-entry registry tarball**. Do not equate this with a shipped install-time build. |
| prepack | `echo 'prepack: no-op'` | Packaging hook, not ordinary registry dependency install. |
| postpack | `echo 'postpack: no-op'` | Packaging hook, not ordinary registry dependency install. |
| prebuild | `echo 'prebuild: no-op'` | Runs before an explicit build command, not automatically because a dependency is installed. |
| prebuild-prod | `echo 'prebuild-prod: no-op'` | Runs before an explicit build-prod command, not a registry dependency install. |

No install, postinstall, prepublish, prepublishOnly, postpublish, preprepare, postprepare, preuninstall, uninstall, postuninstall, or restart hooks are declared. The files allowlist at package.json:100–122 contains compiled dist and node/web package metadata, **not scripts**. Full tar entry enumeration independently confirms absence; missing prepare source is not a failed read of an existing file.

### Linux / Windows effects

For normal registry installation the preinstall literal prints a line through the package manager's lifecycle shell. POSIX shells strip the single quotes; native cmd commonly prints the quote characters as data. The wording can differ, but neither spelling interpolates variables, addresses a file, opens network connections, or invokes another program beyond the package manager's shell setup. On Windows echo is a cmd builtin; on POSIX it is normally a shell builtin. There are no reads of process.env or user config in this command. This does not assert the package manager itself never reads config or starts helper processes.

The registry artifact has no actual prepare.js source whose recursive imports can be audited. Attempts to fetch the exact v1.52.0 tagged upstream prepare source via raw GitHub, GitHub API, and GitHub blob URLs were rejected by the fetch tool because those hostnames resolve to non-public IPs in this environment; no bypass was attempted. **Source-checkout/Git prepare behavior on either OS remains unreviewed.** If someone explicitly forces this absent file command inside the unpacked registry artifact, Node should fail to locate it; it cannot generate a runtime bundle that is already shipped.

### Runtime need

Package.json:6–60 points exports at already-present dist ESM/CJS/type files, including dist/node/index.mjs and index.cjs, web, tokenizer and vertex_internal builds. The actual tar entries include these artifacts. The install pre-hook cannot create, patch, fetch, or compile anything; omitting that print has no identified effect on runtime availability. This is static artifact/source reasoning, not an import or API smoke test.

## 2. `protobufjs@7.6.6`

### All declared lifecycle hooks

The published package.json (lines36–57 inside the integrity-verified protobufjs tarball linked above) declares:

| Hook | Exact command | Reachability / meaning |
| --- | --- | --- |
| postinstall | `node scripts/postinstall` | Normal dependency-install hook; Node extension resolution selects shipped scripts/postinstall.js. Fully audited below. |
| prepublish | `cd cli && npm install && cd .. && npm run build` | Legacy development/root install-and-publish lifecycle, **not** an ordinary fetched registry dependency install hook. Explicit invocation would install dependencies and build; not approved or reviewed recursively. |
| prepublishOnly | `cd cli && npm install && cd .. && npm run build` | Publish-only lifecycle, not a registry dependency install hook. Same unapproved development/publishing effects. |

No preinstall, install, prepare/preprepare/postprepare, prepack/postpack, publish/postpublish, uninstall, or restart hooks are declared. The cli directory and development build scripts are absent from the published tarball; only scripts/postinstall.js is shipped from scripts. The dangerous-looking npm install in publishing metadata is not reachable through this postinstall source and must not be conflated with it.

### Actual script and complete reachable import closure

The entire shipped scripts/postinstall.js (lines1–32 inside the integrity-verified protobufjs tarball linked above) is 1,071 bytes (SHA-256 `5af8463b97ee8e309b4a2111f9479bacdf0c180de0ca0155527679b1fc6d9e6c`). Material excerpts preserve its real line numbers:

```js
// scripts/postinstall.js:3–9
var path = require("path"),
    fs   = require("fs"),
    pkg  = require(path.join(__dirname, "..", "package.json"));
if (!pkg.versionScheme)
    return;
// :15–20
var basePkg;
try {
    basePkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json")));
} catch (e) {
    return;
}
// :28–31
.forEach(function(check) {
    var version = basePkg && basePkg[check] && basePkg[check][pkg.name];
    if (typeof version === "string" && version.charAt(0) !== pkg.versionScheme)
        process.stderr.write(pkg.name + " " + warn + " " + pkg.name + "@" + version + " is configured as a dependency of " + basePkg.name + ". use " + pkg.name + "@" + pkg.versionScheme + version.substring(1) + " instead for API compatibility.\n");
```

- Import closure: Node builtins path and fs plus its own data-only package.json (versionScheme `~`, name protobufjs). **No third-party JS imports, dynamic evaluation, shell, child_process, native tool, recursive package script, or network module/API.** No additional dependency's code is loaded by this hook.
- Reads: own package JSON and the literal path obtained from `__dirname/../../package.json`. This is path-layout-dependent and not a traversal to the actual application root. In pnpm's isolated layout it commonly lands on a virtual node_modules parent without package.json and returns silently; do not assume it finds the direct dependent.
- If that second file exists and is valid JSON, it examines dependencies, devDependencies, optionalDependencies and peerDependencies. For a string protobufjs range whose first character differs from `~`, it prints a compatibility recommendation. It does not validate full semver.
- Output uses stderr and changes ANSI coloring according to process.stderr.isTTY; it reads process.argv[1] to label the warning. The warning may contain the adjacent JSON's package name and declared range. No filesystem writes/deletions, download, process spawn, credentials, process.env access, telemetry, compiler invocation, or source mutation occurs in the reviewed code.
- Missing/unreadable/invalid second JSON is caught and returns normally. Failure to load own package JSON is not caught, although that file is present and verified here. An unreadable installed package, unexpected JSON types, or stderr errors remain ordinary possible failures, not intended build work.

### Linux / Windows effects and runtime need

The same pure JS path.join/fs/JSON operations run on both OSes; no POSIX commands or platform branches occur. The lifecycle starts Node via the package manager shell; Node resolves the extensionless script name to .js on both supported platforms. Relative behavior is based on __dirname, not shell cwd. Different install layouts/TTYs can change the warning, not generate different artifacts. Native execution was **not** performed.

Published index.js:4 and minimal.js:4 directly require shipped src/index and src/index-minimal. The tarball already includes full/light/minimal sources, type declarations and browser dist bundles. Postinstall only advises range style and cannot build these files. Omitting it loses that warning only, not a build product; no runtime API compatibility/import test was run.

## Prepare and package-manager semantics — important scope distinction

For npm-style registry dependency installation, preinstall/install/postinstall are the dependency hooks; prepare is associated with development/root/local installs and preparing Git/source packages for packing, not an extra arbitrary hook run on every already-packed registry dependency. A plain npm install/ci **in a project's own root** can run that root's prepare/prepublish, which is why the first Windows workspace failure in the gate was real. That is not evidence genai's dependency prepare runs. Similarly, protobufjs' root-development prepublish command must not be run during this review.

The tarballs establish that no genai prepare script is shipped and neither reviewed install hook generates runtime artifacts. Lead independently inspected the integrity-verified pnpm 11.7.0 published bundle; [pnpm source review](./pnpm-script-policy-review.md) corroborates the registry dependency preinstall/install/postinstall path, exact name@version true/false selectors, and explicit false omitting that dependency from unreviewed-build collection. The actual official-CLI profile policy consumption still requires a separately approved isolated experiment. Documentation fetches were unavailable for the non-public-DNS error; no test installation was substituted and no policy was applied.

## Minimal proposals — NOT applied

1. **Preferred: exact-version explicit deny/ignore for these two artifacts only.** Allow the install to omit genai's literal print and protobufjs' layout-dependent warning, while retaining fail-closed behavior for every newly encountered script/package/version. Pair policy selection with verification that the actual resolved tarball integrities still match this report. The proposal concerns hooks, not deleting/ignoring packages themselves.
2. **Alternative: exact-version allow for these two artifacts only.** Reviewed normal install code has a small, understood effect surface; allowing it gains only prints/warnings. Approval must not expand to Git/source prepare, pack/publish/development commands, future versions, all protobuf/genai names, or other blocked packages.
3. Before either is executed, the lead must establish pinned pnpm 11.7.0's supported exact-version policy selector and the **actual isolated official-CLI install scope**. Keep configuration scratch/candidate-local, preserve current pins/manifest, and present the exact settings/command and exact candidate roots for separate user confirmation. Do not use global allow-all, blanket ignore-scripts, unattended approve-builds, a package-name-wide allowance, or a version downgrade as a hidden bypass.
4. After separate approval, proving the policy eliminates this first cause still requires the real gate: both platforms' complete build twice and remaining doctor/dump/Host stages. A new ignored-build or error is another first cause, not automatic permission to extend this review to all dependencies.

## Limitations / residual risk

- No lifecycle execution, npm/pnpm install/rebuild, runtime imports, real Windows probe, or full-manifest rerun was performed. OS behavior above is bounded static analysis.
- genai prepare.js is not in the verified registry artifact; source-checkout preparation remains unknown and excluded. Do not use this review for Git installs or publish/development workflows.
- Integrity checks anchor reviewed bytes to fetched registry metadata, not to an authenticated publisher, immutable git commit, or verified Sigstore trust root. Protobufjs provenance digest fields agree but signatures were not validated; genai metadata provides no provenance linkage.
- This is not an audit of API-time outbound requests, the entire generated SDK, protobuf parser security, all dependency versions, license compatibility of every bundled file, or the five consuming plugins. Low install-hook risk does not imply low overall package/runtime risk.
- Exact-version selector and registry lifecycle semantics are independently corroborated in [pnpm source review](./pnpm-script-policy-review.md). Actual official-CLI policy consumption, resolved integrity matching at the test profile, and any permanent management/ownership remain unverified. No configuration was changed. The user's later PC/Windows and devbox/Linux testing preference does not itself approve a build-policy change; target confirmation and the separately requested policy decision remain pending.
