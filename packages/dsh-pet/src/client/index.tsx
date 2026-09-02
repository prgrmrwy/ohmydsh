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

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only merge: pulls the `shell.overlay` SlotMap declaration into this
// program so the registration is compile-time checked.
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PetOverlay, type SourceSelection } from './overlay.js'
import {
  PetSettingsSection,
  setDirectoryPicker,
  setDirectoryLister,
  setWorkspaceLister,
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
 * Mount the Pet overlay and settings section.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  boundContext = ctx
  ctx.effect(() => () => {
    boundContext = undefined
  }, 'dsh-pet: release bound client context')

  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-pet')
    style.textContent = `${PET_CSS}\n${PET_SETTINGS_NAV_CSS}`
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-pet: styles')

  // `slots.inject` waits for each slot DECLARATION and installs the
  // registration inside its lifetime, so Pet never registers into a slot the
  // shell has not declared yet (a direct register would throw at load). The
  // registration itself is `register({ name, id, ... }, Component)`: for a
  // `list` slot the `id` is required, and disposal routes through the
  // caller's fiber.
  // Keep the `shell.overlay` registration (the shell owns mount lifetime and
  // ordering), but the SURFACE escapes the clipped layer from inside the
  // component: that layer is `position:absolute; inset:0` within a frame that
  // sets `overflow:hidden`, so a viewport-edge floating element is clipped
  // away — Pet rendered but stayed invisible. The shipped `dsh-width-tiers`
  // picker solves the same problem the same way, with a `position:fixed`
  // element parented to `document.body`.
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay' as const, id: 'dsh-pet', order: 500 },
      PetOverlaySurface,
    ),
  )

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section' as const, id: 'dsh-pet', order: 320, label: PET_SECTION_LABEL },
      PetSettingsSection,
    ),
  )

  // Publish the Host directory picker to the settings page. Pet asks for a
  // Host path (the machine running `dsh web`), so a browser file input would
  // be wrong: it yields the USER's machine. `host.pickDirectory` is served
  // only under the `native` capability, so a remote deployment simply gets
  // no picker and keeps typing the path.
  // Publish the workspace list so Bindings can offer a real choice: a
  // workspace id is a UUID, which nobody can type from memory.
  setWorkspaceLister(() => {
    const state = ctx.workspaces.list.getSnapshot() as {
      items?: readonly { workspaceId: string; title?: string; path?: string }[]
    }
    return (state.items ?? []).map(item => ({
      id: String(item.workspaceId),
      label: item.title ?? item.path ?? String(item.workspaceId),
      ...(item.path !== undefined ? { path: item.path } : {}),
    }))
  })

  // Two-tier: the OS picker when this deployment serves `native`, otherwise
  // the in-app browser (`browse`). The native call FAILS on a browse-only
  // deployment — which is why the button appeared to do nothing — so its
  // rejection must fall through rather than surface as an error.
  setDirectoryPicker(async () => {
    const connection = ctx.get('connection') as
      | {
          api?: {
            host?: {
              pickDirectory?: (payload: unknown) => Promise<unknown>
            }
          }
        }
      | undefined
    // `host` hangs off `connection.api` (the IApiClient face), NOT
    // `connection.rpc` — reading the wrong face yields `undefined` and the
    // picker silently degrades to "unsupported".
    const pick = connection?.api?.host?.pickDirectory
    if (pick === undefined) return undefined
    const response = (await pick({}).catch(() => undefined)) as
      | { result?: { ok?: boolean; value?: { path?: string | null } } }
      | undefined
    if (response?.result?.ok !== true) return undefined
    return response.result.value?.path ?? undefined
  })

  // Directory listing for the in-app browser, used when no OS picker exists.
  setDirectoryLister(async requested => {
    const connection = ctx.get('connection') as
      | {
          api?: {
            host?: {
              listDirectory?: (payload: unknown) => Promise<unknown>
            }
          }
        }
      | undefined
    const list = connection?.api?.host?.listDirectory
    if (list === undefined) return undefined
    const response = (await list(
      requested === undefined ? {} : { path: requested },
    ).catch(() => undefined)) as
      | {
          result?: {
            ok?: boolean
            value?: {
              path: string
              entries: { name: string; path: string }[]
              crumbs: { name: string; path: string }[]
            }
          }
        }
      | undefined
    return response?.result?.ok === true ? response.result.value : undefined
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

function PetOverlaySurface(): JSX.Element | null {
  const ctx = boundContext
  if (ctx === undefined) return null
  // Read the browser's live selection at RENDER time; the atomic capture
  // happens only when the user actually invokes a capability.
  return (
    <PetOverlay
      currentSource={readCurrentSource(ctx)}
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
