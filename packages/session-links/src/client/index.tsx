/**
 * Client entry for dsh-session-links: registers the「文档/资料」tab in
 * the dsh-better-sidebar workbench (links + produced files of the session).
 *
 * The plugin is gated on the `betterSidebar` service (hard peer dependency):
 * with dsh-better-sidebar absent or disabled, this fiber stays inactive and
 * nothing renders. Everything observed lives in the browser; there is no
 * host capability and no network egress.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { BetterSidebarService } from './better-sidebar.js'
import { SessionLinksStore } from './collector.js'
import { Panel } from './Panel.jsx'
import { openProducedInEditor } from './open-produced.js'

export const name = 'session-links'

/** Services required before mounting: the workbench host and the sessions runtime. */
export const inject = ['betterSidebar', 'sessions', 'connection']

/** A small inline chain-link glyph; no icon library is pulled in. */
function LinkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.9 9.1 9.1 6.9M5.6 10.4l-1.2 1.2a2.2 2.2 0 0 1-3.1-3.1l2.4-2.4a2.2 2.2 0 0 1 3.1 0M10.4 5.6l1.2-1.2a2.2 2.2 0 0 1 3.1 3.1l-2.4 2.4a2.2 2.2 0 0 1-3.1 0"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function apply(ctx: ClientContext & { betterSidebar: BetterSidebarService }): void {
  const store = new SessionLinksStore()
  ctx.effect(() => () => store.dispose())

  const disposeTab = ctx.betterSidebar.registerTab({
    id: 'session-links',
    title: () => '文档/资料',
    icon: (size: number) => <LinkIcon size={size} />,
    order: 45,
    single: true,
    component: ({ ctx: tabCtx, scope }) => (
      <Panel
        ctx={tabCtx}
        store={store}
        sessionId={(scope.sessionId || undefined) as SessionId | undefined}
        onOpenFile={(path) => openProducedInEditor(tabCtx, scope.sessionId as SessionId, path)}
      />
    ),
  })
  ctx.effect(() => disposeTab)
}

export { SessionLinksStore } from './collector.js'
export { Panel } from './Panel.jsx'