import type { CleanResult, OperationRecord, PromoteResult, StatusResult } from '../wire.js';
import { type GitClient } from './git.js';
import { type ProcessRunner } from './process.js';
export declare function resolveOperation(path: string, git?: GitClient): Promise<OperationRecord>;
export declare function wsStatus(path: string, git?: GitClient): Promise<StatusResult>;
export declare function wsPromote(path: string, options?: {
    runner?: ProcessRunner;
    git?: GitClient;
}): Promise<PromoteResult>;
export declare function wsClean(path: string, options?: {
    dryRun?: boolean;
    activePaths?: readonly string[];
    cwd?: string;
    git?: GitClient;
    requireActivePaths?: boolean;
}): Promise<CleanResult>;
