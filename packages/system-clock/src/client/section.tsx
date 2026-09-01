/**
 * React component for the System Clock settings section.
 *
 * Mounts a {@link ClockController} (skew engine) over the injected
 * `connection.rpc` face, and renders the latest frame as a live 24-hour
 * host clock: big time, date/day, timezone line and the host hostname —
 * or an explicit "unavailable" state when no sample could be fetched (never
 * the browser's own local time).
 *
 * All framework-free logic lives in `clock-engine.ts` (pure, tested); this
 * file only wires the controller to React state and paints the frame.
 *
 * @module dsh-system-clock/client/section
 */
import { useEffect, useRef, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { SystemClockSample } from '../contract.js'
import { SYSTEM_CLOCK_CHANNEL, SYSTEM_CLOCK_NOW_ENDPOINT } from '../contract.js'
import { createClockController, type ClockController, type ClockFrame } from './clock-engine.js'
import type { SystemClockKey } from './clock-locales.js'

/** The injected service face for the section slot (spread flat by the renderer). */
export interface SystemClockSectionInjected {
  /** Connection RPC caller for the `/dsh-system-clock` channel. */
  rpc: ClientConnectionRpc
  /** Section copy: a 'settings.systemClock' key. */
  t: (key: SystemClockKey, params?: Record<string, unknown>) => string
  /** Active locale id read at call time (for date/weekday rendering). */
  locale: () => string
}

/** Props delivered to the section component (the inject face, flat). */
export type SystemClockSectionProps = Partial<SystemClockSectionInjected>

/**
 * Call `/dsh-system-clock` `now` and unwrap the business sample.
 * @param rpc - Connection RPC caller.
 * @returns the host clock sample.
 * @throws on transport failure or a non-ok RpcResult.
 */
export async function fetchHostSample(rpc: ClientConnectionRpc): Promise<SystemClockSample> {
  let result: { ok?: boolean; value?: unknown; error?: { message?: string } }
  try {
    result = (await rpc.call(SYSTEM_CLOCK_CHANNEL, SYSTEM_CLOCK_NOW_ENDPOINT, {})) as typeof result
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
  if (!result.ok) {
    throw new Error(result.error?.message ?? 'unknown clock error')
  }
  return result.value as SystemClockSample
}

/**
 * The System Clock section: a live 24-hour host clock at the bottom of the
 * settings nav.
 * @param props - the inject face.
 * @returns the section body, or null while the face is absent.
 */
export function SystemClockSection(props: SystemClockSectionProps): JSX.Element | null {
  const { rpc, t, locale } = props
  const [frame, setFrame] = useState<ClockFrame | undefined>(undefined)
  const controllerRef = useRef<ClockController | undefined>(undefined)

  useEffect(() => {
    if (rpc === undefined || locale === undefined) return
    const controller = createClockController({
      fetch: () => fetchHostSample(rpc),
      now: () => Date.now(),
      locale: () => locale(),
      onFrame: setFrame,
    })
    controllerRef.current = controller
    controller.start()
    const onVisibility = (): void => {
      // Returning to the foreground is the one cheap, guaranteed resync point
      // for drift/DST correction; visibile-only to avoid spurious back-to-back
      // fetches when the tab is hidden for hours.
      if (document.visibilityState === 'visible') void controller.resync()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      controller.stop()
      controllerRef.current = undefined
    }
  }, [rpc, locale])

  // The inject face may be absent at first render (slot mount before inject).
  if (rpc === undefined || t === undefined || locale === undefined) return null

  const status = frame?.status ?? 'loading'
  const time = frame?.time ?? '--:--:--'
  const date = frame?.date ?? ''
  const tzLine =
    frame !== undefined && frame.zone.length > 0
      ? `${frame.zone} (${frame.offsetLabel})`
      : frame?.offsetLabel ?? ''
  const caption = frame !== undefined ? `${t('caption')} · ${frame.hostname}` : ''

  return (
    <div className="dshsc-root">
      <div className="dshsc-time">{time}</div>
      <div className="dshsc-date">{date}</div>
      <div className="dshsc-tz">{tzLine}</div>
      <div className="dshsc-caption">{caption}</div>
      {status === 'unavailable' && (
        <div className="dshsc-unavailable" role="status">
          <div>{t('unavailable')}</div>
          <div className="dshsc-unavailable-detail">{t('unavailableDetail')}</div>
        </div>
      )}
    </div>
  )
}
