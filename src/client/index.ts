import type { Context } from '@deepseek-ai/cordis'

/** Stable contracts owned by the two independent endpoint plugins. */
export const COCKPIT_EDITOR_OPEN_SERVICE = 'cockpitBridge.editorOpen'
export const WORKTREE_OPEN_HANDLER_SERVICE = 'worktreeSession.openHandler'

interface CockpitEditorOpenService {
  open(path: string): void
}

interface WorktreeOpenHandlerRegistry {
  register(handler: (absolutePath: string) => void): () => void
}

type ServiceContext = Context & {
  get(name: string): unknown
}

/**
 * Deployment-specific coupling point. Endpoint plugins never import each
 * other; this adapter observes their public services and connects them when
 * both are live. No top-level inject is allowed because either side is
 * optional and unresolved injects make a client plugin silently not load.
 */
export const inject: string[] = []

export function apply(ctx: ServiceContext): void {
  let unregister: (() => void) | undefined
  let boundRegistry: WorktreeOpenHandlerRegistry | undefined
  let boundEditor: CockpitEditorOpenService | undefined

  const readRegistry = (): WorktreeOpenHandlerRegistry | undefined =>
    ctx.get(WORKTREE_OPEN_HANDLER_SERVICE) as WorktreeOpenHandlerRegistry | undefined

  const readEditor = (): CockpitEditorOpenService | undefined =>
    // Keep the full dotted name in one ctx.get(). Reading the parent service
    // first and then a child property is not equivalent: Cordis reroutes dotted
    // properties through its context proxy and enforces inject, turning this
    // optional seam into an uncaught "without inject" rejection.
    ctx.get(COCKPIT_EDITOR_OPEN_SERVICE) as CockpitEditorOpenService | undefined

  const detach = (): void => {
    unregister?.()
    unregister = undefined
    boundRegistry = undefined
    boundEditor = undefined
  }

  const reconcile = (): void => {
    const registry = readRegistry()
    const editor = readEditor()
    if (registry === boundRegistry && editor === boundEditor) return
    detach()
    if (registry === undefined || editor === undefined) return

    boundRegistry = registry
    boundEditor = editor
    unregister = registry.register((path) => {
      // Resolve on every click: if the bridge fiber unloads after registration,
      // this throws and Worktree Session catches it to run its local fallback.
      const current = readEditor()
      if (current === undefined) throw new Error('cockpit editor-open service unavailable')
      current.open(path)
    })
  }

  const stopListening = ctx.on('internal/service', (name) => {
    if (name === WORKTREE_OPEN_HANDLER_SERVICE || name === COCKPIT_EDITOR_OPEN_SERVICE) reconcile()
  }, { global: true })

  reconcile()
  ctx.effect(() => () => {
    stopListening()
    detach()
  }, 'cockpit-worktree-open-shim: bridge service adapter')
}
