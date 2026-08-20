import { createRoutes } from './host/http.js';
import { activeBoundSessionIds as boundSessionIds, configureContinuableDelegationTools, registerSubagentInheritance, rememberBind } from './host/policy.js';
import { WsError } from './host/errors.js';
import { recoverBindingSync } from './host/recovery.js';
import { registerWsTool } from './host/tool.js';
export const name = 'worktree-session';
export const inject = ['webServer', 'sessions', 'agents', 'tools', 'systemPrompt', 'subagents'];
export function apply(ctx, config = {}) {
    configureContinuableDelegationTools(config.continuableDelegationTools ?? []);
    const activeSessionPaths = () => ctx.sessions.list().flatMap(session => session.header.cwd === undefined ? [] : [session.header.cwd]);
    // Record bound operations and install their stable Agent context. Idempotent
    // per Agent; safe on first bind and on resume after Host restart.
    const recordBind = (sourceSessionId, operation) => {
        rememberBind(ctx, sourceSessionId, operation);
    };
    const bindLiveSource = (sourceSessionId, operation, options) => {
        const session = ctx.sessions.get(sourceSessionId);
        if (session === undefined)
            throw new WsError('OPERATION_CONFLICT', `Source Session ${sourceSessionId} is not live`);
        if (session.header.cwd !== operation.repoRoot)
            throw new WsError('OPERATION_CONFLICT', `Source Session cwd ${session.header.cwd ?? '(none)'} does not equal repository ${operation.repoRoot}`);
        if (options.requireBlank && session.events.some(event => event.type === 'turn/start'))
            throw new WsError('OPERATION_CONFLICT', 'Source Session is no longer blank');
        const agent = ctx.agents.get(sourceSessionId);
        if (agent === undefined)
            throw new WsError('OPERATION_CONFLICT', `Source Agent ${sourceSessionId} is not live`);
        rememberBind(ctx, sourceSessionId, operation);
    };
    const recoverAgent = (agent) => {
        if (agent === undefined)
            return;
        const recovered = recoverBindingSync(agent.session.header.cwd, agent.session.id);
        if (recovered !== undefined)
            rememberBind(ctx, agent.session.id, recovered.operation, recovered.valid ? undefined : recovered.diagnostic);
    };
    // session-start is synchronously emitted before the first driver step; install
    // restored policy before the event returns. Also rescue Agents already live if
    // this plugin hot-loads after their publication.
    ctx.on('agent/session-start', ({ agent }) => { recoverAgent(agent); });
    for (const agent of ctx.agents.list())
        recoverAgent(agent);
    registerSubagentInheritance(ctx);
    ctx.effect(() => registerWsTool(ctx), 'worktree-session: register Session-oriented ws tool');
    for (const route of createRoutes({ activeSessionPaths, activeBoundSessionIds: () => boundSessionIds(ctx), recordBind, bindLiveSource })) {
        ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }), `worktree-session: ${route.path}`);
    }
}
export * from './wire.js';
export { startOperation, loadOperation } from './host/operation.js';
export { wsStatus, wsPromote, wsClean } from './host/maintenance.js';
