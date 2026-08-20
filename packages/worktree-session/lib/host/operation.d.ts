import type { HandoffRequest, HandoffResult, OperationRecord, PreparedOperationResult, StartOperationRequest } from '../wire.js';
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
export declare function updateHandoff(request: HandoffRequest): Promise<HandoffResult>;
export declare function createOperationId(): string;
