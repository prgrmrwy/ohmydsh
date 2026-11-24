/**
 * Injected page script (design D4, D7, D10; spec「页面看到直接地址，导航留在代理内」).
 * Runs as the first executable script of every proxied HTML document. The Host defines
 * `globalThis[INJECT_CONFIG_GLOBAL]` in the same inline <script> right before this text.
 */
import {
  FRAME_ATTR, INJECT_CONFIG_GLOBAL, INJECT_MARKER, PROXY_PATH_RE, WS_ROUTE,
  type InjectConfig, type InjectToTabMessage,
} from '../contract.js'
import { IdentityTableError, recordCurrent } from './identity.js'
import { classify, webSocketTarget } from './routing.js'
import { installCookieView, installStorageViews } from './storage.js'
import type { NavigateEventLike, NavigationLike } from './types.js'

function tell(message: InjectToTabMessage): void {
  if (window.parent !== window) window.parent.postMessage(message, location.origin)
}

function run(): void {
  const config = (globalThis as Record<string, unknown>)[INJECT_CONFIG_GLOBAL] as InjectConfig | undefined
  if (config === undefined) {
    window.stop()
    return
  }
  const { fam, port, prefix } = config

  // Step 1: the Service Worker must already control this document, otherwise sub-requests escape.
  if (navigator.serviceWorker?.controller == null) {
    window.stop()
    tell({ type: 'dshls:uncontrolled' })
    return
  }
  const navigation = (window as { navigation?: NavigationLike }).navigation
  if (navigation === undefined) {
    window.stop()
    tell({ type: 'dshls:identity-unavailable', reason: 'Navigation API 不可用' })
    return
  }

  // Native storage reference, taken before any page-facing wrapper exists.
  const nativeSession = window.sessionStorage
  const nativeLocal = window.localStorage
  const frameId = window.frameElement?.getAttribute(FRAME_ATTR) ?? null

  // Step 2: the page must see the direct address.
  const m = PROXY_PATH_RE.exec(location.pathname)
  if (m === null || m[1] !== fam || m[2] !== port) {
    window.stop()
    tell({ type: 'dshls:identity-unavailable', reason: '文档地址与注入配置不一致' })
    return
  }
  const rest = (m[3] ?? '') === '' ? '/' : (m[3] as string)
  history.replaceState(history.state, '', rest + location.search + location.hash)
  const here = () => ({ fam, port, rest: location.pathname + location.search + location.hash })

  // Step 3: identity table (only frames the tab owns carry a frame id).
  const record = (): void => {
    if (frameId === null) return
    recordCurrent(nativeSession, navigation, frameId, here())
  }
  try {
    record()
  } catch (error) {
    window.stop()
    tell({ type: 'dshls:identity-unavailable', reason: error instanceof IdentityTableError ? error.message : String(error) })
    return
  }
  navigation.addEventListener('currententrychange', () => {
    try {
      record()
    } catch (error) {
      window.stop()
      tell({ type: 'dshls:identity-unavailable', reason: error instanceof Error ? error.message : String(error) })
      return
    }
    tell({ type: 'dshls:location', ...here() })
  })

  // Step 4: keep cross-document navigations inside the proxy.
  const submitAction = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'action')?.set
  const nativeSubmit = HTMLFormElement.prototype.submit
  const classifyUrl = (raw: string) => classify(new URL(raw, location.href), location.origin, { fam, port })
  navigation.addEventListener('navigate', (raw) => {
    const e = raw as NavigateEventLike
    if (e.destination.sameDocument || !e.cancelable) return
    const result = classifyUrl(e.destination.url)
    if (result.kind === 'external') {
      e.preventDefault()
      tell({ type: 'dshls:external', url: result.url })
      return
    }
    if (result.kind !== 'rewrite') return
    e.preventDefault()
    const form = e.sourceElement
    if (e.formData !== null && form instanceof HTMLFormElement && submitAction !== undefined) {
      submitAction.call(form, result.to)
      nativeSubmit.call(form)
      return
    }
    navigation.navigate(result.to, { history: e.navigationType === 'push' ? 'push' : 'replace' })
  })
  // Step 5: user/requestSubmit submissions: rewrite the action before the browser reads it.
  document.addEventListener('submit', (event) => {
    const form = event.target
    if (!(form instanceof HTMLFormElement) || submitAction === undefined) return
    const r = classifyUrl(form.action)
    if (r.kind === 'rewrite') submitAction.call(form, r.to)
    const submitter = (event as SubmitEvent).submitter
    if (submitter?.hasAttribute('formaction')) {
      const fr = classifyUrl((submitter as HTMLButtonElement).formAction)
      if (fr.kind === 'rewrite') submitter.setAttribute('formaction', fr.to)
    }
  }, true)

  // D4: cookie and storage views, cookieStore off.
  installCookieView(prefix)
  installStorageViews(prefix, nativeLocal, nativeSession)

  // D8: the proxied page may not register its own Service Workers.
  navigator.serviceWorker.register = () => Promise.reject(new DOMException('Service Worker registration is blocked for proxied pages', 'SecurityError'))

  // D10: WebSocket through the single Host entry.
  const NativeWebSocket = window.WebSocket
  const Wrapped = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    if (new.target === undefined) throw new TypeError("Failed to construct 'WebSocket': Please use the 'new' operator")
    const target = webSocketTarget(url, location.href, { fam, port }, WS_ROUTE) ?? url
    return Reflect.construct(NativeWebSocket, protocols === undefined ? [target] : [target, protocols], new.target)
  } as unknown as typeof WebSocket
  Object.setPrototypeOf(Wrapped, NativeWebSocket)
  Wrapped.prototype = NativeWebSocket.prototype
  window.WebSocket = Wrapped

  Object.defineProperty(window, INJECT_MARKER, { value: true })
  tell({ type: 'dshls:installed', ...here() })
}

run()
