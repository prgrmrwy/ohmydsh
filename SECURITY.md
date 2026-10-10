# Security Policy

## Supported versions

ohmydsh is a continuously evolving personal customization repository. **Only the latest state of the `main` branch is maintained**, and security fixes land only on `main`.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| Older commits / tags | ❌ |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public issues.**

Use either of these private channels:

1. **GitHub Private Vulnerability Reporting** (preferred): submit a report from the repository's [Security tab](https://github.com/prgrmrwy/ohmydsh/security/advisories/new).
2. **Email**: send it to `prgrmr@163.com` with a subject starting with `[SECURITY]`.

Please include as much of the following as you can:

- the affected component (for example `scripts/sync.mjs`, `bin/dsh`, or a `packages/<id>`);
- reproduction steps or a PoC;
- your assessment of the impact (for example arbitrary file write, command execution, credential leakage);
- environment details (OS, Node version, DSH version).

### Response times

This is a personally maintained project, run on a best-effort basis with no SLA. Typically:

- the report is acknowledged **within 7 days**;
- an assessment and a fix plan follow **within 30 days**.

After a fix is released, if you wish, you will be credited in the release notes.

## Security considerations specific to this project

When assessing risk, note the following known properties of ohmydsh — some of them are **intentional design tradeoffs** that are explicitly documented:

### 1. Plugins are third-party code

Customizations with `source: remote` in `dsh.yaml` are installed from the npm registry and run inside the DSH process. The repository convention is an **exact version pin plus a record of the source and the review conclusion in the entry's `note`**; sources are not vendored.

If you find a vulnerability in a pinned third-party plugin version, that is a valid report — even if the flaw is upstream.

### 2. Loopback binding (no LAN mode)

The web server **binds only the loopback address** (`127.0.0.1`). This repository has **removed** the `web.lan` / `DSH_LAN` LAN-binding switch and the accompanying SSH tunnelling (decision of 2026-09-03: cross-machine access is no longer offered).

Any path that makes the web server produce a **non-loopback listener** when `--host` was not passed explicitly (bypassing the removal above, or making it reappear) is a valid report: it would expose the full agent capability (bash execution, file reads and writes) to any device on the same network segment, and DSH has no TLS (plaintext can be sniffed).

### 3. Fail-closed deployment surface

For managed files such as `$DSH_HOME/AGENTS.md`, sync guards against ownership/hash drift: when it finds an unmanaged file or a local modification it **errors and keeps the file**, never silently overwriting or deleting it.

Any path that lets sync, `dsh reset` or Worktree Session cleanup **silently destroy user data**, or write or delete outside the expected directory, is a high-priority security issue.

### 4. Credential handling

`.env.local` is gitignored and holds machine-private configuration. Subscription-style plugins may read third-party CLI credentials already present on the machine. Please report any behaviour that causes credentials to be written to version control, to logs (`~/.dsh/dsh-startup.log`), or sent to an unintended endpoint.

### 5. Auto-update chain

`autoUpdate` is on by default. Before start/build it detects and **blockingly auto-upgrades** the DSH runtime, rewrites `dsh.yaml` and commits automatically with `git commit`. It rewrites only entries whose name matches `@deepseek-ai/dsh-*` and whose pin equals the old runtime, and it requires a clean working tree.

Any path that lets this chain inject an arbitrary version, an arbitrary package name or an arbitrary command is a high-priority issue. Escape hatches: `autoUpdate.enabled: false` or `DSH_SKIP_UPDATE=1`.

## Notes for users

This repository drives an **AI agent runtime with full local machine capabilities** (it can run shell commands and read and write files). Before using it, understand that:

- you should run it only on machines you trust;
- you should review the source of any third-party plugin before installing it;
- the model instructions in `$DSH_HOME/AGENTS.md` are **neither a grant of permissions nor an enforced security boundary** — the actual capabilities are always determined by the runtime context and the tool execution policy.
