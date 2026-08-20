/** Shared Worktree Session wire contract. This module has no runtime imports. */
export const ROUTES = {
    repoStatus: '/worktree-session/api/repo-status',
    start: '/worktree-session/api/start',
    operationStatus: '/worktree-session/api/operation-status',
    promote: '/worktree-session/api/promote',
    clean: '/worktree-session/api/clean',
    bindSource: '/worktree-session/api/bind-source',
    sessionStatus: '/worktree-session/api/session-status',
    status: '/worktree-session/api/status',
};
/** The persisted binding of a schema-v2 operation, if established. */
export function bindingOf(operation) {
    return operation.binding;
}
