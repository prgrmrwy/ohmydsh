# Local plugin compatibility under federation (Section 8)

Evidence gathered from the deployed profile at `~/.dsh/profiles/web` and the
pinned rc.2 assembly in the npx cache. No plugin source was modified.

## 1. Workspace row-menu seam (8.1, 8.2)

**Finding — rc.2 declares no row-menu hole.** The pinned rc.2 client packages
declare only these sidebar slots:

```
sidebar.brand.mark
sidebar.brand.name
sidebar.footer.action
sidebar.settings
sidebar.workspaces
sidebar.workspaces.directoryFlow
```

`dsh-open-in-vscode@0.1.6` nevertheless targets
`sidebar.workspaces.row-menu`, and its client reconciles on
`ctx.slots.spec('sidebar.workspaces.row-menu')`:

- spec present → it registers `OpenInVscodeRow` into that hole;
- spec absent → it installs `installLegacyWorkspaceMenu`, a
  `MutationObserver` over `document.body` that identifies the workspace menu by
  matching translated `rename` / `delete.workspace` labels and appends a React
  root into the open menu.

Federation therefore **declares** the hole (`WORKSPACE_ROW_MENU_SLOT`) so the
plugin takes its supported path instead of DOM scraping. Owner props match the
component's real signature: `{ cwd, label, onClose }`, occupant injects
`{ open }`.

**This Mac vs remote.** `OpenInVscodeMenuRow` returns `null` when `cwd` is
`undefined`. Federation exploits exactly that: `workspaceRowMenuOwnerProps`
hands a real path only when the row's node is the local node, so a remote
workspace path is never passed to the central `code` CLI and the row simply does
not render for remote nodes. Official rename/delete rows are untouched.

Entry isolation is explicit: `renderRowMenuEntries` preserves registration order
and reports a throwing occupant instead of losing the remaining rows.

## 2. Provider icon (8.3, 8.4)

`dsh-sidebar-session-provider-icon@0.1.2` (local package) injects badges via a
`MutationObserver` on `document.body` plus a row locator, using
`modelDirectories` selector values with a host provider projection fallback.

Federation adds a first-class renderer path and coordinates the two so exactly
one is ever active:

- `CLIENT_FEDERATED` → federated Session row renders the badge; the plugin's DOM
  observer is stopped, so no duplicate logo can appear;
- `CLIENT_FALLBACK` / `CLIENT_OFFICIAL` → the observer is restarted and native
  single-machine behaviour is restored.

`resolveProviderBadge` reuses the plugin's precedence (selector wins, projection
is fallback, unknown yields no badge) rather than reimplementing brand
detection. StateDot, timestamps, menus and drag are not touched.

## 3. Per-node extension actions (8.5)

Nodes are independent installs, so a central plugin list proves nothing about a
remote node. `offersExtensionAction` is conservative:

| Action | This Mac | Remote |
| --- | --- | --- |
| `open-in-editor` | offered | never (central desktop cannot open a remote path) |
| `unarchive` | offered | only with probed `extension.unarchive` |
| `worktree-session` | offered | only with probed `extension.worktree` |

## 4. Composition review of the remaining plugins (8.6)

| Plugin | Integration | Federation impact |
| --- | --- | --- |
| `dsh-cost-meter@1.5.42` | slots `conversation.composer.dock`, `conversation.input.dock`, `conversation.session.header.actions`, `sidebar.footer.action` | Unaffected. Federation replaces only `sidebar.workspaces` and `conversation.hero.workspace`; the single official Conversation/SessionRuntime remains. |
| `dsh-plugin-subscriptions` + `dsh-subscriptions-sandbox-shim` | central Host provider/model surface | Unaffected and deliberately central-only: federation never proxies settings, subscriptions or credentials, so each node keeps its own subscriptions. |
| `dsh-better-sidebar@0.16.0` | slot injection plus DOM anchors `[data-dsh-panel-host]`, `[data-dsh-revealed]`, `#root [data-slot="conversation"]` | Compatible in principle: the anchors it needs are shell/conversation attributes, not workspace-list internals. **Residual risk:** its sidebar layout logic was written against the official single-machine list; visual/scroll behaviour with a Node→Workspace→Session tree must be confirmed in the M3 three-node acceptance run. |
| `dsh-sidebar-qa@0.4.0` | DOM anchor `[data-streaming]` plus owned style tags | Unaffected; the attribute is conversation-side. |
| `dsh-width-tiers@1.0.3` (+ wiring patch) | width tiers on the shell | Unaffected; federation does not change the sidebar shell contract. |
| `@tangzai/dsh-ui-archive-manager@0.1.1` | slot `settings.section` | Continues to manage This Mac. Remote unarchive is capability-gated (§3). |
| `dsh-worktree-session` (local) | Host-side worktree operations | Runs under its owning Host; federation does not assume identical installs across nodes. |
| `@tt-a1i/archify-dsh@0.1.0` | diagram tooling | Unaffected. |

**Declared incompatibilities:** none blocking. One item is explicitly carried
forward as unproven rather than claimed working: `dsh-better-sidebar` layout
behaviour against a federated multi-node tree (verify in Section 10 acceptance).
