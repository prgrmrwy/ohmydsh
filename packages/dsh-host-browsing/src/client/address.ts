/**
 * Address bar parsing (spec "地址栏输入解析与显示"). The port is read from the RAW text: it never
 * goes through WHATWG URL parsing, which would fold default ports (`:80`) away.
 */
import { proxyPath, type Family } from '../contract.js'
import { t } from './locales.js'

export interface ParsedAddress {
  ok: true
  fam: Family
  port: string
  /** pathname + search + hash, starts with '/'. */
  rest: string
  /** Direct address shown in the address bar. */
  direct: string
  /** Proxy URL for the iframe. */
  proxy: string
}
export interface AddressError {
  ok: false
  error: string
}


/** Direct address for a target. */
export function directAddress(fam: Family, port: string, rest: string): string {
  return `http://${fam === 'p6' ? '[::1]' : '127.0.0.1'}:${port}${rest}`
}

export function parseAddress(input: string): ParsedAddress | AddressError {
  const text = input.trim()
  // eslint-disable-next-line no-control-regex
  if (text === '' || /[\u0000-\u001f\u007f\\\s]/.test(text)) return { ok: false, error: t('errChars') }
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(text)
  let afterScheme = text
  if (scheme !== null) {
    if (scheme[1]!.toLowerCase() !== 'http') return { ok: false, error: t('errScheme') }
    afterScheme = text.slice(scheme[0].length)
  }
  const cut = afterScheme.search(/[/?#]/)
  const authority = cut === -1 ? afterScheme : afterScheme.slice(0, cut)
  const tail = cut === -1 ? '' : afterScheme.slice(cut)
  if (authority.includes('@')) return { ok: false, error: t('errUserinfo') }

  let host: string
  let portText: string | undefined
  if (authority.startsWith('[')) {
    const m = /^(\[[^\]]*\])(?::(.*))?$/.exec(authority)
    if (m === null) return { ok: false, error: t('errLocalOnly') }
    host = m[1]!.toLowerCase()
    portText = m[2]
  } else {
    const i = authority.lastIndexOf(':')
    host = (i === -1 ? authority : authority.slice(0, i)).toLowerCase()
    portText = i === -1 ? undefined : authority.slice(i + 1)
  }
  let fam: Family
  if (host === '127.0.0.1' || host === 'localhost') fam = 'p'
  else if (host === '[::1]') fam = 'p6'
  else return { ok: false, error: t('errLocalOnly') }
  if (portText === undefined || portText === '') return { ok: false, error: t('errPortRequired') }
  if (!/^\d+$/.test(portText)) return { ok: false, error: t('errPortInvalid') }
  const n = Number(portText)
  if (!Number.isSafeInteger(n) || n < 1 || n > 65535) return { ok: false, error: t('errPortInvalid') }
  const port = String(n)
  const rest = tail === '' ? '/' : tail.startsWith('/') ? tail : `/${tail}`
  return { ok: true, fam, port, rest, direct: directAddress(fam, port, rest), proxy: proxyPath(fam, port, rest) }
}
