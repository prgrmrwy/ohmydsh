/** Stable Worktree Session extension-point name. */
export const WORKTREE_OPEN_HANDLER_SERVICE = 'worktreeSession.openHandler' as const

export type WorktreeOpenHandler = (absolutePath: string) => void

export interface WorktreeOpenHandlerRegistry {
  /**
   * Register one replacement opener. Registrations form a stack so a later
   * adapter temporarily wins; disposing it restores the previous behavior.
   */
  register(handler: WorktreeOpenHandler): () => void
  /** Invoke the current replacement, or the package's local default. */
  open(absolutePath: string): void
}

/**
 * Runtime registry owned by Worktree Session. It deliberately knows nothing
 * about possible adapters. A failing replacement is removed from the current
 * call path and the default opener runs instead.
 */
export function createWorktreeOpenHandlerRegistry(fallback: WorktreeOpenHandler): WorktreeOpenHandlerRegistry {
  const handlers: WorktreeOpenHandler[] = []
  return {
    register(handler) {
      handlers.push(handler)
      let active = true
      return () => {
        if (!active) return
        active = false
        const index = handlers.lastIndexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
      }
    },
    open(absolutePath) {
      const handler = handlers.at(-1)
      if (handler === undefined) {
        fallback(absolutePath)
        return
      }
      try {
        handler(absolutePath)
      } catch {
        fallback(absolutePath)
      }
    },
  }
}
