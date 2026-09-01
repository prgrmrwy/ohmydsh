/**
 * dsh-system-clock web client half.
 *
 * Registers the "System Clock" settings section into the official
 * `settings.section` slot (id `system-clock`, order 300 → the bottom of the
 * settings nav) and injects a scoped style tag. The page reads its facts from
 * the host half through the injected connection RPC face; this bundle holds no
 * host/network/credential capability of its own.
 *
 * @module dsh-system-clock/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only merges: ctx.locale (dsh-client-locale) and ctx.connection
// (dsh-client-connection/client — the browser ConnectionHandle).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the `settings.section` SlotMap declaration and the
// LocaleNamespaceMap base into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { NS, en, zh } from './clock-locales.js'
import { SystemClockSection, type SystemClockSectionInjected } from './section.js'

/** Required services: the slot registry, the Connection RPC face, and locale. */
export const inject = ['slots', 'connection', 'locale']

/**
 * Style scope. Owned class names (`dshsc-*`) only, injected once with the
 * plugin marker so the client-modules scanner can claim/remove the tag; the
 * section is painted purely with our own elements, never official classes.
 */
const CLOCK_CSS = `
.dshsc-root{display:flex;flex-direction:column;gap:8px;padding-top:8px}
.dshsc-time{font-size:44px;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:1px;color:var(--dsw-alias-label-primary,#1f2329)}
.dshsc-date{font-size:14px;color:var(--dsw-alias-label-secondary,#646a73)}
.dshsc-tz{font-size:14px;color:var(--dsw-alias-label-primary,#1f2329);font-variant-numeric:tabular-nums}
.dshsc-caption{font-size:12px;color:var(--dsw-alias-label-tertiary,#8f959e)}
.dshsc-unavailable{margin-top:8px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover,#0000000f)}
.dshsc-unavailable-detail{font-size:12px;margin-top:4px;color:var(--dsw-alias-label-tertiary,#8f959e)}
`

/**
 * Mount the System Clock settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-system-clock: dictionaries')

  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-system-clock')
    style.textContent = CLOCK_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-system-clock: styles')

  // `connection` is typed as the host handle by some Context merges; in the
  // browser shell the same key holds the full client ConnectionHandle (the
  // same pattern dsh-plugin-subscriptions relies on for its settings page).
  const connection = ctx.get('connection')
  const t = ctx.locale.bind(NS)
  const injected = (): SystemClockSectionInjected => ({
    rpc: connection.rpc,
    t,
    // Re-read each call so the date/weekday text follows the active locale
    // without needing a rerender-triggering subscription.
    locale: () => ctx.locale.getSnapshot().active,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section' as const,
    id: 'system-clock',
    order: 300,
    // A thunk so the nav label follows the active locale (the shell re-renders
    // on the ledger shot + locale revision).
    label: () => t('nav'),
    inject: injected,
  }, SystemClockSection))
}
