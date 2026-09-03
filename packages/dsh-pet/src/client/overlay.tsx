/**
 * The floating Pet surface.
 *
 * Renders only the mascot, the capability menu, the pre-execution source chip
 * and a compact Task panel. The `shell.overlay` layer is click-through; this
 * component opts back into pointer events for its own surface only, so it
 * never blocks the app underneath.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
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
import type { PetCapability, PetSourceKind } from '../wire.js'

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
  const [busy, setBusy] = useState(false)
  const [hovered, setHovered] = useState<string | undefined>(undefined)
  const [sourceRemoved, setSourceRemoved] = useState(false)
  const dragging = useRef<
    { pointerId: number; dx: number; dy: number; moved: boolean } | undefined
  >(undefined)
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


  // Re-clamp whenever the viewport changes so Pet can never be stranded.
  // Deliberately does NOT persist: a temporary narrow layout would otherwise
  // overwrite the user's chosen spot, and it could never be recovered when
  // the layout widened again. Only a real drag writes the position.
  useEffect(() => {
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

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
      // Reset here so each gesture owns its own flag. Relying on the click
      // handler to clear it strands `true` whenever a drag ends without a
      // click (pointercancel, or release outside the element), which then
      // swallows the NEXT click or keyboard activation.
      draggedRef.current = false
    // Pointer capture keeps the drag attached even when the cursor leaves the
    // element or crosses an iframe boundary.
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = {
      pointerId: event.pointerId,
      dx: event.clientX,
      dy: event.clientY,
      moved: false,
    }
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = dragging.current
      if (state === undefined || state.pointerId !== event.pointerId) return
      const deltaX = event.clientX - state.dx
      const deltaY = event.clientY - state.dy
      if (Math.abs(deltaX) < 2 && Math.abs(deltaY) < 2) return
      dragging.current = { ...state, dx: event.clientX, dy: event.clientY, moved: true }
      setPosition(current =>
        clampPosition({ x: current.x + deltaX, y: current.y + deltaY }, viewport, size),
      )
    },
    // `size` is read inside, so it must be a dependency: a stale closure
    // clamps against the previous diameter and `onPointerUp` then PERSISTS
    // that out-of-bounds position.
    [viewport, size],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = dragging.current
      dragging.current = undefined
      if (state === undefined) return
      event.currentTarget.releasePointerCapture(event.pointerId)
      // A drag must not also count as a click: releasing at the new position
      // would otherwise toggle the panel open every time Pet is moved.
      draggedRef.current = state.moved
      setPosition(current => writePosition(current, viewport, globalThis.localStorage, size))
    },
    // `size` is read inside, so it must be a dependency: a stale closure
    // clamps against the previous diameter and `onPointerUp` then PERSISTS
    // that out-of-bounds position.
    [viewport, size],
  )

  const run = useCallback(
    async (capability: PetCapability) => {
      setError(undefined)
      // One click runs the capability. Safety belongs to the Skill inside its
      // Pet Task: a blanket confirmation here cannot tell a destructive
      // capability from a harmless one, so it taxed every action without
      // actually protecting the dangerous ones.
      setBusy(true)
      try {
        // The atomic capture: whatever the browser shows RIGHT NOW is frozen
        // into the request. Later page switches cannot change this Invocation.
        await petApi.createInvocation({
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
        setMode('panel')
      } catch (cause) {
        setError(cause instanceof PetApiError ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
    },
    // `effectiveSource` is read inside, so it must be a dependency: a stale
    // closure would never observe the first click and the gate would never
    // release.
    [effectiveSource],
  )

  // Hidden capabilities stay installed and enabled; they are simply kept out
  // of the radial menu to control clutter.

  const blocked = (capability: PetCapability): string | undefined => {
    if (!capability.available) return capability.diagnostic ?? 'Unavailable'
    if (capability.contextRequirement === 'session-required' && effectiveSource.kind !== 'session') {
      return 'Requires a DSH session'
    }
    if (
      capability.contextRequirement === 'workspace-required' &&
      effectiveSource.kind === 'none'
    ) {
      return 'Requires a workspace'
    }
    return undefined
  }

  return (
    <div
      ref={rootRef}
      className="dshpet-root"
      data-open={mode !== 'closed'}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
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
                  data-disabled={reason !== undefined || busy}
                  data-hovered={hovered === capability.id}
                  // Staggered by ring so the layers read as depth; ring one is
                  // immediate because the most-used capability lives there and
                  // must not wait on an animation.
                  style={{ animationDelay: `${slot.ring * 0.08}s` }}
                  onClick={() => {
                    if (reason === undefined && !busy) void run(capability)
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
                        hovered === capability.id
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
                  disabled={reason !== undefined || busy}
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
          {error !== undefined ? <p className="dshpet-wheel-note dshpet-error">{error}</p> : null}
        </div>
      ) : null}

      {mode === 'panel' ? (
        <TaskPanel
          currentSource={effectiveSource}
          {...(props.openSession !== undefined ? { openSession: props.openSession } : {})}
        />
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
  status: string
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

/** The compact Task panel: invocation/source/task operations only. */
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
      setTasks(Array.isArray(result?.tasks) ? result.tasks : [])
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
          {task.sourceAvailability === 'archived' ? (
            <span className="dshpet-status" style={{ marginLeft: 4 }}>
              source archived
            </span>
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

/** Track the viewport so position clamping follows resizes. */
function useViewport(): { width: number; height: number } {
  // Measure the overlay layer up front. Seeding from `window` and correcting
  // in an effect re-clamps the stored position against a LARGER box first,
  // then a smaller one — nudging Pet up and left on every load.
  const [viewport, setViewport] = useState(() => {
    const layer = globalThis.document?.querySelector('[data-shell-overlay]')
    const box = layer?.getBoundingClientRect()
    return box !== undefined && box.width > 0 && box.height > 0
      ? { width: box.width, height: box.height }
      : { width: globalThis.innerWidth ?? 1280, height: globalThis.innerHeight ?? 800 }
  })
  useEffect(() => {
    // Pet is absolutely positioned inside the shell overlay layer, so that
    // layer — not the window — is its containing block. Measuring the window
    // would let clamping place Pet past the layer's right/bottom edge.
    const read = (): { width: number; height: number } => {
      const layer = globalThis.document?.querySelector('[data-shell-overlay]')
      const box = layer?.getBoundingClientRect()
      return box !== undefined && box.width > 0 && box.height > 0
        ? { width: box.width, height: box.height }
        : { width: globalThis.innerWidth, height: globalThis.innerHeight }
    }
    setViewport(read())
    const onResize = (): void => setViewport(read())
    globalThis.addEventListener('resize', onResize)
    // Dragging a column resizes the frame without firing a window resize.
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : undefined
    const layer = globalThis.document?.querySelector('[data-shell-overlay]')
    if (layer !== null && layer !== undefined) observer?.observe(layer)
    return () => {
      globalThis.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [])
  return viewport
}
