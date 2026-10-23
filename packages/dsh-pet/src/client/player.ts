/**
 * Real Lottie player, imported ONLY by the browser entry.
 *
 * Keeping the import here is a hard seam, not a style choice: the lottie UMD
 * probes a 2D canvas at module-evaluation time and throws in jsdom, which
 * would break every test that imports the overlay or the client entry. Tests
 * therefore never see this module (vitest aliases the import), while the
 * production bundle gets it statically.
 */

import lottie from 'lottie-web/build/player/lottie_light.min.js'
import type { MascotPlayerHandle, MascotPlayerLoader } from './mascot-expression.js'

/**
 * Create one looping SVG-rendered animation.
 *
 * `autoplay` is decided by the caller from reduced-motion and visibility, so
 * the player never starts a loop the environment forbids.
 */
export const loadLottiePlayer: MascotPlayerLoader = (
  container,
  animationData,
  autoplay,
): MascotPlayerHandle => {
  const animation = lottie.loadAnimation({
    container,
    renderer: 'svg',
    loop: true,
    autoplay,
    animationData,
  })
  return {
    play: () => animation.play(),
    pause: () => animation.pause(),
    stopFirstFrame: () => {
      animation.goToAndStop(0, true)
      // `goToAndStop` seeks and renders, but a player that was mid-loop when
      // the pointer left can still paint one queued frame. Force the sought
      // frame to be the last paint.
      const repaint = (animation as unknown as { renderFrame?: () => void }).renderFrame
      repaint?.call(animation)
    },
    destroy: () => animation.destroy(),
    on: (event, listener) => animation.addEventListener(event, listener),
  }
}
