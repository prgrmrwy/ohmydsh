import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { OperationRecord } from '../wire.js';
export declare function configureContinuableDelegationTools(names: readonly string[]): void;
/** Resolve the bound operation record for a live Agent, if any. */
export declare function findOperationForSession(agent: Agent | undefined): OperationRecord | undefined;
/**
 * Record the durable operation for a bound source Session and install the
 * stable runtime context + tool guard into the live Agent (if it exists yet).
 * Idempotent per Agent and safe to call on resume or after Host restart.
 */
export declare function rememberBind(ctx: Context, sourceSessionId: string, operation: OperationRecord | undefined, validationFailure?: string): void;
/** Re-install the recorded context/guard for a Session whose Agent just came live. */
export declare function refreshPolicy(ctx: Context, sourceSessionId: string): void;
/**
 * Compose the parent Worktree binding into every continuable subagent before its
 * publication/first step. The subagent runtime invokes this contribution for
 * fresh children and cold resumes. Missing or conflicting lineage throws during
 * unpublished setup, so the delegation is rolled back rather than starting in
 * the source checkout.
 */
export declare function installSubagentInheritance(childCtx: Context): () => void;
export declare function registerSubagentInheritance(ctx: Context): () => void;
/** Source Sessions currently protected by a live Agent or retained live Session. */
export declare function activeBoundSessionIds(ctx: Context): readonly string[];
