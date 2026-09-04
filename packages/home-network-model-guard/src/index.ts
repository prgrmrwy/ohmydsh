/**
 * dsh-home-network-model-guard host half.
 *
 * Exposes one read-only Connection RPC channel, `/dsh-home-network-model-guard`,
 * whose single `check` endpoint answers the DSH **host** machine's egress
 * verdict: whether the egress country/region hits the configured blocklist
 * (default CN) via two backup Geo services. The verdict is cached host-side
 * (TTL + local IPv4 fingerprint + config generation, single-flight) and failed
 * resolutions degrade to `'unknown'` with exponential-backoff retries — the
 * browser never sees a transport error from this channel.
 *
 * This half is the package's ONLY outbound caller: two configured HTTPS Geo
 * endpoints, queried as primary→fallback backups. Automatic judgment never
 * touches Anthropic/Cloudflare diagnostic endpoints. No local information
 * beyond the request itself is sent, and raw IPs are never persisted or
 * returned. Registration mirrors dsh-system-clock: `connection` is
 * deliberately NOT in the inject list (headless compositions lack it), the
 * channel registers lazily once the service exists, and every business
 * outcome returns an RpcResult value (handlers never throw).
 *
 * @module dsh-home-network-model-guard
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import os from 'node:os'
import path from 'node:path'
import { GUARD_CHANNEL, GUARD_CHECK_ENDPOINT } from './contract.js'
import { configEpochOf, loadGuardConfig } from './config.js'
import { GeoCountrySource } from './geo.js'
import { fingerprintOf, NetworkVerdictCache, type VerdictSource } from './network.js'
import { classifyCountry } from './rules.js'

/** Stable cordis plugin name (the Loader entry). */
export const name = 'dsh-home-network-model-guard'

/**
 * Required services before load: none host-side. The `connection` service is
 * resolved lazily through `ctx.inject` so this plugin also loads in headless
 * compositions that do not carry the web connection half.
 */
export const inject: string[] = []

/** Host config path under the DSH home (never the repository). */
export function configPathOf(dshHome: string): string {
  return path.join(dshHome, 'plugins', 'dsh-home-network-model-guard', 'config.json')
}

function resolveDshHome(): string {
  const explicit = process.env.DSH_HOME?.trim()
  if (explicit !== undefined && explicit !== '') return explicit
  return process.env.HOME ?? os.homedir()
}

/**
 * Build the verdict source from the live host config. The config is refreshed
 * before every check; a config write changes the epoch which invalidates the
 * cache, and the next refresh uses the new endpoints/blocklist.
 */
function buildSource(configFile: string): VerdictSource {
  let current = loadGuardConfig(configFile)
  return {
    fingerprint: () => fingerprintOf(os.networkInterfaces()),
    epoch: () => configEpochOf(configFile),
    fetchCountry: (signal) => {
      current = loadGuardConfig(configFile)
      return new GeoCountrySource(current.geoEndpoints, fetch).resolveCountry(signal)
    },
    classify: (country) => classifyCountry(country, current.blockedCountries),
  }
}

/** Mount the `/dsh-home-network-model-guard` RPC channel when a host connection exists. */
export function apply(ctx: Context): void {
  ctx.inject(['connection'], (child) => {
    const connection = child.get('connection')
    if (connection === undefined) return
    const configFile = configPathOf(resolveDshHome())
    const initial = loadGuardConfig(configFile)
    const cache = new NetworkVerdictCache(
      buildSource(configFile),
      () => Date.now(),
      {
        ttlMs: initial.ttlMs,
        fetchTimeoutMs: initial.timeoutMs,
        backoffBaseMs: initial.backoffBaseMs,
        backoffMaxMs: initial.backoffMaxMs,
      },
    )
    // 诊断信号:verdict 每次变化只记一行,从不含 IP/原文错误文本。
    const logger = ctx.logger('dsh-home-network-model-guard')
    let lastLogged: string | undefined
    const logTransition = (verdict: string, degraded: boolean): void => {
      const line = degraded ? `${verdict} (degraded)` : verdict
      if (lastLogged === line) return
      lastLogged = line
      logger.info(`egress verdict -> ${line}`)
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