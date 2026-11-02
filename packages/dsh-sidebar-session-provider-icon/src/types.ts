/** Pure types of the sidebar-provider-icon domain: the ONE home of the
 * `provider` projection-key declaration, free of this package's host-side
 * value imports (cordis context, zod, session events). Host and client both
 * import it; client aggregates pick it up through the same merge.
 *
 * @module dsh-sidebar-session-provider-icon/types
 */
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Plain-JSON fold state persisted by the `provider` projection unit. */
export interface ProviderProjectionState {
    /** Provider id of the last recorded route; `null` before the first request. */
    provider: string | null;
    /** Model id of the last recorded route; `null` before the first request. */
    model: string | null;
}

/** Latest-request route identity published by the `provider` projection unit. */
export interface ProviderProjection {
    /** Provider id of the session's last actual assistant request. */
    provider: string;
    /** Model id of the session's last actual assistant request. */
    model: string;
}

declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /**
         * Provider/model of the session's last actual assistant request,
         * folded last-wins from `request/header` events; `null` before the
         * first request records a route. The sidebar badge renders only when
         * this resolves to a non-null value.
         */
        provider: ProviderProjection | null;
    }

    interface SessionProjectionStateMap {
        /**
         * Fold state behind the `provider` key. Kept separate from the wire
         * value: the state carries nullable fields so an empty log still has a
         * well-formed state, while the wire value collapses to `null`.
         */
        provider: ProviderProjectionState;
    }
}
