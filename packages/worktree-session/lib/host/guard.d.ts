import type { Agent } from '@deepseek-ai/dsh-agent';
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools';
import type { OperationRecord } from '../wire.js';
/** Exact audited argument contracts for the pinned DSH tool surface. */
export interface ToolContract {
    kind: 'bash' | 'paths' | 'search' | 'delegation' | 'maintenance' | 'non-local';
    pathFields: readonly string[];
    requiredAbsolute: boolean;
}
/**
 * Installed rc.7 contracts. This table is deliberately exported for inventory
 * tests and upgrade review: a schema/name change must fail tests before release.
 */
export declare const TOOL_CONTRACTS: Readonly<Record<string, ToolContract>>;
/**
 * Pure synchronous fail-closed check for a bound Worktree Session. Returns a
 * denial reason, or undefined to let the call continue to existing policy.
 */
export declare function checkTool({ name, args }: {
    name: string;
    args: unknown;
}, operation: OperationRecord, validationFailure?: string, continuableDelegationTools?: readonly string[]): string | undefined;
/** Physical canonical gate for symlinked ancestors and non-existent outputs. */
export declare function physicalDecision(exec: Pick<ToolExecution, 'name' | 'arguments'>, operation: OperationRecord): Promise<PreToolDecision>;
/** Install synchronous contract guard plus asynchronous physical containment. */
export declare function installGuard(agent: Agent, operation: OperationRecord, validationFailure?: string, continuableDelegationTools?: readonly string[]): () => void;
export { confinePath, firstPathOf } from './containment.js';
