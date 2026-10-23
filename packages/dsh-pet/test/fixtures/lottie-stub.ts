/**
 * Test double for the bundled Lottie player.
 *
 * `vitest.config.ts` aliases `lottie-web/build/player/lottie_light.min.js` to
 * this module. The real player's UMD probes a 2D canvas at module-evaluation
 * time and throws under jsdom, so tests that import the client entry (which
 * injects the real player) would fail during collection. The stub records
 * calls and lets a test install its own animation object.
 */

/** Minimal animation object the mascot renderer understands. */
export interface StubAnimation {
  isLoaded: boolean
  play: () => void
  pause: () => void
  goToAndStop: () => void
  destroy: () => void
  addEventListener: (event: string, listener: () => void) => void
}

/** Parameters the real player receives. */
export interface StubLoadParams {
  container: Element
  renderer?: string
  loop?: boolean
  autoplay?: boolean
  animationData?: unknown
}

type StubHandler = (params: StubLoadParams) => StubAnimation

let handler: StubHandler | undefined
const calls: StubLoadParams[] = []

/** Install a custom animation factory for the next load(s). */
export function setLottieStubHandler(next: StubHandler | undefined): void {
  handler = next
}

/** Every loadAnimation call observed since the module loaded. */
export function lottieStubCalls(): readonly StubLoadParams[] {
  return calls
}

/** Forget recorded calls (between tests). */
export function resetLottieStub(): void {
  handler = undefined
  calls.length = 0
}

const stub = {
  loadAnimation(params: StubLoadParams): StubAnimation {
    calls.push(params)
    if (handler !== undefined) return handler(params)
    return {
      isLoaded: true,
      play: () => undefined,
      pause: () => undefined,
      goToAndStop: () => undefined,
      destroy: () => undefined,
      addEventListener: () => undefined,
    }
  },
}

export default stub
