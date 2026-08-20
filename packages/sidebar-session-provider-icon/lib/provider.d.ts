/**
 * The `provider` projection unit: a pure fold over session events that keeps
 * the provider/model of the session's last actual assistant request.
 *
 * `request/header` is the route authority: the loop appends a full header
 * inside a step before dispatch, and only when the route/capacity changed
 * (canonical equality suppresses unchanged snapshots). Folding the latest
 * `request/header` therefore yields exactly the provider/model of the last
 * request the session actually sent. `assistant/message` does not carry the
 * provider, so this unit never reads it.
 *
 * @module dsh-sidebar-session-provider-icon/provider
 */
import { z } from 'zod';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProviderProjection } from './types.ts';
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types';
/** Wire schema for the `provider` projection value (non-null route identity). */
export declare const providerSchema: z.ZodNullable<z.ZodObject<{
    provider: z.ZodString;
    model: z.ZodString;
}, z.core.$strict>>;
/** Internal plain-JSON fold state. */
export interface ProviderProjectionState {
    provider: string | null;
    model: string | null;
}
export declare const providerProjectionInitialState: ProviderProjectionState;
/**
 * Pure transition: only `request/header` events update the route; everything
 * else returns the same reference (zero downstream work).
 * @param state - previous fold state.
 * @param event - the next committed session event.
 * @returns the next state (same reference when the event is not a request header).
 */
export declare function applyProviderEvent(state: ProviderProjectionState, event: SessionEvent): ProviderProjectionState;
/** State → wire value: `null` before any request records a route. */
export declare function viewProviderProjection(state: ProviderProjectionState): SessionProjectionMap['provider'];
/** The `provider` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export declare const providerProjectionDefinition: {
    readonly key: "provider";
    readonly schema: z.ZodNullable<z.ZodObject<{
        provider: z.ZodString;
        model: z.ZodString;
    }, z.core.$strict>>;
    readonly init: () => ProviderProjectionState;
    readonly apply: typeof applyProviderEvent;
    readonly view: typeof viewProviderProjection;
    readonly stateVersion: 1;
};
export type { ProviderProjection };
