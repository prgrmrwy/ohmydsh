/**
 * dsh-pet web client half.
 *
 * Registers one additive `shell.overlay` entry (the floating Pet) and one
 * Pet settings section. Both are additive: a fresh id is added beside the
 * shipped entries rather than replacing them, and the overlay layer stays
 * click-through except on Pet's own surface.
 *
 * This bundle holds no host, filesystem or credential capability of its own —
 * every operation is a same-origin call the Host independently validates.
 *
 * @module dsh-pet/client
 */

import { createElement, useCallback, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only merge: pulls the `shell.overlay` SlotMap declaration into this
// program so the registration is compile-time checked.
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: ctx.slots (0.1.2: dsh-client-ui-renderer), ctx.sessions
// (dsh-api-session-controller) and ctx.workspaces (dsh-api-workspace-controller).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { PetOverlay, type SourceSelection } from './overlay.js'
import {
  PetSettingsSection,
  setDirectoryPicker,
  setDirectoryLister,
} from './settings.js'
import {
  PET_SETTINGS_NAV_CSS,
  registerPetSettingsNavIcon,
} from './settings-nav-icon.js'
import { PET_CSS } from './styles.js'

/**
 * Required services.
 *
 * `slots` alone is NOT enough. The loader resolves a client entry's deps to
 * module ids, and `@deepseek-ai/dsh-client-ui-slots` ships no client bundle of
 * its own (its URL 404s), so an entry depending on it alone waits forever and
 * its `apply` never runs — the styles get injected but no surface is ever
 * mounted. Naming the services Pet actually reads (`sessions`, `workspaces`)
 * pulls in packages that DO ship bundles and provide the slot registry, which
 * is how the shipped sidebar plugin resolves the same dependency. It also
 * fixes an undeclared-access bug: `readCurrentSource` reads both services.
 */
export const inject = ['slots', 'sessions', 'workspaces', 'connection']

/**
 * Marks Pet's own mount node under `document.body`.
 *
 * A stable attribute rather than a generated id, so a reload can find and
 * reuse the existing host instead of leaving a second Pet behind.
 */
export const PET_HOST_ATTRIBUTE = 'data-dsh-pet-host'

/**
 * Mount the Pet overlay and settings section.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  boundContext = ctx
  ctx.effect(() => () => {
    boundContext = undefined
    // Drop the memoized projection too: a stale one would be handed to the
    // next mount as if it were current.
    sourceCache = undefined
  }, 'dsh-pet: release bound client context')

  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-pet')
    style.textContent = `${PET_CSS}\n${PET_SETTINGS_NAV_CSS}`
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-pet: styles')

  // Pet mounts on its OWN React root under `document.body`, not into the
  // `shell.overlay` slot.
  //
  // The slot layer is `position:absolute; inset:0` inside the AppFrame, which
  // lives inside `#root`. A "layout push" plugin — `dsh-better-sidebar` is the
  // one in use here — squeezes `#root` itself:
  //
  //     #root { margin-right: var(--dsh-sidebar-width);
  //             width: calc(100% - var(--dsh-sidebar-width)); }
  //
  // Every descendant containing block narrows with it, so an absolutely
  // positioned Pet gets pushed and clipped when that panel opens. This is a
  // CONTAINING BLOCK problem, not a stacking one: no `z-index` can fix it.
  //
  // Escaping via `createPortal` was tried before and failed badly (see the
  // note in `overlay.tsx`): React delegates events at the mount container, so
  // a node moved out of the host root still renders but silently receives no
  // hover, drag or click. A separate `createRoot` is different — it
  // establishes its own delegation container — and it is exactly what
  // `dsh-better-sidebar` itself does for its panel.
  ctx.effect(() => {
    // Reuse an existing host rather than stacking a second Pet: a client
    // bundle can be applied again by HMR or a plugin reload.
    const existing = document.querySelector(`[${PET_HOST_ATTRIBUTE}]`)
    const host = existing instanceof HTMLElement ? existing : document.createElement('div')
    if (existing === null) {
      host.setAttribute(PET_HOST_ATTRIBUTE, '')
      document.body.appendChild(host)
    }
    const root = createRoot(host)
    root.render(createElement(PetOverlaySurface))
    return () => {
      // Unmount before removing the node, so React tears down its listeners
      // instead of leaking them with an orphaned container.
      root.unmount()
      host.remove()
    }
  }, 'dsh-pet: floating surface on its own root')

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section' as const, id: 'dsh-pet', order: 320, label: PET_SECTION_LABEL },
      PetSettingsSection,
    ),
  )

  // Publish the Host directory picker to the settings page. Pet asks for a
  // Host path (the machine running `dsh web`), so a browser file input would
  // be wrong: it yields the USER's machine. `directoryPicker/pick` is served
  // only under the `native` capability, so a remote deployment simply gets
  // no picker and keeps typing the path.
  // Two-tier: the OS picker when this deployment serves `native`, otherwise
  // the in-app browser (`browse`). The native call FAILS on a browse-only
  // deployment — which is why the button appeared to do nothing — so its
  // rejection must fall through rather than surface as an error.
  //
  // 0.1.2 note: the old `connection.api.host.*` proxy face was removed with
  // dsh-host-apiproxy; the same Host verbs now live on the `remote` service's
  // typed `directoryPicker` namespace (RemoteResult envelope, no `result`
  // wrapper). Read lazily via `ctx.get` so a composition without the gateway
  // degrades to "unsupported" instead of failing to load.
  type RemoteDirectoryPicker = {
    pick?: (signal?: AbortSignal) => Promise<unknown>
    list?: (path: string | undefined, signal?: AbortSignal) => Promise<unknown>
  }
  const directoryPickerRemote = (): RemoteDirectoryPicker | undefined =>
    (ctx.get('remote') as { directoryPicker?: RemoteDirectoryPicker } | undefined)?.directoryPicker
  setDirectoryPicker(async () => {
    const pick = directoryPickerRemote()?.pick
    if (pick === undefined) return undefined
    const response = (await pick().catch(() => undefined)) as
      | { ok?: boolean; value?: string | null }
      | undefined
    if (response?.ok !== true) return undefined
    return response.value ?? undefined
  })

  // Directory listing for the in-app browser, used when no OS picker exists.
  setDirectoryLister(async requested => {
    const list = directoryPickerRemote()?.list
    if (list === undefined) return undefined
    const response = (await list(requested).catch(() => undefined)) as
      | {
          ok?: boolean
          value?: {
            path: string
            entries: { name: string; path: string }[]
            crumbs: { name: string; path: string }[]
          }
        }
      | undefined
    return response?.ok === true ? response.value : undefined
  })


  // DSH 0.1.x picks settings-nav icons from a closed list of built-in ids, so
  // Pet's row would otherwise render the fallback gear. Mark our own row (and
  // only ours) so the bundled CSS can paint the mascot glyph instead.
  ctx.effect(
    () => registerPetSettingsNavIcon(PET_SECTION_LABEL),
    'dsh-pet: settings nav glyph',
  )
}

/**
 * The overlay surface bound to this plugin's client context.
 *
 * Declared at module scope (not as an inline arrow) so React keeps one stable
 * component identity across shell re-renders instead of remounting Pet — and
 * remounting would drop drag state and in-flight panel state on every
 * session, Hero or Settings transition.
 */
/** Display label for the settings section; shared with the nav-glyph marker. */
const PET_SECTION_LABEL = (): string => 'Pet'

let boundContext: ClientContext | undefined

/**
 * Last source projection handed to the surface.
 *
 * Kept at module scope so the `useSyncExternalStore` getter can return the
 * same reference while the selection is unchanged; a fresh object every call
 * reads as a new snapshot and re-renders forever.
 */
let sourceCache: SourceSelection | undefined

function PetOverlaySurface(): JSX.Element | null {
  const ctx = boundContext

  // Pet renders on its own root, so nothing re-renders it when the user
  // switches sessions — the shell's render pass no longer reaches it. Without
  // this subscription Pet would keep showing the session that was current when
  // it mounted and would capture THAT one on the next invocation.
  // `useSyncExternalStore` compares snapshots by identity, so the getter must
  // return a STABLE reference while nothing changed. Rebuilding the object on
  // every call would report a change each time and loop forever.
  const source = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        if (ctx === undefined) return () => {}
        const stops = [
          ctx.sessions.list.subscribe(onChange),
          ctx.workspaces.list.subscribe(onChange),
        ]
        return () => {
          for (const stop of stops) stop()
        }
      },
      [ctx],
    ),
    useCallback(() => {
      if (ctx === undefined) return undefined
      const next = readCurrentSource(ctx)
      const cached = sourceCache
      if (
        cached?.sessionId === next?.sessionId &&
        cached?.workspaceId === next?.workspaceId &&
        cached?.title === next?.title &&
        cached?.kind === next?.kind
      ) {
        return cached
      }
      sourceCache = next
      return next
    }, [ctx]),
  )

  if (ctx === undefined) return null
  return (
    <PetOverlay
      currentSource={source}
      openSession={sessionId => {
        openSession(ctx, sessionId)
      }}
    />
  )
}


/**
 * Read the browser's current session/workspace selection.
 *
 * `sessions.list` and `workspaces.list` are `ObservableSnapshot`s, so the
 * state is read through `getSnapshot()` — reading `.current` off the feed
 * object itself yields `undefined` and would make Pet believe there is never
 * an active session.
 *
 * Returns `undefined` on a Hero page with no active session: Pet must NEVER
 * fall back to the most recently used session, because the user did not
 * choose it for this invocation.
 * @param ctx - Client context.
 * @returns the current selection, or `undefined`.
 */
function readCurrentSource(ctx: ClientContext): SourceSelection | undefined {
  const sessionState = ctx.sessions.list.getSnapshot()
  const currentId = sessionState.current
  if (currentId === undefined) return undefined

  // The list is keyed by id (`byId`), not an `items` array.
  const summary = sessionState.byId[currentId]
  const workspaceState = ctx.workspaces.list.getSnapshot()
  const workspace = workspaceState.items.find(item => item.sessionIds.includes(currentId))

  const title = summary?.title ?? summary?.displayTitle
  return {
    kind: 'session',
    sessionId: currentId,
    ...(title !== undefined ? { title } : {}),
    // WorkspaceView identifies itself with `workspaceId`, not `id`.
    ...(workspace !== undefined ? { workspaceId: workspace.workspaceId } : {}),
  }
}

/**
 * Navigate to a native DSH session.
 *
 * Uses the typed sessions face rather than an untyped `ctx.get` lookup, so a
 * contract change fails the build instead of silently no-opping.
 * @param ctx - Client context.
 * @param sessionId - Target session.
 */
function openSession(ctx: ClientContext, sessionId: string): void {
  ctx.sessions.open(sessionId as Parameters<ClientContext['sessions']['open']>[0])
}
