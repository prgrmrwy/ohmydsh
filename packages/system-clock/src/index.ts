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
      { authority: 'loopback' },
    ), 'dsh-system-clock: /dsh-system-clock rpc channel')
  })
}
