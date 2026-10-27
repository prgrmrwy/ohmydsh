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
 *    Bindings are re-targeted whenever the runtime replaces a session's model
 *    directory (client session generations) and re-decided on every session-list
 *    change, so the gate follows a model switch without a page reload (see
 *    bindings.ts).
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
import { GUARD_CHANNEL, GUARD_CHECK_ENDPOINT, GUARD_POLICY_ENDPOINT, GUARD_CONFIG_CHANGED, type GuardPolicy, type GuardCheckResult, type NetworkVerdict } from '../contract.js'
import { SessionBindings } from './bindings.js'
import { ComposerGuardController, type ReasonBlock, type SessionGuardDeps } from './guard.js'
import { NS, en, zh, type GuardKey } from './locales.js'
import { GuardSettingsSection, type GuardSettingsInjected } from './settings.jsx'
import { mainSessionId } from './main-session.js'
import { isProviderList } from '../rules.js'

/** Required services: slots, locale, connection RPC, sessions, composer blocks, model directories. */
export const inject = ['slots', 'locale', 'connection', 'sessions', 'conversation', 'modelDirectories']

/** Minimum gap between client-side re-fetches of the host verdict (throttle). */
const MIN_NETWORK_RETRY_MS = 10_000

/**
 * Styles this plugin injects: the settings page (own `.dshg-*` classes) plus
 * one compensation rule for a runtime regression (see COMPOSER_FALLBACK_CSS).
 */
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
 * TEMPORARY compensation for a DSH 0.1.2-rc.1 composer regression.
 *
 * The runtime moved the composer from a native `<textarea>` to a Lexical
 * contenteditable and dropped the hidden mirror element that used to carry the
 * height (its content was `draft + "\n"`, so an empty draft still occupied one
 * line). Height now comes solely from the `<p>` Lexical renders, and the only
 * `min-height` rule left is scoped to the hero (centred) composer. With a
 * composer block raised AND an empty draft there is no `<p>`: the content box
 * collapses to 0, and the absolutely-positioned reason text — the whole point
 * of a block — is clipped away by the scroller's `overflow-y`.
 *
 * The floor below restores one line of height. It is deliberately:
 * - anchored on the runtime's stable `data-*` attributes, never on build-time
 *   hashed class names (those change on every runtime rebuild);
 * - applied to the content wrapper rather than the editor itself, so it never
 *   competes with the official `.hero .input{min-height:52px}` rule;
 * - a floor, not an override: 24px equals one `line-height`, so states that
 *   already have height (a non-empty draft, the hero composer, normal editing)
 *   are unaffected.
 *
 * REMOVE THIS once the runtime again guarantees a minimum height for the
 * non-hero composer content area (or restores an equivalent mirror). Verify by
 * checking whether a blocked composer with an empty draft still renders its
 * reason text after the fallback is removed.
 */
export const COMPOSER_FALLBACK_CSS = `
[data-input-scroll] > div{min-height:24px}
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
    style.textContent = `${SETTINGS_CSS}${COMPOSER_FALLBACK_CSS}`
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
    exemptProviders: readonly string[]
  } = { verdict: 'unknown', lastAttempt: 0, resolved: false, exemptProviders: [] }
  let refreshGeneration = 0
  const refreshNetwork = async (force = false): Promise<void> => {
    const now = Date.now()
    // Throttle settled verdicts; an unresolved one keeps retrying on every signal.
    if (!force && now - networkState.lastAttempt < MIN_NETWORK_RETRY_MS && networkState.verdict !== 'unknown') return
    networkState.lastAttempt = now
    const generation = ++refreshGeneration
    try {
      const policy = await connection.rpc.call(GUARD_CHANNEL, GUARD_POLICY_ENDPOINT, {}) as { ok?: boolean; value?: GuardPolicy }
      if (generation !== refreshGeneration) return
      if (policy.ok !== true || !isProviderList(policy.value?.exemptProviders)) throw new Error('invalid policy response')
      networkState.exemptProviders = policy.value.exemptProviders
      refreshBindings()
    } catch {
      if (generation !== refreshGeneration) return
      networkState.exemptProviders = []
      networkState.verdict = 'unknown'
      networkState.resolved = false
      refreshBindings()
      return
    }
    let result: { ok?: boolean; value?: GuardCheckResult; error?: { message?: string } }
    try {
      result = (await connection.rpc.call(GUARD_CHANNEL, GUARD_CHECK_ENDPOINT, {})) as typeof result
    } catch (error) {
      if (generation !== refreshGeneration) return
      networkState.verdict = 'unknown'
      // 诊断信号:浏览器控制台可见;失败不泄漏任何 IP 信息。
      console.warn('[dsh-home-network-model-guard] verdict RPC failed:', error instanceof Error ? error.message : String(error))
      return
    }
    if (generation !== refreshGeneration) return
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
    exemptProviders: () => networkState.exemptProviders,
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
    blockOf: (id) => ctx.conversation.blocks.storeFor(id as SessionId).getSnapshot() as ReasonBlock | undefined,
    setBlock: (id, block) => ctx.conversation.blocks.set(id as SessionId, block),
    reason: () => t(guardKey),
  }
  const guard = new ComposerGuardController(deps)

  // ---- per-session lifecycle -------------------------------------------------
  /**
   * Sessions are bound through `SessionBindings`: one live store subscription
   * per session id, re-targeted when the runtime replaces that session's model
   * directory. Resolving a directory once and trusting it forever is the defect
   * the module documents — a retired store never fires again, so the gate would
   * silently stop following the session's model.
   */
  const bindings = new SessionBindings({
    // NOTE: no `directory.load()` here. Priming every bound session at boot
    // fans catalog refreshes out across ALL sessions (each one hits the host
    // models API → provider catalogs), which can visibly slow down the model
    // picker. Only the ACTIVE session is primed (see primeActive below);
    // other sessions load lazily when their selector is opened, and their
    // store publish then drives evaluate as usual.
    storeFor: (id) => ctx.modelDirectories.directoryFor(id as SessionId).store,
    subscribeStore: (store, onChange) => store.subscribe(onChange),
    subscribeBlocks: (id) => ctx.conversation.blocks.storeFor(id as SessionId).subscribe(() => guard.onBlockStoreChanged(id as SessionId)),
    evaluate: (id) => guard.evaluate(id as SessionId),
    dispose: (id) => guard.dispose(id as SessionId),
  })

  /** Session ids in the client list, or `undefined` while that store is unreadable. */
  const liveSessionIds = (): string[] | undefined => {
    try {
      return Object.keys(ctx.sessions.list.getSnapshot().byId)
    } catch {
      // sessions.list not ready yet; the subscription retries on change.
      return undefined
    }
  }
  /**
   * Reconcile the per-session bindings and re-decide every bound session. Runs on
   * every session-list change, on visibility, and on each verdict refresh: the
   * guard must not depend on a single subscription staying valid across client
   * session generations, and a cheap re-decision heals any signal it missed.
   */
  const refreshBindings = (): void => {
    const ids = liveSessionIds()
    if (ids === undefined) bindings.reverify()
    else bindings.sync(ids)
  }

  ctx.effect(() => {
    const syncSessions = (): void => {
      refreshBindings()
      // 会话切换(如点击左侧列表)后,新活跃会话的目录可能尚未加载。
      primeActive()
    }
    const primeActive = (): void => {
      // 只预热正在查看的会话:其目录为空时触发一次 catalog 刷新。失败无妨
      // (下次 sessions.list 变化会重试),成功后 store 发布 → evaluate。
      try {
        const active = mainSessionId(ctx.sessions.list.getSnapshot()) as SessionId | undefined
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
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void refreshNetwork().then(refreshBindings)
      }
    }

    const onConfigChanged = (): void => {
      void refreshNetwork(true).then(refreshBindings)
    }
    window.addEventListener(GUARD_CONFIG_CHANGED, onConfigChanged)
    const stopList = ctx.sessions.list.subscribe(syncSessions)
    document.addEventListener('visibilitychange', onVisibility)

    // Keep policy changes from other clients fresh even after Geo has resolved.
    const heartbeat = window.setInterval(() => {
      void refreshNetwork().then(refreshBindings)
    }, 5_000)

    void refreshNetwork().then(syncSessions)
    syncSessions()

    return () => {
      stopList()
      window.clearInterval(heartbeat)
      ++refreshGeneration
      window.removeEventListener(GUARD_CONFIG_CHANGED, onConfigChanged)
      document.removeEventListener('visibilitychange', onVisibility)
      bindings.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, 'dsh-home-network-model-guard: session guard sync')
}