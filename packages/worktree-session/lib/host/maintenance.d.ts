import type { CleanResult, OperationRecord, PromoteResult, StatusResult } from '../wire.js';
import { type GitClient } from './git.js';
import { type ProcessRunner } from './process.js';
export declare function resolveOperation(path: string, git?: GitClient): Promise<OperationRecord>;
export interface MaintenanceTarget {
    path?: string;
    sessionId?: string;
    repoPath?: string;
}
export declare function resolveMaintenanceTarget(target: string | MaintenanceTarget, git?: GitClient): Promise<OperationRecord>;
export declare function wsStatus(target: string | MaintenanceTarget, git?: GitClient): Promise<StatusResult>;
export declare function wsPromote(target: string | MaintenanceTarget, options?: {
    runner?: ProcessRunner;
    git?: GitClient;
}): Promise<PromoteResult>;
export declare function wsClean(targetInput: string | MaintenanceTarget, options?: {
    dryRun?: boolean;
    activePaths?: readonly string[];
    activeBoundSessionIds?: readonly string[];
    cwd?: string;
    git?: GitClient;
    requireActivePaths?: boolean;
}): Promise<CleanResult>;
