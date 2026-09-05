/**
 * dsh-home-network-model-guard web client half.
 *
 * Two surfaces:
 *
 * 1. **Composer guard**: subscribes the official per-session model-directory
 *    store and the composer-block registry (`ctx.conversation.blocks`); when
 *    the host verdict is `'blocked'`/`'unknown'` and the session selects a
 *    Claude-family model, the session's composer becomes inert with our
 *    localized reason. Fails CLOSED for Claude — only `'allowed'` permits.
 *
 * 2. **Settings page**: "Egress Guard" section showing the sanitized host
 *    verdict and editing the local configuration (blocked countries, Geo
 *    endpoints) through loopback RPC endpoints.
 *
 * Network verdicts are fetched from the host over the loopback RPC channel and
 * cached client-side; re-fetched when the tab becomes visible again and on a
 * throttled retry while unknown. The browser never performs its own Geo or IP
 * lookups.
 *
 * @module dsh-home-network-model-guard/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only merges: ctx.locale (dsh-client-locale), ctx.connection
// (dsh-client-connection/client — the browser ConnectionHandle) and the
// settings.section slot (dsh-client-ui-settings).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: ctx.slots (0.1.2: dsh-client-ui-renderer) and ctx.sessions
// (0.1.2: dsh-api-session-controller) Context merges.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: ctx.conversation.blocks / ctx.modelDirectories merges.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { GUARD_CHANNEL, GUARD_CHECK_ENDPOINT, type GuardCheckResult, type NetworkVerdict } from '../contract.js'
import { ComposerGuardController, type ReasonBlock, type SessionGuardDeps } from './guard.js'
import { NS, en, zh, type GuardKey } from './locales.js'
import { GuardSettingsSection, type GuardSettingsInjected } from './settings.jsx'

/** Required services: slots, locale, connection RPC, sessions, composer blocks, model directories. */
export const inject = ['slots', 'locale', 'connection', 'sessions', 'conversation', 'modelDirectories']

/** Minimum gap between client-side re-fetches of the host verdict (throttle). */
const MIN_NETWORK_RETRY_MS = 10_000

/** Style scope for the settings page (owned classes only). */
const SETTINGS_CSS = `
.dshg-root{display:flex;flex-direction:column;gap:10px;padding-top:6px}
.dshg-group-title{margin:12px 0 6px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2329)}
.dshg-status{margin:0;display:flex;flex-direction:column;gap:4px}
.dshg-status div{display:flex;gap:8px}
.dshg-status dt{min-width:90px;color:var(--dsw-alias-label-secondary,#646a73)}
.dshg-status dd{margin:0}
.dshg-verdict-allowed{color:var(--dsw-alias-success,#2ba471)}
.dshg-verdict-blocked,.dshg-verdict-unknown{color:var(--dsw-alias-danger,#c0392b)}
.dshg-action{width:fit-content;padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border,#d0d3d9);background:var(--dsw-alias-bg,#fff);cursor:pointer;color:var(--dsw-alias-label-primary,#1f2329)}
.dshg-action:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000f)}
.dshg-busy{opacity:.6;pointer-events:none}
.dshg-field{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--dsw-alias-label-secondary,#646a73)}
.dshg-input{padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border,#d0d3d9);font:inherit}
.dshg-notice{font-size:13px;margin:0}
.dshg-notice-ok{color:var(--dsw-alias-success,#2ba471)}
.dshg-notice-error{color:var(--dsw-alias-danger,#c0392b)}
`

/**
 * Mount the sending guard and the Egress Guard settings page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-home-network-model-guard: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', 'dsh-home-network-model-guard')
    style.textContent = SETTINGS_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-home-network-model-guard: settings styles')

  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section' as const,
    id: 'egress-guard',
    order: 290,
    label: () => t('settingsNav'),
    inject: (): GuardSettingsInjected => ({
      rpc: ctx.get('connection').rpc,
      t,
    }),
  }, GuardSettingsSection))

  // `connection` is typed as the host handle by some Context merges; in the
  // browser shell the same key holds the full client ConnectionHandle (the
  // same pattern dsh-system-clock relies on for its settings page).
  const connection = ctx.get('connection')

  // ---- client-side verdict cache (host RPC) -------------------------------
  const networkState: {
    verdict: NetworkVerdict
    lastAttempt: number
    resolved: boolean
  } = { verdict: 'unknown', lastAttempt: 0, resolved: false }
  const refreshNetwork = async (): Promise<void> => {
    const now = Date.now()
    if (now - networkState.lastAttempt < MIN_NETWORK_RETRY_MS && networkState.verdict !== 'unknown') return
    networkState.lastAttempt = now
    let result: { ok?: boolean; value?: GuardCheckResult; error?: { message?: string } }
    try {
      result = (await connection.rpc.call(GUARD_CHANNEL, GUARD_CHECK_ENDPOINT, {})) as typeof result
    } catch (error) {
      networkState.verdict = 'unknown'
      // 诊断信号:浏览器控制台可见;失败不泄漏任何 IP 信息。
      console.warn('[dsh-home-network-model-guard] verdict RPC failed:', error instanceof Error ? error.message : String(error))
      return
    }
    if (result.ok !== true || result.value === undefined) {
      networkState.verdict = 'unknown'
      console.warn('[dsh-home-network-model-guard] verdict RPC returned an error result')
      return
    }
    if (result.value.verdict !== networkState.verdict || !networkState.resolved) {
      console.info('[dsh-home-network-model-guard] network verdict:', result.value.verdict)
    }
    networkState.verdict = result.value.verdict
    networkState.resolved = true
  }

  // ---- guard wiring --------------------------------------------------------
  const guardKey: GuardKey = 'homeNetworkClaudeBlocked'
  const deps: SessionGuardDeps = {
    network: () => networkState.verdict,
    read: (id) => {
      try {
        const directory = ctx.modelDirectories.directoryFor(id as SessionId)
        const snapshot = directory.store.getSnapshot()
        const current = snapshot.current
        return {
          selection: current === null ? null : { provider: current.provider, model: current.model },
          // `null` (not loaded) is NOT blocked — same reading as the official
          // publish (`routable === false` is the only value it blocks on).
          routable: snapshot.routable !== false,
        }
      } catch {
        return undefined
      }
    },
    subscribeSelection: (id, onChange) => {
      // NOTE: no `directory.load()` here. Priming every bound session at boot
      // fans catalog refreshes out across ALL sessions (each one hits the host
      // models API → provider catalogs), which can visibly slow down the model
      // picker. Only the ACTIVE session is primed (see primeActive below);
      // other sessions load lazily when their selector is opened, and their
      // store publish then drives evaluate as usual.
      return ctx.modelDirectories.directoryFor(id as SessionId).store.subscribe(onChange)
    },
    subscribeBlockStore: (id, onChange) => ctx.conversation.blocks.storeFor(id as SessionId).subscribe(onChange),
    blockOf: (id) => ctx.conversation.blocks.storeFor(id as SessionId).getSnapshot() as ReasonBlock | undefined,
    setBlock: (id, block) => ctx.conversation.blocks.set(id as SessionId, block),
    reason: () => t(guardKey),
  }
  const guard = new ComposerGuardController(deps)

  // ---- per-session lifecycle -------------------------------------------------
  const bindings = new Map<string, { stop: () => void }>()
  const bind = (id: SessionId): void => {
    if (bindings.has(id)) return
    let stopSelection = (): void => undefined
    let stopBlockStore = (): void => undefined
    try {
      // The store subscription fires immediately, so the first evaluate
      // happens through it (and the block slot subscription self-checks).
      stopSelection = deps.subscribeSelection(id, () => guard.evaluate(id))
      stopBlockStore = deps.subscribeBlockStore(id, () => guard.onBlockStoreChanged(id))
    } catch {
      // directoryFor threw (session not materialized yet): retry on the next
      // sessions-list change; nothing was registered.
      stopSelection()
      stopBlockStore()
      return
    }
    bindings.set(id, { stop: () => { stopSelection(); stopBlockStore() } })
    guard.evaluate(id)
  }
  const unbind = (id: string): void => {
    const binding = bindings.get(id)
    if (binding === undefined) return
    binding.stop()
    bindings.delete(id)
    guard.dispose(id)
  }

  ctx.effect(() => {
    const syncSessions = (): void => {
      try {
        const snapshot = ctx.sessions.list.getSnapshot()
        const live = new Set<string>()
        for (const id of Object.keys(snapshot.byId)) {
          live.add(id)
          if (!bindings.has(id)) bind(id as SessionId)
        }
        for (const id of [...bindings.keys()]) {
          if (!live.has(id)) unbind(id)
        }
      } catch {
        // sessions.list not ready yet; the subscription retries on change.
      }
      // 会话切换(如点击左侧列表)后,新活跃会话的目录可能尚未加载。
      primeActive()
    }
    const primeActive = (): void => {
      // 只预热正在查看的会话:其目录为空时触发一次 catalog 刷新。失败无妨
      // (下次 sessions.list 变化会重试),成功后 store 发布 → evaluate。
      try {
        const active = ctx.sessions.list.getSnapshot().current
        if (active === undefined) return
        const directory = ctx.modelDirectories.directoryFor(active)
        if (directory.store.getSnapshot().current === null) {
          directory.load().catch(() => {
            // no-op: store keeps last good state
          })
        }
      } catch {
        // directoryFor 尚未就绪:下次 list 变化重试
      }
    }
    const reEvaluateAll = (): void => {
      for (const id of bindings.keys()) guard.evaluate(id)
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void refreshNetwork().then(reEvaluateAll)
      }
    }

    const stopList = ctx.sessions.list.subscribe(syncSessions)
    document.addEventListener('visibilitychange', onVisibility)

    // 自愈心跳:判定不明(unknown,即 fail-open 态)时每 5s 重试,直到拿到结论。
    // 原实现只在启动/切回标签页时重试——连接 RPC 在 bundle 装载瞬间可能尚
    // 未就绪,导致永久 unknown、永远不拦截,且无任何可观测迹象。
    const heartbeat = window.setInterval(() => {
      if (networkState.resolved) return
      void refreshNetwork().then(reEvaluateAll)
    }, 5_000)

    void refreshNetwork().then(() => {
      syncSessions()
      primeActive()
      reEvaluateAll()
    })
    syncSessions()
    primeActive()

    return () => {
      stopList()
      window.clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const id of [...bindings.keys()]) unbind(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, 'dsh-home-network-model-guard: session guard sync')
}