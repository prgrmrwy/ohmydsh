import { bindingOf } from '../wire.js';
import { installContext } from './context.js';
import { installGuard } from './guard.js';
/** Live source Session id → bound operation, seeded by the Host routes. */
const survey = new Map();
const guards = new WeakMap();
let continuableDelegationTools = [];
export function configureContinuableDelegationTools(names) {
    continuableDelegationTools = [...new Set(names)];
}
/** Resolve the bound operation record for a live Agent, if any. */
export function findOperationForSession(agent) {
    if (agent === undefined)
        return undefined;
    return survey.get(agent.session.id);
}
function refreshAgent(agent, operation, validationFailure) {
    if (agent === undefined || operation === undefined)
        return;
    const binding = bindingOf(operation);
    // Stable runtime context for bound (active or cleaned) Sessions.
    installContext(agent, operation);
    const previous = guards.get(agent);
    if (previous !== undefined) {
        previous();
        guards.delete(agent);
    }
    // Every source binding keeps a guard. A cleaned binding reaches checkTool's
    // terminal deny-all branch; it must never fall back to the source checkout.
    if (binding?.mode === 'source-session')
        guards.set(agent, installGuard(agent, operation, validationFailure, continuableDelegationTools));
}
/**
 * Record the durable operation for a bound source Session and install the
 * stable runtime context + tool guard into the live Agent (if it exists yet).
 * Idempotent per Agent and safe to call on resume or after Host restart.
 */
export function rememberBind(ctx, sourceSessionId, operation, validationFailure) {
    if (operation === undefined) {
        survey.delete(sourceSessionId);
        return;
    }
    survey.set(sourceSessionId, operation);
    refreshAgent(ctx.agents.get(sourceSessionId), operation, validationFailure);
}
/** Re-install the recorded context/guard for a Session whose Agent just came live. */
export function refreshPolicy(ctx, sourceSessionId) {
    const operation = survey.get(sourceSessionId);
    refreshAgent(ctx.agents.get(sourceSessionId), operation);
}
/**
 * Compose the parent Worktree binding into every continuable subagent before its
 * publication/first step. The subagent runtime invokes this contribution for
 * fresh children and cold resumes. Missing or conflicting lineage throws during
 * unpublished setup, so the delegation is rolled back rather than starting in
 * the source checkout.
 */
export function installSubagentInheritance(childCtx) {
    const child = childCtx.agent;
    if (child === undefined)
        throw new Error('Worktree Session cannot install delegated policy without an unpublished child Agent');
    const parentId = child.session.header.parentSession;
    if (parentId === undefined)
        return () => { };
    const operation = survey.get(parentId);
    if (operation === undefined)
        return () => { };
    const binding = bindingOf(operation);
    if (binding?.mode !== 'source-session' || binding.sourceSessionId !== parentId)
        throw new Error(`Worktree Session cannot prove parent binding for delegated Agent ${child.id}`);
    refreshAgent(child, operation);
    return () => {
        const guard = guards.get(child);
        if (guard !== undefined) {
            guard();
            guards.delete(child);
        }
        installContext(child, undefined);
    };
}
export function registerSubagentInheritance(ctx) {
    return ctx.subagents.registerContinuableSetup(installSubagentInheritance);
}
/** Source Sessions currently protected by a live Agent or retained live Session. */
export function activeBoundSessionIds(ctx) {
    return [...survey.entries()].flatMap(([sessionId, operation]) => {
        const binding = bindingOf(operation);
        if (binding?.mode !== 'source-session' || binding.state === 'cleaned')
            return [];
        return ctx.agents.get(sessionId) !== undefined || ctx.sessions.get(sessionId) !== undefined ? [sessionId] : [];
    });
}
