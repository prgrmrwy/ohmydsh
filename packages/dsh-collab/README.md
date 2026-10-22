# DSH Collab

English · [简体中文](README.zh.md)

<!-- problem -->
Independent sessions in one DSH Host can work in different repositories but need a shared authoritative ledger and directed next-turn notifications. This bundle connects existing ordinary sessions to the standalone collaboration kernel, without turning them into a team or creating child sessions. Whether it runs is decided by the manifest's `enabled` flag; a profile that registers the bundle loads it.

## Configuration

Set the dsh-collab manifest entry to `enabled: true`, run `dsh build`, then `dsh restart`; no machine-specific path is needed. The data directory defaults to `<DSH home>/plugins/dsh-collab`, where DSH home is the Host process's non-empty `DSH_HOME`, else `~/.dsh`. Storage is chosen only by Host configuration and process environment, never by session arguments or model input. Every key below is optional; override it by row id in a profile patch when needed:

```yaml
- id: dsh-collab
  name: dsh-collab
  config:
    dataDir: /absolute/profile-owned-state/collab   # optional; must be absolute, defaults as above
    admission: invite            # default; allowlist restores first-release admission
    allowedSessionIds: []        # under invite: only seed contacts for collab_status
    denySessionIds: []           # exclusion list: cannot call, be claimed or be woken
    memberTrust: true            # default; false restores manual join and the non-authorization wake notice
```

**Admission.** `invite` (default): any first-level session passing ordinary-session checks may create a space; a session that a Leader invites by its complete session ID, and that is claimed, is admitted to that space. The authorization record is the ledger's `member/invited` commit; no configuration change or restart is needed. `allowlist`: callers and invitees must additionally be in `allowedSessionIds`; old configurations keep working. In both modes subagents, nonzero delegationDepth, archived sessions, sessions refused by official ownership checks and those in `denySessionIds` can neither call nor be claimed. An invalid `admission`, a list with empty/padded/duplicate entries, or an ID in both lists makes the plugin refuse to start (`COLLAB_BAD_CONFIG`) without registering tools or creating the data directory. **Changing the exclusion list or admission mode takes effect only after `dsh build` and `dsh restart`**; there is no hot reload.

**Member trust.** `memberTrust: true` (default, in both admission modes) records the operator's standing consent: after `collab_invite` succeeds the Host joins on behalf of the invitee it just claimed (reserved cmdId `dsh-collab:auto-join`, replay-safe; the result gains `autoJoined`), and wake notices tell members they may take requests from space members and execute them directly **within their session's existing permissions**, without asking the user again. Sandbox, approval and worktree limits are unchanged; when a decision needs the user, the member asks its own user in its session and writes the conclusion back to the ledger. `memberTrust: false` restores manual join and the original "not an authorization" wake notice byte for byte. New spaces record convention v3; v1 and v2 spaces keep reading their recorded version.

**Trust surface.** Any ordinary session's agent on the same Host can invite and wake another ordinary session by complete ID; each wake costs the target one model call. With member trust on (default), an invitation also means the inviter can direct the invitee's work within the invitee's own permissions. The plugin **does not limit the number of invitations or cumulative wakes**. Only three things wake a member: a `needsReply` message, an invitation, and a request it authored reaching `done`/`rejected`; item revisions, acks, agreement, `accepted` and leader changes are recorded silently. Loops are bounded per topic: a message may `ref` an earlier message or item in the same space, and a topic accepts at most 20 waking messages before further ones are rejected with `COLLAB_THREAD_LIMIT` (omitting `ref` starts a new topic). The other constraints are the exclusion list and (with member trust off) the invitee's ability to decline. Add sessions to the exclusion list, set `memberTrust: false`, or switch back to `allowlist` when needed.

**Data directory precondition.** One data directory must be used by **one Host process** for its whole lifetime and must not be reachable from another pid namespace through network disks, VM shared folders or container mounts (a host machine and a LumeVM sharing one directory violates this). Otherwise startup lock cleanup may delete a lock another Host still holds and cause double writes; two misconfigured Hosts on one machine are not safe either. The data directory must be outside every declared workspace and node_modules deployment directory. New directories are created 0700; existing group/world-accessible directories are refused, not silently chmodded. The service ID derives from the canonical data directory. The kernel is inlined from source at build time.

## Tools and trust

Eleven resident tools with one identical definition for every session (at most 4200 characters in the real request header):

- `collab_status`: **the single entry point**. Call it first when woken or starting to collaborate. It returns the caller's spaces, pending work (acks, messages awaiting a reply, assigned requests with their creation seq), each space's optional `purpose`, pending invitations, seed contacts and fixed-enum next steps. It never contains titles, bodies or status text; nonconforming space/item IDs (must match `^[a-z0-9][a-z0-9-]{0,63}$`) are omitted. It is a pure read: it opens no space, writes nothing, wakes nobody and samples no presence.
- `collab_space` (`create|close`; create takes an optional `purpose`), `collab_invite`, `collab_member` (`join|decline|leave|mark_gone|transfer_leader`), `collab_read` (`overview|since|convention`).
- `collab_create_item`, `collab_revise_item`, `collab_ack_item`, `collab_send_message`, `collab_set_status`, `collab_advance_request`. `collab_send_message` and `collab_create_item` take an optional integer `ref`.

Writes require a stable nonempty `cmdId`; retries of the same successful command return the original receipt. A write that returns `COLLAB_SPACE_UNAVAILABLE` has an unknown outcome; retry later with the same `cmdId` and arguments. "Space not found", "not a member" and every storage error (lock, corruption, write failure) are all `COLLAB_SPACE_UNAVAILABLE` to models; lock identity and diagnostics go only to the Host log. The single exception is creating an existing space ID, which returns `COLLAB_SPACE_EXISTS`. Invitations do not join automatically; reads before join return `COLLAB_MEMBER_INACTIVE`.

Caller identity comes only from the actual execution agent; arguments cannot supply principal, actor, provider or caller session. Cold target verification reads session header metadata only: no bodies, no agent restore, and no other session's ID or cwd is returned. No tool lists all sessions. Notifications carry only whitelisted pointers, a plugin source and a hint to call `collab_status` first; they carry no business bodies/titles and grant no workspace/user authority. Running sessions receive followup in a later turn, never steer.

Successful delivery means **the Host accepted enqueue**, not durable flush, model completion or user consent. Unknown/failed deliveries are never retried automatically; the ledger remains the authority. There are no human-decision or reset tools; people are not ledger members.

## Recovery

| Situation | Recovery |
|---|---|
| Residual lock (Host SIGKILLed, crashed or exceeded the shutdown budget) | `dsh restart`: startup scans every `*.lock` (including orphan locks without a log); a lock whose pid probes ESRCH locally and whose bytes are unchanged on re-read is removed and logged, and spaces with logs then open. Live, reused or EPERM pids and malformed locks are kept with a one-line diagnostic; then use a new space ID, or stop the Host and delete that lock file manually. Locks are never cleared at runtime. |
| Corrupt line in the middle of a log | Offline salvage while the Host is stopped, or create a new space ID at any time without stopping. |
| Runtime write failure (disk full, fsync error) | Repair the disk, then `dsh restart`. |

Offline salvage runs only while the Host is stopped:

```sh
dsh-collab-salvage --data-dir /absolute/profile-owned-state/collab --space-id SPACE
```

It takes the lock exclusively, keeps the valid prefix before the first bad line using the storage loading rules, writes and fsyncs a temporary file, hard-links the original to `SPACE.jsonl.corrupt-<UTC timestamp>`, atomically replaces the log (or deletes it when nothing valid remains, freeing the ID), and releases the lock. The original bytes are always kept. Output reports the kept record count and the first bad line number. **Receipts of discarded commands are lost; after salvage seq numbers are reused, so members must reset their read cursor to 0 (`collab_read`: if lastSeq is below your cursor, reread from 0); for spaces with agents prefer a new space ID.** If `.salvage-tmp` already exists it refuses and lists file states; the only allowed manual action is to confirm the log is the original corrupt file, delete the tmp file and rerun. If a residual lock and corruption coexist, start the Host once to clear the lock, then stop it and salvage.

## Verification

See [isolated probe instructions](test/README.md). Tests use temporary homes, synthetic sessions and local scripted model behavior; normal stop, budget expiry and SIGKILL are tested separately, and the last two are cleared and replayed by the next official start. A component result alone does not establish all consumer acceptance scenarios. No daily profile or GUI is modified.

## Removal
<!-- section: removal -->
This connects ordinary DSH session execution and the independent collaboration kernel. Disable/remove this bundle and its manifest entry when that integration is not needed, then perform your separately authorized build/restart. Disposing unregisters the tools and closes admitted stores, but retains persistent collaboration logs. Delete no workspace or session data. The standalone kernel remains independently usable and removable.
