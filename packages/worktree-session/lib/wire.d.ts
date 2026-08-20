/** Shared Worktree Session wire contract. This module has no runtime imports. */
export declare const ROUTES: {
    readonly repoStatus: "/worktree-session/api/repo-status";
    readonly start: "/worktree-session/api/start";
    readonly operationStatus: "/worktree-session/api/operation-status";
    readonly promote: "/worktree-session/api/promote";
    readonly clean: "/worktree-session/api/clean";
    readonly handoff: "/worktree-session/api/handoff";
};
export type OperationPhase = 'allocated' | 'branch-created' | 'worktree-created' | 'dependencies-ready' | 'environment-ready' | 'prepared' | 'cleaned';
export type ActiveOperationPhase = Exclude<OperationPhase, 'prepared' | 'cleaned'>;
export type DependencyMode = 'lean' | 'mutable';
export type RefKind = 'local' | 'remote';
export interface RefEntry {
    name: string;
    fullName: string;
    kind: RefKind;
    commit: string;
}
export interface WorktreeEntry {
    path: string;
    head: string;
    branch?: string;
    bare: boolean;
    detached: boolean;
    prunable: boolean;
}
export interface OperationRecord {
    schemaVersion: 1;
    operationId: string;
    repoRoot: string;
    gitCommonDir: string;
    baseRef: string;
    baseCommit: string;
    taskBranch: string;
    worktreePath: string;
    taskHash: string;
    dependencyMode: DependencyMode;
    lockFingerprint?: string;
    cacheNodeModules?: string;
    dshHome: string;
    phase: OperationPhase;
    createdAt: string;
    updatedAt: string;
    diagnostics?: readonly string[];
    handoff?: {
        state: 'target-bound' | 'submit-claimed' | 'admitted' | 'uncertain';
        targetSessionId: string;
        updatedAt: string;
    };
}
export interface RepoStatusRequest {
    repoPath: string;
}
export interface RepoStatusResult {
    repo: true;
    repoRoot: string;
    gitCommonDir: string;
    currentBranch?: string;
    currentCommit: string;
    refs: readonly RefEntry[];
    worktrees: readonly WorktreeEntry[];
}
export interface StartOperationRequest {
    operationId: string;
    repoPath: string;
    baseRef: string;
    taskText: string;
    dependencyMode: 'lean';
}
export interface PreparedOperationResult {
    operationId: string;
    phase: 'prepared';
    worktreePath: string;
    taskBranch: string;
    baseCommit: string;
    dependencyMode: DependencyMode;
    lockFingerprint: string;
    dshHome: string;
}
export interface OperationStatusRequest {
    operationId: string;
    repoPath: string;
}
export interface MaintenanceRequest {
    path: string;
}
export interface HandoffRequest {
    operationId: string;
    repoPath: string;
    action: 'bind-target' | 'claim-submit' | 'admitted' | 'uncertain';
    targetSessionId: string;
}
export interface HandoffResult {
    state: 'target-bound' | 'submit-claimed' | 'admitted' | 'uncertain';
    targetSessionId: string;
    submitAllowed: boolean;
}
export interface CleanRequest extends MaintenanceRequest {
    dryRun: boolean;
    activePaths?: readonly string[];
}
export interface StatusResult {
    operationId: string;
    phase: OperationPhase;
    repoRoot: string;
    baseRef: string;
    baseCommit: string;
    taskBranch: string;
    worktreePath: string;
    dependencyMode: DependencyMode;
    lockFingerprint?: string;
    dshHome: string;
}
export interface PromoteResult extends StatusResult {
    dependencyMode: 'mutable';
}
export interface CleanResult {
    dryRun: boolean;
    operationId: string;
    worktreePath: string;
    taskBranch: string;
    actions: readonly string[];
    cleaned: boolean;
}
export type WsErrorCode = 'INVALID_REQUEST' | 'UNTRUSTED_REQUEST' | 'METHOD_NOT_ALLOWED' | 'BODY_TOO_LARGE' | 'NOT_A_REPOSITORY' | 'OUTSIDE_REPOSITORY' | 'GIT_FAILED' | 'GIT_TIMEOUT' | 'OPERATION_CONFLICT' | 'OPERATION_NOT_FOUND' | 'OPERATION_INVALID' | 'DEPENDENCY_FAILED' | 'ENVIRONMENT_FAILED' | 'PROMOTE_REFUSED' | 'CLEAN_REFUSED' | 'INTERNAL_ERROR';
export interface WsWireError {
    code: WsErrorCode;
    message: string;
    phase?: OperationPhase;
    retryable: boolean;
    details?: Record<string, string | number | boolean>;
}
export type WireEnvelope<T> = {
    ok: true;
    data: T;
} | {
    ok: false;
    error: WsWireError;
};
