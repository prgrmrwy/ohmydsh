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
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProviderProjection, ProviderProjectionState } from './types.ts'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'

/** Wire schema for the `provider` projection value (non-null route identity). */
export const providerSchema = z.object({
  provider: z.string(),
  model: z.string(),
}).strict().nullable()

/**
 * Validates persisted fold state before it seeds a fold. Distinct from
 * {@link providerSchema}: the state keeps nullable fields so an empty log has a
 * well-formed state, while the wire value collapses the empty case to `null`.
 */
export const providerStateSchema = z.object({
  provider: z.string().nullable(),
  model: z.string().nullable(),
}).strict()

export const providerProjectionInitialState: ProviderProjectionState = {
  provider: null,
  model: null,
}

/**
 * Pure transition: only `request/header` events update the route; everything
 * else returns the same reference (zero downstream work).
 * @param state - previous fold state.
 * @param event - the next committed session event.
 * @returns the next state (same reference when the event is not a request header).
 */
export function applyProviderEvent(state: ProviderProjectionState, event: SessionEvent): ProviderProjectionState {
  if (event.type !== 'request/header') return state
  const config = event.data.header.config
  return {
    provider: config.provider,
    model: config.model,
  }
}

/** State → wire value: `null` before any request records a route. */
export function viewProviderProjection(state: ProviderProjectionState): SessionProjectionMap['provider'] {
  return state.provider === null || state.model === null
    ? null
    : { provider: state.provider, model: state.model }
}

/** The `provider` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const providerProjectionDefinition = {
  key: 'provider',
  stateSchema: providerStateSchema,
  init: () => providerProjectionInitialState,
  apply: applyProviderEvent,
  wire: {
    viewSchema: providerSchema,
    view: viewProviderProjection,
  },
  stateVersion: 1,
} as const satisfies {
  key: keyof SessionProjectionMap
  stateSchema: import('zod').ZodType<ProviderProjectionState>
  init(): ProviderProjectionState
  apply(state: ProviderProjectionState, event: SessionEvent): ProviderProjectionState
  wire: {
    viewSchema: import('zod').ZodType<SessionProjectionMap['provider']>
    view(state: ProviderProjectionState): SessionProjectionMap['provider']
  }
  stateVersion: number
}

export type { ProviderProjection, ProviderProjectionState }
