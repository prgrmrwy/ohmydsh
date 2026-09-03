/**
 * dsh-home-network-model-guard host half.
 *
 * Exposes one read-only Connection RPC channel, `/dsh-home-network-model-guard`,
 * whose single `check` endpoint answers the DSH **host** machine's network
 * verdict for the sending guard: egress IP hit the home allowlist or not. The
 * verdict is cached host-side (TTL + local IPv4 fingerprint invalidation,
 * single-flight), and failures degrade to `'unknown'` (fail open) instead of
 * throwing — the browser never sees a transport error from this channel.
 *
 * This half is the package's ONLY outbound caller: `fetchEgressIp` queries a
 * single fixed endpoint (`api.ipify.org`) with a timeout+abort, sends no local
 * information, and never persists the measured IP. Registration mirrors
 * dsh-system-clock: `connection` is deliberately NOT in the inject list
 * (headless compositions lack it), the channel registers lazily once the
 * service exists, and every business outcome returns an RpcResult value
 * (handlers never throw).
 *
 * @module dsh-home-network-model-guard
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: brings the host Context.connection merge (HostConnectionHandle).
import type {} from '@deepseek-ai/dsh-client-connection'
import os from 'node:os'
import { GUARD_CHANNEL, GUARD_CHECK_ENDPOINT } from './contract.js'
import { fetchEgressIp, fingerprintOf, NetworkVerdictCache } from './network.js'
import { classifyIp } from './rules.js'

/** Stable cordis plugin name (the Loader entry). */
export const name = 'dsh-home-network-model-guard'

/**
 * Required services before load: none host-side. The `connection` service is
 * resolved lazily through `ctx.inject` so this plugin also loads in headless
 * compositions that do not carry the web connection half.
 */
export const inject: string[] = []

/**
 * Cache TTL: the fallback upper bound for an unchanged fingerprint. The
 * fingerprint check already invalidates on reconnect, so this can afford to
 * be minutes-long (常态时几乎零外呼; 只有重启后首次判定会外呼一次).
 */
const TTL_MS = 5 * 60_000

/** Abort a single egress fetch after this long; the verdict then degrades. */
const FETCH_TIMEOUT_MS = 5_000

/** Mount the `/dsh-home-network-model-guard` RPC channel when a host connection exists. */
export function apply(ctx: Context): void {
  ctx.inject(['connection'], (child) => {
    const connection = child.get('connection')
    if (connection === undefined) return
    const cache = new NetworkVerdictCache(
      {
        fingerprint: () => fingerprintOf(os.networkInterfaces()),
        fetchIp: (signal) => fetchEgressIp(fetch, signal),
        classify: (ip) => classifyIp(ip),
      },
      () => Date.now(),
      { ttlMs: TTL_MS, fetchTimeoutMs: FETCH_TIMEOUT_MS },
    )
    // 诊断信号:verdict 每次变化只记一行,从不含 IP/原文错误文本。
    const logger = ctx.logger('dsh-home-network-model-guard')
    let lastLogged: string | undefined
    const logTransition = (verdict: string, degraded: boolean): void => {
      const line = degraded ? `${verdict} (degraded)` : verdict
      if (lastLogged === line) return
      lastLogged = line
      logger.info(`network verdict -> ${line}`)
    }
    child.effect(() => connection.rpc.handle(
      GUARD_CHANNEL,
      async (endpoint) => {
        if (endpoint !== GUARD_CHECK_ENDPOINT) {
          return {
            ok: false as const,
            error: {
              code: 'internal',
              message: `dsh-home-network-model-guard: unknown endpoint "${endpoint}"`,
              details: {},
            },
          }
        }
        try {
          const result = await cache.check()
          logTransition(result.verdict, result.degraded)
          return { ok: true as const, value: result }
        } catch (error) {
          return {
            ok: false as const,
            error: {
              code: 'internal',
              message: `dsh-home-network-model-guard: check failed: ${error instanceof Error ? error.message : String(error)}`,
              details: {},
            },
          }
        }
      },
      { authority: 'loopback' },
    ), 'dsh-home-network-model-guard: /dsh-home-network-model-guard rpc channel')
  })
}