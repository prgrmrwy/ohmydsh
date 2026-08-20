import type { Agent } from '@deepseek-ai/dsh-agent';
import type { OperationRecord, SessionBinding } from '../wire.js';
/** Deterministic rules that accompany every active Worktree Session binding. */
export declare function activeBindingContext(operation: OperationRecord): string;
/** Deterministic terminal context for a cleaned historical binding. */
export declare function cleanedBindingContext(operation: OperationRecord): string;
/** Deterministic stable context for a bound Session, or undefined when not bound. */
export declare function boundContextText(operation: OperationRecord | undefined, binding: SessionBinding | undefined): string | undefined;
/**
 * Install the stable Worktree Session runtime context into an exact live Agent
 * scope. Idempotent per Agent: repeated installs dispose the previous named
 * context first, so restart-safe rescue cannot double-register. The disposer
 * is also released automatically when the Agent scope unwinds, so a removed
 * binding leaves no stale context behind.
 */
export declare function installContext(agent: Agent | undefined, operation: OperationRecord | undefined): void;
