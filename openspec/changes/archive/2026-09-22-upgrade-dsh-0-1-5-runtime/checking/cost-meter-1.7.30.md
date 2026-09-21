# `dsh-cost-meter@1.7.30` audit

## Provenance

- Current rollback pin: `dsh-cost-meter@1.7.10`.
- Candidate: `dsh-cost-meter@1.7.30` from the npm registry.
- Current tarball integrity: `sha512-EA9g…GYfFlA==`; shasum `d0e8b4e3d163b14a3a355f04a17d809f9f3286c8`; registry `gitHead` `e9cafb5139f350053ac6f521c7ab002ed702e31c`.
- Candidate tarball integrity: `sha512-JGXA…pTY+CQ==`; shasum `0f6af2b578af9ca19b7c22c9dc34d4ac9d67e0e4`; registry `gitHead` `c2891e1ff5fbcb85335f37cfb55918863baa1b0c`.
- Both artifacts declare Node `>=20`. The complete tarballs were extracted read-only under `/tmp/dsh-cost-meter-audit/`; no repository files were modified by the audit.

## Compatibility and loader seam

`1.7.10` hard-depends on `@deepseek-ai/dsh-home-paths@0.1.0-rc.8` and `@deepseek-ai/dsh-credentials@0.1.0-rc.8`. `1.7.30` changes those to peers with the range:

```text
^0.1.0-rc.6 || ^0.1.1-0 || ^0.1.2-0 || ^0.1.3-0 || ^0.1.5-0
```

Semver checks show both `0.1.2-rc.1` and target `0.1.5-rc.2` satisfy the range. Target `home-paths` and `credentials` packages are published. The candidate keeps the same `dsh.bundle.patch` bytes (SHA-256 `b95d32ed20c2eebe33f91f1beeffc78e11058444678023c2d94422865de34b0`) and `dsh.client.platform: web`; the normal Host source does not import Cordis/DSH Service/Context classes. JavaScript syntax checks passed for the extracted files.

The candidate adds `dsh.compatibility` metadata, but its release list does not contain exact `0.1.5-rc.2` (it lists `0.1.2-rc.1` and `0.1.5-alpha.1`). No loader enforcement of that field was proven. This is a metadata gap requiring explicit review, not proof of runtime incompatibility.

## Security and behavior delta

The candidate expands the declared origin set from 18 to 20 and adds:

- unconditional, credential-free OpenRouter model-price fetch after startup and hourly;
- an Aliyun balance adapter using signed requests and credential/env fallback;
- MiniMax custom HTTPS origin support that expands the potential credential destination;
- bounded/abort-aware network helpers and additional repair/native-search/session-cost functionality.

These are material behavior changes. A real Host/Web smoke, credential-leak check, mock network policy test, and peer single-instance check remain required.

## Decision

Static evidence supports a **candidate independent remote pre-upgrade** because the peer range accepts both old and target runtime families and the loader seam is unchanged. Production promotion is **NO-GO** until isolated old-runtime materialization and target-runtime smoke prove loader activation, fee UI/RPC, no duplicate `home-paths`/`credentials` instances, network policy, and rollback. Keep `1.7.10` as the rollback pin until those gates pass; do not claim task 2.1 complete from static evidence alone.
