<div align="center">

# ohmydsh

**A declarative customization repo for DeepSeek Harness (DSH) — one manifest drives every customization, idempotently materialized into `~/.dsh`**

[![CI](https://github.com/prgrmrwy/ohmydsh/actions/workflows/ci.yml/badge.svg)](https://github.com/prgrmrwy/ohmydsh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](.nvmrc)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196.svg)](https://www.conventionalcommits.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[中文](README.md) · [Quick start](#quick-start) · [Architecture](#architecture) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

---

> **Note**
> This is a condensed English overview. The authoritative and most detailed documentation is the
> [Chinese README](README.md), which covers every command flag, sync rule and configuration switch.

ohmydsh is a customization repository for **DSH (DeepSeek Harness)**: one central manifest manages every customization, while each customization stays pluggable, independently versioned and independently maintained — all inside a single repo.

It is **not** DSH core. It is the source of truth for a personal DSH setup.

## Why

Hand-maintaining an AI agent runtime's plugins, versions and config tends to decay into local state nobody remembers the reason for. ohmydsh collapses that into reproducible, reviewable, revertible engineering assets:

- 🎛 **Single control surface** — `dsh.yaml` governs the DSH version, third-party plugins, first-party packages, patches, skills and environment-level agent instructions.
- 🔁 **Idempotent materialization** — `dsh build` syncs repo state into `~/.dsh`; repeated runs converge, and failures fail closed.
- 🔌 **Pluggable** — every customization can be enabled, disabled, upgraded or removed independently. `enabled: false` means disabled, **not** deleted.
- 📌 **Pin exactly, never vendor** — third-party code is referenced by exact version pin plus an override fragment and a review note, keeping the trust surface auditable.
- 🚀 **Automatic runtime upgrades** — `autoUpdate` detects new DSH releases, upgrades in a blocking step, re-runs sync and commits — but never when the working tree is dirty.
- 📐 **Spec-driven** — behavior changes go through OpenSpec (proposal → design → spec → tasks) before implementation.

## Source-of-truth rules

- **The repository is the only source of truth.** `dsh.yaml` + customization directories + `instructions/dsh-home.md` form the complete configuration; `~/.dsh` is generated output.
- The root `package-lock.json` is the sole dependency lock for all npm workspaces. TypeScript packages commit only `src/`; the gitignored `lib/` is produced by the root build/sync.
- `$DSH_HOME/AGENTS.md` is drift-protected: unmanaged files or local edits cause an error and are preserved, never silently overwritten or deleted.
- **Disabled ≠ deleted.**

## Requirements

- **Node.js >= 22** and **npm >= 10** (the version in `.nvmrc` is recommended)
- macOS / Linux / WSL / Git Bash — `bin/dsh` is a bash script, so native Windows is unsupported

## Quick start

```bash
git clone https://github.com/prgrmrwy/ohmydsh.git && cd ohmydsh
./scripts/bootstrap.sh     # 1. check Node toolchain + install deps (idempotent, run once)
./scripts/install.sh       # 2. install the `dsh` command into ~/.local/bin
dsh build && dsh           # 3. materialize customizations and start
```

`install.sh` creates a **relative symlink**, so the command keeps working after you move the repo. Uninstall with `./scripts/install.sh uninstall`; reinstall dependencies with `./scripts/bootstrap.sh --force`.

Once installed:

```bash
dsh build   # materialize dsh.yaml into ~/.dsh (re-run after config changes)
dsh         # start in the background
dsh stop    # stop the service
```

The UI serves at **http://127.0.0.1:3080** (change with `dsh -p 8080`). Every start/stop prints the currently loaded plugin list, so it is always clear which customizations are in effect.

## Common commands

| Command | Purpose |
|---|---|
| `dsh` | Start (or open the UI if already running) |
| `dsh -b` | Build then start |
| `dsh build` | Materialize config into `~/.dsh` only |
| `dsh stop` | Stop the server, verified by listening port; refuses to kill non-DSH processes |
| `dsh restart` | Stop → close UIs → confirm port released → start |
| `dsh history` | Past starts: time, DSH version, port, plugin list |
| `dsh reset` | Remove custom plugins/presets/skills and safely revoke the managed `AGENTS.md` |
| `dsh plugin-update` | Detect plugin updates, confirm one by one, rewrite `dsh.yaml`, sync and commit |
| `dsh --foreground` | Run in the foreground with logs on the terminal |

## How sync materializes each type

| Type | Source | Action |
|---|---|---|
| package | local | `dsh plugin add file:<packages/<id>>` |
| package | remote | `dsh plugin add <spec>` |
| preset | — | copy to `~/.dsh/.agent-presets/<id>` |
| patch | — | merge into the profile `cordis.patch.yml` in manifest order |
| skill | — | copy to `~/.dsh/skills/<id>` |

## Layout

```
dsh.yaml                  # the manifest — the single control surface
openspec/                 # spec-driven change process
scripts/sync.mjs          # manifest → ~/.dsh materialization
packages/<name>/          # first-party bundle plugins
presets/<id>/             # agent presets
patches/<id>.yml          # composition fragments / overrides for remote packages
skills/<name>/            # skills
instructions/dsh-home.md  # environment-level agent instruction source
docs/adr/, docs/notes/    # architecture decisions and implementation notes
tests/                    # black-box sync regression tests
```

## Architecture

<img alt="ohmydsh architecture: repo source of truth → sync → ~/.dsh → DSH runtime" src="archify-out/ohmydsh-architecture.dual.svg" width="100%">

The editable diagram source is `archify-out/ohmydsh-architecture.json`; update it and re-export the theme-adaptive SVG when the architecture changes.

## Security notes

⚠️ This repository drives an **AI agent runtime with full local machine capabilities** (shell execution, file read/write). Run it only on machines you trust, and review third-party plugin source before installing.

The webserver binds to loopback only; LAN binding (`web.lan` / `DSH_LAN`) has been **removed** from this repo. Enabling it exposes full agent capability to every device on the network without TLS.

Report vulnerabilities privately per [SECURITY.md](SECURITY.md).

## Contributing

Issues and PRs are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first — it documents the reading order, the OpenSpec-driven workflow, verification requirements and commit conventions.

Before submitting:

```bash
npm test
npm run check:artifacts
```

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Acknowledgements

- [DeepSeek Harness (DSH)](https://www.npmjs.com/package/@deepseek-ai/dsh) — the runtime this repo customizes.
- Third-party plugin authors; provenance, license and review conclusions are recorded in each `dsh.yaml` entry's `note`.

## License

Released under the [MIT License](LICENSE).

Third-party customizations are referenced by pin rather than vendored and remain under their original licenses; see `packages/worktree-session/NOTICE` for interaction-concept attribution.
