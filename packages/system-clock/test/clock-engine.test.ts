import { describe, expect, it } from 'vitest'
import type { SystemClockSample } from '../src/contract.js'
import {
  createClockController,
  deriveFrame,
  formatDate,
  formatOffsetLabel,
  formatTime,
  type ClockFrame,
} from '../src/client/clock-engine.js'

/** A fixed Shanghai-like sample with known facts. */
const SAMPLE: SystemClockSample = {
  now: 1_752_494_400_000, // 2025-07-14T08:00:00Z (a Monday in PDT, 16:00 in Shanghai)
  timeZone: 'Asia/Shanghai',
  utcOffsetMinutes: -480, // getTimezoneOffset convention: east of UTC is negative
  hostname: 'devbox',
}

describe('clock-engine formatters', () => {
  it('formats the UTC offset as UTC±HH:MM (getTimezoneOffset convention)', () => {
    // Shanghai: -480 minutes → east → UTC+08:00
    expect(formatOffsetLabel(-480)).toBe('UTC+08:00')
    // New York in DST: +240 minutes → west → UTC-04:00
    expect(formatOffsetLabel(240)).toBe('UTC-04:00')
    // UTC itself
    expect(formatOffsetLabel(0)).toBe('UTC+00:00')
    // Irregular offsets keep both fields padded
    expect(formatOffsetLabel(-345)).toBe('UTC+05:45')
  })

  it('renders 24-hour time with zero padding and no AM/PM', () => {
    // 2025-07-14T16:05:09Z is 00:05:09 in Shanghai (+8) the next day
    const t = formatTime(
      Date.UTC(2025, 6, 14, 16, 5, 9),
      'en-GB',
      'Asia/Shanghai',
    )
    expect(t).toBe('00:05:09')
    expect(t).not.toMatch(/PM|AM/)
  })

  it('renders afternoon hours in 24h form', () => {
    expect(formatTime(Date.UTC(2025, 6, 14, 6, 5, 9), 'en-GB', 'Asia/Shanghai')).toBe('14:05:09')
  })

  it('assembles a stable YYYY-MM-DD weekday date', () => {
    // 2025-07-14T08:00:00Z → 2025-07-14 16:00 Shanghai (a Monday)
    expect(formatDate(Date.UTC(2025, 6, 14, 8, 0, 0), 'zh-CN', 'Asia/Shanghai')).toBe(
      '2025-07-14 周一',
    )
    expect(formatDate(Date.UTC(2025, 6, 14, 8, 0, 0), 'en-GB', 'Asia/Shanghai')).toBe(
      '2025-07-14 Mon',
    )
  })

  it('falls back to UTC rendering when the host zone is missing', () => {
    // Shanghai sample shift: east +480 min applied on 08:00Z → 16:00 same day
    expect(formatTime(Date.UTC(2025, 6, 14, 8, 0, 0), 'en-GB', '')).toBe('08:00:00')
  })
})

describe('deriveFrame', () => {
  it('renders a ready frame from a sample at a given instant', () => {
    const frame = deriveFrame({ sample: SAMPLE, skew: 0 }, 1_752_494_400_000, 'zh-CN')
    expect(frame.status).toBe('ready')
    expect(frame.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(frame.zone).toBe('Asia/Shanghai')
    expect(frame.offsetLabel).toBe('UTC+08:00')
    expect(frame.hostname).toBe('devbox')
  })

  it('reports unavailable with no sample (never browser time)', () => {
    const frame = deriveFrame({ sample: undefined, skew: 0 }, 0, 'zh-CN')
    expect(frame.status).toBe('unavailable')
    expect(frame.time).toBe('--:--:--')
  })
})

describe('createClockController', () => {
  const collect = (): { frames: ClockFrame[] } => {
    const bag = { frames: [] as ClockFrame[] }
    return bag
  }

  it('fetches once, computes skew, and emits ready frames', async () => {
    const bag = collect()
    let browserNow = 1_752_494_400_000
    const controller = createClockController({
      fetch: async () => ({ ...SAMPLE }),
      now: () => browserNow,
      locale: () => 'en-GB',
      onFrame: (frame) => bag.frames.push(frame),
    })
    await controller.resync()
    const frame = controller.getFrame()
    expect(frame?.status).toBe('ready')
    expect(frame?.hostname).toBe('devbox')
    // skew = sample.now - browserNow = 0; next tick re-derives unchanged
    controller.tick()
    expect(bag.frames.length).toBe(2)
    expect(controller.getFrame()?.time).toBe(frame?.time)
    controller.stop()
  })

  it('keeps the last sample across a failed resync and still ticks', async () => {
    const bag = collect()
    let calls = 0
    const controller = createClockController({
      fetch: async () => {
        calls += 1
        if (calls === 1) return { ...SAMPLE }
        throw new Error('offline')
      },
      now: () => 1_752_494_400_000,
      locale: () => 'en-GB',
      onFrame: (frame) => bag.frames.push(frame),
    })
    await controller.resync() // success
    await controller.resync() // failure keeps old sample
    const frame = controller.getFrame()
    expect(frame?.status).toBe('ready')
    expect(frame?.hostname).toBe('devbox')
    controller.stop()
  })

  it('moves to unavailable and counts retries while no sample exists', async () => {
    const bag = collect()
    let calls = 0
    const controller = createClockController({
      fetch: async () => {
        calls += 1
        if (calls <= 2) throw new Error('unreachable')
        return { ...SAMPLE }
      },
      now: () => 1_752_494_400_000,
      locale: () => 'zh-CN',
      onFrame: (frame) => bag.frames.push(frame),
    })
    await controller.resync()
    expect(controller.getFrame()?.status).toBe('unavailable')
    expect(controller.getFrame()?.unavailableCount).toBe(1)
    await controller.resync()
    expect(controller.getFrame()?.unavailableCount).toBe(2)
    await controller.resync()
    expect(controller.getFrame()?.status).toBe('ready')
    expect(controller.getFrame()?.unavailableCount).toBe(0)
    controller.stop()
  })

  it('start/stop wires real intervals without double-starting', async () => {
    const bag = collect()
    const controller = createClockController({
      fetch: async () => ({ ...SAMPLE }),
      now: () => 1_752_494_400_000,
      locale: () => 'en-GB',
      onFrame: (frame) => bag.frames.push(frame),
    })
    controller.start()
    controller.start() // no-op
    await Promise.resolve()
    controller.stop()
    controller.stop() // idempotent
  })
})
