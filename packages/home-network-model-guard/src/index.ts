/**
 * dsh-home-network-model-guard host half.
 *
 * Two independent surfaces:
 *
 * 1. **Egress verdict source** (`/dsh-home-network-model-guard` check RPC, plus
 *    the `llm/stream` waterfall gate): the host resolves the egress
 *    country/region through two backup HTTPS Geo services (primary first,
 *    fallback on failure; both failing → `unknown`). The verdict is cached
 *    host-side (TTL + local IPv4 fingerprint + config generation,
 *    single-flight), failed resolutions degrade to `'unknown'` with
 *    exponential-backoff retries, and the Claude-family gate fails closed on
 *    `blocked`/`unknown` without ever calling the provider.
 *
 * 2. **Local config**: `$DSH_HOME/plugins/dsh-home-network-model-guard/config.json`
 *    (blockedCountries default CN, two Geo endpoints, cache knobs). Writes
 *    change the config epoch, which invalidates the verdict cache; nothing
 *    secret is accepted.
 *
 * This half is the package's ONLY outbound caller: the two configured Geo
 * endpoints. Automatic judgment never touches Anthropic/Cloudflare diagnostic
 * endpoints, sends no local information beyond the request itself, and raw IPs
 * are never persisted or returned. The RPC registration mirrors
 * dsh-system-clock: `connection` is deliberately NOT in the inject list
 * (headless compositions lack it), the channel registers lazily once the
 * service exists, and every business outcome returns an RpcResult value
 * (handlers never throw). The `llm/stream` gate registers on the root context
 * and therefore also guards headless compositions.
 *
 * @module dsh-home-network-model-guard
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import os from 'node:os'
import path from 'node:path'
import { GUARD_CHANNEL, GUARD_CHECK_ENDPOINT } from './contract.js'
import { configEpochOf, loadGuardConfig, type GuardConfig } from './config.js'
import { createEgressGate } from './egress-gate.js'
import { GeoCountrySource } from './geo.js'
import { fingerprintOf, NetworkVerdictCache, type VerdictSource } from './network.js'
import { classifyCountry } from './rules.js'

/** Stable cordis plugin name (the Loader entry). */
export const name = 'dsh-home-network-model-guard'

/**
 * Required services before load: none host-side. The `connection` service is
 * resolved lazily through `ctx.inject` so this plugin also loads in headless
 * compositions that do not carry the web connection half; the `llm/stream`
 * gate registers regardless.
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
 * before every resolution; a config write changes the epoch which invalidates
 * the cache, and the next resolution uses the new endpoints/blocklist.
 */
function buildSource(configFile: string): VerdictSource {
  let current: GuardConfig = loadGuardConfig(configFile)
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

/** Mount the verdict cache, the `llm/stream` gate and the loopback RPC channel. */
export function apply(ctx: Context): void {
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

  // Host enforcement: refuse Claude from blocked/unknown egress before the
  // provider adapter issues the request. Registers on the root context so
  // headless compositions are guarded too. Non-Claude passes through.
  ctx.on('llm/stream', createEgressGate(() => cache.check()))

  ctx.inject(['connection'], (child) => {
    const connection = child.get('connection')
    if (connection === undefined) return
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