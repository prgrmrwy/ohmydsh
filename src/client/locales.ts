/**
 * Copy dictionaries for the「本地服务」tab. `apply()` registers them in the `settings`-style locale
 * namespace and binds the host translator; before that (jsdom tests, an embedding without a locale
 * service) `t()` falls back to the Chinese set — the wording the spec fixes. Placeholders use `{name}`.
 */
export const NS = 'sidebar.localServiceBrowser'

export const zh = {
  tabTitle: '本地服务',
  back: '返回',
  home: '首页',
  refresh: '刷新',
  open: '打开',
  close: '关闭',
  hostBadge: 'Host 上的本机地址',
  addressLabel: '本机服务地址',
  addressPlaceholder: '输入 Host 上的地址，例如 127.0.0.1:5173',
  trustNote: '页面和 DSH 同源：只打开你信任的服务。',
  externalNotice: '页面想打开外部链接 {host}',
  openInNewWindow: '在新窗口打开',
  frameTitle: '本地服务',
  homeTitle: '在 Host 上打开一个本机服务',
  homeIntro: '这里的 127.0.0.1 指运行 DSH 的那台机器，不是你面前这台。',
  searching: '正在查找…',
  noServices: 'Host 上没有发现网页服务',
  errLocalOnly: '仅支持本机地址',
  errUserinfo: '地址不能包含用户信息',
  errPortInvalid: '端口无效',
  errPortRequired: '需要写明端口',
  errScheme: '仅支持 http 地址',
  errChars: '地址包含非法字符',
  errNoRestore: '无法恢复该历史记录',
  errBlocked: '页面阻止了注入脚本',
  errUncontrolled: '页面未受 Service Worker 控制',
  errIdentityTable: '身份表不可用：{reason}',
  titleNotHtml: '这个地址返回的不是网页',
  notHtmlDetail: '{where}返回了 {type}{status}。本地服务只能显示网页，换一个页面地址试试。',
  notHtmlStatus: '，状态 {status}',
  errNoServiceWorker: '当前浏览器不支持 Service Worker',
  errNoNavigation: '当前浏览器不支持 Navigation API',
  errSwRegister: 'Service Worker 注册失败：{reason}',
  errSwTimeout: 'Service Worker 未在 5 秒内注册并激活',
} as const

export type LocaleKey = keyof typeof zh

export const en: Record<LocaleKey, string> = {
  tabTitle: 'Local services',
  back: 'Back',
  home: 'Home',
  refresh: 'Refresh',
  open: 'Open',
  close: 'Close',
  hostBadge: 'Local address on the Host',
  addressLabel: 'Local service address',
  addressPlaceholder: 'Enter a Host address, e.g. 127.0.0.1:5173',
  trustNote: 'The page shares DSH’s origin: only open services you trust.',
  externalNotice: 'The page wants to open an external link: {host}',
  openInNewWindow: 'Open in a new window',
  frameTitle: 'Local service',
  homeTitle: 'Open a local service on the Host',
  homeIntro: '127.0.0.1 here means the machine DSH runs on, not the one in front of you.',
  searching: 'Looking…',
  noServices: 'No web services found on the Host',
  errLocalOnly: 'Only local addresses are supported',
  errUserinfo: 'The address cannot contain user info',
  errPortInvalid: 'Invalid port',
  errPortRequired: 'A port is required',
  errScheme: 'Only http addresses are supported',
  errChars: 'The address contains invalid characters',
  errNoRestore: 'Cannot restore this history entry',
  errBlocked: 'The page blocked the injected script',
  errUncontrolled: 'The page is not controlled by the Service Worker',
  errIdentityTable: 'Identity table unavailable: {reason}',
  titleNotHtml: 'This address did not return a web page',
  notHtmlDetail: '{where}returned {type}{status}. Local services can only show web pages; try a page address.',
  notHtmlStatus: ', status {status}',
  errNoServiceWorker: 'This browser does not support Service Worker',
  errNoNavigation: 'This browser does not support the Navigation API',
  errSwRegister: 'Service Worker registration failed: {reason}',
  errSwTimeout: 'The Service Worker did not register and activate within 5 seconds',
}

type Params = Record<string, string | number>
type Translator = (key: LocaleKey) => string
let bound: Translator | undefined

/** Bind the host translator (client entry `apply`). */
export function bindLocale(translator: Translator): void {
  bound = translator
}
/** Drop the bound translator: fall back to the Chinese set. */
export function resetLocale(): void {
  bound = undefined
}

/** Translate one key; `{name}` placeholders are interpolated here so both paths behave alike. */
export function t(key: LocaleKey, params?: Params): string {
  const template = bound === undefined ? zh[key] : bound(key)
  return params === undefined ? template : template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}
