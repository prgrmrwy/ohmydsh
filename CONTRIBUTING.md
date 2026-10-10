# Contributing

Thanks for your interest in ohmydsh! This document explains how to submit changes to this repository efficiently and safely.

The documentation is English-first. Every `README.md` has a Simplified Chinese twin, `README.zh.md`, in the same directory; the community documents (this file, [SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)) are English only.

## What this repository is

ohmydsh is the **source of truth for customizing and deploying DeepSeek Harness (DSH)**; it is not DSH core. A declarative manifest (`dsh.yaml`) manages the DSH version, third-party plugins, in-house packages, patches, skills and environment-level agent instructions, and `scripts/sync.mjs` then **idempotently materializes** them into `~/.dsh`.

Understanding this matters, because it drives almost every contribution rule:

- `dsh.yaml` is the single switch surface and `~/.dsh` is the output — **never edit the output directly**.
- Third-party capabilities keep only an exact version pin, override fragments and a review record; **remote sources are not vendored**.
- Every customization should be independently enableable, disableable, upgradable and removable; `enabled: false` means disabled, **not deleted**.

## Setting up

Prerequisites: **Node.js >= 22** and **npm >= 10** (the version in `.nvmrc` is recommended).

```bash
git clone https://github.com/prgrmrwy/ohmydsh.git && cd ohmydsh
./scripts/bootstrap.sh     # check the Node environment + install dependencies (idempotent)
./scripts/install.sh       # install the dsh command into ~/.local/bin
```

To reinstall dependencies after something breaks: `./scripts/bootstrap.sh --force`. To uninstall the command: `./scripts/install.sh uninstall`.

## Reading order before you start

Do not guess requirements from directory names or a local implementation. Build context in this order:

1. The root [`dsh.yaml`](dsh.yaml) — the current DSH pin, the enabled customizations, their sources, purpose and risk notes.
2. [`openspec/specs/`](openspec/specs/) — the behaviour the system **currently must satisfy**.
3. [`openspec/changes/`](openspec/changes/) — whether a related in-progress change exists (read `proposal.md`, `design.md`, `specs/` and `tasks.md`).
4. `openspec/changes/archive/` — design evolution and history. An archived change is historical evidence and **does not override the current spec**.
5. [`docs/adr/`](docs/adr/) and [`docs/architecture/`](docs/architecture/) — long-term architecture decisions, and the current system structure and mechanisms. Read [`docs/architecture/dsh-plugin-integration-pitfalls.md`](docs/architecture/dsh-plugin-integration-pitfalls.md) before touching DSH host capabilities (creating sessions/agents, spawning long-running child processes, parsing session events, calling lark-cli).
6. [`packages/`](packages/), [`scripts/`](scripts/), [`patches/`](patches/), [`skills/`](skills/), [`presets/`](presets/) and the tests — confirm what is actually implemented. The tiered package READMEs are indexed in [`packages/README.md`](packages/README.md).

If a document and the implementation disagree, **do not silently pick one side**: point out the difference first, then decide from the current OpenSpec, the accepted ADRs and the maintainer's intent whether to fix the spec or the implementation. The agent entry file is [`CLAUDE.md`](CLAUDE.md) (`AGENTS.md` is a symlink to it).

## Contribution workflow

### 1. Open an issue first

Except for obvious small fixes (typos, broken links), please open an issue first to explain the motivation and the expected behaviour, which avoids rework caused by a wrong direction.

### 2. Spec-driven development (OpenSpec)

New features, behaviour changes, compatibility adjustments and architecture decisions **should go through an OpenSpec change first**:

```bash
openspec new change <name>   # generates the proposal / design / specs / tasks skeleton
```

- Confirm the relevant spec and tasks before implementing; keep the task status consistent with the real progress while you work.
- When done, run the relevant tests and the strict validation, confirm that the current specs reflect the final behaviour, and then archive the change.
- Even for a small bug fix, search the existing specs first so you do not break existing scenarios and invariants.

### 3. Changing configuration and customizations

- Edit only `dsh.yaml`, the matching local source (`packages/<id>/`) or `patches/`; **never hand-edit the deployed `~/.dsh` directory**.
- A remote customization must use an **exact version pin**, with its source and review conclusion recorded in the entry's `note`.
- After changing the code of an in-house package, **bump the version in both `package.json` and the manifest**.
- Every in-house package declares its documentation tier in `package.json` as `ohmydsh.docTier` (`A`, `B` or `C`); see [`packages/README.md`](packages/README.md).
- Materialize the change with `dsh build` (or `node scripts/sync.mjs`).
- Sync must stay **idempotent**: at least verify that running it a second time produces no changes.
- For a TypeScript local package, `src/` is the source of truth; build products such as `lib/` stay gitignored and are not committed.

### 4. Documentation: README pairs

Any change to a `README.md` **must update the matching `README.zh.md` in the same commit**, and the other way round. Both files link to each other within their first 15 lines and keep the same structure; `README.md` is written in English and `README.zh.md` in Simplified Chinese, and the repository tests check the pairing and the language ratio. READMEs under `openspec/` are not covered.

Package READMEs are tiered. Screenshots must come from an isolated `DSH_HOME` filled with synthetic data, never from a daily-use instance, must be at most 400 KiB each, and must be registered in the `SCREENSHOTS.md` next to the image. Details are in [`packages/README.md`](packages/README.md).

### 5. Verification

Pick the checks that fit the scope of your change, and **report the checks you actually ran**:

```bash
npm test                 # regression tests (including the sync black-box tests)
npm run check:artifacts  # keep generated artifacts / nested locks / raw evidence out of the repository
node scripts/sync.mjs    # materialize; when deployment is involved, verify that a second run changes nothing
```

If a package has its own build, typecheck or test, run those as well.

> ⚠️ **Do not claim that a verification you did not run has passed.** This is a hard rule of this repository.

### 6. Submitting a pull request

- Keep a PR focused on a single topic so it is easy to review.
- Fill in the PR template: the motivation, what changed, and the **verification commands you actually ran and their results**.
- Link the related issue or OpenSpec change.
- CI must pass.

## Commit messages

This repository uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>
```

Common types:

| type | use |
|---|---|
| `feat` | new feature / new customization capability |
| `fix` | bug fix |
| `docs` | documentation (including OpenSpec proposals and archives) |
| `refactor` | refactoring without changing external behaviour |
| `test` | adding or correcting tests |
| `chore` | dependencies, version pins, build and other chores |

Common scopes: `sync`, `launcher`, `customizations`, `worktree-session`, `openspec`, `dsh`, and so on.

Examples:

```
feat(worktree-session): explicit preflight diagnostics for pnpm and unsupported projects
fix(sync): verify the deployment surface against the manifest and self-heal broken packages
docs(openspec): archive scope-npm-registry-injection
```

## Code and documentation style

- Follow `.editorconfig` (UTF-8, LF, 2-space indentation).
- Match the style of the surrounding code; do not make unrelated large-scale reformatting along the way.
- For important behaviour, **write the spec, design and acceptance criteria first, then change the code**.
- Security-related paths must **fail closed**: when identity or state cannot be proven, refuse destructive operations.

## Safety and compatibility red lines

- Worktree Session, deployment overrides, cleanup, migration and legacy-format reading must be handled conservatively.
- Preserve manifest order, the GENERATED markers, version pins, idempotency and reversible-switch semantics.
- Before changing a third-party plugin integration, read the review record in `dsh.yaml` and the related OpenSpec/ADR to confirm the trust surface and DSH version compatibility.
- **A plugin is third-party code**: read its source before introducing it, and write its provenance and review conclusion into `note`.

Found a security vulnerability? Please **do not** open a public issue; report it privately following [SECURITY.md](SECURITY.md).

## What must not be committed

- Rebuildable artifacts (`packages/*/lib/`) and nested lockfiles (`packages/*/package-lock.json`).
- Bulk screenshots and raw session/history evidence (`openspec/changes/**/checking/{baselines,screenshots}/`).
- Duplicate exports of architecture diagrams (keep only the source JSON and one theme-adaptive SVG).
- Any key, token or machine-private configuration (`.env.local` is gitignored).

`npm run check:artifacts` enforces these rules.

## Code of conduct

By participating in this project you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Unless stated otherwise, your contributions are licensed under the [MIT License](LICENSE).
