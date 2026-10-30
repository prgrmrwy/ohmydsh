# dsh-session-id-copy

English · [简体中文](README.zh.md)

<p align="center">
  <img src="docs/overview.png" alt="Conversation header with the short session id badge 71766c and the copied hint shown right after clicking it" width="760">
</p>

*The six-character badge next to the conversation title, and the copied hint right after a click. Captured in an isolated DSH instance; the session title is synthetic.*

![Architecture: the DSH web client loads the plugin's browser bundle, which reads the official sessions list and title DOM, injects the session-id badge and writes the full id to the clipboard on click](docs/architecture.en.svg)

<!-- problem -->
DSH shows a conversation's title but offers no way to copy its session id, which you need for logs, scripts, issue reports and `dsh` commands. This plugin puts a small six-character badge next to the title; one click copies the full session id and confirms it with a short hint.

**What you get**

- **The id is one click away.** No devtools, no log grep, no retyping an id from a URL.
- **The title stays official.** The badge is an extra sibling inside the title cluster, so titles, breadcrumbs and their navigation behave exactly as before.
- **Nothing leaves the page.** No host-side capability, no network request, no stored data and no reading of conversation content; only the id of the current session is used.
- **It follows the session live.** Switching sessions or renaming a title updates the badge immediately.

## Install

DeepSeek Harness `0.2.0-rc.2`, Node.js `>=22.19`.

```sh
# from npm — prebuilt, no build approval
dsh plugin --profile web add dsh-session-id-copy

# or from source — builds locally, approve the build when dsh asks
dsh plugin --profile web add prgrmrwy/dsh-session-id-copy
```

Restart DSH and refresh the Web page. There is nothing to configure.

## How it behaves

- A badge (`data-dsh-session-id-copy-badge`) appears to the right of the current conversation title. It shows the first six characters of the session id without its `session-` prefix: `session-9af69be9-…` becomes `9af69b`.
- The source of truth is `current` in the official sessions list. The badge text and the copied value follow session switches and title changes. A blank session or the hero view has no title area, so there is no badge.
- Clicking copies the **full** session id. Hover shows a pointer cursor, a background tint and a tooltip with the full id. After a successful copy a transient hint appears under the badge for 1.2 s and fades out in 200 ms; its wording follows the UI language (English / Chinese).
- The title itself stays official: still `disabled`, cursor default, no click behaviour. Ancestor breadcrumbs keep opening their session and never copy.
- A `MutationObserver` (subtree plus class changes) together with the sessions subscription drives a rAF-debounced reconcile: the badge is updated in place, rebuilt when the title cluster is rebuilt, and removed when no title area exists.

How it is wired (re-check after DSH upgrades):

| Part | File | Responsibility |
|---|---|---|
| Official DOM seam | `src/client/title-locator.ts` | finds the breadcrumb `nav` inside the title cluster; the only file that knows the official structure |
| Badge and interaction | `src/client/wiring.ts` | own marker, inline styles, tooltip, clipboard call and the transient hint |
| Reconciliation | `src/client/index.ts` | sessions subscription, observer, rAF debounce, cleanup |
| Hint copy | `src/client/locales.ts` | the hint label for the active UI language |
| Host entry | `src/index.ts` | no-op loader entry (see [Boundaries & safety](#boundaries--safety)) |

Version 0.1.0 made the session title itself click-to-copy. Since 0.1.1 the interaction lives on the badge instead, because a breadcrumb is a navigation control and overriding it was not discoverable.

## Configuration

None. The plugin row carries no `config` fields and the package reads no environment variables.

## Boundaries & safety

- **No host capability.** The host half (`src/index.ts`) is an empty loader entry. It exists for one structural reason: the bundle row imports the package at boot, and being that entry is what makes the browser bundle reachable. It has no network, filesystem or session side effects.
- **No network, no storage.** The browser half reads the official sessions list and the official title DOM, and calls `navigator.clipboard` on click. It keeps no `localStorage`, no cookies and no files; nothing is uploaded.
- **Silent degradation.** If the official DOM changes and the breadcrumb cannot be found, nothing is injected and no error is raised. If the clipboard API is unavailable or refuses the write, the plugin stays silent.
- **No impersonation of official UI.** The badge and the hint are plugin-owned elements (own marker, inline styles, official design tokens with fallbacks); official class names and handlers are never patched.
- **Dependencies.** Peer dependencies are `@deepseek-ai/cordis`, `@deepseek-ai/dsh-api-session-controller` and `@deepseek-ai/dsh-client-locale`, all at the running DSH version.

## Development

`lib/` is a gitignored build artifact. In a standalone checkout:

```sh
npm install
npm run typecheck
npm test
npm run build
```

In the ohmydsh monorepo this package is a workspace member: install once at the repository root and add `--workspace dsh-session-id-copy` to the last three commands. `dsh build` / sync also builds `lib/` on demand before installing the local package; refresh the Web page to pick up a new client bundle.

When the official structure changes, only `src/client/title-locator.ts` should need a fix; the wiring tests assert the badge, clipboard and hint behaviour without a browser.

## Removal

```sh
dsh plugin --profile web remove dsh-session-id-copy
```

Restart DSH and refresh the page; the badge disappears. The plugin keeps no settings or files of its own, and no data is left behind.

## Source, license and contributing

This plugin is developed in [ohmydsh](https://github.com/prgrmrwy/ohmydsh) (`packages/session-title-copy`); this repository is its release mirror, published to npm and GitHub Releases automatically. Current behaviour is specified in [`openspec/specs/session-title-copy`](https://github.com/prgrmrwy/ohmydsh/blob/main/openspec/specs/session-title-copy/spec.md); design history lives in the archived changes [`session-title-copy`](https://github.com/prgrmrwy/ohmydsh/tree/main/openspec/changes/archive/2026-09-01-session-title-copy) and [`session-title-id-badge`](https://github.com/prgrmrwy/ohmydsh/tree/main/openspec/changes/archive/2026-09-02-session-title-id-badge).

Code is [MIT](LICENSE). Issues and pull requests are welcome at [prgrmrwy/dsh-session-id-copy](https://github.com/prgrmrwy/dsh-session-id-copy/issues).
