# DSH Collab

English · [简体中文](README.zh.md)

<!-- problem -->
Independent sessions in one DSH Host can work in different repositories but need a shared authoritative ledger and directed next-turn notifications. This bundle connects explicitly permitted existing sessions to the standalone collaboration kernel, without turning them into a team or creating child sessions. It is disabled by default and requires trusted Host configuration.

## Configuration

Register the bundle in the intended profile only, then override its disabled composition row with an explicit absolute `dataDir`, `allowedSessionIds` (complete exact session IDs) and `disabled: false`. The manifest entry remains disabled until you deliberately deploy it. Never use a user session's environment to select storage.

```yaml
- override:
    dsh-collab:
      disabled: false
      config:
        dataDir: /absolute/profile-owned-state/collab
        allowedSessionIds: [complete-session-id-a, complete-session-id-b]
```

The data directory must be outside every declared workspace and all node_modules deployment directories. New directories are created with mode 0700; existing group/world-accessible directories are refused, not silently chmodded. Do not point two Hosts at one data directory. The stable service ID derives from the canonical data directory. The kernel is inlined from source at build time; no runtime workspace package is needed.

The allowlist is human permission, **not proof that a session is unmanaged by another product**. Add only independent ordinary sessions. Known subagent origin/depth and official ownership failures are refused. Ordinary forks are not rejected merely for having parent lineage. No Pet or Agent Teams private indexes are read.

## Tools and trust

The tool surface contains 15 named kernel write adapters, four authorized read adapters and `collab_sessions`. Read the versioned convention through `collab_read_convention`; use `collab_overview` and `collab_read_since` to resume work. Writes require a stable nonempty `cmdId`; retries of the same successful command preserve the original receipt. Names use the kernel's lowercase member-name rules. Invitations do not automatically join or grant read access.

Caller identity comes only from the actual execution agent. Tool arguments cannot supply principal, actor, provider or caller session identity. Discovery exposes only permitted session metadata, never message history. Notifications include only whitelisted pointers and a plugin source; they do not carry business bodies/titles or grant workspace/user authority. Running sessions receive followup in a later turn, never steer in the current turn.

Successful delivery means **the Host accepted enqueue**, not durable flush, model completion or user consent. A crash between enqueue and session flush can lose a pointer. Unknown/failed deliveries are never automatically retried; the ledger remains the authority. Human confirmation and breaker reset are not model tools. Agent-only decision requests return `COLLAB_NO_DECIDER`; historical human requests without a confirmation channel remain waiting.

## Offline residual-lock maintenance

Stop **all** Hosts using this data directory and prevent concurrent restarts first. Then run the package's trusted CLI with the exact lock instance ID:

```sh
dsh-collab-unlock --data-dir /absolute/profile-owned-state/collab --space-id SPACE --expected-instance-id INSTANCE --all-hosts-stopped
```

Only a positive safe PID whose local process probe returns ESRCH may be recovered; live processes, EPERM, unknown outcomes, PID reuse, malformed locks and changed identity are refused. The command does not open or rewrite logs. This is a trusted single-operator operation, not atomic CAS against concurrent writers. Never expose it as an agent tool or use it to bypass a live writer. Normal shutdown drains admitted storage; the official CLI's finite shutdown budget can still leave a lock, as can SIGKILL.

## Verification

See [isolated probe instructions](test/README.md). Tests use temporary homes, synthetic sessions and local scripted model behavior; the normal CLI, budget expiry and SIGKILL are tested separately. A component result does not by itself establish all consumer acceptance scenarios. No daily profile or GUI is modified by these commands.

## Removal
<!-- section: removal -->
This connects ordinary DSH session execution and the independent collaboration kernel. Disable/remove this bundle and its manifest entry when that integration is not needed, then perform your separately authorized build/restart. Disposing unregisters the tools and closes admitted stores, but retains persistent collaboration logs. Delete no workspace or session data. The standalone kernel remains independently usable and removable.
