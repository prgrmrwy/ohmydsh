# Pet media fixed-source lark-cli

This directory builds a **Pet-only** lark-cli compatibility binary. It never
replaces or resolves through the user's global `lark-cli`.

Pinned inputs:

- upstream: `https://github.com/larksuite/cli`, tag `v1.0.94`, commit
  `f065bf5b645af381f9b7475ce721451e6ca36a23`;
- patch: `bounded-fd-download.patch`, SHA-256
  `3c8b66745b20f44d2f88e86342df15294e13779eeb0d78ceddcb2511419aea7c`;
- fixed Go `1.23.12` toolchains: darwin-amd64
  `0f6efdc3ffc6f03b230016acca0aef43c229de022d0ff401e7aa4ad4862eca8e`,
  darwin-arm64 `5bfa117e401ae64e7ffb960243c448b535fe007e682a13ff6c7371f4a6f0ccaa`,
  linux-amd64 `d3847fef834e9db11bf64e3fb34db9c04db14e068eeb064f49af747010454f90`,
  and linux-arm64 `52ce172f96e21da53b1ae9079808560d49b02ac86cecfa457217597f9bc28ab3`.

The patch adds hidden Host integration flags to
`im +messages-resources-download`:

- `--output-fd <n>`: inherited POSIX descriptor `n >= 3`;
- `--max-bytes <positive-int64>`: mandatory byte ceiling.

They must be paired and conflict with `--output`. The command opens the normal
`openIMResourceDownload` stream, rejects a known `Content-Length` over the
ceiling before copying, then copies through `io.LimitedReader(max+1)` into
`os.NewFile(fd, ...)`. Overflow is a typed
`validation/failed_precondition` error. Binary bytes only use the inherited fd;
stdout carries the normal small JSON receipt. The ordinary path-based CLI mode
is unchanged.

Run `node build.mjs`. Generated `.upstream/`, `.toolchains/`, `.cache/`,
`.artifact-builds/`, and the `artifact` pointer are ignored. The builder verifies
all hashes, applies the patch only to the exact commit, runs focused Go unit
tests, builds with `-trimpath` and a fixed build date, verifies capability
markers/version/provenance, and atomically publishes `artifact/lark-cli`.
Unsupported OS/architecture pairs fail closed until their official Go archive
and SHA-256 are explicitly reviewed and added.
