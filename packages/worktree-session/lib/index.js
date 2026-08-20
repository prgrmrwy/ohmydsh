import { createRoutes } from './host/http.js';
export const name = 'worktree-session';
export const inject = ['webServer', 'sessions'];
export function apply(ctx) {
    const activeSessionPaths = () => ctx.sessions.list().flatMap(session => session.header.cwd === undefined ? [] : [session.header.cwd]);
    for (const route of createRoutes({ activeSessionPaths })) {
        ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }), `worktree-session: ${route.path}`);
    }
}
export * from './wire.js';
export { startOperation, loadOperation } from './host/operation.js';
export { wsStatus, wsPromote, wsClean } from './host/maintenance.js';
