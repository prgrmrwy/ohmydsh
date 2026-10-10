# dsh-cockpit-worktree-open-shim

English · [简体中文](README.zh.md)

<!-- problem -->
Without this shim, the "open in editor" action of a Worktree Session on a remote machine falls back to a local `vscode://file/` link that cannot reach the worktree. The shim hands the worktree path to dsh-cockpit's remote-editor capability so the editor opens on the right machine.

A deployment-side adapter: it registers the remote-editor open capability exposed by `dsh-cockpit-bridge` into the generic open-behaviour extension point of `dsh-worktree-session`.

```text
dsh-cockpit-bridge ──provide──▶ shim ──register──▶ dsh-worktree-session
  knows nothing about ws                     knows nothing about cockpit
```

## Why a separate package

Worktree Session is a generic plugin and must not know about dsh-cockpit; dsh-cockpit-bridge must not know its concrete consumers either. All coupling between the two ends lives only in this shim, which keeps independent upgrades and complete removal possible.

## Behaviour

- No top-level `inject`; at runtime it watches both services appearing and disappearing, so any load order works.
- It reads the bridge service by the full dotted name `ctx.get('cockpitBridge.editorOpen')`; `ctx.get('cockpitBridge').editorOpen` is forbidden.
- It forwards only the absolute worktree path, unchanged, to the bridge: no validation, no rewriting, no state, no retries.
- If either end is missing or unloaded, the shim is inert; Worktree Session automatically falls back to its default `vscode://file/` behaviour.

## Prerequisites and known limits

- Requires `dsh-cockpit-bridge >= 0.4.0` (this repository currently pins 0.6.4); an older bridge does not provide the service and the shim silently does nothing.
- The host machine needs VS Code Remote-SSH installed and must be able to reach the target device through the SSH config alias registered for the Cockpit device.
- Without Remote-SSH the URI may be silently dropped; a directory name containing a dot may be treated as a file by the VS Code URI handler.

## Removal

<!-- section: removal -->
This shim connects two ends: the **`cockpitBridge.editorOpen` service** of `dsh-cockpit-bridge` and the **open-behaviour extension point** (`worktreeSession.openHandler`) of `dsh-worktree-session`. Neither side references the other, so the shim is the only place the two meet.

It can be removed at any time, and it should be removed once you stop using dsh-cockpit remote editors, or when either end ships the integration natively. Delete or disable `cockpit-worktree-open-shim` in `dsh.yaml`, run `dsh build`, and restart DSH web. After removal:

- Worktree Session returns to the default `vscode://file/` behaviour;
- existing dsh-cockpit-bridge features such as session read-confirmation and the pending snapshot are unaffected;
- neither end needs any source or configuration migration.
