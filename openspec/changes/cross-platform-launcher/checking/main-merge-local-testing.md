# Authorized main merge and local testing

## User decision (2026-10-25)

User confirmed PC is the native Windows machine already tested, replaced devbox with this machine's WSL, authorized preparing and merging into main before local testing, and requested normal local testing instead of an isolated profile. This is not acceptance of unrun macOS/console/full-manifest gates and does not authorize restarting the existing production Host.

The local two-exact-version script policy remains denial (`allowBuilds:false`), not approval to execute scripts or any allow-all. Permanent deployment configuration must still be maintained through repository sources, not an undocumented generated-profile edit.

## Main cleanliness gate

Controlled `node scripts/ws-merge.mjs ws/win` dry-run refused because main had one pre-existing dirty file, root package-lock.json. Read-only diff showed two existing workspace keys reordered. User explicitly selected preserving and committing that change first. Parsed JSON equality to HEAD was checked before staging; no dependency value changed. Saved separately on main as `85ea1f42` (`chore(lock): preserve existing workspace entry ordering`); main then clean.

## Migration commit candidate

Staged only migration implementation/tests/evidence plus the previously approved old-change archive/spec synchronization. No ignored dependency-review raw scratch or generated package build output included. Staged artifact policy/diff checks pass. Fresh staged candidate `npm test` job bash-336: **578 tests /576 pass /0 fail /2 existing MCP integration skips**, exit0.

Migration remains unaccepted (`verify.md DECISION:FAIL`) while merge/local testing proceeds under this explicit user authorization. No upstream push, change archive, worktree deletion or production restart has been performed.
