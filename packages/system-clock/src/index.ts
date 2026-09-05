/**
 * dsh-system-clock host half.
 *
 * Exposes one read-only Connection RPC channel, `/dsh-system-clock`, whose
 * single `now` endpoint samples the DSH **host** machine's clock: host epoch,
 * IANA timezone, current UTC offset and hostname. The web half renders a live
 * 24-hour clock in that zone. Registration mirrors dsh-plugin-subscriptions'
 * `/subscriptions-auth` channel: `connection` is deliberately NOT in the
 * plugin's inject list (headless compositions lack it), the channel is
 * registered lazily once the service exists, and every business outcome
 * returns an RpcResult value (handlers never throw). No files, commands,
 * credentials or model faces — only harmless host-fact sampling.
 *
 * Loopback boundary: on DSH 0.1.1-rc.2 this channel passed
 * `{ authority: 'loopback' }` at registration. The 0.1.2 line removed that
 * per-channel parameter; the same boundary is now enforced by the Connection
 * host fence itself — every registered channel rejects requests whose Host is
 * neither loopback nor a configured `trustedHosts` authority (403) and
 * requires an authenticated browser session (401). This deployment configures
 * no `trustedHosts`, so the channel remains loopback-only; configuring
 * `trustedHosts` would widen every channel and must be treated as a security
 * decision (see openspec spec `settings-system-clock`).
 *
 * @module dsh-system-clock
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: brings the host Context.connection merge (HostConnectionHandle).
import type {} from '@deepseek-ai/dsh-client-connection'
import { SYSTEM_CLOCK_CHANNEL, SYSTEM_CLOCK_NOW_ENDPOINT } from './contract.js'
import { buildSystemClockSample, resolveHostIanaZone } from './host-time.js'
import { hostname as osHostname } from 'node:os'

/** Stable cordis plugin name (the Loader entry). */
export const name = 'dsh-system-clock'

/**
 * Required services before load: none host-side. The `connection` service is
 * resolved lazily through `ctx.inject` so this plugin also loads in headless
 * compositions that do not carry the web connection half.
 */
export const inject: string[] = []

/** Mount the `/dsh-system-clock` RPC channel when a host connection exists. */
export function apply(ctx: Context): void {
  ctx.inject(['connection'], (child) => {
    const connection = child.get('connection')
    if (connection === undefined) return
    child.effect(() => connection.rpc.handle(
      SYSTEM_CLOCK_CHANNEL,
      async (endpoint) => {
        if (endpoint !== SYSTEM_CLOCK_NOW_ENDPOINT) {
          return {
            ok: false as const,
            error: {
              code: 'internal',
              message: `dsh-system-clock: unknown endpoint "${endpoint}"`,
              details: {},
            },
          }
        }
        return {
          ok: true as const,
          value: buildSystemClockSample(Date.now(), resolveHostIanaZone(), osHostname()),
        }
      },
    ), 'dsh-system-clock: /dsh-system-clock rpc channel')
  })
}
