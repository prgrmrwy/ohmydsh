/**
 * dsh-memex web client half.
 *
 * Registers the "记忆 / Memory" settings section into the official
 * `settings.section` slot and paints its navigation glyph. The page reads and
 * writes the `dsh-memex` settings namespace through the official client
 * settings scope, and reads library facts from the Host's `/dsh-memex` channel.
 * This bundle holds no filesystem, process or network capability of its own.
 *
 * @module dsh-memex/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: brings the ctx.slots Context merge (0.1.2: dsh-client-ui-renderer).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only merges: ctx.locale (dsh-client-locale) and ctx.connection
// (dsh-client-connection/client — the browser ConnectionHandle).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
// Type-only: the `settings.section` slot declaration and ctx.settingsScope.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { createBrowseAddressRegistry, MEMEX_BROWSE_ADDRESS_SERVICE } from './browse-address.js'
import { createLauncherDeps } from './launcher.js'
import { mountLauncher } from './launcher-view.js'
import { NS, en, zh } from './locales.js'
import { registerMemexSettingsNavIcon } from './nav-icon.js'
import { MemexSettingsSection, type MemexSectionInjected, type MemexSectionProps } from './page.js'
import { MEMEX_CSS } from './styles.js'
import type { MemexSettingsShape } from './settings-model.js'

/** Required services: slot registry, locale, the Connection RPC face, settings transport. */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/** Settings namespace owned by the host half. */
const MEMEX_NAMESPACE = 'dsh-memex'

/** Nav position: after the official pages, before the other third-party sections. */
const SECTION_ORDER = 25

/**
 * Mount the Memory settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memex: dictionaries')

  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-memex')
    style.textContent = MEMEX_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-memex: styles')

  const settingsScope = ctx.settingsScope.bind<MemexSettingsShape>({ namespace: MEMEX_NAMESPACE })
  const t = ctx.locale.bind(NS)
  // `connection` is typed as the host handle by some Context merges; in the
  // browser shell the same key holds the full client ConnectionHandle.
  const connection = ctx.get('connection')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section' as const,
    id: MEMEX_NAMESPACE,
    order: SECTION_ORDER,
    // A thunk so the nav label follows the active locale.
    label: () => t('nav'),
    inject: (): MemexSectionInjected => ({
      rpc: connection.rpc,
      t,
      scope: settingsScope,
    }),
  }, MemexSettingsSection as (props: MemexSectionProps) => JSX.Element | null))

  // Decoration only: if the shell's row cannot be located, the official glyph
  // stays and the page is unaffected.
  ctx.effect(() => registerMemexSettingsNavIcon(() => t('nav')), 'dsh-memex: settings nav glyph')

  // Card browsing, client half.
  //
  // The registry is dsh-memex's own extension point: with no registrant it
  // yields this machine's address, which is right whenever the Host and the
  // browser are the same machine. It is provided unconditionally and is NOT in
  // `inject`, because a registrant is optional and an unresolved inject makes a
  // client plugin silently not load.
  const addresses = createBrowseAddressRegistry()
  ctx.effect(() => ctx.provide(MEMEX_BROWSE_ADDRESS_SERVICE, addresses), 'dsh-memex: browse address registry')
  ctx.effect(
    () => mountLauncher({ deps: createLauncherDeps(connection.rpc, addresses), t }),
    'dsh-memex: card browser launcher',
  )
}
