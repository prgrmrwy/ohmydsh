import type { NodeId } from '../../core/index.js'

/**
 * The workspace row-menu seam third-party plugins already target.
 *
 * rc.2 itself declares only `sidebar.workspaces` and
 * `sidebar.workspaces.directoryFlow`; `dsh-open-in-vscode` registers into
 * `sidebar.workspaces.row-menu` when that spec exists and otherwise falls back
 * to DOM injection into the open menu. Federation declares the hole so the
 * plugin takes its supported path instead of scraping the DOM.
 */
export const WORKSPACE_ROW_MENU_SLOT = 'sidebar.workspaces.row-menu' as const

/** Owner share handed to each occupant row, matching the plugin's props. */
export interface WorkspaceRowMenuOwnerProps {
  /** Host path of the workspace whose menu is open; absent hides the row. */
  readonly cwd: string | undefined
  /** Workspace display title used in the row's accessible label. */
  readonly label: string
  /** Closes the owning menu after the occupant acts. */
  readonly onClose: () => void
}

export interface RowMenuOwnerContext {
  readonly nodeId: NodeId
  readonly localNodeId: NodeId
  readonly workspaceTitle: string
  /** Node-owned absolute path; never rewritten or mapped centrally. */
  readonly workspacePath: string
  readonly closeMenu: () => void
}

/**
 * Builds the owner share for one node's workspace row menu.
 *
 * A remote workspace path is meaningless to a central-machine editor, so a
 * remote node passes `cwd: undefined`: occupants that open local paths render
 * nothing, while the official rename/delete rows stay untouched. Only This Mac
 * hands out a real path.
 */
export function workspaceRowMenuOwnerProps(context: RowMenuOwnerContext): WorkspaceRowMenuOwnerProps {
  const isLocal = context.nodeId === context.localNodeId
  return Object.freeze({
    cwd: isLocal ? context.workspacePath : undefined,
    label: context.workspaceTitle,
    onClose: context.closeMenu,
  })
}

export interface RowMenuEntry {
  readonly registrant: string
  readonly render: (owner: WorkspaceRowMenuOwnerProps) => unknown
}

export interface RowMenuRenderOutcome {
  readonly rendered: readonly { readonly registrant: string; readonly node: unknown }[]
  readonly failed: readonly { readonly registrant: string; readonly error: unknown }[]
}

/**
 * Renders third-party row entries after the official ones, in registration
 * order. One occupant throwing is isolated: it is reported and skipped, and
 * every other entry — official rows included — still renders.
 */
export function renderRowMenuEntries(entries: readonly RowMenuEntry[], owner: WorkspaceRowMenuOwnerProps): RowMenuRenderOutcome {
  const rendered: { registrant: string; node: unknown }[] = []
  const failed: { registrant: string; error: unknown }[] = []
  for (const entry of entries) {
    try {
      rendered.push({ registrant: entry.registrant, node: entry.render(owner) })
    } catch (error) {
      failed.push({ registrant: entry.registrant, error })
    }
  }
  return Object.freeze({ rendered: Object.freeze(rendered), failed: Object.freeze(failed) })
}
