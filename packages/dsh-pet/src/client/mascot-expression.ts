/**
 * Mascot animation rendering policy.
 *
 * This module is deliberately the only place that decides WHEN an imported
 * animation is shown, mounted and played. It must not import the real player:
 * the browser entry injects it (see `client/player.ts`), so the overlay and
 * this module stay importable in jsdom, where lottie's UMD probes a canvas
 * context that does not exist and throws at module-evaluation time.
 *
 * Failure detection is event + timing based. lottie 5.13.0 does not throw from
 * `loadAnimation` for malformed content: config errors surface as an `error`
 * event, an item may report `isLoaded === true` before its DOM is built, and a
 * failed `<image>` still counts as loaded. So a one-shot `isLoaded` or "any
 * node exists" check would hide the glyph over a blank mascot — the exact bug
 * this module exists to prevent.
 */

import type { PetExpressionView } from '../wire.js'

/** One loaded animation, as the injected player exposes it. */
export interface MascotPlayerHandle {
  readonly play: () => void
  readonly pause: () => void
  /** Render the first frame and stay there (reduced-motion mode). */
  readonly stopFirstFrame: () => void
  readonly destroy: () => void
  /** Subscribe to lottie's `error` / `DOMLoaded` events. */
  readonly on: (event: 'error' | 'DOMLoaded', listener: () => void) => void
}

/** Browser-entry injected factory for the real (light) player. */
export type MascotPlayerLoader = (
  container: HTMLElement,
  animationData: unknown,
  autoplay: boolean,
) => MascotPlayerHandle

/** Ambient facts and scheduling hooks the animation needs. */
export interface MascotEnvironment {
  readonly reducedMotion: () => boolean
  readonly hidden: () => boolean
  /** Subscribe to reduced-motion / visibility changes. */
  readonly subscribe: (listener: () => void) => () => void
  /** Schedule the post-load drawable check (two frames in the browser). */
  readonly schedule: (callback: () => void) => void
  /** Whether the mounted player produced a real drawing node. */
  readonly isDrawable: (container: HTMLElement) => boolean
}

/** Nodes that actually paint; `g`/`defs`/`clipPath`/`mask` are containers. */
const DRAWABLE_SELECTOR = 'path,rect,circle,ellipse,line,polyline,polygon,image'

/**
 * Create the browser environment used in production.
 * @returns environment bound to the current document.
 */
export function createBrowserEnvironment(): MascotEnvironment {
  const media =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : undefined
  return {
    reducedMotion: () => media?.matches ?? false,
    hidden: () => typeof document !== 'undefined' && document.hidden === true,
    subscribe: listener => {
      const onVisibility = (): void => listener()
      document.addEventListener('visibilitychange', onVisibility)
      media?.addEventListener('change', listener)
      return () => {
        document.removeEventListener('visibilitychange', onVisibility)
        media?.removeEventListener('change', listener)
      }
    },
    schedule: callback => {
      // Two frames: lottie builds its DOM from the DOMLoaded handler, and the
      // first paint after that is when a blank result becomes observable.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          requestAnimationFrame(callback)
        })
        return
      }
      setTimeout(callback, 0)
    },
    isDrawable: container => {
      const svg = container.querySelector('svg')
      if (svg === null) return false
      return svg.querySelector(DRAWABLE_SELECTOR) !== null
    },
  }
}

/** Playback decision from the two independent pause conditions. */
export type MascotPlayback = 'play' | 'pause'

/**
 * Decide whether an animation may run.
 *
 * Hidden wins over reduced motion for the mechanic (pause vs first frame) but
 * both mean "do not play"; keeping this a pure function lets the caller
 * re-evaluate on every environment change without duplicating the rule.
 */
export function resolvePlayback(reducedMotion: boolean, hidden: boolean): MascotPlayback {
  return reducedMotion || hidden ? 'pause' : 'play'
}

/** Gate that remembers the last environment reading. */
export class PlaybackGate {
  private reducedMotion = false
  private hidden = false

  /**
   * Apply one environment reading.
   * @returns the playback decision after the update.
   */
  update(reducedMotion: boolean, hidden: boolean): MascotPlayback {
    this.reducedMotion = reducedMotion
    this.hidden = hidden
    return resolvePlayback(reducedMotion, hidden)
  }

  /** How to pause: reduced motion freezes the first frame, hidden just pauses. */
  pauseMode(): 'first-frame' | 'pause' {
    return this.reducedMotion ? 'first-frame' : 'pause'
  }
}

/**
 * Which face the mascot should render.
 * @param view - Current expression projection, if loaded.
 * @param renderFailed - Whether the last mount attempt was proven unusable.
 * @returns `'animation'` only for a usable source that has not failed.
 */
export function resolveMascotFace(
  view: PetExpressionView | undefined,
  renderFailed: boolean,
): 'animation' | 'glyph' {
  return view?.state === 'ok' && !renderFailed ? 'animation' : 'glyph'
}

/** Monotonic token source: only the newest read may commit. */
export interface LatestOnly {
  /** Begin a new read and return its token. */
  readonly begin: () => number
  /** Whether the given token is still the newest read. */
  readonly isCurrent: (token: number) => boolean
}

/** Create a latest-wins token source (late responses are ignored). */
export function createLatestOnly(): LatestOnly {
  let current = 0
  return {
    begin: () => {
      current += 1
      return current
    },
    isCurrent: token => token === current,
  }
}

/** Handle for a mounted mascot animation. */
export interface MascotAnimation {
  readonly destroy: () => void
  /**
   * Hover state for `hoverOnly` playback. Ignored in the default loop mode.
   * Present on every handle so the overlay can wire one listener unconditionally.
   */
  readonly setHover: (hovered: boolean) => void
}

/**
 * Mount one imported animation, applying playback policy and failure fallback.
 *
 * Synchronous validation failures (bad JSON, loader throw) call `onFailure`
 * before returning; asynchronous ones (player `error`, blank DOM after
 * `DOMLoaded`) call it later. The returned handle is always safe to destroy.
 * @param container - Element the player may fill.
 * @param content - Raw Lottie source from the Host.
 * @param options - Injected loader plus optional environment/diagnostic hooks.
 * @returns the animation handle.
 */
export function createMascotAnimation(
  container: HTMLElement,
  content: string,
  options: {
    readonly loader: MascotPlayerLoader
    readonly environment?: MascotEnvironment
    /**
     * Freeze on the first frame and play only while hovered.
     *
     * Default (absent/`false`) is the historical auto-loop behavior; the
     * setting is persisted as `appearance.animationPlayback`.
     */
    readonly hoverOnly?: boolean
    readonly onFailure?: (reason: string) => void
    readonly onReady?: () => void
  },
): MascotAnimation {
  const environment = options.environment ?? createBrowserEnvironment()
  const gate = new PlaybackGate()
  let disposed = false
  let handle: MascotPlayerHandle | undefined
  let unsubscribe: (() => void) | undefined

  const cleanup = (): void => {
    unsubscribe?.()
    unsubscribe = undefined
    try {
      handle?.destroy()
    } catch {
      // A player that already tore itself down must not mask the real reason.
    }
    handle = undefined
  }

  const fail = (reason: string): void => {
    if (disposed) return
    disposed = true
    cleanup()
    options.onFailure?.(reason)
  }

  let animationData: unknown
  try {
    animationData = JSON.parse(content)
  } catch {
    fail('动画内容不是合法 JSON')
    return { destroy: () => undefined, setHover: () => undefined }
  }
  if (typeof animationData !== 'object' || animationData === null) {
    fail('动画内容不是 JSON 对象')
    return { destroy: () => undefined, setHover: () => undefined }
  }

  const hoverOnly = options.hoverOnly === true
  let hovered = !hoverOnly

  /**
   * Apply the combined playback rule: reduced-motion > hidden > hover gate.
   *
   * Reduced motion wins over everything (freeze the first frame); hidden
   * pauses; in hover mode an un-hovered mascot freezes on the first frame.
   */
  const applyPlayback = (): void => {
    if (disposed) return
    const decision = gate.update(environment.reducedMotion(), environment.hidden())
    if (decision === 'play' && (!hoverOnly || hovered)) {
      loaded.play()
      return
    }
    if (decision === 'pause' && gate.pauseMode() === 'first-frame') {
      loaded.stopFirstFrame()
      return
    }
    if (hoverOnly && !hovered && !environment.hidden()) {
      loaded.stopFirstFrame()
      return
    }
    loaded.pause()
  }

  const initial = gate.update(environment.reducedMotion(), environment.hidden())
  const autoplay = initial === 'play' && (!hoverOnly || hovered)
  try {
    handle = options.loader(container, animationData, autoplay)
  } catch (error) {
    fail(`播放器加载失败：${error instanceof Error ? error.message : String(error)}`)
    return { destroy: () => undefined, setHover: () => undefined }
  }
  const loaded = handle

  // Static modes must render something rather than stay blank until the first
  // interaction.
  if (!autoplay) {
    try {
      loaded.stopFirstFrame()
    } catch {
      // A player that cannot seek is handled by the drawable check below.
    }
  }

  loaded.on('error', () => fail('播放器报告动画错误'))
  loaded.on('DOMLoaded', () => {
    environment.schedule(() => {
      if (disposed) return
      if (!environment.isDrawable(container)) {
        fail('渲染结果中没有可绘制内容')
        return
      }
      options.onReady?.()
    })
  })

  unsubscribe = environment.subscribe(applyPlayback)

  return {
    setHover: (next: boolean) => {
      if (disposed) return
      hovered = next
      if (hoverOnly) applyPlayback()
    },
    destroy: () => {
      if (disposed) return
      disposed = true
      cleanup()
    },
  }
}
