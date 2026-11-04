/**
 * Which quota window the sidebar usage card shows. Shared by the host (settings
 * persistence and request validation) and the client (row selection) so the two
 * lists can never drift; the module has no runtime dependency and is bundled
 * into both builds.
 *
 * @module dsh-magpie-connector/shared/sidebar-window
 */

/** `weekly`: the gateway's weekly window; `fiveHour`: its 5-hour window; `tightest`: the highest reading. */
export type SidebarWindowMode = 'weekly' | 'fiveHour' | 'tightest'

export const SIDEBAR_WINDOW_MODES = ['weekly', 'fiveHour', 'tightest'] as const satisfies readonly SidebarWindowMode[]

/** The card showed the weekly window before this setting existed, so absence keeps that behaviour. */
export const DEFAULT_SIDEBAR_WINDOW: SidebarWindowMode = 'weekly'

export const isSidebarWindowMode = (value: unknown): value is SidebarWindowMode =>
  typeof value === 'string' && (SIDEBAR_WINDOW_MODES as readonly string[]).includes(value)
