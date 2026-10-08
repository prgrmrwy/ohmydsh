/**
 * The Session shown in the main conversation view.
 *
 * DSH 0.1.5 published it as `SessionListState.current`. DSH 0.2.0 removed that
 * field (upstream 6830e1460d, "session-controller: own Client Session
 * generations"): the main view now holds a `mainView` retain reference on the
 * Session it shows, and releases the previous one when navigation moves on, so
 * at most one Session has `retainedBy.mainView > 0`. Official `ui-session`
 * resolves its main binding the same way (`publishMain`).
 *
 * Both shapes are read so this package works on either runtime.
 */
export interface MainSessionListSnapshot {
  readonly current?: unknown
  readonly byId?: Readonly<Record<string, { readonly id?: unknown; readonly retainedBy?: Readonly<Record<string, number | undefined>> } | undefined>>
}

export function mainSessionId(snapshot: MainSessionListSnapshot | undefined): string | undefined {
  if (snapshot === undefined) return undefined
  if (typeof snapshot.current === 'string') return snapshot.current
  for (const [id, row] of Object.entries(snapshot.byId ?? {})) {
    if ((row?.retainedBy?.mainView ?? 0) > 0) return id
  }
  return undefined
}
