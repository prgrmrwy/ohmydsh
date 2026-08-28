import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MaintenanceTarget } from './maintenance.js'
import { wsCleanRepository, wsPromote, wsStatus } from './maintenance.js'
import { activeBoundSessionIds } from './policy.js'

export function targetFor(args: object & { path?: string }, exec: { agent?: { session: { id: unknown; header: { cwd?: string } } } }): MaintenanceTarget | string {
  const agent = exec.agent
  // Older model/tool clients sometimes materialize an omitted optional string as
  // `""`. Treat that wire artefact as absent so a bound call still resolves by
  // Session identity; every non-empty explicit path remains forbidden to Agents.
  if (args.path !== undefined && args.path !== '') {
    if (agent !== undefined) throw new Error('ws explicit path is unavailable to an Agent-bound call; use the Session binding or the path-oriented dsh-ws CLI')
    return args.path
  }
  const repoPath = agent?.session.header.cwd
  if (agent === undefined || repoPath === undefined) throw new Error('ws requires a calling Session binding or an explicit operator recovery path')
  return { sessionId: String(agent.session.id), repoPath }
}

/**
 * Resolve the repository a `clean` call may scan.
 *
 * Cleanup is repository-oriented rather than binding-oriented: it runs from an
 * ordinary Session at the repository main checkout, never from a Session still
 * bound to a worktree (which cannot clean itself and must not sweep its peers).
 * The model cannot name a path, Session, or repository — only the calling
 * Session's own cwd is used, and a caller whose Session identity cannot be
 * resolved is refused before any operation is scanned.
 */
export function cleanTargetFor(
  exec: { agent?: { session: { id: unknown; header: { cwd?: string } } } },
  context: { boundSessionIds: readonly string[] },
): { repoPath: string } {
  const agent = exec.agent
  const repoPath = agent?.session.header.cwd
  if (agent === undefined || repoPath === undefined) throw new Error('ws clean requires a calling Session whose working directory is the repository main checkout')
  if (context.boundSessionIds.includes(String(agent.session.id))) {
    throw new Error('ws clean is unavailable to a bound Worktree Session; run it from an ordinary main-checkout Session in the same repository')
  }
  return { repoPath }
}

/** Agent-visible arguments deliberately exclude operator-only path targeting. */
export const WS_TOOL_PARAMETERS = {
  action: { type: 'string', required: true, enum: ['status', 'promote', 'clean'] as const, description: 'Maintenance action. status/promote target the exact calling Session binding; clean scans the calling repository.' },
  dry_run: { type: 'boolean', description: 'For clean only, preview the safety-proven actions without removing resources.' },
} as const

/** Register the Session-oriented maintenance tool. */
export function registerWsTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'ws',
    description: "Inspect or promote the exact current Worktree Session binding. Clean runs from an ordinary main-checkout Session and cleans this repository's archived Worktree Sessions, applying the active/dirty/merge safety gates to each candidate. Path-oriented operator recovery is available only through dsh-ws or the Skill shell wrapper.",
    parameters: WS_TOOL_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          json: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(args, exec) {
      // Clean is repository-oriented and takes its trusted inputs (archive
      // membership, live Session paths, protected bindings) from the Host.
      if (args.action === 'clean') {
        const bound = activeBoundSessionIds(ctx)
        const { repoPath } = cleanTargetFor(exec, { boundSessionIds: bound })
        const result = await wsCleanRepository(repoPath, {
          dryRun: args.dry_run ?? false,
          archivedSessionIds: ctx.workspaceRegistry.archivedSessionIds.map(String),
          activePaths: ctx.sessions.list().flatMap(session => session.header.cwd === undefined ? [] : [session.header.cwd]),
          activeBoundSessionIds: bound,
        })
        return { json: JSON.stringify(result, null, 2) }
      }
      const target = targetFor(args, exec)
      const result = args.action === 'status' ? await wsStatus(target) : await wsPromote(target)
      return { json: JSON.stringify(result, null, 2) }
    },
  }))
}
