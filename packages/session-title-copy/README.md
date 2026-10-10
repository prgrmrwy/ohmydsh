# dsh-session-title-copy

English · [简体中文](README.zh.md)

<!-- problem -->
DSH shows a conversation's title but offers no way to grab its session id, which you need for scripts, logs and bug reports. This plugin adds a small six-character badge next to the title; one click copies the full session id.

![Illustration: a short session-id badge next to the title copies the full id on click](docs/overview.png)

**Install.** Managed through `dsh.yaml` (entry `session-title-copy`, `source: local`): set `enabled: true`, run `dsh build`, then restart DSH. Backlog item B018; designs in the OpenSpec changes `session-title-copy` and `session-title-id-badge`.

## How it behaves

- A badge (`data-dsh-session-title-copy-badge`) appears to the right of the current session title. It shows the first 6 characters of the session id without its `session-` prefix, for example `session-9af69be9-…` becomes `9af69b`.
- The source of truth is `current` in the official sessions list, the same subscription seam the cockpit bridge uses. The badge text and copy target follow session switches and title updates. With no title (a blank session or the hero view) there is no badge.
- Click copies the **full** current session id. Hover shows a pointer cursor, a background tint and a tooltip with the full id. After a successful copy a transient hint (the Chinese string `会话 ID 已复制`, "session ID copied") appears under the badge for 1.2 s and fades out in 200 ms.
- The title itself stays official: still `disabled`, cursor default, no click behavior. Earlier breadcrumbs (titles of ancestor sessions) keep opening their session and never copy. Version 0.1.0 made the title itself click-to-copy; that was dropped in 0.1.1 because it was not discoverable and a breadcrumb is a navigation control.

How it is wired (re-check after DSH upgrades):

1. `title-locator.ts` finds the breadcrumb `nav` inside the official title cluster. This is the only file holding knowledge of the official structure.
2. A self-made `<button>` badge (own marker, inline styles, tooltip with the full id) is inserted after the `nav`.
3. Click reads `current` from `sessions.list`, calls `navigator.clipboard.writeText`, then shows the hint.
4. A `MutationObserver` (subtree and class changes) plus the sessions subscription drive a rAF-debounced reconcile: update the text if the badge exists, rebuild it if missing, and remove leftovers when there is no title area.

## Configuration

None. The plugin row carries no `config` fields; it has no settings, no stored data and no environment variables. To remove it, set `enabled: false` in `dsh.yaml` and sync.

## Boundaries & safety

- No network requests, no host-side capability (the host half is an empty entry), and no reading or uploading of conversation content; only the current session id is used.
- If the official DOM changes and the insertion point cannot be found, nothing is injected and no error is raised. If the clipboard API is unavailable or refused, the plugin stays silent.
- Peer dependencies: `@deepseek-ai/cordis` and `@deepseek-ai/dsh-api-session-controller` (the web client half uses the latter).

## Development

Run from the repository root:

```sh
npm run typecheck --workspace dsh-session-title-copy   # host + client projects
npm run build --workspace dsh-session-title-copy       # tsc (host) + tsdown (client bundle)
npm test --workspace dsh-session-title-copy            # vitest, structural stubs, no browser
```

When the official structure changes, only `src/client/title-locator.ts` should need a fix.
