import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MaintenanceTarget } from './maintenance.js'
import { wsClean, wsPromote, wsStatus } from './maintenance.js'

export function targetFor(args: { path?: string }, exec: { agent?: { session: { id: unknown; header: { cwd?: string } } } }): MaintenanceTarget | string {
  const agent = exec.agent
  if (args.path !== undefined) {
    if (agent !== undefined) throw new Error('ws explicit path is unavailable to an Agent-bound call; use the Session binding or the path-oriented dsh-ws CLI')
    return args.path
  }
  const repoPath = agent?.session.header.cwd
  if (agent === undefined || repoPath === undefined) throw new Error('ws requires a calling Session binding or an explicit operator recovery path')
  return { sessionId: String(agent.session.id), repoPath }
}

/** Register the Session-oriented maintenance tool. */
export function registerWsTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'ws',
    description: 'Inspect or promote the current Worktree Session binding; explicit paths remain available for operator recovery and diagnostics. Clean always applies the existing active/dirty/merge safety gates.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'promote', 'clean'] as const, description: 'Maintenance action.' },
      path: { type: 'string', description: 'Optional absolute operator recovery/debug worktree path. Omit to resolve the calling source Session binding.' },
      dry_run: { type: 'boolean', description: 'For clean, preview the safety-proven actions without removing resources.' },
    },
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
      const target = targetFor(args, exec)
      const result = args.action === 'status'
        ? await wsStatus(target)
        : args.action === 'promote'
          ? await wsPromote(target)
          : await wsClean(target, {
              dryRun: args.dry_run ?? false,
              activePaths: ctx.sessions.list().flatMap(session => session.header.cwd === undefined ? [] : [session.header.cwd]),
              requireActivePaths: true,
              activeBoundSessionIds: ctx.agents.list().map(agent => String(agent.session.id)),
            })
      return { json: JSON.stringify(result, null, 2) }
    },
  }))
}
