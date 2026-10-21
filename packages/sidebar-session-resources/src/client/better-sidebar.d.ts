/**
 * Minimal local type mirror of the dsh-better-sidebar service face.
 *
 * dsh-better-sidebar is NOT a devDependency of this package: its peer chain
 * (^0.1.0-rc.8 era) conflicts with this repo's 0.1.1-rc.2 runtime peer chain
 * under npm strict-peer resolution. The runtime contract is served by the
 * profile installation (peerDependencies ^0.16.0); these types mirror the
 * subset consumed here, transcribed from the installed 0.16.0 sources
 * (dsh-better-sidebar/src/client/service.ts). Re-verify on plugin upgrades —
 * the changelog/README regression checklist covers the registerTab face.
 *
 * A plain module (NOT `declare module 'dsh-better-sidebar/...'`): TypeScript
 * treats a slash-named module with no resolvable physical module as an
 * invalid augmentation (TS2664), so the mirror lives here and consumers
 * import it directly. When a real devDependency becomes installable, switch
 * the import specifiers back to 'dsh-better-sidebar/client/service' and
 * delete this file.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'

/** Session scope handed to tab components and badge callbacks (0.16.0). */
export interface SessionScope {
  sessionId: string
  /** The session's working directory from the client list summary (optional). */
  cwd?: string
  /** Selected Git repository when cwd is a workspace container. */
  repoRoot?: string
}

/** The sidebar tab state snapshot passed to badge callbacks. */
export interface SidebarState {
  // Consumed fields only; the real snapshot carries panel geometry, open
  // tabs and expansions. Kept opaque on purpose.
  [key: string]: unknown
}

/** Props every registered tab component receives (0.16.0). */
export interface TabComponentProps {
  ctx: Context
  scope: SessionScope
  tab: unknown
  /** Whether this tab is the active one AND the panel is open. */
  visible: boolean
  /** Open a file in the workbench's editor host (the explorer's "Show in folder" seam). */
  onOpenFile?: (path: string) => void
}

/** One workbench tab type (0.16.0; consumed subset). */
export interface TabDescriptor {
  /** Unique id; also the `SidebarTab.type` value. */
  id: string
  title: string | (() => string)
  icon?: ReactNode | ((size: number) => ReactNode)
  /** + menu sort order (ascending); default 100. */
  order?: number
  /** Single-instance sugar: opening focuses an existing tab of the same type. */
  single?: boolean
  /** Tab badge: a count (99+ capped) or a short text pill; throws are swallowed by the host. */
  badge?: (ctx: Context, scope: SessionScope, state: SidebarState) => string | number | null | undefined
  component: (props: TabComponentProps) => ReactNode
}

/** One `openTab` request (0.16.0; consumed subset). */
export interface OpenTabSeed {
  /** Tab type id (`'editor'` for the built-in text editor). */
  type: string
  /** Overrides the descriptor's title (the editor tab shows the file name). */
  title?: string
  /** A file path (the editor tab's content seed). */
  path?: string
  /** Explicit tab id (defaults to the type); per-path dedupe rides the editor id. */
  id?: string
  /** A URL the tab navigates to on mount (the browser tab's seed). */
  url?: string
  /** JSON-serializable custom state carried on the minted tab. */
  meta?: unknown
}

/** The registry service published as `ctx.betterSidebar` (0.16.0; consumed subset). */
export interface BetterSidebarService {
  registerTab(descriptor: TabDescriptor): () => void
  /** Open a tab through the host (the editor descriptor's per-path dedupe applies). */
  openTab(seed: OpenTabSeed): void
  /** Monotonic capability list (gates newer APIs; unused here). */
  readonly features: readonly string[]
  readonly version: string
}

/**
 * Local context face: the cordis context plus the betterSidebar service.
 * Used instead of a global Context augmentation (shadowing breaks merge).
 */
export type BetterSidebarAware<T> = T & {
  betterSidebar: BetterSidebarService
}