import type { OperationRecord } from '../wire.js';
export interface RecoveredBinding {
    operation: OperationRecord;
    valid: boolean;
    diagnostic?: string;
}
/** Synchronously recover one Session binding so session-start can install policy before first assembly. */
export declare function recoverBindingSync(repoPath: string | undefined, sourceSessionId: string): RecoveredBinding | undefined;
