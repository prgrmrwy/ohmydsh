/**
 * Egress Guard settings section.
 *
 * Shows the sanitized host verdict (verdict, country, source service,
 * degradation) and edits the local configuration (blocked countries + Geo
 * endpoints). The page only ever talks to the host over the loopback RPC —
 * it never performs its own network lookups, and the response never contains
 * the raw IP.
 *
 * @module dsh-home-network-model-guard/client/settings
 */
import { useEffect, useRef, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { GUARD_CHANNEL, GUARD_SET_CONFIG_ENDPOINT, GUARD_STATUS_ENDPOINT, type GuardStatus } from '../contract.js'
import type { GuardKey } from './locales.js'

/** The injected service face for the section slot (spread flat by the renderer). */
export interface GuardSettingsInjected {
  /** Connection RPC caller for the guard channel. */
  rpc: ClientConnectionRpc
  /** Section copy under the guard namespace. */
  t: (key: GuardKey) => string
}

/** Props delivered to the section component (the inject face, flat). */
export type GuardSettingsProps = Partial<GuardSettingsInjected>

async function fetchStatus(rpc: ClientConnectionRpc): Promise<GuardStatus | null> {
  let result: { ok?: boolean; value?: GuardStatus; error?: { message?: string } }
  try {
    result = (await rpc.call(GUARD_CHANNEL, GUARD_STATUS_ENDPOINT, {})) as typeof result
  } catch {
    return null
  }
  if (result.ok !== true || result.value === undefined) return null
  return result.value
}

/**
 * The Egress Guard settings page: verdict card + configuration editor.
 * @param props - the inject face.
 * @returns the page body, or null while the face is absent.
 */
export function GuardSettingsSection(props: GuardSettingsProps): JSX.Element | null {
  const { rpc, t } = props
  const [status, setStatus] = useState<GuardStatus | null>(null)
  const [blockedText, setBlockedText] = useState('')
  const [endpointsText, setEndpointsText] = useState('')
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const busy = useRef(false)

  const refresh = (): void => {
    if (rpc === undefined) return
    void fetchStatus(rpc).then((next) => {
      setStatus(next)
      if (next !== null) {
        setBlockedText(next.config.blockedCountries.join(', '))
        setEndpointsText(next.config.geoEndpoints.join(', '))
      }
    })
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc])

  if (rpc === undefined || t === undefined) return null

  const save = (): void => {
    if (busy.current) return
    busy.current = true
    setNotice(null)
    const blockedCountries = blockedText.split(',').map((s) => s.trim().toUpperCase()).filter((s) => s !== '')
    const geoEndpoints = endpointsText.split(',').map((s) => s.trim()).filter((s) => s !== '')
    void rpc.call(GUARD_CHANNEL, GUARD_SET_CONFIG_ENDPOINT, { blockedCountries, geoEndpoints })
      .then((result) => {
        const ok = (result as { ok?: boolean })?.ok === true
        if (ok) {
          setNotice({ kind: 'ok', text: t('saved') })
          refresh()
        } else {
          setNotice({ kind: 'error', text: `${t('saveFailed')} ${(result as { error?: { message?: string } })?.error?.message ?? ''}` })
        }
      })
      .catch((error: unknown) => {
        setNotice({ kind: 'error', text: `${t('saveFailed')} ${error instanceof Error ? error.message : String(error)}` })
      })
      .finally(() => {
        busy.current = false
      })
  }

  const verdictLabel = status?.verdict ?? '…'
  return (
    <div className="dshg-root">
      <h3 className="dshg-group-title">{t('statusTitle')}</h3>
      <dl className="dshg-status">
        <div><dt>{t('verdict')}</dt><dd className={`dshg-verdict-${verdictLabel}`}>{verdictLabel}</dd></div>
        {status?.country !== undefined && <div><dt>{t('country')}</dt><dd>{status.country}</dd></div>}
        {status?.source !== undefined && <div><dt>{t('source')}</dt><dd>{status.source}</dd></div>}
        {status?.degraded === true && <div><dt>{t('degraded')}</dt><dd>{status.degradedReason ?? 'true'}</dd></div>}
      </dl>
      <button type="button" className="dshg-action" onClick={refresh}>{t('refresh')}</button>

      <h3 className="dshg-group-title">{t('configTitle')}</h3>
      <label className="dshg-field">
        {t('blockedLabel')}
        <input className="dshg-input" value={blockedText} onChange={(event) => setBlockedText(event.target.value)} />
      </label>
      <label className="dshg-field">
        {t('endpointsLabel')}
        <input className="dshg-input" value={endpointsText} onChange={(event) => setEndpointsText(event.target.value)} />
      </label>
      <button type="button" className={`dshg-action${busy.current ? ' dshg-busy' : ''}`} onClick={save}>{t('save')}</button>
      {notice !== null && (
        <p className={`dshg-notice dshg-notice-${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}
    </div>
  )
}