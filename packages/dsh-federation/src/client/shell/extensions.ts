import type { NodeCapability, NodeId } from '../../core/index.js'

export type ExtensionAction =
  | 'open-in-editor'
  | 'unarchive'
  | 'worktree-session'

export interface ExtensionContext {
  readonly nodeId: NodeId
  readonly localNodeId: NodeId
  /** Capabilities proven by this node's probe; never assumed from the central install. */
  readonly capabilities: ReadonlySet<NodeCapability>
}

/**
 * Decides whether one node may offer an extension action.
 *
 * Central-machine actions (opening a path in a local editor) stay This-Mac-only.
 * Remote extension actions appear only when this node's own probe proved the
 * matching protocol, because nodes are independent installs.
 */
export function offersExtensionAction(action: ExtensionAction, context: ExtensionContext): boolean {
  const isLocal = context.nodeId === context.localNodeId
  switch (action) {
    // Hands a path to the central desktop; a remote path would be wrong here.
    case 'open-in-editor':
      return isLocal
    case 'unarchive':
      return isLocal || context.capabilities.has('extension.unarchive')
    case 'worktree-session':
      return isLocal || context.capabilities.has('extension.worktree')
  }
}

/** Actions offered for one node, in stable display order. */
export function extensionActionsFor(context: ExtensionContext): readonly ExtensionAction[] {
  const all: readonly ExtensionAction[] = ['open-in-editor', 'unarchive', 'worktree-session']
  return Object.freeze(all.filter(action => offersExtensionAction(action, context)))
}
