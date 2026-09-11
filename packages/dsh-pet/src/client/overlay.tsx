/**
 * The floating Pet surface.
 *
 * Renders only the mascot, the capability menu, the pre-execution source chip
 * and a compact Task panel. The `shell.overlay` layer is click-through; this
 * component opts back into pointer events for its own surface only, so it
 * never blocks the app underneath.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { PetApiError, petApi } from './api.js'
import {
  fitLabel,
  hoverRadius,
  planRings,
  planSlots,
  RING_GAP,
  RING_WIDTH,
  WHEEL_CAPACITY,
} from './wheel.js'
import {
  DEFAULT_RING_STYLE,
  PET_RING_STYLES,
  hoverFill,
  ringFill,
  type PetRingStyleId,
  DEFAULT_GLYPH,
  DEFAULT_SIZE_PX,
  PET_ACCENT_EVENT,
  PET_APPEARANCE_EVENT,
  PET_SKILLS_EVENT,
  PET_SIZES,
  resolveAccent,
} from './accent.js'
import {
  clampPosition,
  readPosition,
  writePosition,
  type PetPosition,
} from './position.js'
import { QA_GROUP_ACTION_ID, type PetCapability, type PetSourceKind } from '../wire.js'

/** Current browser source selection, captured atomically on invoke. */
export interface SourceSelection {
  readonly kind: PetSourceKind
  readonly sessionId?: string
  readonly workspaceId?: string
  readonly title?: string
}

/** Live DSH facts the overlay reads from the client runtime. */
export interface PetOverlayProps {
  /** The browser's current session/workspace, or `undefined` on a Hero page. */
  readonly currentSource: SourceSelection | undefined
  /** Opens a native DSH session; used by "open full process". */
  readonly openSession?: (sessionId: string) => void
}

type Mode = 'closed' | 'menu' | 'panel'

/**
 * Per-browser flag remembering that the user dismissed the channel hint.
 *
 * `localStorage`, like the mascot's position: this is display state for one
 * browser, not configuration. Losing it merely shows the hint again.
 */
const CHANNEL_HINT_DISMISSED_KEY = 'dshpet.channelHintDismissed'

/**
 * How long a success receipt stays on screen.
 *
 * Long enough to read a sentence, short enough that it never becomes part of
 * the furniture: the note is absolutely positioned and would otherwise cover
 * whatever sits beneath the wheel for the rest of the session.
 */
const NOTICE_DISMISS_MS = 6000

/**
 * Render a position as Pet's `transform` value.
 *
 * One helper for both writers — React's render and the drag's direct DOM
 * write — so the two can never disagree on the format; the commit at the end
 * of a drag produces the identical string React then renders, which is what
 * makes the handover invisible.
 *
 * `translate3d`, not `translate`: the third axis is the conventional hint that
 * puts the element on its own compositor layer. `will-change:transform` is
 * deliberately NOT used — Pet is a permanent overlay, so a standing hint would
 * hold a layer for the entire session to speed up an occasional drag.
 *
 * Rounded because a fractional offset makes the mascot's emoji glyph render
 * blurry. Inputs are integer pointer deltas today, so this only guards against
 * a fractional viewport or size arriving from elsewhere.
 * @param position - Viewport position in CSS pixels.
 * @returns the `transform` value to apply.
 */
function translateFor(position: PetPosition): string {
  return `translate3d(${Math.round(position.x)}px, ${Math.round(position.y)}px, 0)`
}

/**
 * The Pet overlay surface.
 * @param props - Live DSH facts and navigation callbacks.
 * @returns the rendered overlay.
 */
export function PetOverlay(props: PetOverlayProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)

  // NOTE: Pet deliberately stays inside the `shell.overlay` layer instead of
  // re-parenting itself to `document.body`. React 18 delegates events at the
  // mount container, so a node moved out of that container silently stops
  // receiving every synthetic handler — hover, drag and click all die while
  // the element still renders. The layer is `position:absolute; inset:0` over
  // a full-height frame, so it already spans the visible area; escaping it
  // bought nothing and cost every interaction.

  const viewport = useViewport()
  const [position, setPosition] = useState<PetPosition>(() => readPosition(viewport, globalThis.localStorage, DEFAULT_SIZE_PX))
  // Appearance comes from the Host config, not `localStorage`: the plugin
  // runtime has no usable browser storage, so writes there are lost.
  const [accent, setAccent] = useState(() => resolveAccent(undefined))
  const [glyph, setGlyph] = useState(DEFAULT_GLYPH)
  const [size, setSize] = useState(DEFAULT_SIZE_PX)
  const [ringStyle, setRingStyle] = useState<PetRingStyleId>(DEFAULT_RING_STYLE)
  const [mode, setMode] = useState<Mode>('closed')
  const [capabilities, setCapabilities] = useState<readonly PetCapability[]>([])
  const [degraded, setDegraded] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  /**
   * A successful outcome worth stating, kept apart from `error`.
   *
   * A built-in action can succeed in two visibly different ways — creating a
   * QA group or handing back the existing one — and reporting that through
   * the error channel would dress a normal result as a failure.
   *
   * Auto-dismissed, unlike `error`: a receipt has been read the moment it is
   * seen, and one that lingers becomes furniture that covers whatever sits
   * below it. An error, by contrast, waits for the next attempt.
   */
  const [notice, setNotice] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (notice === undefined) return
    const timer = setTimeout(() => setNotice(undefined), NOTICE_DISMISS_MS)
    // Cleared on replacement too, so a second notice restarts the clock
    // instead of inheriting the remainder of the first one's.
    return () => clearTimeout(timer)
  }, [notice])
  /**
   * Capabilities whose click is still in flight, by id.
   *
   * Per capability rather than one shared flag: a single boolean disabled the
   * WHOLE wheel while any one capability was submitting, which is wrong on
   * its own terms — different sources own different Tasks and have no reason
   * to block each other — and turned a missed reset into a wheel that stayed
   * entirely dead until the page was reloaded.
   */
  const [submitting, setSubmitting] = useState<ReadonlySet<string>>(() => new Set())
  const [hovered, setHovered] = useState<string | undefined>(undefined)
  const [sourceRemoved, setSourceRemoved] = useState(false)
  const [botBound, setBotBound] = useState<boolean | undefined>(undefined)
  const [channelHintDismissed, setChannelHintDismissed] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(CHANNEL_HINT_DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })
  // Only once the Host has ANSWERED: while the answer is pending `botBound`
  // is undefined, and flashing a "not connected" hint at a Pet that is in
  // fact connected would be worse than showing nothing.
  const showChannelHint = botBound === false && !channelHintDismissed
  /**
   * The in-flight drag gesture, in ABSOLUTE form.
   *
   * `origin` is Pet's position at pointerdown and `startX/startY` the pointer
   * that grabbed it, so every move computes `origin + (pointer - start)`
   * outright. The previous shape accumulated a per-event delta onto the
   * current position instead, which no longer works now that `position` is
   * frozen for the duration of the gesture (see `onPointerMove`) — every
   * increment would land on the same stale base.
   *
   * Absolute also fixes a bug the incremental form had: past the viewport
   * edge the clamp discarded the overflow while `dx/dy` still advanced to the
   * latest pointer, so dragging back inward moved Pet immediately rather than
   * waiting for the pointer to return to where it left the edge. Clamping is
   * a pure function of an absolute candidate, so nothing accumulates.
   *
   * `pending` is the clamped position awaiting commit. It is kept here rather
   * than parsed back out of `style.transform` so the string format never
   * becomes an implicit contract.
   */
  const dragging = useRef<
    | {
        pointerId: number
        startX: number
        startY: number
        origin: PetPosition
        pending: PetPosition
        moved: boolean
      }
    | undefined
  >(undefined)
  /** In-flight rAF handle for the drag's single write-per-frame. */
  const frameRef = useRef<number | undefined>(undefined)
  /** True when the gesture that just ended actually moved Pet. */
  const draggedRef = useRef(false)
  // Last known pointer position, for the blur-vs-fall-through decision.
  const pointerRef = useRef({ x: -1e6, y: -1e6 })

  // Settings can change the accent; the surface reads it once into state, so
  // the change must be broadcast to take effect without a reload.
  useEffect(() => {
    const load = (): void => {
      void petApi
        .config()
        .then(config => {
          const look = config.appearance ?? {}
          setAccent(resolveAccent(look.accent))
          setGlyph(look.glyph === undefined || look.glyph === '' ? DEFAULT_GLYPH : look.glyph)
          setSize(PET_SIZES.find(item => item.id === look.size)?.px ?? DEFAULT_SIZE_PX)
          setRingStyle(
            PET_RING_STYLES.find(item => item.id === look.ringStyle)?.id ?? DEFAULT_RING_STYLE,
          )
        })
        .catch(() => undefined)
    }
    load()
    const onAccent = load
    const onAppearance = load
    globalThis.addEventListener(PET_ACCENT_EVENT, onAccent)
    globalThis.addEventListener(PET_APPEARANCE_EVENT, onAppearance)
    return () => {
      globalThis.removeEventListener(PET_ACCENT_EVENT, onAccent)
      globalThis.removeEventListener(PET_APPEARANCE_EVENT, onAppearance)
    }
  }, [])


  /**
   * Clamp inputs, mirrored into refs for the drag path.
   *
   * A drag now runs outside React (see `onPointerMove`), so its handlers stay
   * alive for the whole gesture instead of being recreated per render. Reading
   * `viewport` / `size` from the closure would therefore clamp against
   * whatever those were when the gesture STARTED, and `onPointerUp` would
   * persist that out-of-bounds result — the exact hazard the dependency lists
   * on the old handlers warned about, made worse by the longer lifetime. A ref
   * always reads current, so resizing the mascot mid-drag clamps correctly.
   */
  const viewportRef = useRef(viewport)
  const sizeRef = useRef(size)
  useEffect(() => {
    viewportRef.current = viewport
    sizeRef.current = size
  }, [viewport, size])

  /**
   * Pet's committed position, for the drag to snapshot at pointerdown.
   *
   * Assigned during render rather than in an effect: `onPointerDown` must see
   * the position the user is looking at, and an effect would still be pending
   * if the pointer goes down in the same frame as a re-clamp.
   */
  const positionRef = useRef(position)
  positionRef.current = position

  // Re-clamp whenever the viewport changes so Pet can never be stranded.
  // Deliberately does NOT persist: a temporary narrow layout would otherwise
  // overwrite the user's chosen spot, and it could never be recovered when
  // the layout widened again. Only a real drag writes the position.
  useEffect(() => {
    // Skipped mid-drag: this would `setPosition` and let React paint a
    // `transform` over the value the drag writes straight to the DOM, which
    // reads as Pet snapping backwards under the pointer. Nothing is lost by
    // waiting — the drag already clamps against the current viewport and size
    // through the refs above, and its commit lands on a clamped value.
    if (dragging.current !== undefined) return
    setPosition(current => clampPosition(current, viewport, size))
    // `size` included: growing the mascot near an edge must pull it back
    // into view rather than leave it partly off-screen.
  }, [viewport.width, viewport.height, size])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const status = await petApi.status()
        if (cancelled) return
        setDegraded(
          status.lifecycle.phase === 'ready' ? undefined : (status.lifecycle.diagnostic ?? status.lifecycle.phase),
        )
        const list = await petApi.capabilities()
        if (!cancelled) setCapabilities(list.capabilities)
        const config = await petApi.config()
        // `none` means a new Task starts unattached unless the user opts in,
        // so the current session is pre-removed rather than pre-selected.
        if (!cancelled && config.defaultContextPolicy === 'none') setSourceRemoved(true)
        // Failure here leaves `botBound` undefined, which shows no hint at
        // all: a Host without the channel composed must not be nagged to
        // configure something it does not have.
        const channel = await petApi.channel().catch(() => undefined)
        if (!cancelled && channel !== undefined) setBotBound(channel.bot !== undefined)
      } catch (cause) {
        if (!cancelled) setDegraded(cause instanceof Error ? cause.message : String(cause))
      }
    })()

    // Capabilities move with the Skill set, so a Skill added or enabled in
    // Settings must appear in the menu without a page reload. Settings and the
    // mascot are separate mount points, hence the broadcast; the interval is a
    // backstop for changes made outside this browser.
    const reloadCapabilities = (): void => {
      void petApi
        .capabilities()
        .then(list => {
          if (!cancelled) setCapabilities(list.capabilities)
        })
        .catch(() => undefined)
      // Binding a bot happens in Settings, a separate mount point, so the
      // hint must clear on the same broadcast rather than on a reload.
      void petApi
        .channel()
        .then(channel => {
          if (!cancelled) setBotBound(channel.bot !== undefined)
        })
        .catch(() => undefined)
    }
    globalThis.addEventListener(PET_SKILLS_EVENT, reloadCapabilities)
    const timer = setInterval(reloadCapabilities, 10_000)

    return () => {
      cancelled = true
      clearInterval(timer)
      globalThis.removeEventListener(PET_SKILLS_EVENT, reloadCapabilities)
    }
  }, [])

  const effectiveSource: SourceSelection =
    sourceRemoved || props.currentSource === undefined ? { kind: 'none' } : props.currentSource

  // Safety net for the in-flight marks.
  //
  // `run`'s `finally` is the normal release, but Pet lives on its own React
  // root and survives session and workspace switches, so a mark that was
  // somehow not released would sit there forever and the affected capability
  // would look permanently disabled — recoverable only by reloading the page.
  // Changing the source means any earlier click no longer applies to what the
  // wheel now offers, so clearing here costs nothing and removes that class
  // of dead end entirely.
  const sourceKey =
    effectiveSource.kind === 'session'
      ? `session:${effectiveSource.sessionId ?? ''}`
      : effectiveSource.kind === 'workspace'
        ? `workspace:${effectiveSource.workspaceId ?? ''}`
        : 'none'
  useEffect(() => {
    setSubmitting(current => (current.size === 0 ? current : new Set()))
  }, [sourceKey])

  // The panel is click-opened, so it needs a click-driven way out. Without
  // this it could only be closed by clicking the mascot again, which reads as
  // "Pet is stuck open" once the pointer has moved elsewhere.
  const shortcuts = capabilities.filter(capability => capability.showAsShortcut)
  // Sized for the largest mascot so one viewBox serves every size; the wheel
  // may extend past the viewport and is allowed to clip, but the mascot and
  // the centre are always placed inside it.
  const WHEEL_VIEWBOX = 88 + 2 * (RING_GAP + 3 * RING_WIDTH)
  const rings = planRings(shortcuts.length, size)
  const slots = planSlots(shortcuts.length, size, WHEEL_VIEWBOX / 2)
  // While capabilities are still LOADING the list is empty and the disc would
  // collapse to the mascot: the first hover after a restart then closed the
  // instant the pointer left the mascot's face, and the click landed on a
  // wheel that had already vanished. Hold one ring's radius until the answer
  // arrives; an ACTUALLY empty catalog keeps the wheel open over the hint it
  // shows for exactly the same reason.
  const wheelRadius =
    shortcuts.length === 0
      ? size / 2 + RING_GAP + RING_WIDTH
      : hoverRadius(rings, size)

  /**
   * Clearance the wheel notes must leave, which is NOT `wheelRadius`.
   *
   * `wheelRadius` is a HIT-TESTING radius: with no capabilities it is held at
   * one ring's width so the wheel does not collapse to the mascot and snap
   * shut on the first hover after a restart (see above). Nothing is drawn out
   * there, though — so a note pushed past it floated in blank space, visibly
   * detached from the mascot it belongs to. That is exactly the "Pet 未就绪"
   * case, where there are no rings at all.
   *
   * The note must clear what is actually PAINTED: the outermost drawn ring,
   * or the mascot's own edge when no ring is drawn. Keeping the two radii
   * separate is deliberate — collapsing them would either reopen the
   * snap-shut bug or put the note back on top of the rings.
   */
  const noteClearance = rings.length === 0 ? size / 2 : hoverRadius(rings, size)

  /**
   * The capability actually under the pointer right now.
   *
   * A highlight means "the pointer is on this slice", so it must not outlive
   * the wheel. `hovered` used to be cleared only by a slice's own
   * `mouseleave` and the a11y button's `blur`, so whenever the wheel closed
   * with the pointer still resting on a slice — the distance check, Escape,
   * focus leaving, a drag — that `mouseleave` never arrived and the stale id
   * survived into the next open. A slice then looked selected that the user
   * was not pointing at, on a wheel where a click runs the capability
   * immediately.
   *
   * The effect below clears the state on every close, whatever caused it.
   * Deliberately one place keyed on `mode` rather than a
   * `setHovered(undefined)` bolted onto each closing branch: that would be
   * four call sites to keep in sync, and a fifth closing path added later
   * would regress in exactly the way this bug did. Gating only the READ on
   * `mode` was tried first and is NOT enough — it hides the stale value
   * while the wheel is closed, then hands it straight back when re-opening
   * sets `mode` to `menu` again.
   *
   * A capability vanishing from a refreshed catalog needs no guard of its
   * own: slice geometry comes from the index, but the highlight is compared
   * by id, so a departed id matches no rendered slice and cannot be
   * inherited by whichever capability now occupies that position. An
   * explicit `shortcuts.some(...)` check was written here and then removed
   * as dead code — its regression test passes without it, which is how the
   * redundancy was found. `activeHover` stays as the single named read so
   * the two call sites below cannot drift apart.
   */
  const activeHover = hovered
  useEffect(() => {
    if (mode !== 'menu') setHovered(undefined)
  }, [mode])

  // Closing is decided by distance from the centre, not by `mouseleave`: the
  // breathing gap and the seams between slices are all inside the disc, so a
  // continuous exit path never reports a false departure — which is exactly
  // why the old rectangular menu needed a grace timer.
  useEffect(() => {
    if (mode !== 'menu') return undefined
    const onMove = (event: MouseEvent): void => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
      // Measure the MASCOT, not the root: the root box is a fixed 72px, so at
      // any other mascot size its centre is off by half the difference and the
      // disc is judged from the wrong origin.
      const node = rootRef.current?.querySelector('.dshpet-mascot')
      if (node === null || node === undefined) return
      const box = node.getBoundingClientRect()
      const dx = event.clientX - (box.left + box.width / 2)
      const dy = event.clientY - (box.top + box.height / 2)
      if (Math.hypot(dx, dy) > wheelRadius) setMode('closed')
    }
    document.addEventListener('mousemove', onMove)
    return () => document.removeEventListener('mousemove', onMove)
  }, [mode, wheelRadius])

  useEffect(() => {
    if (mode !== 'panel') return
    const onPointerDownOutside = (event: PointerEvent): void => {
      const node = rootRef.current
      if (node === null) return
      if (!node.contains(event.target as Node)) setMode('closed')
    }
    document.addEventListener('pointerdown', onPointerDownOutside, true)
    return () => document.removeEventListener('pointerdown', onPointerDownOutside, true)
  }, [mode])

  /**
   * Paint the drag's latest position, at most once per frame.
   *
   * Writes `transform` STRAIGHT to the DOM and deliberately skips React. The
   * old handler called `setPosition` on every `pointermove`, which re-rendered
   * the whole overlay — including the wheel's entire SVG tree, up to 24
   * slices, none of which depend on Pet's coordinates. The wheel is usually
   * open while dragging, because hovering the mascot to grab it is what opens
   * it, so that was the common case rather than an edge one.
   *
   * DOM and React state are therefore knowingly out of step for the duration
   * of one gesture, and only for `transform`. `onPointerUp` commits the same
   * value it last painted, so the handover renders identically and Pet does
   * not jump; any in-flight frame is cancelled first so a stale one cannot
   * repaint over the commit.
   */
  const paintDrag = useCallback(() => {
    frameRef.current = undefined
    const state = dragging.current
    const node = rootRef.current
    // Both can vanish between scheduling and running: the gesture may have
    // ended, or the component may have unmounted.
    if (state === undefined || node === null) return
    node.style.transform = translateFor(state.pending)
  }, [])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    // Reset here so each gesture owns its own flag. Relying on the click
    // handler to clear it strands `true` whenever a drag ends without a
    // click (pointercancel, or release outside the element), which then
    // swallows the NEXT click or keyboard activation.
    draggedRef.current = false
    // A grabbed Pet is not a hovered capability. Unlike the ways the wheel
    // CLOSES, which the `mode` effect above already covers, a drag leaves
    // `mode` untouched (Pet is draggable with the wheel open), so the
    // highlight has to be dropped explicitly here.
    setHovered(undefined)
    // Pointer capture keeps the drag attached even when the cursor leaves the
    // element or crosses an iframe boundary.
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      // Snapshot the base once. Every move is measured from this, so the
      // gesture needs no position updates from React while it runs.
      origin: positionRef.current,
      pending: positionRef.current,
      moved: false,
    }
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = dragging.current
      if (state === undefined || state.pointerId !== event.pointerId) return
      const deltaX = event.clientX - state.startX
      const deltaY = event.clientY - state.startY
      // Below the threshold this is still a click, not a drag.
      if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return
      const pending = clampPosition(
        { x: state.origin.x + deltaX, y: state.origin.y + deltaY },
        // Refs, not closure values: see `viewportRef` above.
        viewportRef.current,
        sizeRef.current,
      )
      dragging.current = { ...state, pending, moved: true }
      // Coalesce to one write per frame. Pointer events can outpace the
      // display — a high-rate mouse fires several per frame — and every extra
      // write past the first is discarded by the compositor anyway.
      if (frameRef.current !== undefined) return
      frameRef.current = requestAnimationFrame(paintDrag)
    },
    [paintDrag],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = dragging.current
      dragging.current = undefined
      if (state === undefined) return
      // Cancel before committing: a frame still queued would otherwise fire
      // after React has taken the position back and repaint the old value.
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = undefined
      }
      event.currentTarget.releasePointerCapture(event.pointerId)
      // A drag must not also count as a click: releasing at the new position
      // would otherwise toggle the panel open every time Pet is moved.
      draggedRef.current = state.moved
      // Hand the gesture's final position back to React and persist it. Also
      // the `pointercancel` path, so an interrupted drag keeps where it got to
      // instead of springing back to where it started.
      const committed = writePosition(
        state.pending,
        viewportRef.current,
        globalThis.localStorage,
        sizeRef.current,
      )
      setPosition(committed)
    },
    [],
  )

  // A queued frame must not outlive the component: it would touch a detached
  // node, and on a fast unmount `rootRef` is already null.
  useEffect(
    () => () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  const run = useCallback(
    async (capability: PetCapability) => {
      setError(undefined)
      setNotice(undefined)
      // One click runs the capability. Safety belongs to the Skill inside its
      // Pet Task: a blanket confirmation here cannot tell a destructive
      // capability from a harmless one, so it taxed every action without
      // actually protecting the dangerous ones.
      const marking = capability.id
      setSubmitting(current => new Set(current).add(marking))
      try {
        // A built-in action is not an Invocation and pins no Skill: the Host
        // runs it directly, so there is no capture to freeze and no
        // capability envelope to dispatch.
        if (capability.kind === 'builtin') {
          if (capability.id !== QA_GROUP_ACTION_ID) {
            throw new PetApiError('INVALID_REQUEST', `未知的内置动作 ${capability.id}`)
          }
          // Re-checked here as well as in `blocked`: the source can change
          // between render and click, and a QA group needs a real session to
          // fork — a workspace or independent source has nothing to inherit.
          if (effectiveSource.kind !== 'session' || effectiveSource.sessionId === undefined) {
            throw new PetApiError('INVALID_REQUEST', '答疑群需要一个当前会话作为来源')
          }
          const result = await petApi.locusDefaultQa({
            parentSessionId: effectiveSource.sessionId,
          })
          const chatName = result.locus.endpoint.chatName
          const label = chatName === undefined ? '默认答疑入口' : `答疑群「${chatName}」`
          setNotice(result.reused === true ? `已打开本会话的${label}。` : `已创建${label}。`)
          setMode('panel')
          return
        }
        // The atomic capture: whatever the browser shows RIGHT NOW is frozen
        // into the request. Later page switches cannot change this Invocation.
        const accepted = await petApi.createInvocation({
          clientInvocationId: `inv-${crypto.randomUUID()}`,
          capabilityId: capability.id,
          sourceKind: effectiveSource.kind,
          ...(effectiveSource.sessionId !== undefined
            ? { sourceSessionId: effectiveSource.sessionId }
            : {}),
          ...(effectiveSource.workspaceId !== undefined
            ? { sourceWorkspaceId: effectiveSource.workspaceId }
            : {}),
        })
        // Accepting only QUEUES the Invocation; dispatch runs afterwards and
        // reports through the Task record. Saying which of the two happened
        // stops a queued-but-undispatched capability from reading as a dead
        // button — the panel below then carries the outcome.
        //
        // Read defensively: the route returns an untyped record, so a Host
        // that omits the field must degrade to the neutral wording rather
        // than claim the work started.
        setNotice(
          (accepted as { started?: unknown }).started === true
            ? `已开始执行 ${capability.label}。`
            : `${capability.label} 已排队，稍后在下方面板查看结果。`,
        )
        setMode('panel')
      } catch (cause) {
        setError(cause instanceof PetApiError ? cause.message : String(cause))
      } finally {
        setSubmitting(current => {
          const next = new Set(current)
          next.delete(marking)
          return next
        })
      }
    },
    // `effectiveSource` is read inside, so it must be a dependency: a stale
    // closure would never observe the first click and the gate would never
    // release.
    [effectiveSource],
  )

  // Hidden capabilities stay installed and enabled; they are simply kept out
  // of the radial menu to control clutter.

  // Only a proven-missing dependency disables a capability. Pet applies NO
  // context gate: it cannot know what a given Skill needs without the Skill
  // declaring it, and such a declaration is exactly the Pet-adaptation this
  // design removes. A Skill that needs a session checks its own snapshot and
  // stops to ask, so the wheel stays live and the answer comes from the Skill.
  //
  // A BUILT-IN action is different, and gating it here is not a regression of
  // that rule: it is Host code with a known, fixed requirement, not a Skill
  // whose needs Pet would have to guess.
  const blocked = (capability: PetCapability): string | undefined => {
    if (!capability.available) return capability.diagnostic ?? 'Unavailable'
    if (capability.kind === 'builtin' && capability.id === QA_GROUP_ACTION_ID) {
      if (effectiveSource.kind !== 'session') return '需要当前会话作为来源'
    }
    return undefined
  }

  return (
    <div
      ref={rootRef}
      className="dshpet-root"
      data-open={mode !== 'closed'}
      style={{
        // `transform`, not `left`/`top`: the compositor can move a layer
        // without a layout pass, whereas every `left`/`top` write invalidates
        // Pet's geometry and forces layout plus paint on each pointer event.
        // The CSS rule pins `left:0;top:0` so these are viewport coordinates
        // (see styles.ts for why that pinning is required).
        transform: translateFor(position),
        // The wheel notes clear the RINGS (see `.dshpet-wheel-note` in
        // styles.ts), but the wheel box is sized for its widest possible ring
        // while the mascot is resizable and the ring count follows the
        // capability list — so both measurements are published here for the
        // CSS to read. @types/react has no custom-property signature, hence
        // the cast.
        '--dshpet-mascot-size': `${size}px`,
        // Outer edge of what is actually PAINTED, which is what the notes have
        // to clear. A note anchored to the mascot alone landed ON TOP of the
        // rings (the mascot is only the innermost 72px of a disc reaching
        // ~170px); anchoring it to the hit-testing radius instead left it
        // floating in blank space whenever no ring was drawn, since that
        // radius is deliberately held at one ring's width even with an empty
        // wheel. `noteClearance` is neither — it follows the rings drawn, and
        // falls back to the mascot's edge when there are none.
        '--dshpet-wheel-radius': `${noteClearance}px`,
      } as CSSProperties}
      // Focus is the keyboard equivalent of hover, so a keyboard user reaches
      // the capability wheel the same way a pointer user does.
      onFocus={() => {
        if (mode === 'closed') setMode('menu')
      }}
      onBlur={event => {
        // Only close when focus genuinely leaves the Pet surface; moving
        // between the mascot and a menu item must not collapse it.
        //
        // A mouse click that lands in a seam between slices falls through the
        // pointer-transparent SVG to the page below, focusing it — blur then
        // closed the wheel instantly, unmounting the slice under the pointer
        // before its click could fire. Distance decides instead: focus loss
        // with the pointer still on the disc is that fall-through, not a real
        // departure. Keyboard users are unaffected — their focus moves carry
        // no pointer position, so the distance reads as outside.
        if (mode !== 'menu' || event.currentTarget.contains(event.relatedTarget)) return
        const mascot = event.currentTarget.querySelector('.dshpet-mascot')
        const box = mascot?.getBoundingClientRect()
        if (box !== undefined) {
          const dx = pointerRef.current.x - (box.left + box.width / 2)
          const dy = pointerRef.current.y - (box.top + box.height / 2)
          if (Math.hypot(dx, dy) <= wheelRadius) return
        }
        setMode('closed')
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') setMode('closed')
      }}
    >
      <button
        type="button"
        className="dshpet-mascot"
        // Only the mascot OPENS the wheel. Binding this to the container made
        // the empty square around a collapsed mascot a hover target, so the
        // wheel sprang open from well outside it.
        onMouseEnter={() => {
          if (mode === 'closed') setMode('menu')
        }}
        // Inline, because the palette is user data: emitting one rule per
        // accent into the injected stylesheet would couple the CSS to the
        // palette and grow it for options nobody selected.
        style={{
          // The surface is tinted, not the glyph: 🐾 is a colour emoji and
          // CSS `color` cannot recolour it.
          background: accent.background,
          width: size,
          height: size,
          // Keep the glyph proportional to the circle it sits in.
          fontSize: Math.round(size * 0.53),
        }}
        data-dragging={dragging.current !== undefined}
        aria-label="DSH Pet"
        aria-expanded={mode !== 'closed'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false
            return
          }
          setMode(current => (current === 'panel' ? 'closed' : 'panel'))
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') setMode('closed')
          if (event.key === 'ArrowUp' && mode === 'closed') setMode('menu')
        }}
      >
        {glyph}
        {degraded !== undefined ? (
          <span className="dshpet-badge" data-state="degraded" title={degraded} role="status">
            <span className="dshpet-visually-hidden">Pet 未就绪：{degraded}</span>
            <span aria-hidden="true">!</span>
          </span>
        ) : null}
      </button>

      {mode === 'menu' ? (
        <div className="dshpet-wheel" role="menu" aria-label="Pet 能力">
          <svg
            className="dshpet-wheel-svg"
            viewBox={`0 0 ${WHEEL_VIEWBOX} ${WHEEL_VIEWBOX}`}
            style={{ width: WHEEL_VIEWBOX, height: WHEEL_VIEWBOX }}
            aria-hidden="true"
          >
            {/* Catches clicks in the seams and the breathing gap, so they do
                not fall through to the page, steal focus and blur the wheel
                shut. Sized to the drawn disc, not the square: the corners
                stay transparent to the page below. */}
            <circle
              className="dshpet-wheel-catch"
              cx={WHEEL_VIEWBOX / 2}
              cy={WHEEL_VIEWBOX / 2}
              r={wheelRadius}
            />
            {slots.map(slot => {
              const capability = shortcuts[slot.index]
              if (capability === undefined) return null
              const reason = blocked(capability)
              return (
                <g
                  key={capability.id}
                  className="dshpet-slot"
                  data-ring={slot.ring}
                  data-disabled={reason !== undefined || submitting.has(capability.id)}
                  data-hovered={activeHover === capability.id}
                  // Staggered by ring so the layers read as depth; ring one is
                  // immediate because the most-used capability lives there and
                  // must not wait on an animation.
                  style={{ animationDelay: `${slot.ring * 0.08}s` }}
                  onClick={() => {
                    if (reason === undefined && !submitting.has(capability.id)) void run(capability)
                  }}
                  onMouseEnter={() => setHovered(capability.id)}
                  onMouseLeave={() => setHovered(undefined)}
                >
                  <title>
                    {reason ??
                      (capability.description === ''
                        ? capability.label
                        : `${capability.label}: ${capability.description}`)}
                  </title>
                  <path
                    className="dshpet-slot-face"
                    d={slot.path}
                    // Inline, not a CSS rule or a `fill` attribute: the palette
                    // is user data, and a presentation attribute would lose to
                    // the class rule while a class rule would lose to this.
                    // Hover rides the same channel for that reason.
                    style={{
                      fill:
                        activeHover === capability.id
                          ? hoverFill(ringFill(accent.background, slot.ring, ringStyle))
                          : ringFill(accent.background, slot.ring, ringStyle),
                    }}
                  />
                  <text
                    className="dshpet-slot-label"
                    x={slot.labelX}
                    y={slot.labelY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${slot.labelRotation} ${slot.labelX} ${slot.labelY})`}
                  >
                    {fitLabel(capability.label, slot.labelCapacity)}
                  </text>
                </g>
              )
            })}
          </svg>

          {/* Buttons carry the accessible tree: SVG groups are not focusable,
              so keyboard users would otherwise have no way in. */}
          <div className="dshpet-wheel-a11y">
            {shortcuts.slice(0, WHEEL_CAPACITY).map(capability => {
              const reason = blocked(capability)
              return (
                <button
                  key={capability.id}
                  type="button"
                  role="menuitem"
                  className="dshpet-wheel-item"
                  disabled={reason !== undefined || submitting.has(capability.id)}
                  title={reason}
                  aria-describedby={reason !== undefined ? `${capability.id}-reason` : undefined}
                  onClick={() => void run(capability)}
                  onFocus={() => setHovered(capability.id)}
                  onBlur={() => setHovered(undefined)}
                >
                  {capability.label}
                  <span className="dshpet-visually-hidden" id={`${capability.id}-reason`}>
                    {reason ?? capability.description}
                  </span>
                </button>
              )
            })}
          </div>

          {degraded !== undefined ? (
            <p className="dshpet-wheel-note dshpet-error">Pet 未就绪：{degraded}</p>
          ) : null}
          {shortcuts.length === 0 && degraded === undefined ? (
            <p className="dshpet-wheel-note dshpet-empty">
              还没有可用能力。在「设置 → Pet → Skill」加入一个 Skill 并启用后，
              它就会出现在这里。
            </p>
          ) : null}
          {/*
            One hint at a time, and Skills win: a Pet with no capabilities
            needs a Skill first, not a chat channel. The channel hint is
            dismissible because the channel is optional — nobody should be
            nagged forever about a feature they chose not to use — while the
            Channel settings tab remains the permanent home for binding.
          */}
          {shortcuts.length > 0 && degraded === undefined && showChannelHint ? (
            <p className="dshpet-wheel-note dshpet-empty">
              还没有连接飞书 Bot，无法从飞书发起任务。
              在「设置 → Pet → 飞书」连接后即可 @它。
              <button
                type="button"
                className="dshpet-note-dismiss"
                onClick={() => {
                  setChannelHintDismissed(true)
                  try {
                    globalThis.localStorage?.setItem(CHANNEL_HINT_DISMISSED_KEY, '1')
                  } catch {
                    // A blocked storage only costs the user one more reminder.
                  }
                }}
              >
                不再提示
              </button>
            </p>
          ) : null}
          {error !== undefined ? <p className="dshpet-wheel-note dshpet-error">{error}</p> : null}
          {notice !== undefined ? (
            <p className="dshpet-wheel-note dshpet-wheel-receipt">{notice}</p>
          ) : null}
        </div>
      ) : null}

      {mode === 'panel' ? (
        <>
          <TaskPanel
            currentSource={effectiveSource}
            {...(props.openSession !== undefined ? { openSession: props.openSession } : {})}
          />
          {error !== undefined ? <p className="dshpet-panel-receipt dshpet-error">{error}</p> : null}
          {notice !== undefined ? (
            <p className="dshpet-panel-receipt dshpet-wheel-receipt">{notice}</p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}


interface TaskView {
  id: string
  scopeKey: string
  sourceKind: string
  sourceId?: string
  sourceTitle?: string
  sourceAvailability?: string
  /** Set when the executor runs inside the routed workspace itself. */
  residentWorkspaceId?: string
  status: string
  /**
   * Why the Task is in its current status.
   *
   * Dispatch happens after the create call returns, so a failure there is
   * reported only here — the panel renders it, otherwise a failed capability
   * looks like a button that did nothing.
   */
  diagnostic?: string
  archivedAt?: number
  executorSessionId: string
  revision: number
  invocations: {
    id: string
    capabilityId: string
    status: string
    resultSummary?: string
    errorSummary?: string
  }[]
}

/**
 * The compact Task/Invocation panel belongs only to the ordinary Pet wheel.
 * Legacy Feishu Task projections are preserved by the Host for history, but
 * the unified channel has its own locus management surface and must never make
 * those rows look live again.
 */
export function ordinaryPetTasks(tasks: readonly TaskView[]): TaskView[] {
  return tasks.filter(task => task.sourceKind !== 'chat' && task.sourceKind !== 'qa-chat')
}

/** The compact Task panel: ordinary invocation/source/task operations only. */
function TaskPanel(props: {
  currentSource: SourceSelection
  openSession?: (sessionId: string) => void
}): JSX.Element {
  const [tab, setTab] = useState<'current' | 'all' | 'archived'>('current')
  const [tasks, setTasks] = useState<TaskView[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  // Draft answers per Task; a complex interaction still belongs in the native
  // session, which "Open full process" reaches.
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    try {
      const result = (await petApi.tasks()) as { tasks?: TaskView[] }
      // Normalize. A type assertion only CLAIMS the field exists; a response
      // without it makes `tasks` undefined and the next render throws in
      // `tasks.filter`. The overlay is a `list` slot, so the error boundary
      // abdicates the entry — the mascot silently disappears until reload,
      // which is harder to notice than a blank panel.
      setTasks(Array.isArray(result?.tasks) ? ordinaryPetTasks(result.tasks) : [])
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let seen = 0

    /**
     * Generation-aware refresh: the panel asks only for the cheap status
     * generation and reloads the full task list when the Host reports it is
     * stale. Without this the panel would show whatever it fetched on mount
     * forever, because background Invocations settle Host-side.
     */
    const poll = async (): Promise<void> => {
      try {
        const status = await petApi.status(seen)
        if (cancelled) return
        if (status.stale || seen === 0) {
          seen = status.generation
          // A complete reload, never an increment applied to partial state.
          await refresh()
        }
      } catch {
        // A transient failure must not stop later refreshes.
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), 2_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refresh])

  // The scope key is the same identity the Host routes on, so "current"
  // shows exactly the Task this source would reuse — never the executor
  // session, which is not a source.
  const currentScopeKey =
    props.currentSource.kind === 'session' && props.currentSource.sessionId !== undefined
      ? `session:${props.currentSource.sessionId}`
      : props.currentSource.kind === 'workspace' && props.currentSource.workspaceId !== undefined
        ? `workspace:${props.currentSource.workspaceId}`
        : 'independent:web:default'

  const visible = tasks.filter(task => {
    if (tab === 'archived') return task.archivedAt !== undefined
    if (task.archivedAt !== undefined) return false
    return tab === 'all' || task.scopeKey === currentScopeKey
  })

  return (
    <div className="dshpet-panel" role="dialog" aria-label="Pet tasks">
      <h2>Pet tasks</h2>
      <div className="dshpet-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="dshpet-tab"
          aria-selected={tab === 'current'}
          onClick={() => setTab('current')}
        >
          Current
        </button>
        <button
          type="button"
          role="tab"
          className="dshpet-tab"
          aria-selected={tab === 'all'}
          onClick={() => setTab('all')}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          className="dshpet-tab"
          aria-selected={tab === 'archived'}
          onClick={() => setTab('archived')}
        >
          Archived
        </button>
      </div>

      {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
      {visible.length === 0 ? (
        <p className="dshpet-empty">
          {tab === 'current' ? 'No task for the current source yet.' : `No ${tab} tasks.`}
        </p>
      ) : null}

      {visible.map(task => (
        <div
          key={task.id}
          className="dshpet-task"
          role="button"
          tabIndex={0}
          onClick={event => {
            // The row also hosts the answer field and its submit button.
            // Navigating on every click would steal focus mid-typing.
            if ((event.target as HTMLElement).closest('input, button, textarea') !== null) return
            props.openSession?.(task.executorSessionId)
          }}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              props.openSession?.(task.executorSessionId)
            }
          }}
        >
          <strong style={{ fontSize: 12 }}>
            {task.sourceKind === 'none'
              ? 'Independent task'
              : `${task.sourceKind}: ${task.sourceTitle ?? task.sourceId ?? task.id}`}
          </strong>
          <span className="dshpet-status" style={{ marginLeft: 6 }}>
            {task.status}
          </span>
          {/*
            A resident ordinary Pet Task works directly inside its workspace,
            where Pet's Skill projection and standing instructions do not apply.
          */}
          {task.residentWorkspaceId !== undefined ? (
            <span className="dshpet-status" style={{ marginLeft: 4 }}>
              工作区内执行
            </span>
          ) : null}
          {task.sourceAvailability === 'archived' ? (
            <span className="dshpet-status" style={{ marginLeft: 4 }}>
              source archived
            </span>
          ) : null}
          {/*
            The Task's own diagnostic. Dispatch happens AFTER the create call
            returns, so a failure there cannot surface as a rejected request:
            the wheel closed on success and the reason was written only to
            this field, which nothing rendered. That is the whole of "clicking
            does nothing" — the Task was sitting in `recovering` with the
            explanation attached, invisible.
          */}
          {task.diagnostic !== undefined ? (
            <p className="dshpet-error" style={{ margin: '4px 0 0' }}>
              {task.diagnostic}
            </p>
          ) : null}
          {(task.invocations ?? []).map(invocation => (
            <div key={invocation.id} className="dshpet-inv">
              <span>{invocation.capabilityId}</span>
              <span className="dshpet-status">{invocation.status}</span>
              {invocation.resultSummary !== undefined ? (
                <span>{invocation.resultSummary}</span>
              ) : null}
              {invocation.errorSummary !== undefined ? (
                <span className="dshpet-error">{invocation.errorSummary}</span>
              ) : null}
              {invocation.status === 'failed' ? (
                <button
                  type="button"
                  className="dshpet-action"
                  onClick={() => void petApi.retry(invocation.id).then(refresh)}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ))}
          {task.status === 'waiting-user' ? (
            <form
              className="dshpet-actions"
              onSubmit={event => {
                event.preventDefault()
                const text = (answers[task.id] ?? '').trim()
                if (text === '') return
                // The answer continues the CURRENT Invocation; it never starts
                // queued work.
                void petApi
                  .answer(task.id, text)
                  .then(() => {
                    setAnswers(current => ({ ...current, [task.id]: '' }))
                    return refresh()
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
              }}
            >
              <input
                className="dshpet-answer"
                aria-label={`Answer the question waiting in ${task.sourceTitle ?? task.id}`}
                placeholder="Answer the waiting question…"
                value={answers[task.id] ?? ''}
                onChange={event =>
                  setAnswers(current => ({ ...current, [task.id]: event.target.value }))
                }
              />
              <button type="submit" className="dshpet-action">
                Send
              </button>
            </form>
          ) : null}
          {/* One action, and it navigates rather than mirrors the transcript.
              Archiving is deliberately absent: it belongs in the session, and
              `reconcileArchives` already observes that live — a terminal Task
              archives itself, while a non-terminal one stays active with a
              diagnostic instead of being treated as cancelled. Putting a
              destructive control in a hover panel only invites misclicks. */}
        </div>
      ))}
    </div>
  )
}

/**
 * Track the VIEWPORT so position clamping follows window resizes.
 *
 * Deliberately the window, not the app frame. Pet is `position:fixed` on its
 * own root under `document.body`, so the viewport is its containing block.
 * This used to measure `[data-shell-overlay]`, which was correct while Pet
 * lived inside that layer — but that layer shrinks when a layout-push sidebar
 * squeezes `#root`, and clamping against it would drag Pet left as the panel
 * opens. That is precisely the "gets pushed aside" behaviour being removed, so
 * the frame must not be consulted at all.
 * @returns the current viewport size.
 */
function useViewport(): { width: number; height: number } {
  const read = (): { width: number; height: number } => ({
    width: globalThis.innerWidth ?? 1280,
    height: globalThis.innerHeight ?? 800,
  })
  const [viewport, setViewport] = useState(read)
  useEffect(() => {
    // Only a real window resize changes the viewport. A sidebar opening does
    // not, and must not move Pet.
    const onResize = (): void => setViewport(read())
    setViewport(read())
    globalThis.addEventListener('resize', onResize)
    return () => {
      globalThis.removeEventListener('resize', onResize)
    }
  }, [])
  return viewport
}
