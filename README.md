<div align="center">

# ohmydsh

**One repository to aggregate, review and iteratively manage your whole DeepSeek Harness (DSH) configuration — from adding a plugin to removing it.**

[![CI](https://github.com/prgrmrwy/ohmydsh/actions/workflows/ci.yml/badge.svg)](https://github.com/prgrmrwy/ohmydsh/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](.nvmrc)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196.svg)](https://www.conventionalcommits.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

English · [简体中文](README.zh.md) · [Quick start](#quick-start) · [Plugins](#plugins) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

</div>

---

## What it does
<!-- section: what-it-does -->

ohmydsh turns the configuration of **one person's DSH** into a single, reviewable, reproducible repository and manages it across its whole lifecycle: **add** a plugin, **review** its trust surface, **pin** an exact version, **build** it into place, **upgrade** it later, **disable** it without losing it, and finally **remove** it.

- The **repository is the source of truth.** Everything that defines your setup lives here: the manifest, self-developed packages, skills, presets, patches and environment-level agent instructions.
- **`~/.dsh` is a generated product.** `dsh build` materializes the repository into it idempotently. Never edit it by hand; change the repository and build again.
- **`dsh.yaml` is the single switch.** The DSH version, the auto-update policy and every customization are declared there. `enabled: false` disables an entry without deleting it.

Two kinds of readers, two entry points:

- **You (or your AI) want to manage your own DSH** — start at [Quick start](#quick-start) and [Architecture](#architecture).
- **You (or your AI) want to know what the self-developed plugins solve** — jump to the [plugin index](#plugins).

## Quick start
<!-- section: quick-start -->

Initialization requires Node.js 22+ and npm 10+; `.nvmrc` is the recommended Node version, not an exact-version gate. The launcher uses one Node implementation on Windows, macOS and Linux, without requiring Git Bash on Windows. **Full configuration support is still pending the complete native-platform build and terminal-close gates**; passing launcher tests is not a full-repository Windows support claim. Pick one of three paths.

### Path 1 — copy my full configuration

```bash
git clone https://github.com/prgrmrwy/ohmydsh.git && cd ohmydsh
node scripts/bootstrap.mjs # validate engines and run locked npm ci when needed
npm link                   # register the repository bin; separate from dependency installation
dsh build && dsh           # materialize the configuration, then start DSH
```

On Windows, run these commands in cmd or PowerShell (split `&&` into separate lines in Windows PowerShell 5.1). `npm link` creates `dsh.cmd` and `dsh.ps1` in the npm global prefix; put that prefix on PATH. If PowerShell execution policy blocks the generated script, invoke `dsh.cmd` rather than weakening machine-wide policy. On POSIX, the global bin directory is `<prefix>/bin`. Check `npm prefix -g` and `where.exe dsh` / `command -v dsh` when another official `dsh` is already installed; do not use `--force` to overwrite an unrelated command. `npm unlink --global ohmydsh` unregisters this link. POSIX legacy install/bootstrap wrappers remain thin compatibility entries.

POSIX start/stop/restart require `lsof` and `ps` (for example, install `lsof` using your OS package manager); missing ownership tools fail before launching or killing a Host. Windows uses the built-in PowerShell TCP/CIM query and forcefully stops only a revalidated owned tree; graceful flush is not guaranteed. An explicit `DSH_BIN` is a single executable path: Windows accepts JS entrypoints or native `.exe`, not `.cmd`/`.bat`/`.ps1` shims or a command string. Use the real JS CLI, not its npm shim.

### Path 2 — pick parts

Start from path 1, then trim `dsh.yaml`: set `enabled: false` on what you do not want (it stays in the repository and is easy to re-enable) or delete the entry for good. The `add-dsh-plugin` and `remove-dsh-plugin` skills make the edit, run `dsh build` and ask before restarting. Run `dsh build` again after every change.

### Path 3 — start from zero

Replace `dsh.yaml` with the minimal manifest below and run `dsh build`. No new command, script or template is involved.

<!-- fixture: minimal-manifest -->
```yaml
dshVersion: 0.2.0-rc.2
autoUpdate:
  enabled: false
customizations: []
```

`autoUpdate.enabled` must be explicitly `false`. When it is absent, auto-update defaults to on, and the launcher would then edit `dsh.yaml` and commit the change on its own.

`dsh reset` is **not** the from-zero route. It only undeploys customizations from `~/.dsh`; the manifest stays unchanged and `dsh build` restores everything.

### Let an AI agent do it

Hand this prompt to your agent. It asks which path you want and then follows the guard rails.

<!-- fixture: agent-install-prompt -->
```text
You are installing ohmydsh, a DSH customization repository. Follow these rules in order:

1. [ASK-PATH] Ask me first which path I want: (1) copy the full configuration, (2) pick parts, (3) start from zero. Do nothing before I answer.
2. [VERIFY-IDEMPOTENT] After every change run `dsh build` twice; the second run must report no changes. If it does not, stop and report.
3. [NO-DEPLOY-EDIT] Never hand-edit anything under ~/.dsh. Change dsh.yaml or the repository sources, then run `dsh build`.
4. [NO-SECRETS] Never write credentials into the manifest, command arguments or this chat. Secrets belong in .env.local only.
5. [STOP-ON-FAIL-CLOSED] If sync fails closed (for example AGENTS.md drift), stop and report the exact error. Never delete files to get around it.
6. [ASK-RESTART] Ask me before restarting DSH.
```

### Command cheat-sheet

```text
dsh build          materialize dsh.yaml into ~/.dsh without starting DSH
dsh stop           stop the running DSH
dsh restart        stop, wait for the port, start again
dsh reset          undeploy customizations (the manifest is untouched)
dsh history        list previous startups and the plugins they loaded
dsh plugin-update  check remote plugins, confirm, edit dsh.yaml, build, commit
dsh doctor         check and repair host-level prerequisites
```

## Architecture
<!-- section: architecture -->

![ohmydsh architecture: repository as source of truth, sync, ~/.dsh, DSH runtime](docs/assets/ohmydsh-architecture.dual.svg)

### Mental model

The repository declares *what should be installed*. `scripts/sync.mjs` (run by `dsh build`) makes `~/.dsh` match it, fails closed on anything it cannot prove, and changes nothing on the second run. DSH then loads `~/.dsh` like any other deployment.

### Where customizations come from

| Source | Declared as | Example |
|---|---|---|
| Third-party npm package | `source: remote`, exact version pin | `width-tiers` |
| Official optional bundle | `source: remote`, pinned to the DSH version | `experimental-schedule` |
| Self-developed package in this repository | `source: local`, code in `packages/<id>/` | `dsh-memex` |
| Self-developed package in another repository | `source: remote`, GitHub release tarball | `dsh-cockpit-bridge` |
| Skill | `type: skill`, `skills/<id>/` | `ws` |
| Patch | `type: patch`, `patches/<id>.yml` | `connection-webserver` |
| Preset | `type: preset`, `presets/<id>/` | `dsh-pet-executor` |
| Third-party resource | `thirdPartyResources`, pinned with integrity | `spec-superflow` |

### Directory layout

```text
dsh.yaml                 the single switch surface
instructions/            environment-level agent instructions
packages/<id>/           self-developed DSH packages
skills/<id>/             skills synced to ~/.dsh/skills
presets/<id>/            agent presets
patches/<id>.yml         composition patches and overrides
scripts/                 sync, build, upgrade and maintenance scripts
openspec/                specs and changes: behavior is written down before it is built
docs/                    adr/ decisions, architecture/ mechanisms, assets/ diagrams
tests/                   repository-level tests
```

### Lifecycle

![ohmydsh customization lifecycle: add, review, pin, build, verify, upgrade, disable, remove](docs/assets/ohmydsh-lifecycle.dual.svg)

Every customization follows the same loop: add the entry, review its source and trust surface, pin an exact version, build, verify that a second build changes nothing, and upgrade by repeating the loop. Finally disable it, or remove the entry and build again to uninstall it.

### Private overlay

Entries that cannot be published (internal packages, machine-specific patches) go into a gitignored overlay. It is validated exactly like public entries and can only append. See [private overlay](docs/architecture/private-overlay.md).

More mechanisms: [environment-level agent instructions](docs/architecture/agent-instructions.md) and [DSH plugin integration pitfalls](docs/architecture/dsh-plugin-integration-pitfalls.md) (read it before touching host capabilities).

## Multiple machines
<!-- section: multiple-machines -->

Each machine does the same two things: clone this repository (plus your optional private overlay) and run `dsh build`.

[dsh-cockpit](https://github.com/prgrmrwy/dsh-cockpit) lets you manage and view several machines from one place. It does not distribute configuration; the repository does.

## Your configuration
<!-- section: your-configuration -->

- `dsh.yaml` is the truth. Read it, not `~/.dsh`.
- `node scripts/plugin-list.mjs` prints what is actually loaded.
- A private overlay (`dsh.yaml.local`, or the file named by `DSH_LOCAL_MANIFEST`) appends entries that must not be public.
- `.env.local` (gitignored) holds literal single-line `KEY=VALUE` settings and secrets, never executable Shell. Quote paths containing spaces or backslashes; use absolute paths instead of `$HOME` or `~`. Blank/full-comment lines, optional `export`, empty values and CRLF are supported. `$`, backticks, multiline values, bare operators and inline comments are rejected with redacted line diagnostics. Single quotes are completely literal; double quotes decode only `\\` and `\"`. File values override inherited launcher env except explicit caller `DSH_BIN`. Bare sync/plugin-list consumers share the parser but retain their narrow allow-list, caller-first policy and tolerance for unrelated lines; the launcher is deliberately stricter. Migration never rewrites your file.
- `thirdPartyResources` pins assets that are not plugins: the spec-superflow workflow skills, the Jev MCP server (its `TYPESAFE_API_KEY` comes from `.env.local` only, never from the manifest) and the Anvil OpenSpec schema.

## Plugins
<!-- section: plugins -->

Every enabled entry of `dsh.yaml`, grouped by origin. Third-party items link to their upstream; self-developed items link to their directory in this repository.

### Third-party packages

- [cost-meter](https://github.com/Han-1413141/dsh-cost-meter) — Shows per-session cost statistics in the web client.
- [archify-dsh](https://github.com/tt-a1i/archify) — Generates interactive architecture, sequence and data-flow diagrams from a conversation.
- [llm-subscriptions](https://github.com/V1ki/dsh-plugin-subscriptions) — Adds subscription-based providers (Codex, Claude, Grok, Copilot) switchable from the input box.
- [width-tiers](https://github.com/aaronlei/dsh-width-tiers) — Switches the conversation width between five tiers.
- [better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) — Turns the sidebar into a service-backed workbench with tabs.
- [dsh-opencode-session-header](https://github.com/beihzb/dsh-opencode-session-header) — Sends the session header that OpenCode Go requires, fixing missing-session errors.
- [michengai-btw](https://github.com/prgrmrwy/dsh-btw) — Adds `/btw` for one-off side questions answered from the current context, without running tools or writing back to the main conversation. Temporarily installed from a fork release of upstream MichengAI/dsh-btw PR #16.
- [dsh-magpie-connect](https://github.com/bitxeno/dsh-magpie-connect) — Brings the models of a Magpie AI gateway into the model picker, alongside the direct providers.

- [dsh-mobile](https://github.com/saya-ch/dsh-mobile) — Accesses the same DSH sessions from an Android app or phone browser, with paired LAN access and optional remote gateways.

### Official optional

- [experimental-schedule](https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-schedule-bundle) — Official scheduled-automation page, schedule tools and time context.

### Third-party resources

- [spec-superflow](https://github.com/MageByte-Zero/spec-superflow) — State-machine workflow skills for planned, spec-driven changes.
- [jev](https://github.com/jkudish/jev-mcp) — MCP server giving agents semantic judgment tools; the key stays in `.env.local`.
- [anvil](https://github.com/jikkujoyce/openspec-schemas) — OpenSpec schema for test-first change workflows.
- [ponytail](https://github.com/DietrichGebert/ponytail) — Prompt-only skills for a minimal-change, low-bloat coding mode and its review and audit commands.

### Adapted third-party skills

- [i-have-adhd](skills/i-have-adhd/SKILL.md) — Answer-first, short-step output mode, used only when explicitly requested.
- [frontend-design](skills/frontend-design/SKILL.md) — Design guidance that avoids templated, default-looking interfaces.
- [eli5](skills/eli5/SKILL.md) — Explains any topic at the level of a chosen audience.

### Self-developed packages

- [worktree-session](packages/worktree-session/README.md) — Creates an isolated task branch and worktree on the first message of a session.
- [dsh-openspec](packages/dsh-openspec/README.md) — Managed adapter exposing the official OpenSpec workflows as skills and commands.
- [dsh-memex](packages/dsh-memex/README.md) — Native persistent memory with per-workspace scopes and a memory settings page.
- [dsh-pet](packages/dsh-pet/README.md) — A resident desktop companion agent that runs management skills on a trusted snapshot.
- [sidebar-session-provider-icon](packages/sidebar-session-provider-icon/README.md) — Shows the selected model's brand logo on every sidebar session row.
- [session-title-copy](packages/session-title-copy/README.md) — Adds a short session-id badge next to the title that copies the full id.
- [system-clock](packages/system-clock/README.md) — Shows the DSH host's clock, time zone and hostname at the bottom of settings.
- [sidebar-session-resources](packages/sidebar-session-resources/README.md) — Collects links and produced files of the current session into a sidebar panel.
- [home-network-model-guard](packages/home-network-model-guard/README.md) — Disables Claude models in the input box when the host egress region is restricted.
- [subscriptions-sandbox-shim](packages/subscriptions-sandbox-shim/README.md) — Strips sandbox escalation fields and orphan tool calls for subscription providers.
- [dsh-magpie](packages/dsh-magpie/README.md) — Self-hosted Magpie provider with grouped usage cards, model visibility, default effort and per-session fast mode.
- [magpie-display-name-shim](packages/magpie-display-name-shim/README.md) — Shows Magpie gateway display names in the model picker instead of route ids, until the upstream fix ships.
- [cockpit-worktree-open-shim](packages/cockpit-worktree-open-shim/README.md) — Connects the cockpit remote editor to Worktree Session's open action.
- [cockpit-memex-browse-shim](packages/cockpit-memex-browse-shim/README.md) — Connects cockpit port forwarding to the memory card browser.
- [dsh-collab](packages/dsh-collab/README.md) — Lets existing independent sessions share a collaboration ledger by invitation and wakes members on their next turn.
- [auto-model-routing](packages/auto-model-routing/README.md) — In AUTO, asks the Jev decision model for each turn's tier and adjusts only reasoning effort; any Jev failure turns AUTO off and says why. [Standalone repository](https://github.com/prgrmrwy/dsh-auto-model-routing).

### Self-developed skills, preset and patch

- [ws](skills/ws/SKILL.md) — Inspects, promotes and cleans Worktree Session bindings.
- [jev-workflow-router](skills/jev-workflow-router/SKILL.md) — Observation-only routing hint on whether work should use a formal workflow.
- [memex-recall-report](skills/memex-recall-report/SKILL.md) — Reports memory recall statistics and which cards are never recalled.
- [weekly-insights](skills/weekly-insights/SKILL.md) — Local session retrospective like Claude Code `/insights`: streams session logs, tags each session and caches the result, writes an HTML report with improvement prompts.
- [add-dsh-plugin](skills/add-dsh-plugin/SKILL.md) — Adds a remote plugin to the manifest, builds it and asks about a restart.
- [remove-dsh-plugin](skills/remove-dsh-plugin/SKILL.md) — Removes a plugin from the manifest, builds and asks about a restart.
- [dsh-sandbox-notes](skills/dsh-sandbox-notes/SKILL.md) — Notes on sandbox permissions and the "not strictly wider" error.
- [subagent-model-routing](packages/auto-model-routing/skills/subagent-model-routing/SKILL.md) — Calls route_subagent before delegating and passes its model and effort explicitly; pauses and asks on failure.
- [dsh-pet-executor](presets/dsh-pet-executor) — Preset for Pet execution sessions without the global skill provider.
- [connection-webserver](patches/connection-webserver.yml) — Composition patch that restores Connection RPC channel registration.
- [dsh-collab-config](patches/dsh-collab-config.yml) — Config patch for dsh-collab: invite-based admission and the `pet-locus` managed channel that lets Pet Locus join as a proxy member.
- [websocket-heartbeat](patches/websocket-heartbeat.yml) — Config patch that relaxes the official gateway's WebSocket heartbeat to 5 seconds so large histories survive short network hiccups.
- [ponytail-skills](patches/ponytail-skills.yml) — Composition patch that mounts a dedicated skill provider for the ponytail package only.

### Self-developed, separate repository

- [dsh-cockpit-bridge](https://github.com/prgrmrwy/dsh-cockpit) — Bridge between DSH and the dsh-cockpit multi-machine manager, installed from a GitHub release.

## Contributing
<!-- section: contributing -->

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, plus [SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Behavior changes go through an OpenSpec change. Any change to `README.md` must update `README.zh.md` in the same commit, and the other way round.

## License
<!-- section: license -->

[MIT](LICENSE). Third-party plugins keep their own licenses; their upstream links are in the [plugin index](#plugins).
