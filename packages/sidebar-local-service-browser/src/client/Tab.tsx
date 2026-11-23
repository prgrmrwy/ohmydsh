/**
 * The「本地服务」tab: address bar + the proxied iframe (design D1, D7, D11).
 *
 * The iframe's page talks back with `dshls:*` postMessages (contract.ts). The tab also repairs
 * cross-document history traversals: the browser first asks DSH for the bare path, the tab sees an
 * un-injected document in its `load` handler and replaces it by the proxy path the identity table names.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ENTRIES_KEY_PREFIX, FRAME_ATTR, INJECT_MARKER, PROXY_PATH_RE, isInjectMessage, proxyPath } from '../contract.js'
import type { NavigationLike } from '../inject/types.js'
import { isEntryIdentity } from '../inject/identity.js'
import { directAddress, parseAddress } from './address.js'
import { browserPlatform, type TabPlatform } from './platform.js'

export type { TabPlatform } from './platform.js'

export interface TabProps {
  platform?: TabPlatform
  /** Random id written on the iframe's `data-dshls`; defaults to a fresh one. */
  frameId?: string
}

const newFrameId = (): string => `f${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

export const ERR_NO_RESTORE = '无法恢复该历史记录'
export const ERR_BLOCKED = '页面阻止了注入脚本'
export const ERR_UNCONTROLLED = '页面未受 Service Worker 控制'

/** Remove `__dshls.entries.*` keys whose frame id no live `iframe[data-dshls]` carries. */
function sweepStaleTables(): void {
  try {
    const alive = new Set([...document.querySelectorAll(`iframe[${FRAME_ATTR}]`)].map((f) => f.getAttribute(FRAME_ATTR)))
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(ENTRIES_KEY_PREFIX) && !alive.has(key.slice(ENTRIES_KEY_PREFIX.length))) window.sessionStorage.removeItem(key)
    }
  } catch { /* storage unavailable: nothing to sweep */ }
}

export function Tab({ platform = browserPlatform, frameId: givenFrameId }: TabProps) {
  const [frameId] = useState(() => givenFrameId ?? newFrameId())
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [external, setExternal] = useState('')
  const [src, setSrc] = useState<string | undefined>(undefined)
  const ready = useRef<Promise<string | undefined> | undefined>(undefined)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const uncontrolledSeen = useRef(0)
  const reportedUncontrolled = useRef(false)

  const blank = useCallback((message: string): void => {
    setError(message)
    setSrc('about:blank')
    const win = frame.current?.contentWindow
    try {
      win?.location.replace('about:blank')
    } catch { /* cross-origin document: the src change below still navigates */ }
  }, [])

  // Mount: sweep dead frames' tables and stale per-port Service Workers; unmount: drop only our own table.
  useEffect(() => {
    sweepStaleTables()
    void platform.cleanupStaleRegistrations().catch(() => undefined)
    return () => {
      try {
        window.sessionStorage.removeItem(`${ENTRIES_KEY_PREFIX}${frameId}`)
      } catch { /* ignore */ }
    }
  }, [platform, frameId])

  // Messages from the injected script (same origin, from our iframe only).
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const win = frame.current?.contentWindow
      if (win === null || win === undefined || event.source !== win || event.origin !== location.origin) return
      const data: unknown = event.data
      if (!isInjectMessage(data)) return
      switch (data.type) {
        case 'dshls:installed':
        case 'dshls:location':
          uncontrolledSeen.current = 0
          reportedUncontrolled.current = false
          setError('')
          setText(directAddress(data.fam, data.port, data.rest))
          break
        case 'dshls:uncontrolled':
          reportedUncontrolled.current = true
          uncontrolledSeen.current += 1
          if (uncontrolledSeen.current === 1) {
            try {
              win.location.reload()
            } catch {
              blank(ERR_UNCONTROLLED)
            }
          } else {
            blank(ERR_UNCONTROLLED)
          }
          break
        case 'dshls:identity-unavailable':
          blank(data.reason === 'no-identity' ? ERR_NO_RESTORE : `身份表不可用：${data.reason}`)
          break
        case 'dshls:external':
          setExternal(data.url)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [blank])

  /** `load` of the iframe: repair un-injected documents (history traversal) or refuse blocked pages. */
  const onLoad = (): void => {
    const win = frame.current?.contentWindow
    if (win === null || win === undefined) return
    let href: string
    let pathname: string
    let injected: boolean
    try {
      href = win.location.href
      pathname = win.location.pathname
      injected = (win as unknown as Record<string, unknown>)[INJECT_MARKER] === true
    } catch {
      return // cross-origin document: nothing to inspect
    }
    if (href === 'about:blank' || injected) return
    if (PROXY_PATH_RE.test(pathname)) {
      if (reportedUncontrolled.current) return // handled through the uncontrolled report
      blank(ERR_BLOCKED)
      return
    }
    // A bare path: DSH answered a traversal. Restore by the entry's recorded identity, never by guessing.
    try {
      const navigation = (win as unknown as { navigation?: NavigationLike }).navigation
      const key = navigation?.currentEntry?.key
      const raw = window.sessionStorage.getItem(`${ENTRIES_KEY_PREFIX}${frameId}`)
      const table: unknown = raw === null ? undefined : JSON.parse(raw)
      const identity = key !== undefined && typeof table === 'object' && table !== null ? (table as Record<string, unknown>)[key] : undefined
      if (!isEntryIdentity(identity)) {
        blank(ERR_NO_RESTORE)
        return
      }
      win.location.replace(proxyPath(identity.fam, identity.port, identity.rest))
    } catch {
      blank(ERR_NO_RESTORE)
    }
  }

  /** Preconditions (D11); resolves to an error message, or undefined when everything is in place. */
  const preflight = (): Promise<string | undefined> => {
    ready.current ??= (async () => {
      if (!platform.hasServiceWorker()) return '当前浏览器不支持 Service Worker'
      if (!platform.hasNavigation()) return '当前浏览器不支持 Navigation API'
      try {
        await platform.registerServiceWorker()
      } catch (cause) {
        return `Service Worker 注册失败：${cause instanceof Error ? cause.message : String(cause)}`
      }
      return undefined
    })()
    return ready.current.then((message) => {
      if (message !== undefined) ready.current = undefined // a later attempt may succeed
      return message
    })
  }

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const parsed = parseAddress(text)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    // The Navigation API check must be re-evaluated per attempt (it can disappear/appear); the SW part is cached.
    if (!platform.hasNavigation()) {
      setError('当前浏览器不支持 Navigation API')
      return
    }
    const failure = await preflight()
    if (failure !== undefined) {
      setError(failure)
      return
    }
    setError('')
    setExternal('')
    uncontrolledSeen.current = 0
    reportedUncontrolled.current = false
    setText(parsed.direct)
    const current = frame.current
    if (current !== null && src === parsed.proxy) {
      try {
        current.contentWindow?.location.assign(parsed.proxy)
        return
      } catch { /* fall through to the attribute */ }
    }
    setSrc(parsed.proxy)
  }

  return (
    <div className="dshls-tab" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '4px 8px', fontSize: 12, opacity: 0.7 }}>只打开你信任的本机服务：被代理页面与 DSH 同源。</div>
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'flex', gap: 4, padding: '0 8px 4px' }}>
        <input
          data-dshls-address=""
          aria-label="本机服务地址"
          value={text}
          placeholder="127.0.0.1:5173"
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit">打开</button>
      </form>
      {error !== '' && <div role="alert" style={{ padding: '0 8px', color: '#c0392b' }}>{error}</div>}
      {external !== '' && (
        <div data-dshls-external="" style={{ padding: '0 8px' }}>
          外部链接：<a href={external} target="_blank" rel="noopener noreferrer">{external}</a>
          <button type="button" onClick={() => setExternal('')}>关闭</button>
        </div>
      )}
      {src !== undefined && (
        <iframe
          ref={frame}
          {...{ [FRAME_ATTR]: frameId }}
          src={src}
          title="本地服务"
          onLoad={onLoad}
          style={{ flex: 1, border: 0, width: '100%' }}
        />
      )}
    </div>
  )
}
