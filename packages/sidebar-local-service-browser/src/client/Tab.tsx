/**
 * The「本地服务」tab: address bar + the proxied iframe (design D1, D7, D11).
 *
 * The iframe's page talks back with `dshls:*` postMessages (contract.ts). The tab also repairs
 * cross-document history traversals: the browser first asks DSH for the bare path, the tab sees an
 * un-injected document in its `load` handler and replaces it by the proxy path the identity table names.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ENTRIES_KEY_PREFIX, FRAME_ATTR, INJECT_MARKER, PROXY_PATH_RE, SERVICES_ROUTE, isInjectMessage, proxyPath } from '../contract.js'
import type { NavigationLike } from '../inject/types.js'
import { isEntryIdentity } from '../inject/identity.js'
import { directAddress, parseAddress } from './address.js'
import { STYLE_ATTR, TAB_CSS } from './styles.js'
import { browserPlatform, type TabPlatform } from './platform.js'

export type { TabPlatform } from './platform.js'

export interface TabProps {
  platform?: TabPlatform
  /** Random id written on the iframe's `data-dshls`; defaults to a fresh one. */
  frameId?: string
}

/** A panel shown in place of the page: what happened, and (optionally) what to do. */
interface Notice {
  title: string
  detail?: string
}
type Visit = { fam: string; port: string; rest: string }

function ensureStyle(): void {
  if (document.querySelector(`style[${STYLE_ATTR}]`) !== null) return
  const style = document.createElement('style')
  style.setAttribute(STYLE_ATTR, '')
  style.textContent = TAB_CSS
  document.head.appendChild(style)
}

const svgProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const BackIcon = () => <svg {...svgProps}><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
const HostIcon = () => <svg {...svgProps}><rect x="2" y="3" width="12" height="4.2" rx="1" /><rect x="2" y="8.8" width="12" height="4.2" rx="1" /><path d="M4.5 5.1h.01M4.5 10.9h.01" /></svg>
const EnterIcon = () => <svg {...svgProps}><path d="M12.5 3.5v4a1 1 0 0 1-1 1h-8M6 5.5 3.5 8.5 6 11" /></svg>
const CloseIcon = () => <svg {...svgProps}><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>

const HomeIcon = () => <svg {...svgProps}><path d="M2.5 7.5 8 3l5.5 4.5M4 6.8V13h8V6.8" /></svg>
const RefreshIcon = () => <svg {...svgProps}><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" /></svg>

interface HostService {
  fam: 'p' | 'p6'
  port: number
  process: string | null
}
type Services = { state: 'loading' } | { state: 'done'; items: HostService[] }

const EXAMPLES = ['127.0.0.1:5173', 'localhost:3000', '127.0.0.1:8080']

const newFrameId = (): string => `f${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`

export const ERR_NO_RESTORE = '无法恢复该历史记录'
export const ERR_BLOCKED = '页面阻止了注入脚本'
export const TITLE_NOT_HTML = '这个地址返回的不是网页'
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
  const [notice, setNotice] = useState<Notice | null>(null)
  const [external, setExternal] = useState('')
  const [src, setSrc] = useState<string | undefined>(undefined)
  const [depth, setDepth] = useState(0)
  const [services, setServices] = useState<Services>({ state: 'loading' })
  const servicesRun = useRef(0)
  const ready = useRef<Promise<string | undefined> | undefined>(undefined)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const uncontrolledSeen = useRef(0)
  const reportedUncontrolled = useRef(false)
  // Visit stack behind the back button (spec: 访问栈 + location.replace + "返回中" 标志).
  const stack = useRef<Visit[]>([])
  const returning = useRef(false)

  /** Ask the Host which web services listen on it; any failure reads as "none found". */
  const loadServices = useCallback((): void => {
    const run = ++servicesRun.current
    setServices({ state: 'loading' })
    void (async () => {
      let items: HostService[] = []
      try {
        const res = await fetch(SERVICES_ROUTE, { credentials: 'same-origin', cache: 'no-store' })
        const data: unknown = res.ok ? await res.json() : []
        if (Array.isArray(data)) {
          items = data.filter((x): x is HostService => typeof x === 'object' && x !== null
            && ((x as HostService).fam === 'p' || (x as HostService).fam === 'p6') && Number.isInteger((x as HostService).port))
        }
      } catch { /* unreachable endpoint: show the empty state */ }
      if (run === servicesRun.current) setServices({ state: 'done', items })
    })()
  }, [])

  const syncDepth = (): void => setDepth(stack.current.length)

  const blank = useCallback((message: string | Notice): void => {
    returning.current = false
    setError('')
    setNotice(typeof message === 'string' ? { title: message } : message)
    setSrc('about:blank')
    const win = frame.current?.contentWindow
    try {
      win?.location.replace('about:blank')
    } catch { /* cross-origin document: the src change below still navigates */ }
  }, [])

  // Mount: styles, sweep dead frames' tables and stale per-port Service Workers; unmount: drop only our own table.
  useEffect(() => {
    ensureStyle()
    loadServices()
    sweepStaleTables()
    void platform.cleanupStaleRegistrations().catch(() => undefined)
    return () => {
      try {
        window.sessionStorage.removeItem(`${ENTRIES_KEY_PREFIX}${frameId}`)
      } catch { /* ignore */ }
    }
  }, [platform, frameId, loadServices])

  // Messages from the injected script (same origin, from our iframe only).
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const win = frame.current?.contentWindow
      if (win === null || win === undefined || event.source !== win || event.origin !== location.origin) return
      const data: unknown = event.data
      if (!isInjectMessage(data)) return
      switch (data.type) {
        case 'dshls:installed':
        case 'dshls:location': {
          uncontrolledSeen.current = 0
          reportedUncontrolled.current = false
          setError('')
          setNotice(null)
          setText(directAddress(data.fam, data.port, data.rest))
          const visit: Visit = { fam: data.fam, port: data.port, rest: data.rest }
          const top = stack.current[stack.current.length - 1]
          if (data.type === 'dshls:installed' && returning.current) {
            // The page we went back to may have been redirected elsewhere: record where we really are.
            returning.current = false
            if (top === undefined) stack.current.push(visit)
            else stack.current[stack.current.length - 1] = visit
          } else if (top === undefined || top.fam !== visit.fam || top.port !== visit.port || top.rest !== visit.rest) {
            stack.current.push(visit)
          }
          syncDepth()
          break
        }
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

  /** What to say about a proxied document that carries no injection marker. */
  const describeUninjected = (win: Window, pathname: string): string | Notice => {
    let contentType = 'text/html'
    try {
      contentType = win.document.contentType
    } catch { /* unreadable: treat as a page the injection was blocked on */ }
    if (contentType === 'text/html') return ERR_BLOCKED
    let status = 0
    try {
      const first = win.performance.getEntriesByType('navigation')[0] as { responseStatus?: unknown } | undefined
      const value = first?.responseStatus
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) status = value
    } catch { /* no navigation entry */ }
    const m = PROXY_PATH_RE.exec(pathname)
    const where = m === null ? '' : directAddress(m[1] === 'p6' ? 'p6' : 'p', m[2] as string, (m[3] ?? '') === '' ? '/' : (m[3] as string)).replace(/^http:\/\//, '')
    return {
      title: TITLE_NOT_HTML,
      detail: `${where === '' ? '' : `${where} `}返回了 ${contentType}${status > 0 ? `，状态 ${String(status)}` : ''}。本地服务只能显示网页，换一个页面地址试试。`,
    }
  }

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
      blank(describeUninjected(win, pathname))
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

  const open = async (input: string): Promise<void> => {
    const parsed = parseAddress(input)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    // The Navigation API check must be re-evaluated per attempt (it can disappear/appear); the SW part is cached.
    if (!platform.hasNavigation()) {
      setError('')
      setNotice({ title: '当前浏览器不支持 Navigation API' })
      return
    }
    const failure = await preflight()
    if (failure !== undefined) {
      setError('')
      setNotice({ title: failure })
      return
    }
    setError('')
    setNotice(null)
    setExternal('')
    uncontrolledSeen.current = 0
    reportedUncontrolled.current = false
    stack.current = []
    returning.current = false
    syncDepth()
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

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void open(text)
  }

  const goBack = (): void => {
    if (stack.current.length < 2) return
    stack.current.pop()
    const target = stack.current[stack.current.length - 1] as Visit
    returning.current = true
    syncDepth()
    try {
      frame.current?.contentWindow?.location.replace(proxyPath(target.fam as 'p' | 'p6', target.port, target.rest))
    } catch {
      returning.current = false
    }
  }

  const goHome = (): void => {
    stack.current = []
    returning.current = false
    uncontrolledSeen.current = 0
    reportedUncontrolled.current = false
    syncDepth()
    setText('')
    setError('')
    setNotice(null)
    setExternal('')
    setSrc(undefined)
    loadServices()
  }

  const externalHost = ((): string => {
    try {
      return new URL(external).host
    } catch {
      return external
    }
  })()

  return (
    <div className="dshls-tab" data-dshls-history-depth={depth}>
      <div className="dshls-toolbar">
        <button type="button" className="dshls-icon-btn dshls-back" aria-label="返回" title="返回" disabled={depth < 2} onClick={goBack}>
          <BackIcon />
        </button>
        <button type="button" className="dshls-icon-btn dshls-back" aria-label="首页" title="首页" onClick={goHome}>
          <HomeIcon />
        </button>
        <form className="dshls-route" onSubmit={onSubmit}>
          <span className="dshls-host" aria-label="Host 上的本机地址" title="Host 上的本机地址">
            <HostIcon />
            <span className="dshls-host-text">Host</span>
          </span>
          <span className="dshls-sep" aria-hidden="true" />
          <input
            className="dshls-address"
            data-dshls-address=""
            aria-label="本机服务地址"
            value={text}
            placeholder="127.0.0.1:5173"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="dshls-icon-btn dshls-open" aria-label="打开" title="打开">
            <EnterIcon />
          </button>
        </form>
      </div>
      <div className="dshls-note">页面和 DSH 同源：只打开你信任的服务。</div>
      {error !== '' && <div role="alert" className="dshls-inline-error">{error}</div>}
      {external !== '' && (
        <div className="dshls-external" data-dshls-external="">
          <span>页面想打开外部链接 {externalHost}</span>
          <a href={external} target="_blank" rel="noopener noreferrer">在新窗口打开</a>
          <button type="button" className="dshls-icon-btn dshls-close" aria-label="关闭" title="关闭" onClick={() => setExternal('')}>
            <CloseIcon />
          </button>
        </div>
      )}
      <div className="dshls-body">
        {src !== undefined && (
          <iframe
            ref={frame}
            {...{ [FRAME_ATTR]: frameId }}
            className="dshls-frame"
            hidden={notice !== null}
            src={src}
            title="本地服务"
            onLoad={onLoad}
          />
        )}
        {notice !== null && (
          <div className="dshls-panel" role="alert">
            <h2>{notice.title}</h2>
            {notice.detail !== undefined && <p>{notice.detail}</p>}
          </div>
        )}
        {notice === null && src === undefined && (
          <div className="dshls-panel">
            <h2>在 Host 上打开一个本机服务</h2>
            <p>这里的 127.0.0.1 指运行 DSH 的那台机器，不是你面前这台。</p>
            {services.state === 'loading' && <p>正在查找…</p>}
            {services.state === 'done' && services.items.length > 0 && (
              <ul className="dshls-services">
                {services.items.map((svc) => {
                  const target = `${svc.fam === 'p6' ? '[::1]' : '127.0.0.1'}:${String(svc.port)}/`
                  return (
                    <li key={`${svc.fam}:${String(svc.port)}`}>
                      <button type="button" className="dshls-service" data-dshls-service="" onClick={() => { setText(target); void open(target) }}>
                        <span className="dshls-service-port">{svc.fam === 'p6' ? '[::1]' : ''}{String(svc.port)}</span>
                        {svc.process !== null && <span className="dshls-service-proc">{svc.process}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {services.state === 'done' && services.items.length === 0 && <p>Host 上没有发现网页服务</p>}
            {services.state === 'done' && services.items.length === 0 && (
              <div className="dshls-examples">
                <span>试试</span>
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" className="dshls-example" onClick={() => { setText(example); void open(example) }}>{example}</button>
                ))}
              </div>
            )}
            <button type="button" className="dshls-refresh" aria-label="刷新" onClick={loadServices} disabled={services.state === 'loading'}>
              <RefreshIcon /><span>刷新</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
