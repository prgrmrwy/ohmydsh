import type { ProviderProjection } from '../types.ts'

/** Minimal selector-store shape used by the binding lifecycle. */
export interface SelectionStore {
  getSnapshot(): { current: ProviderProjection | null }
  subscribe(listener: () => void): () => void
}

export interface SelectionDirectory {
  store: SelectionStore
  load(): Promise<unknown>
}

/**
 * Bind one current session to its selector store. The caller records the
 * session id only after this function succeeds, so a transient resolver error
 * remains retryable on the next list/DOM signal.
 */
export function bindSelectionDirectory(
  sessionId: string,
  resolve: (id: string) => SelectionDirectory,
  selected: Map<string, ProviderProjection>,
  reconcile: () => void,
): () => void {
  const directory = resolve(sessionId) // may throw: caller must remain retryable
  const publish = (): void => {
    const current = directory.store.getSnapshot().current
    if (current === null) selected.delete(sessionId)
    else selected.set(sessionId, { provider: current.provider, model: current.model })
    reconcile()
  }
  const stop = directory.store.subscribe(publish)
  publish()
  if (directory.store.getSnapshot().current === null) directory.load().catch(() => undefined)
  return stop
}
