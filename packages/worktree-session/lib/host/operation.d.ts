import type { BindSourceResult, OperationRecord, PreparedOperationResult, SessionStatusResult, StartOperationRequest } from '../wire.js';
import { type GitClient } from './git.js';
import { type ProcessRunner } from './process.js';
export interface OperationDeps {
    git?: GitClient;
    runner?: ProcessRunner;
    now?: () => Date;
}
export declare function operationFile(gitCommonDir: string, operationId: string): string;
export declare function loadOperation(gitCommonDir: string, operationId: string): Promise<OperationRecord | undefined>;
export declare function saveOperation(operation: OperationRecord, now?: Date): Promise<OperationRecord>;
export declare function startOperation(request: StartOperationRequest, deps?: OperationDeps): Promise<PreparedOperationResult>;
export declare function createOperationId(): string;
/** Resolve the operation whose source-session binding owns the given Session id. */
export declare function findBySourceSession(gitCommonDir: string, sourceSessionId: string): Promise<OperationRecord | undefined>;
export declare function bindSource(request: {
    operationId: string;
    repoPath: string;
    sourceSessionId: string;
}): Promise<BindSourceResult>;
export declare function updateSourceBinding(request: {
    operationId: string;
    repoPath: string;
    sourceSessionId: string;
    action: 'bind-source' | 'claim-submit' | 'admitted' | 'uncertain' | 'cleaned';
}): Promise<BindSourceResult>;
export declare function sessionStatus(repoPath: string, sourceSessionId: string): Promise<SessionStatusResult>;
