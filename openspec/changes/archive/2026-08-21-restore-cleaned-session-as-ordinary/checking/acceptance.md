# 5.4 Real Host / GUI acceptance evidence

Date: 2026-08-21
URL: `http://127.0.0.1:3080`
Host profile: real user profile at `/Users/bytedance/.dsh/profiles/web`
Session: `session-a583ff33-d2ce-4229-8699-7cd6b7a69a7c` (`优化 Worktree 启动阶段 Trace`)
Operation: `f95bbd16-b71c-4a02-9222-bb8fc9e1ffca`

## Host and deployment

- Existing URL returned HTTP 200 after restart.
- Host process read `/Users/bytedance/.dsh/profiles/web/package.json`.
- Real profile retained all 11 configured bundles and existing credentials/sessions.
- Deployed `dsh-worktree-session/lib/index.js` contained `workspaceRegistry` / `storageDomain` injection and `registerArchiveLifecycle`.

## Legacy startup migration

Before the new Host loaded, the schema-v2 tombstone had `phase: cleaned`, binding state `cleaned`, and no archive lifecycle marker. The source Session remained in the durable `archivedSessionIds` set.

After restart, without creating resources, the operation became:

```json
{
  "schemaVersion": 2,
  "phase": "cleaned",
  "binding": {
    "mode": "source-session",
    "sourceSessionId": "session-a583ff33-d2ce-4229-8699-7cd6b7a69a7c",
    "state": "cleaned-archived",
    "archiveLifecycle": { "version": 1 }
  }
}
```

This proved an archived legacy tombstone remains fail-closed until the real unarchive edge.

## Real archive → unarchive release

The installed archive-manager's real unarchive HTTP route returned HTTP 200 / `{ "ok": true }`. The Worktree operation atomically became:

```json
{
  "schemaVersion": 2,
  "phase": "cleaned",
  "binding": {
    "mode": "source-session",
    "sourceSessionId": "session-a583ff33-d2ce-4229-8699-7cd6b7a69a7c",
    "state": "released",
    "archiveLifecycle": { "version": 1 }
  }
}
```

The Session was absent from `archivedSessionIds`, and three repeated status calls plus the final call all returned:

```json
{ "ok": true, "data": { "bound": false } }
```

## Resource invariants

Before and after the real release:

- Git worktree porcelain hash unchanged: `a402a4e9d0e26c47c4214cfc3938e6a7af4044812c6ce685f9bd07038887fc20`
- Local branch inventory hash unchanged: `05653506fda43fc5dbd256f77ded5c725a05e54585bcae16253b14c3ae0a84c4`
- Worktree Session operation count: `5 → 5`
- Operation id inventory unchanged
- DSH Workspace count: `4 → 4`
- Retained Workspace Session slots: `28 → 28`

The cleaned audit tombstone remained on disk.

## GUI black-box result

The released Session was visible under the original `ohmydsh` Workspace and opened with its complete 9-turn / 66-step history. Its composer rendered the ordinary non-blank placeholder `给智能体发消息`.

For the selected released Session:

- persisted client key `dsh.worktree-session.v1.<sessionId>` was absent (`localStorage` returned null);
- no `[data-testid=worktree-session-status]` branch/status badge existed;
- its composer contained only ordinary access/model controls;
- there was no Worktree toggle, task branch selector, cleaned badge, or `ws start` action in that composer;
- no submit was performed during acceptance, so Session history/resources remained untouched.

The acceptance screenshot was reviewed during execution and intentionally omitted from Git under the repository's raw-evidence retention policy.

## Released monotonicity

The official `workspace.archiveSession` RPC re-archived the released ordinary Session successfully. A second real unarchive succeeded. Across both events:

- tombstone binding state remained `released` with the same release timestamp;
- final `session-status` remained `{ "bound": false }`;
- Git worktree/branch hashes, operation count, Workspace count, and retained Session slots remained unchanged.

Result: PASS.
