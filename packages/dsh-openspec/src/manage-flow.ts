export type ManagementActions = {
  transact: (target: string, consent: { approved: boolean }) => Promise<unknown>
  refreshProject: (consent: { approved: boolean }) => Promise<unknown>
}
export function createManagementGuidance() {
  return [
    '# Upgrade the managed official OpenSpec stack (openspec-upgrade)',
    'This adapter-defined entry checks and upgrades the managed official OpenSpec CLI and workflow templates, not a project change or a system-global installation.',
    'Check the managed adapter release and report the PATH CLI version separately; this help does not authorize mutation.',
    'An explicitly approved adapter upgrade or rollback changes only the managed OpenSpec runtime and its pin/lock transaction.',
    'Project instruction refresh via `openspec update` is separate and requires a separate explicit request and authorization.',
    'Official change revision uses the distinct `opsx-update` workflow; it is not an adapter software upgrade.',
    'Exact slash grammar (the verb is required; the literal `--approve` flag is the only consent, and only the user types it): `/openspec-upgrade` (read-only check), `/openspec-upgrade upgrade <X.Y.Z> --approve`, `/openspec-upgrade rollback <X.Y.Z> --approve`, `/openspec-upgrade refresh-project --approve`. A version number without the leading verb is invalid and is rejected. When suggesting a command to the user, copy one of these forms exactly; never invent other syntax and never add `--approve` on the user\'s behalf without their request.',
    'Explicit slash requests return a quoted session-updater command, not a completed mutation. Run it only through the calling session Bash with the supplied workdir and report the actual result. Never elevate policy, switch workdir, or use a Host fallback after denial.',
    'Never install globally, use npx/latest, or modify project files merely by loading this guide.',
  ].join('\n\n')
}

/** A pure controller: no action occurs without explicit, action-specific approval. */
export function createManagementFlow(actions: ManagementActions) {
  return {
    upgrade: (target: string, approved: boolean) => actions.transact(target, { approved }),
    rollback: (target: string, approved: boolean) => actions.transact(target, { approved }),
    refreshProject: (approved: boolean) => actions.refreshProject({ approved }),
  }
}
