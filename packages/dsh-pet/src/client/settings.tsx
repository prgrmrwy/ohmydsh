/**
 * Pet settings section: six stable tabs.
 *
 * General, Skills, Locus, Environment, Channel and Diagnostics.
 * The overlay and Task panel deliberately do not duplicate installation,
 * locus management, binding editing or diagnostics.
 *
 * Provider credentials are owned by DSH provider/subscription plugins. This
 * page displays provider/model availability by id only and never reads,
 * persists or renders a token. The locus surface likewise never accepts a
 * browser-supplied owner identity: Host authority is fail-closed.
 */

import type { ReactNode } from 'react'
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  DEFAULT_GLYPH,
  PET_ACCENT_EVENT,
  PET_APPEARANCE_EVENT,
  PET_SKILLS_EVENT,
  normalizeGlyph,
  PET_ACCENTS,
  PET_ANIMATION_PLAYBACKS,
  PET_SIZES,
  resolveAnimationPlayback,
  type PetAnimationPlayback,
  PET_RING_STYLES,
  DEFAULT_RING_STYLE,
  type PetRingStyleId,
  resolveAccent,
  type PetAccentId,
  type PetSizeId,
} from './accent.js'
import { petApi, type PetConfig, type PetTodoLedgerGroup } from './api.js'
import {
  getExpressionPresence,
  setExpressionPresence,
  subscribeExpressionPresence,
} from './expression-presence.js'
import {
  getMascotExpressionDiagnostic,
  subscribeMascotExpressionDiagnostic,
} from './mascot-diagnostics.js'
import {
  availableTodoActions,
  groupTodosByLocus,
  resolveFeishuJumpTarget,
  resolveSessionJumpTarget,
  todoStatusLabel,
  type TodoSnapshotItem,
} from './ledger-view.js'
import {
  DEFAULT_LOCUS_FILTER,
  ENTRY_BUCKET_OPTIONS,
  LOCUS_ACCESS_LABELS,
  LOCUS_DEFAULT_QA_MISSING_NOTE,
  LOCUS_FENCE_STALE_TEXT,
  LOCUS_FULL_ACCESS_NOTE,
  LOCUS_NOT_CREATED_SESSION,
  LOCUS_REBIND_CONSEQUENCES,
  SHOW_ALL_LOCUS_FILTER,
  accessBlock,
  applyLocusFilter,
  applyQuery,
  archivedWorkNote,
  childJumpBlock,
  collectHandleCodes,
  countLocusFilterOptions,
  emptyListText,
  endpointHandleId,
  endpointHandleLabel,
  endpointKey,
  entryDisplayName,
  entryFeishuTarget,
  entryStateFilterLabel,
  entryStateNote,
  fullAccessBlock,
  groupByEntry,
  handleCode,
  handleLabel,
  isDocEndpointView,
  locusAccessRequest,
  locusRebindRequest,
  locusStateLabel,
  locusStateTone,
  locusStopRequest,
  rebindBlock,
  sessionAvailabilityLabel,
  sessionJumpBlock,
  stopBlock,
  summarizeLocusView,
  type ChatSection,
  type EntryBucketId,
  type HandleCodes,
  type LocusFilter,
  type WorkSectionView,
} from './locus-view.js'
import { PET_EXECUTOR_PRESET, chatAppLink } from '../wire.js'
import { WHEEL_CAPACITY } from './wheel.js'
import type {
  PetEnvRecord,
  PetLocusChatViewV20,
  PetLocusEntryViewV20,
  PetLocusManagementViewV20,
  PetLocusWorkViewV20,
  PetProjectionEntry,
  PetSkillRevision,
  PetChannelPhase,
  PetChannelView,
  PetExpressionView,
  PetSkillSelection,
  PetTodoAction,
  PetTodoDispatchReceipt,
  PetTodoStatus,
  PetTodoView,
  PetUnroutableView,
  PetUnifiedLocusReadiness,
  PetWorkspaceChoice,
} from '../wire.js'

/** The six stable tabs. */
export const PET_SETTINGS_TABS = [
  'general',
  'skills',
  'locus',
  'env',
  'channel',
  'diagnostics',
] as const

export type PetSettingsTab = (typeof PET_SETTINGS_TABS)[number]

/**
 * The Pet settings section.
 * @param props - Optionally the initially selected tab, for deep links.
 * @returns the rendered section.
 */
/**
 * A small "i" affordance for explanation text.
 *
 * Hover/focus only — no click state: explanation is a glance, not a mode. The
 * trigger is a real button so keyboard users can focus it, and the tooltip is
 * a described-by element rendered as a child of the wrapper so moving the
 * pointer into the tooltip keeps it open (links inside stay clickable).
 * @param props - Accessible label plus the explanation content.
 * @returns the disclosure control.
 */
export function InfoHint(props: {
  readonly label: string
  readonly children: ReactNode
}): JSX.Element {
  const id = useId()
  return (
    <span className="dshpet-info">
      <button
        type="button"
        className="dshpet-info-mark"
        aria-label={props.label}
        aria-describedby={id}
      >
        {/* Official Fluent info-outline glyph (14px) so this matches the
            DSH settings panels that use the shared icon set. */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M12.5757 7.00012C12.5757 3.92085 10.0794 1.42463 7.00012 1.42456C3.9208 1.42456 1.42456 3.9208 1.42456 7.00012C1.42463 10.0794 3.92085 12.5757 7.00012 12.5757C10.0793 12.5756 12.5756 10.0793 12.5757 7.00012ZM13.8002 7.00012C13.8001 10.7559 10.7559 13.8001 7.00012 13.8002C3.2443 13.8002 0.199291 10.7559 0.199219 7.00012C0.199219 3.24426 3.24426 0.199219 7.00012 0.199219C10.7559 0.199291 13.8002 3.2443 13.8002 7.00012Z"
            fill="currentColor"
          />
          <path d="M7.6127 3.18921V4.55986H6.38735V3.18921H7.6127Z" fill="currentColor" />
          <path d="M7.6127 5.68921V10.8109H6.38735V5.68921H7.6127Z" fill="currentColor" />
        </svg>
      </button>
      <span id={id} role="tooltip" className="dshpet-info-body">
        <span className="dshpet-info-card">{props.children}</span>
      </span>
    </span>
  )
}

/**
 * A stored setting: read-only until the user chooses to edit.
 *
 * Every persisted value in this panel behaves the same way — you can see what
 * is configured without exposing it to an accidental keystroke, and a change
 * only lands when you save. A rejected save keeps the editor open with the
 * input preserved so the invalid field can be corrected.
 *
 * @param props - Label, current value, options for a choice field, and the
 *   save handler which may reject with a user-facing message.
 * @returns the rendered setting row.
 */
function StoredField(props: {
  readonly label: string
  readonly value: string
  readonly placeholder?: string
  readonly options?: readonly { value: string; label: string }[]
  readonly emptyText?: string
  /** Optional explanation rendered as an info icon beside the label. */
  readonly info?: ReactNode
  /** Optional "restore default" action, shown only while editing. */
  readonly onReset?: () => Promise<void>
  readonly onSave: (next: string) => Promise<void>
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.value)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  // Adopt an externally refreshed value while not editing, so a save
  // elsewhere is reflected instead of showing a stale copy.
  useEffect(() => {
    if (!editing) setDraft(props.value)
  }, [props.value, editing])

  const shown = props.value.trim()
  const display =
    shown === ''
      ? (props.emptyText ?? '未设置')
      : (props.options?.find(option => option.value === shown)?.label ?? shown)

  if (!editing) {
    return (
      <div className="dshpet-field">
        <div className="dshpet-field-label">
          <span className="dshpet-fact-key">{props.label}</span>
          {props.info}
        </div>
        <div className="dshpet-row">
          <span className="dshpet-readonly" data-empty={shown === ''}>
            {display}
          </span>
          <button
            type="button"
            className="dshpet-action"
            onClick={() => {
              setError(undefined)
              setEditing(true)
            }}
          >
            编辑
          </button>
        </div>
      </div>
    )
  }

  const commit = (): void => {
    setError(undefined)
    setBusy(true)
    void props
      .onSave(draft.trim())
      .then(() => {
        // Return to read-only only once the write actually succeeded.
        setEditing(false)
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="dshpet-field">
      <div className="dshpet-field-label">
        <span className="dshpet-fact-key">{props.label}</span>
        {props.info}
      </div>
      {props.options === undefined ? (
        <input
          className="dshpet-input"
          value={draft}
          placeholder={props.placeholder ?? ''}
          onChange={event => setDraft(event.target.value)}
        />
      ) : (
        <select
          className="dshpet-input"
          value={draft}
          onChange={event => setDraft(event.target.value)}
        >
          {props.options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      <div className="dshpet-actions">
        <button type="button" className="dshpet-action" disabled={busy} onClick={commit}>
          保存
        </button>
        <button
          type="button"
          className="dshpet-action"
          disabled={busy}
          onClick={() => {
            setError(undefined)
            setDraft(props.value)
            setEditing(false)
          }}
        >
          取消
        </button>
        {props.onReset !== undefined ? (
          <button
            type="button"
            className="dshpet-action"
            disabled={busy}
            onClick={() => {
              const reset = props.onReset
              if (reset === undefined) return
              setError(undefined)
              setBusy(true)
              void reset()
                .then(() => setEditing(false))
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                )
                .finally(() => setBusy(false))
            }}
          >
            恢复默认
          </button>
        ) : null}
      </div>
      {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
    </div>
  )
}

/** Chinese labels for the stable tab ids, which stay English on the wire. */
const TAB_LABELS: Record<PetSettingsTab, string> = {
  general: '通用',
  skills: 'Skill',
  locus: 'Locus 管理',
  env: '环境变量',
  channel: '飞书',
  diagnostics: '诊断',
}

/**
 * A titled section of a tab.
 *
 * The single unit of grouping on this page. Every control belongs to exactly
 * one, so a tab reads as a few named concerns instead of one long column of
 * equally weighted rows.
 * @param props - Title, optional collapsed default, an optional one-line
 *   summary shown on the closed header, and the section body.
 * @returns the rendered group.
 */
function Group(props: {
  readonly title: string
  /**
   * Render collapsed behind a disclosure.
   *
   * For reference material — import instructions, file health, security
   * notes — which the user consults occasionally but which otherwise
   * dominates the page simply by being printed in full. Primary controls are
   * never folded: a setting you cannot see is a setting you cannot find.
   */
  readonly collapsible?: boolean
  /** Open on first render; only meaningful with `collapsible`. */
  readonly defaultOpen?: boolean
  /** A short status shown on the header, so a closed group can be judged. */
  readonly note?: string
  readonly children: ReactNode
}): JSX.Element {
  if (props.collapsible !== true) {
    return (
      <section className="dshpet-group">
        <h3 className="dshpet-group-title">{props.title}</h3>
        {props.children}
      </section>
    )
  }

  // `<details>` rather than a state-driven div: the open/closed state, the
  // keyboard activation and the ARIA expanded semantics are all native, so
  // there is nothing here to get wrong or to leave out.
  return (
    <details className="dshpet-group dshpet-fold" open={props.defaultOpen ?? false}>
      <summary className="dshpet-fold-head">
        <span className="dshpet-fold-mark" aria-hidden="true">
          ›
        </span>
        <span className="dshpet-fold-title">{props.title}</span>
        {props.note !== undefined ? (
          <span className="dshpet-fold-note">{props.note}</span>
        ) : null}
      </summary>
      <div className="dshpet-fold-body">{props.children}</div>
    </details>
  )
}

export function PetSettingsSection(props: { initialTab?: PetSettingsTab } = {}): JSX.Element {
  const [tab, setTab] = useState<PetSettingsTab>(props.initialTab ?? 'general')

  return (
    <div className="dshpet-settings">
      <div className="dshpet-settings-tabs" role="tablist" aria-label="Pet settings">
        {PET_SETTINGS_TABS.map(name => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`dshpet-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`dshpet-panel-${name}`}
            className="dshpet-settings-tab"
            onClick={() => setTab(name)}
          >
            {TAB_LABELS[name]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`dshpet-panel-${tab}`} aria-labelledby={`dshpet-tab-${tab}`}>
        {tab === 'general' ? <GeneralTab /> : null}
        {tab === 'skills' ? <SkillsTab /> : null}
        {tab === 'locus' ? <LocusTab /> : null}
        {tab === 'env' ? <EnvironmentTab /> : null}
        {tab === 'channel' ? <ChannelTab /> : null}
        {tab === 'diagnostics' ? <DiagnosticsTab /> : null}
      </div>
    </div>
  )
}

/** General: the followed model, appearance reset and default context policy. */
function GeneralTab(): JSX.Element {
  const [config, setConfig] = useState<PetConfig | undefined>(undefined)
  const [accent, setAccent] = useState<PetAccentId>('default')
  const [glyph, setGlyph] = useState(DEFAULT_GLYPH)
  const [size, setSize] = useState<PetSizeId>('medium')
  const [ringStyle, setRingStyle] = useState<PetRingStyleId>(DEFAULT_RING_STYLE)
  const [animationPlayback, setAnimationPlayback] = useState<PetAnimationPlayback>('loop')
  // Emoji glyph and imported animation are two FORMS of the same mascot, not
  // two independent settings to scroll past: only one is shown at a time.
  const [form, setForm] = useState<'emoji' | 'lottie'>('emoji')
  const formTouched = useRef(false)
  const selectForm = (next: 'emoji' | 'lottie'): void => {
    formTouched.current = true
    setForm(next)
  }

  /**
   * Persist the playback mode immediately (the control is a radio, not a
   * read-only row with an edit mode). Older Hosts drop unknown appearance
   * keys but still answer 200, so the echoed value is verified.
   */
  const saveAnimationPlayback = async (next: PetAnimationPlayback): Promise<void> => {
    try {
      const updated = await petApi.updateConfig({
        appearance: { animationPlayback: next },
      })
      setConfig(updated)
      if (updated.appearance?.animationPlayback !== next) {
        throw new Error(
          '当前运行中的 DSH Host 还没有加载「动画播放」设置；请重启 DSH 后再保存。',
        )
      }
      setAnimationPlayback(resolveAnimationPlayback(next))
      setError(undefined)
      globalThis.dispatchEvent?.(new Event(PET_APPEARANCE_EVENT))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const [presetOptions, setPresetOptions] = useState<
    readonly { value: string; label: string }[]
  >([])
  const [error, setError] = useState<string | undefined>(undefined)

  // The model is read-only here: Pet follows DSH's default selection, so
  // there is no Pet-owned draft to edit or save.
  useEffect(() => {
    void petApi
      .config()
      .then(value => {
        setConfig(value)
        // Seed the controls from the persisted configuration.
        const look = value.appearance ?? {}
        setAccent(resolveAccent(look.accent).id)
        setGlyph(look.glyph === undefined || look.glyph === '' ? DEFAULT_GLYPH : look.glyph)
        setSize(PET_SIZES.find(item => item.id === look.size)?.id ?? 'medium')
        setRingStyle(
          PET_RING_STYLES.find(item => item.id === look.ringStyle)?.id ?? DEFAULT_RING_STYLE,
        )
        setAnimationPlayback(resolveAnimationPlayback(look.animationPlayback))
      })
      .catch((cause: unknown) => setError(String(cause)))
  }, [])

  // Open the form the owner actually uses. Presence is published by the
  // overlay (which mounts with the app) and by this section's own reads, so
  // opening Settings later still lands on the active form. A manual switch is
  // never overridden.
  const expressionPresence = useSyncExternalStore(
    subscribeExpressionPresence,
    getExpressionPresence,
    getExpressionPresence,
  )
  useEffect(() => {
    if (formTouched.current) return
    if (expressionPresence === 'ok') setForm('lottie')
    else if (expressionPresence === 'none') setForm('emoji')
  }, [expressionPresence])
  // Nothing has published yet (settings mounted before the overlay's first
  // read): read once and publish, so the form still follows the real state.
  useEffect(() => {
    if (getExpressionPresence() !== 'unknown') return
    void petApi
      .expression()
      .then(view => setExpressionPresence(view.state === 'ok' ? 'ok' : 'none'))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void petApi
      .presets()
      .then(result =>
        setPresetOptions(result.presets.map(item => ({ value: item.id, label: item.label }))),
      )
      // A Host without presets simply offers the default composition.
      .catch(() => setPresetOptions([]))
  }, [])

  return (
    <div className="dshpet-settings">
      <Group title="模型">
        <p className="dshpet-item-hint">
          Pet 执行会话跟随 DSH 的默认模型。在「设置 → 模型」修改后，下一次调用即生效，
          Pet 侧无需另行配置，也不会出现两处不一致。
        </p>
        <div className="dshpet-fact">
          <span className="dshpet-fact-key">当前模型</span>
          <span className="dshpet-fact-value">
            <code>{config?.providerId ?? '…'}</code>
            {config?.modelId !== undefined ? <> / <code>{config.modelId}</code></> : null}
          </span>
        </div>
        {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
      </Group>

      <Group title="Agent 预设">
        <p className="dshpet-item-hint">
          Agent 预设决定执行会话装载哪些插件与工具。默认使用
          <strong>「Pet 执行会话」</strong>——它与官方 standard 的唯一差别是
          不加载本地 Skill 发现，因此只有你在 Pet 里启用的 Skill 对执行会话可见。
        </p>
        {/* A warning about widening the authorization boundary, not a failure
            that already happened: plain red body text read as the latter. */}
        <p className="dshpet-callout" data-tone="warn">
          改成 standard 等其它预设会让全局安装的 Skill 也对执行会话可见，
          相当于放宽授权范围。除非你明确需要，否则保持默认。
        </p>
        <StoredField
          label="预设"
          // Unset means Pet's own executor preset, not the Host default: it is
          // what actually composes the executor, so the field must say so.
          value={config?.agentPreset ?? PET_EXECUTOR_PRESET}
          emptyText="Pet 执行会话（推荐）"
          // Enumerated from what this Host offers: a typed name could refer to
          // a composition that does not exist.
          options={presetOptions}
          onSave={async next => {
            const updated = await petApi.updateConfig({ agentPreset: next })
            setConfig(updated)
          }}
        />
        <p className="dshpet-item-hint">
          Pet 自己的上下文由常驻指令和每次调用的任务信封提供：告诉执行会话它是 Pet
          任务会话、一个会话会串行承载多次调用、以及本次调用的来源与快照。
          这些始终生效，与这里选什么预设无关。
        </p>
      </Group>

      <Group title="外观">
        <p className="dshpet-item-hint">
          吉祥物有两种形态：静态 emoji 图标，或导入的 Lottie 动画。两者共用配色与尺寸，
          但同一时间只展示其中一种。
        </p>
        <div className="dshpet-segmented" role="tablist" aria-label="吉祥物形态">
          <button
            type="button"
            role="tab"
            id="dshpet-form-tab-emoji"
            aria-selected={form === 'emoji'}
            aria-controls="dshpet-form-panel-emoji"
            className="dshpet-segment"
            data-selected={form === 'emoji'}
            onClick={() => selectForm('emoji')}
          >
            Emoji 图标
          </button>
          <button
            type="button"
            role="tab"
            id="dshpet-form-tab-lottie"
            aria-selected={form === 'lottie'}
            aria-controls="dshpet-form-panel-lottie"
            className="dshpet-segment"
            data-selected={form === 'lottie'}
            onClick={() => selectForm('lottie')}
          >
            动画表情
          </button>
        </div>

        <div
          role="tabpanel"
          id="dshpet-form-panel-emoji"
          aria-labelledby="dshpet-form-tab-emoji"
          className="dshpet-form-panel"
          hidden={form !== 'emoji'}
        >
        <div className="dshpet-swatches" role="radiogroup" aria-label="桌宠配色">
          {PET_ACCENTS.map(item => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={accent === item.id}
              aria-label={item.label}
              title={item.label}
              className="dshpet-swatch"
              data-selected={accent === item.id}
              style={{ background: item.background }}
              onClick={() => {
                setAccent(item.id)
                // Settings are configuration: they belong in the Host config
                // file, not `localStorage` — the plugin runtime has no usable
                // browser storage, so writes there are silently lost.
                void petApi
                  .updateConfig({ appearance: { accent: item.id } })
                  .then(next => {
                    setConfig(next)
                    // Tell a mounted Pet to re-read without a reload.
                    globalThis.dispatchEvent?.(new Event(PET_ACCENT_EVENT))
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
              }}
            >
              {glyph}
            </button>
          ))}
        </div>

        <StoredField
          label="图标"
          value={glyph}
          placeholder="🐾"
          onReset={async () => {
            const updated = await petApi.updateConfig({ appearance: { glyph: '' } })
            setConfig(updated)
            setGlyph(DEFAULT_GLYPH)
            globalThis.dispatchEvent?.(new Event(PET_APPEARANCE_EVENT))
          }}
          onSave={async next => {
            // Only the first grapheme is kept; blank restores the default.
            const glyphValue = normalizeGlyph(next)
            const updated = await petApi.updateConfig({
              appearance: { glyph: glyphValue },
            })
            setConfig(updated)
            setGlyph(glyphValue === '' ? DEFAULT_GLYPH : glyphValue)
            globalThis.dispatchEvent?.(new Event(PET_APPEARANCE_EVENT))
          }}
        />
        <p className="dshpet-item-hint">
          一个 emoji 或字符。留空或点「恢复默认」都会回到 {DEFAULT_GLYPH}。
        </p>

        {/* Two single-select appearance controls; side by side they read as
            one "shape" concern instead of two unrelated full-width rows. */}
        <div className="dshpet-row">
        <label className="dshpet-field">
          尺寸
          <select
            className="dshpet-input"
            value={size}
            onChange={event => {
              const next = event.target.value as PetSizeId
              setSize(next)
              void petApi
                .updateConfig({ appearance: { size: next } })
                .then(updated => {
                  setConfig(updated)
                  globalThis.dispatchEvent?.(new Event(PET_APPEARANCE_EVENT))
                })
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                )
            }}
          >
            {PET_SIZES.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}（{item.px}px）
              </option>
            ))}
          </select>
        </label>

        <label className="dshpet-field">
          圆环底色
          <select
            className="dshpet-input"
            value={ringStyle}
            onChange={event => {
              const next = event.target.value as PetRingStyleId
              setRingStyle(next)
              void petApi
                .updateConfig({ appearance: { ringStyle: next } })
                .then(updated => {
                  setConfig(updated)
                  globalThis.dispatchEvent?.(new Event(PET_APPEARANCE_EVENT))
                })
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                )
            }}
          >
            {PET_RING_STYLES.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        </div>
        <p className="dshpet-item-hint">
          能力轮盘的圆环底色跟随上面的配色，由内向外逐圈变淡。
          「默认」配色本身是白色，任何档位下圆环都靠描边区分。
        </p>

        </div>

        <div
          role="tabpanel"
          id="dshpet-form-panel-lottie"
          aria-labelledby="dshpet-form-tab-lottie"
          className="dshpet-form-panel"
          hidden={form !== 'lottie'}
        >
        <div className="dshpet-inline-row">
          <div className="dshpet-field-head">
            <span className="dshpet-fact-key">动画播放</span>
            <InfoHint label="播放模式说明">
              <p>「自动循环」一直播放；「悬停时播放」平时停在动画首帧，指针移入才循环。</p>
              <p>系统「减少动效」偏好始终优先：无论哪种模式都停在首帧。</p>
            </InfoHint>
          </div>
          <div className="dshpet-segmented" role="radiogroup" aria-label="动画播放">
            {PET_ANIMATION_PLAYBACKS.map(item => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={animationPlayback === item.id}
                className="dshpet-segment"
                data-selected={animationPlayback === item.id}
                onClick={() => void saveAnimationPlayback(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <ExpressionSection />
        </div>
      </Group>

      <Group title="新建任务">
        <p className="dshpet-item-hint">
          新任务默认关联哪个来源。选择「不关联」时任务独立运行，
          除非你在调用前手动指定来源。
        </p>
        <StoredField
          label="默认上下文策略"
          value={config?.defaultContextPolicy ?? 'current-session'}
          options={[
            { value: 'current-session', label: '当前会话' },
            { value: 'none', label: '不关联' },
          ]}
          onSave={async next => {
            const updated = await petApi.updateConfig({
              defaultContextPolicy: next === 'none' ? 'none' : 'current-session',
            })
            setConfig(updated)
          }}
        />
      </Group>
    </div>
  )
}

/**
 * Copy shown (and confirmed) before replacing an already-imported animation.
 *
 * Exported so the replacement-warning contract is assertable from the static
 * markup test instead of relying on a live `confirm`.
 */
export const EXPRESSION_REPLACE_WARNING =
  '当前动画将被替换且不保留，如需保留请先复制导出。'

/**
 * Owner-imported mascot animation (Lottie JSON only).
 *
 * The flow is deliberately one textarea: the owner copies the JSON from the
 * site they already use, pastes it here and saves. The Host does the security
 * validation; this surface only reports what the Host answered, plus the
 * mascot root's own render diagnostic (shared through `mascot-diagnostics`).
 * @returns the animation settings group.
 */
export function ExpressionSection(): JSX.Element {
  const [view, setView] = useState<PetExpressionView | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [urlDraft, setUrlDraft] = useState('')
  const [busy, setBusy] = useState<'idle' | 'import' | 'url' | 'remove'>('idle')
  /**
   * A destructive import/removal waiting for an IN-PAGE confirmation.
   *
   * Deliberately not `window.confirm`: a WebView/PWA may suppress native
   * dialogs (or the user may have ticked "prevent additional dialogs"), and a
   * silently-cancelled confirm looks exactly like a dead button — the button
   * click does nothing and no state changes. An inline confirmation is always
   * visible and always actionable.
   */
  const [pending, setPending] = useState<'import' | 'url' | 'remove' | undefined>(undefined)
  /** URL import or pasted JSON — one method shown at a time. */
  const [importMode, setImportMode] = useState<'url' | 'json'>('url')
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [renderDiagnostic, setRenderDiagnostic] = useState<string | undefined>(
    getMascotExpressionDiagnostic(),
  )

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await petApi.expression()
      setExpressionPresence(next.state === 'ok' ? 'ok' : 'none')
      setView(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
    return subscribeMascotExpressionDiagnostic(() =>
      setRenderDiagnostic(getMascotExpressionDiagnostic()),
    )
  }, [refresh])

  /** The projection when an animation is active. */
  const saved = view?.state === 'ok' ? view : undefined

  const executeImport = async (kind: 'import' | 'url'): Promise<void> => {
    setPending(undefined)
    setBusy(kind)
    setError(undefined)
    setNotice(undefined)
    try {
      const result =
        kind === 'import'
          ? await petApi.importExpression(draft)
          : await petApi.importExpressionFromUrl(urlDraft.trim())
      if (kind === 'import') setDraft('')
      else setUrlDraft('')
      setCopied(false)
      setRenderDiagnostic(undefined)
      await refresh()
      setNotice(`已导入动画（${result.bytes} 字节）。`)
      // The mascot lives on another React root; this is the same broadcast the
      // glyph/accent controls already use.
      globalThis.dispatchEvent?.(new Event(PET_APPEARANCE_EVENT))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('idle')
    }
  }

  const beginImport = (kind: 'import' | 'url'): void => {
    if (kind === 'import' && draft.trim() === '') {
      setError('请先粘贴 Lottie JSON 内容。')
      return
    }
    if (kind === 'url' && urlDraft.trim() === '') {
      setError('请先填写要导入的 https URL。')
      return
    }
    setError(undefined)
    setNotice(undefined)
    // Nothing to lose when no animation is active: import immediately.
    if (saved === undefined) {
      void executeImport(kind)
      return
    }
    setPending(kind)
  }

  const executeRemove = async (): Promise<void> => {
    setPending(undefined)
    setBusy('remove')
    setError(undefined)
    setNotice(undefined)
    try {
      await petApi.removeExpression()
      await refresh()
      setNotice('已移除动画，吉祥物恢复显示图标。')
      globalThis.dispatchEvent?.(new Event(PET_APPEARANCE_EVENT))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy('idle')
    }
  }

  const copySource = async (): Promise<void> => {
    if (saved === undefined) return
    try {
      await navigator.clipboard.writeText(saved.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('复制失败，请手动选择保存的 JSON 文本复制。')
    }
  }

  const confirming = pending !== undefined

  return (
    <div className="dshpet-form-panel">
      <div className="dshpet-expression-status">
        <span className="dshpet-expression-fact">
          {saved !== undefined
            ? `已导入 · ${saved.bytes} 字节 · ${new Date(saved.importedAt).toLocaleString()}`
            : view?.state === 'corrupt'
              ? `当前动画不可用：${view.diagnostic}`
              : '当前未导入动画'}
        </span>
        <span className="dshpet-expression-actions">
          <button
            type="button"
            className="dshpet-action dshpet-action-sm"
            disabled={busy !== 'idle' || saved === undefined}
            onClick={() => void copySource()}
          >
            {copied ? '已复制' : '复制导出'}
          </button>
          <button
            type="button"
            className="dshpet-action dshpet-action-sm dshpet-action-danger"
            disabled={busy !== 'idle' || saved === undefined}
            onClick={() => setPending('remove')}
          >
            {busy === 'remove' ? '移除中…' : '移除'}
          </button>
        </span>
      </div>

      {renderDiagnostic !== undefined ? (
        <p className="dshpet-error">动画渲染失败：{renderDiagnostic}</p>
      ) : null}

      {pending === 'remove' ? (
        <div className="dshpet-callout" data-tone="warn">
          移除后吉祥物会恢复显示图标，并保留一份最近素材的备份。
          <div className="dshpet-row">
            <button
              type="button"
              className="dshpet-action"
              disabled={busy !== 'idle'}
              onClick={() => void executeRemove()}
            >
              确认移除
            </button>
            <button
              type="button"
              className="dshpet-action"
              disabled={busy !== 'idle'}
              onClick={() => setPending(undefined)}
            >
              取消
            </button>
          </div>
        </div>
      ) : confirming ? (
        <div className="dshpet-callout" data-tone="warn">
          {EXPRESSION_REPLACE_WARNING}
          <div className="dshpet-row">
            <button
              type="button"
              className="dshpet-action"
              disabled={busy !== 'idle'}
              onClick={() => void executeImport(pending === 'url' ? 'url' : 'import')}
            >
              确认替换
            </button>
            <button
              type="button"
              className="dshpet-action"
              disabled={busy !== 'idle'}
              onClick={() => setPending(undefined)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div className="dshpet-inline-row">
        <div className="dshpet-segmented" role="radiogroup" aria-label="导入方式">
          <button
            type="button"
            role="radio"
            aria-checked={importMode === 'url'}
            aria-label="从 URL 导入"
            className="dshpet-segment"
            data-selected={importMode === 'url'}
            onClick={() => setImportMode('url')}
          >
            URL 导入
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={importMode === 'json'}
            aria-label="粘贴 JSON"
            className="dshpet-segment"
            data-selected={importMode === 'json'}
            onClick={() => setImportMode('json')}
          >
            粘贴 JSON
          </button>
        </div>
        <InfoHint label="格式与存储说明">
          <p>只接受 Lottie JSON 文本；不支持 SVG、PNG/GIF 或其它格式。</p>
          <p>动画保存在 Pet 的状态目录（<code>plugins/dsh-pet/expressions/</code>），不写入配置数据库。</p>
          <p>素材的来源与许可由你自行负责；对外分发前请确认原作者许可。</p>
        </InfoHint>
      </div>

      {importMode === 'url' ? (
        <div className="dshpet-field">
          <div className="dshpet-field-head">
            <span className="dshpet-fact-key">URL</span>
            <InfoHint label="URL 导入规则">
              <p>由运行 DSH 的 Host 下载，因此浏览器网络受限或受 CORS 限制时仍可用。</p>
              <p>沿用 Host 的网络与代理配置；支持 HTTPS，单文件 ≤512 KiB，下载超时 10 秒。</p>
              <p>下载失败会在页内显示诊断，现有动画保持不变。</p>
            </InfoHint>
          </div>
          <div className="dshpet-url-row">
            <input
              className="dshpet-input"
              type="url"
              value={urlDraft}
              spellCheck={false}
              disabled={busy !== 'idle'}
              onChange={event => setUrlDraft(event.target.value)}
              placeholder="https://example.com/animations/lottie.json"
            />
            <button
              type="button"
              className="dshpet-action dshpet-action-primary"
              disabled={busy !== 'idle' || urlDraft.trim() === ''}
              onClick={() => beginImport('url')}
            >
              {busy === 'url' ? '导入中…' : '从 URL 导入'}
            </button>
          </div>
        </div>
      ) : (
        <div className="dshpet-field">
          <textarea
            className="dshpet-textarea"
            value={draft}
            spellCheck={false}
            disabled={busy !== 'idle'}
            onChange={event => setDraft(event.target.value)}
            placeholder='{"v":"5.7.0","w":100,"h":100,"layers":[...]}'
          />
          <div className="dshpet-row">
            <button
              type="button"
              className="dshpet-action"
              disabled={busy !== 'idle' || draft.trim() === ''}
              onClick={() => beginImport('import')}
            >
              {busy === 'import' ? '导入中…' : '粘贴导入'}
            </button>
          </div>
        </div>
      )}

      <p className="dshpet-item-hint">
        找素材：
        <a
          className="dshpet-link"
          href="https://googlefonts.github.io/noto-emoji-animation/"
          target="_blank"
          rel="noreferrer"
        >
          Google Noto 动画 emoji
        </a>
        <InfoHint label="素材来源">
          <p>方形构图、适合小图标；素材为 CC BY 4.0，对外使用需署名。</p>
          <p>
            直链形如 <code>https://fonts.gstatic.cn/s/e/notoemoji/latest/1f914/lottie.json</code>；
            <code>fonts.gstatic.com</code> 不通时换成 <code>fonts.gstatic.cn</code>，由 Host 下载即可。
          </p>
          <p>
            也可以去
            <a
              className="dshpet-link"
              href="https://lottiefiles.com/free-animations"
              target="_blank"
              rel="noreferrer"
            >
              LottieFiles
            </a>
            ，素材更多，但每个作品的许可不同，商用前逐个确认。
          </p>
        </InfoHint>
      </p>

      {notice !== undefined ? <p className="dshpet-item-hint">{notice}</p> : null}
      {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
    </div>
  )
}
// ---------------------------------------------------------------------------
// Owner-facing locus management surface (v20, pet-locus-isomorphic-entries D10).
//
// Grouped by the work session W; one row per entry, topics nested under their
// group row by chatId. Three mutations only — stop, access, rebind — each
// fenced by {expectedLocusId, expectedRevision} and greyed with a stated
// reason before the click. Two rules this surface must not break:
//   - it invents nothing: states, availability, in-flight and the write switch
//     all come from the Host snapshot; labels and groupings are derived here;
//   - a rejected Host action never changes what is shown: the snapshot is
//     re-read after a successful call, never patched optimistically.
// ---------------------------------------------------------------------------

/** Which reading of the same associations is on screen. */
type LocusReading = 'work' | 'entry'

/** Runs one Host action; resolves true when it succeeded. */
type LocusActionRunner = (key: string, operation: () => Promise<unknown>) => Promise<boolean>

/** Copy a value, tolerating every way a browser can refuse the clipboard. */
function copyValue(value: string): void {
  void globalThis.navigator?.clipboard?.writeText(value).catch(() => undefined)
}

/** A short "how long ago", for facts whose freshness matters more than the date. */
function formatRelative(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.round(hours / 24)} 天前`
}

/** A display alias that copies its full identifier. */
function HandleChip(props: {
  readonly value: string
  readonly code: string
  readonly label?: string
}): JSX.Element {
  return (
    <button
      type="button"
      className="dshpet-handle"
      title={`复制 ${props.value}`}
      onClick={() => copyValue(props.value)}
    >
      {props.label === undefined ? props.code : `${props.label} ${props.code}`}
    </button>
  )
}

/** A navigation control. Navigation and mutation look different on purpose. */
function Jump(props: {
  readonly label: string
  readonly title: string
  readonly href?: string
  readonly disabled?: boolean
  readonly onClick?: () => void
}): JSX.Element {
  const disabled = props.disabled === true
  if (props.href !== undefined && !disabled) {
    return (
      <a className="dshpet-jump" href={props.href} target="_blank" rel="noreferrer" title={props.title}>
        {props.label} <span aria-hidden="true">↗</span>
      </a>
    )
  }
  return (
    <button
      type="button"
      className="dshpet-jump"
      data-disabled={disabled}
      title={props.title}
      disabled={disabled}
      onClick={props.onClick}
    >
      {props.label} <span aria-hidden="true">↗</span>
    </button>
  )
}

/** `S·xxxx` for a session id, from the snapshot-wide codes. */
function sessionCode(codes: HandleCodes, sessionId: string): string {
  return handleLabel('session', codes.session.get(sessionId) ?? handleCode(sessionId, 'session'))
}

/**
 * One entry's disclosure: identifiers and its two per-entry mutations.
 *
 * Exported for the rendering tests: the disclosure is collapsed until opened,
 * so a surface-level snapshot cannot see these controls.
 */
export function LocusDetails(props: {
  readonly entry: PetLocusEntryViewV20
  readonly chat: PetLocusChatViewV20
  readonly writeEnabled: boolean
  readonly codes: HandleCodes
  readonly busyKey: string | undefined
  readonly onAction: LocusActionRunner
}): JSX.Element {
  const { entry, chat } = props
  const blocked = props.busyKey !== undefined
  const access = accessBlock(entry)
  const full = fullAccessBlock({ writeEnabled: props.writeEnabled })
  const stop = stopBlock(entry)
  const isFull = entry.accessMode === 'danger-full-access'
  const threadId = entry.endpoint.threadId
  const run = (name: string, operation: () => Promise<unknown>): (() => void) => () => {
    void props.onAction(`${entry.locusId}:${name}`, operation)
  }

  return (
    <dl className="dshpet-locus-details">
      <dt>标识符</dt>
      <dd>
        <HandleChip value={entry.locusId} code={handleLabel('locus', props.codes.locus.get(entry.locusId) ?? handleCode(entry.locusId, 'locus'))} />
        <HandleChip
          value={entry.endpoint.chatId}
          code={endpointHandleLabel({ chatId: entry.endpoint.chatId }, props.codes.endpoint.get(endpointHandleId({ chatId: entry.endpoint.chatId })) ?? '')}
        />
        {threadId === undefined ? null : (
          <HandleChip
            value={threadId}
            code={endpointHandleLabel(entry.endpoint, props.codes.endpoint.get(endpointHandleId(entry.endpoint)) ?? '')}
          />
        )}
        <HandleChip value={entry.sessionId} code={sessionCode(props.codes, entry.sessionId)} label="子会话" />
        <HandleChip value={chat.locusMain.sessionId} code={sessionCode(props.codes, chat.locusMain.sessionId)} label="M" />
        <HandleChip
          value={chat.workspace.workspaceId}
          code={handleLabel('workspace', props.codes.workspace.get(chat.workspace.workspaceId) ?? '')}
        />
      </dd>

      <dt>访问模式</dt>
      <dd>
        {LOCUS_ACCESS_LABELS[entry.accessMode]}
        {isFull ? ` · ${LOCUS_FULL_ACCESS_NOTE}` : ''}
      </dd>

      <dt>操作</dt>
      <dd className="dshpet-locus-ops">
        <span className="dshpet-locus-perm" role="group" aria-label="访问模式">
          <button
            type="button"
            aria-pressed={!isFull}
            disabled={blocked || access !== undefined || !isFull}
            onClick={run('access-read-only', () => petApi.locusAction(locusAccessRequest(entry, 'read-only')))}
          >
            只读
          </button>
          <button
            type="button"
            aria-pressed={isFull}
            disabled={blocked || access !== undefined || full !== undefined || isFull}
            title={full ?? `完全访问：${LOCUS_FULL_ACCESS_NOTE}`}
            onClick={run('access-full', () => petApi.locusAction(locusAccessRequest(entry, 'danger-full-access')))}
          >
            完全访问
          </button>
        </span>
        {access === undefined ? null : <span className="dshpet-meta" data-reason="access">{access}</span>}
        {access !== undefined || full === undefined ? null : <span className="dshpet-meta" data-reason="full-access">{full}</span>}
        <button
          type="button"
          className="dshpet-action dshpet-action-sm dshpet-action-danger"
          disabled={blocked || stop !== undefined}
          title={stop ?? '停止服务；会话与飞书资源保留'}
          onClick={run('stop', () => petApi.locusAction(locusStopRequest(entry)))}
        >
          停止
        </button>
        {stop === undefined || entry.state === 'stopped' ? null : <span className="dshpet-meta" data-reason="stop">{stop}</span>}
      </dd>
    </dl>
  )
}

/**
 * 「改绑到其他会话」, directly on the group / doc-root row.
 *
 * The input is sent as typed (trimmed): a short code is never resolved. The
 * input is kept when the Host refuses, and cleared only after success.
 */
export function RebindControl(props: {
  readonly chat: PetLocusChatViewV20
  readonly work: PetLocusWorkViewV20
  readonly busyKey: string | undefined
  readonly onAction: LocusActionRunner
  /** Test seam: start with the dialog open and this input. */
  readonly initialInput?: string
}): JSX.Element {
  const [open, setOpen] = useState(props.initialInput !== undefined)
  const [input, setInput] = useState(props.initialInput ?? '')
  const block = rebindBlock(props.chat, props.work)
  const disabled = props.busyKey !== undefined || block !== undefined
  const submit = (): void => {
    if (input.trim() === '') return
    void props.onAction(
      `${props.chat.group.locusId}:rebind`,
      () => petApi.locusAction(locusRebindRequest(props.chat, input)),
    ).then(ok => {
      if (!ok) return
      setOpen(false)
      setInput('')
    })
  }
  return (
    <span className="dshpet-locus-rebind">
      <button
        type="button"
        className="dshpet-action dshpet-action-sm"
        disabled={disabled}
        title={block ?? '把整个群改绑到另一个工作会话'}
        onClick={() => { if (!disabled) setOpen(true) }}
      >
        改绑到其他会话
      </button>
      {block === undefined ? null : <span className="dshpet-meta" data-reason="rebind">{block}</span>}
      {!open || block !== undefined ? null : (
        <span className="dshpet-locus-rebind-dialog" role="dialog" aria-label="改绑到其他会话">
          <input
            className="dshpet-input"
            value={input}
            placeholder="目标工作会话的完整 sessionId（session-…）"
            aria-label="目标工作会话 sessionId"
            onChange={event => setInput(event.target.value)}
          />
          <span className="dshpet-meta">{LOCUS_REBIND_CONSEQUENCES}</span>
          <button
            type="button"
            className="dshpet-action dshpet-action-sm dshpet-action-primary"
            disabled={props.busyKey !== undefined || input.trim() === ''}
            onClick={submit}
          >
            确认
          </button>
          <button type="button" className="dshpet-jump" onClick={() => setOpen(false)}>取消</button>
        </span>
      )}
    </span>
  )
}

/** One entry row (group row, doc root, topic or comment). */
function LocusRow(props: {
  readonly entry: PetLocusEntryViewV20
  readonly chat: PetLocusChatViewV20
  readonly work: PetLocusWorkViewV20
  readonly reading: LocusReading
  readonly writeEnabled: boolean
  readonly codes: HandleCodes
  readonly busyKey: string | undefined
  readonly onAction: LocusActionRunner
  readonly open: boolean
  readonly onToggle: () => void
  readonly nested: boolean
}): JSX.Element {
  const { entry, chat, work } = props
  const isGroup = entry.endpoint.threadId === undefined
  const endpointCode = props.codes.endpoint.get(endpointHandleId(entry.endpoint)) ?? ''
  const display = entryDisplayName(entry.endpoint, endpointCode)
  const isDoc = isDocEndpointView(entry.endpoint)
  const feishu = entryFeishuTarget(entry.endpoint, chatAppLink)
  const childBlock = childJumpBlock(entry)
  const stateNote = entryStateNote(entry)
  const archivedNote = isGroup ? archivedWorkNote(work) : undefined
  const mainBlock = sessionJumpBlock(chat.locusMain.availability ?? 'unknown')
  const workBlock = sessionJumpBlock(work.availability)

  return (
    <>
      <div className="dshpet-locus-row" data-nested={props.nested} data-open={props.open}>
        <span className="dshpet-locus-node" data-tone={locusStateTone(entry.state)} aria-hidden="true" />
        <div className="dshpet-locus-row-body">
          <div className="dshpet-locus-row-line">
            <span className="dshpet-locus-name" data-placeholder={display.isPlaceholder}>{display.name}</span>
            {endpointCode === '' ? null : (
              <HandleChip value={endpointHandleId(entry.endpoint)} code={endpointHandleLabel(entry.endpoint, endpointCode)} />
            )}
            {display.isPlaceholder ? <span className="dshpet-meta">（兜底显示）</span> : null}
            {isGroup && chat.defaultQa === true ? <span className="dshpet-chip" data-tone="qa">默认 Q&amp;A</span> : null}
            {isDoc && isGroup ? <span className="dshpet-meta">本文档的评论者均可提问</span> : null}
            {entry.inFlight ? <span className="dshpet-chip" data-tone="busy">投递中</span> : null}
          </div>
          <div className="dshpet-locus-row-line">
            <span className="dshpet-meta" data-state={entry.state}>
              {locusStateLabel(entry.state)} · {LOCUS_ACCESS_LABELS[entry.accessMode]}
            </span>
            {entry.accessMode === 'danger-full-access'
              ? <span className="dshpet-meta">{LOCUS_FULL_ACCESS_NOTE}</span>
              : null}
            {stateNote === undefined ? null : <span className="dshpet-meta">{stateNote}</span>}
            <span className="dshpet-meta dshpet-locus-session-title" title={entry.session?.title}>
              子会话 {entry.state === 'not-created' ? LOCUS_NOT_CREATED_SESSION : entry.session?.title ?? '未命名'}
            </span>
          </div>
          {!isGroup || (chat.reboundFrom === undefined && archivedNote === undefined) ? null : (
            <div className="dshpet-locus-row-line">
              {chat.reboundFrom === undefined ? null : (
                <span className="dshpet-meta">
                  改绑自 {chat.reboundFrom.title ?? '未命名会话'}{' '}
                  <HandleChip value={chat.reboundFrom.sessionId} code={sessionCode(props.codes, chat.reboundFrom.sessionId)} />
                </span>
              )}
              {archivedNote === undefined ? null : <span className="dshpet-meta" data-note="archived-w">{archivedNote}</span>}
            </div>
          )}
          {props.reading !== 'entry' ? null : (
            <div className="dshpet-locus-row-line">
              <span className="dshpet-meta">工作会话 {work.title ?? '未命名会话'}</span>
              <HandleChip value={work.sessionId} code={sessionCode(props.codes, work.sessionId)} />
              <span className="dshpet-meta">{sessionAvailabilityLabel(work.availability)}</span>
              <span className="dshpet-meta">locus 主会话 {chat.locusMain.title ?? '未命名'}</span>
              <HandleChip value={chat.locusMain.sessionId} code={sessionCode(props.codes, chat.locusMain.sessionId)} />
            </div>
          )}
        </div>
        <div className="dshpet-locus-row-tail">
          {isGroup ? (
            <RebindControl chat={chat} work={work} busyKey={props.busyKey} onAction={props.onAction} />
          ) : null}
          {props.reading !== 'entry' ? null : (
            <>
              <Jump
                label="工作会话"
                title={workBlock ?? '打开工作会话'}
                disabled={sessionOpener === undefined || workBlock !== undefined}
                onClick={() => {
                  sessionOpener?.({ kind: 'session', sessionId: work.sessionId })
                  closeSettings?.()
                }}
              />
              <Jump
                label="主会话"
                title={mainBlock ?? '打开 locus 主会话'}
                disabled={sessionOpener === undefined || mainBlock !== undefined}
                onClick={() => {
                  sessionOpener?.({ kind: 'session', sessionId: chat.locusMain.sessionId })
                  closeSettings?.()
                }}
              />
            </>
          )}
          <Jump
            label="子会话"
            title={childBlock ?? '打开这个入口的子会话'}
            disabled={sessionOpener === undefined || childBlock !== undefined}
            onClick={() => {
              sessionOpener?.({ kind: 'subagent', parentSessionId: chat.locusMain.sessionId, childSessionId: entry.sessionId })
              closeSettings?.()
            }}
          />
          <Jump
            label={isDoc ? '文档' : feishu.kind === 'thread' ? '话题' : '飞书'}
            title={feishu.reason ?? (isDoc ? '在飞书中打开这个文档' : feishu.kind === 'thread' ? '在飞书中打开这个话题' : '在飞书中打开这个入口')}
            disabled={feishu.url === undefined}
            {...(feishu.url === undefined ? {} : { href: feishu.url })}
          />
          <button type="button" className="dshpet-locus-more" aria-expanded={props.open} onClick={props.onToggle}>
            {props.open ? '收起 ▾' : '更多 ▸'}
          </button>
        </div>
      </div>
      {props.open ? (
        <LocusDetails
          entry={entry}
          chat={chat}
          writeEnabled={props.writeEnabled}
          codes={props.codes}
          busyKey={props.busyKey}
          onAction={props.onAction}
        />
      ) : null}
    </>
  )
}

/** A group row kept only as the container of visible topics: name and state in words. */
function ChatContainerRow(props: { readonly chat: PetLocusChatViewV20; readonly codes: HandleCodes }): JSX.Element {
  const group = props.chat.group
  const code = props.codes.endpoint.get(endpointHandleId(group.endpoint)) ?? ''
  const display = entryDisplayName(group.endpoint, code)
  const note = entryStateNote(group)
  return (
    <div className="dshpet-locus-row" data-container="true">
      <span className="dshpet-locus-node" data-tone={locusStateTone(group.state)} aria-hidden="true" />
      <div className="dshpet-locus-row-body">
        <div className="dshpet-locus-row-line">
          <span className="dshpet-locus-name" data-placeholder={display.isPlaceholder}>{display.name}</span>
          <span className="dshpet-meta" data-state={group.state}>{locusStateLabel(group.state)}</span>
          {note === undefined ? null : <span className="dshpet-meta">{note}</span>}
        </div>
      </div>
    </div>
  )
}

/** One chat: the group row (or its container) with its topic rows nested under it. */
function ChatBlock(props: {
  readonly section: ChatSection
  readonly work: PetLocusWorkViewV20
  readonly reading: LocusReading
  readonly writeEnabled: boolean
  readonly codes: HandleCodes
  readonly busyKey: string | undefined
  readonly onAction: LocusActionRunner
  readonly openKeys: readonly string[]
  readonly onToggle: (key: string) => void
}): JSX.Element {
  const { section } = props
  const row = (entry: PetLocusEntryViewV20, nested: boolean): JSX.Element => {
    const key = endpointKey(entry.endpoint)
    return (
      <LocusRow
        key={key}
        entry={entry}
        chat={section.chat}
        work={props.work}
        reading={props.reading}
        writeEnabled={props.writeEnabled}
        codes={props.codes}
        busyKey={props.busyKey}
        onAction={props.onAction}
        open={props.openKeys.includes(key)}
        onToggle={() => props.onToggle(key)}
        nested={nested}
      />
    )
  }
  return (
    <div className="dshpet-locus-chat">
      {section.groupVisible ? row(section.chat.group, false) : <ChatContainerRow chat={section.chat} codes={props.codes} />}
      {section.topics.map(topic => row(topic, true))}
    </div>
  )
}

/** What the panel knows about one ledger besides its rows (D10). */
interface PetTodoLedgerMeta {
  readonly collabUnavailable: boolean
  readonly unroutable: readonly PetUnroutableView[]
}

/** Stable empty reference so a session with no todos does not re-render. */
const EMPTY_TODOS: readonly PetTodoView[] = Object.freeze([])

/**
 * One work session W and the chats that serve it.
 *
 * Exported for the rendering tests: an archived W's notes and the rebind
 * control can be asserted by rendering the block itself.
 */
export function WorkSection(props: {
  readonly section: WorkSectionView
  readonly writeEnabled: boolean
  readonly codes: HandleCodes
  readonly busyKey: string | undefined
  readonly onAction: LocusActionRunner
  readonly openKeys: readonly string[]
  readonly onToggle: (key: string) => void
  /** Todos per locus main session (the ledger key). */
  readonly todosByMain?: ReadonlyMap<string, readonly PetTodoView[]>
  readonly todoMeta?: ReadonlyMap<string, PetTodoLedgerMeta>
  readonly todoBusyId?: string | undefined
  readonly onTodoDispatch?: (itemId: string, action: PetTodoAction) => void
  readonly initialTodosOpen?: boolean
  /** Undefined keeps the entries always shown. */
  readonly expanded?: boolean
  readonly onToggleExpanded?: () => void
}): JSX.Element {
  const { section } = props
  const work = section.work
  const collapsible = props.onToggleExpanded !== undefined
  const showEntries = !collapsible || props.expanded === true
  const workBlock = sessionJumpBlock(work.availability)
  const title = work.title ?? '未命名会话'
  const mains = [...new Map(section.chats.map(item => [item.chat.locusMain.sessionId, item.chat.locusMain])).values()]
  const workspaces = [...new Map(section.chats.map(item => [item.chat.workspace.workspaceId, item.chat.workspace])).values()]
  const entryCount = section.chats.reduce((total, item) => total + item.topics.length + (item.groupVisible ? 1 : 0), 0)

  return (
    <section className="dshpet-work">
      <div className="dshpet-work-head">
        <span className="dshpet-work-mark" aria-hidden="true" />
        {workBlock === undefined && sessionOpener !== undefined ? (
          <button
            type="button"
            className="dshpet-work-name"
            title="打开工作会话"
            onClick={() => {
              sessionOpener?.({ kind: 'session', sessionId: work.sessionId })
              closeSettings?.()
            }}
          >
            {title} <span aria-hidden="true">↗</span>
          </button>
        ) : (
          <span className="dshpet-work-name" data-static="true" title={workBlock ?? title}>{title}</span>
        )}
        <span className="dshpet-work-tail">
          <HandleChip value={work.sessionId} code={sessionCode(props.codes, work.sessionId)} />
          <span className="dshpet-meta" data-availability={work.availability}>{sessionAvailabilityLabel(work.availability)}</span>
          {!collapsible ? null : (
            <button
              type="button"
              className="dshpet-work-expand"
              aria-expanded={showEntries}
              title={showEntries ? '收起这个会话的入口' : '展开这个会话的入口'}
              onClick={props.onToggleExpanded}
            >
              <span aria-hidden="true" className="dshpet-work-expand-mark">▸</span>
              {entryCount} 个入口
            </button>
          )}
        </span>
      </div>
      <div className="dshpet-work-sub">
        <span>工作会话</span>
        {mains.map(main => (
          <span key={main.sessionId} className="dshpet-meta">
            · locus 主会话 {main.title ?? '未命名'}{' '}
            <HandleChip value={main.sessionId} code={sessionCode(props.codes, main.sessionId)} />
          </span>
        ))}
        {workspaces.map(workspace => (
          <span key={workspace.workspaceId} className="dshpet-meta">
            · 工作区 {workspace.title ?? workspace.workspaceId}
            {workspace.path === undefined ? null : <code className="dshpet-code">{workspace.path}</code>}
          </span>
        ))}
      </div>
      {section.hasDefaultQa ? null : <p className="dshpet-work-note">{LOCUS_DEFAULT_QA_MISSING_NOTE}</p>}
      {!showEntries ? null : (
        <div className="dshpet-rail">
          {section.chats.map(item => (
            <ChatBlock
              key={item.key}
              section={item}
              work={work}
              reading="work"
              writeEnabled={props.writeEnabled}
              codes={props.codes}
              busyKey={props.busyKey}
              onAction={props.onAction}
              openKeys={props.openKeys}
              onToggle={props.onToggle}
            />
          ))}
        </div>
      )}
      {props.todosByMain === undefined || props.onTodoDispatch === undefined ? null : mains.map(main => props.onTodoDispatch === undefined ? null : (
        <WorkTodos
          key={main.sessionId}
          items={props.todosByMain?.get(main.sessionId) ?? EMPTY_TODOS}
          parentSessionId={main.sessionId}
          loci={section.chats
            .filter(item => item.chat.locusMain.sessionId === main.sessionId)
            .flatMap(item => [item.chat.group, ...item.chat.topics])}
          busyId={props.todoBusyId}
          disabled={props.busyKey !== undefined}
          onDispatch={props.onTodoDispatch}
          {...(props.todoMeta?.get(main.sessionId) === undefined ? {} : { meta: props.todoMeta.get(main.sessionId)! })}
          {...(props.initialTodosOpen === true ? { initialOpen: true } : {})}
        />
      ))}
    </section>
  )
}

/** The filter panel. Every bucket states its count over the whole snapshot. */
function LocusFilterPanel(props: {
  readonly filter: LocusFilter
  readonly counts: ReadonlyMap<EntryBucketId, number>
  readonly onChange: (next: LocusFilter) => void
}): JSX.Element {
  const toggle = (id: EntryBucketId): void => {
    const next = props.filter.buckets.includes(id)
      ? props.filter.buckets.filter(item => item !== id)
      : [...props.filter.buckets, id]
    props.onChange({ buckets: next })
  }
  return (
    <div className="dshpet-locus-filter" role="dialog" aria-label="筛选">
      <span className="dshpet-locus-filter-cap">入口状态</span>
      {ENTRY_BUCKET_OPTIONS.map(option => {
        const count = props.counts.get(option.id) ?? 0
        return (
          <label className="dshpet-locus-filter-row" key={option.id} data-empty={count === 0}>
            <input
              className="dshpet-input"
              type="checkbox"
              checked={props.filter.buckets.includes(option.id)}
              onChange={() => toggle(option.id)}
            />
            {option.label}
            <span className="dshpet-locus-filter-count">{count}</span>
          </label>
        )
      })}
      <div className="dshpet-locus-filter-hr" aria-hidden="true" />
      <div className="dshpet-locus-filter-foot">
        <button type="button" className="dshpet-action dshpet-action-sm" onClick={() => props.onChange(DEFAULT_LOCUS_FILTER)}>
          重置默认
        </button>
        <span className="dshpet-meta">只影响显示</span>
      </div>
    </div>
  )
}

/**
 * Validate the Host snapshot before showing it.
 *
 * Accepts every state string: a value outside the four v20 states renders as
 * 「未知状态」 instead of failing the panel (and `not-created` is one of the four,
 * so a snapshot with it always loads).
 * Exported for its test.
 */
export function requireLocusSnapshot(value: unknown): PetLocusManagementViewV20 {
  const isRecord = (item: unknown): item is Record<string, unknown> =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
  const isNonEmptyString = (item: unknown): item is string => typeof item === 'string' && item.trim() !== ''
  const isCount = (item: unknown): boolean => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0
  const optionalString = (item: unknown): boolean => item === undefined || typeof item === 'string'
  const isAvailability = (item: unknown, allowUnknown: boolean): boolean =>
    ['available', 'archived', 'missing', ...(allowUnknown ? ['unknown'] : [])].includes(String(item))
  const isEndpoint = (item: unknown): item is Record<string, unknown> =>
    isRecord(item) && isNonEmptyString(item['chatId']) &&
    (item['threadId'] === undefined || isNonEmptyString(item['threadId'])) &&
    optionalString(item['chatName']) && optionalString(item['quote']) && optionalString(item['docUrl'])
  const isEntry = (item: unknown): boolean => {
    if (!isRecord(item) || !isNonEmptyString(item['locusId']) || !isCount(item['revision']) || !isEndpoint(item['endpoint'])) return false
    if (!isNonEmptyString(item['sessionId']) || !isNonEmptyString(item['state'])) return false
    if (!['read-only', 'danger-full-access'].includes(String(item['accessMode']))) return false
    if (typeof item['inFlight'] !== 'boolean' || typeof item['hasCurrentDelivery'] !== 'boolean') return false
    if (!isCount(item['createdAt']) || !isCount(item['updatedAt'])) return false
    const session = item['session']
    return session === undefined || (isRecord(session) && optionalString(session['title']) &&
      (session['availability'] === undefined || isAvailability(session['availability'], true)))
  }
  const isChat = (item: unknown): boolean => {
    if (!isRecord(item) || !isEntry(item['group']) || !Array.isArray(item['topics']) || !item['topics'].every(isEntry)) return false
    const group = item['group'] as { endpoint: { chatId: string; threadId?: string } }
    if (group.endpoint.threadId !== undefined) return false
    const topics = item['topics'] as { endpoint: { chatId: string; threadId?: string } }[]
    if (!topics.every(topic => topic.endpoint.threadId !== undefined && topic.endpoint.chatId === group.endpoint.chatId)) return false
    const main = item['locusMain']
    const workspace = item['workspace']
    const rebound = item['reboundFrom']
    return isRecord(main) && isNonEmptyString(main['sessionId']) &&
      (main['availability'] === undefined || isAvailability(main['availability'], false)) &&
      isRecord(workspace) && isNonEmptyString(workspace['workspaceId']) &&
      (rebound === undefined || (isRecord(rebound) && isNonEmptyString(rebound['sessionId']))) &&
      (item['defaultQa'] === undefined || typeof item['defaultQa'] === 'boolean')
  }
  const candidate = value as Record<string, unknown>
  if (!isRecord(value) || !isCount(candidate['generation']) || typeof candidate['writeEnabled'] !== 'boolean' ||
      !Array.isArray(candidate['works']) || !candidate['works'].every(item =>
        isRecord(item) && isRecord(item['work']) && isNonEmptyString(item['work']['sessionId']) &&
        isAvailability(item['work']['availability'], true) &&
        Array.isArray(item['chats']) && item['chats'].every(isChat))) {
    throw new Error('Host 返回的 locus 快照不完整或字段无效，已拒绝显示。')
  }
  return value as unknown as PetLocusManagementViewV20
}

/** Work sessions per page. */
const WORKS_PER_PAGE = 8

/** Page control, rendered both above and below the list; nothing for one page. */
function LocusPager(props: {
  readonly page: number
  readonly pageCount: number
  readonly total: number
  readonly onGo: (page: number) => void
  readonly position: 'top' | 'bottom'
}): JSX.Element | null {
  if (props.pageCount <= 1) return null
  const first = props.page * WORKS_PER_PAGE + 1
  const last = Math.min((props.page + 1) * WORKS_PER_PAGE, props.total)
  return (
    <nav className="dshpet-pager" data-position={props.position} aria-label="工作会话分页">
      <button type="button" className="dshpet-jump" disabled={props.page === 0} onClick={() => props.onGo(props.page - 1)}>
        上一页
      </button>
      <span className="dshpet-pager-state">
        {first}–{last} / {props.total} 个工作会话
      </span>
      <button
        type="button"
        className="dshpet-jump"
        disabled={props.page >= props.pageCount - 1}
        onClick={() => props.onGo(props.page + 1)}
      >
        下一页
      </button>
    </nav>
  )
}

/** What the panel should do after one disposition call returns (design D11). */
export interface AcceptFollowThrough {
  /** Where to navigate, taken from the receipt — never re-derived here. */
  readonly navigate?: { readonly kind: 'session'; readonly sessionId: string }
  readonly closeSettings: boolean
  /** Outcome announcement that outlives the panel closing. */
  readonly persistentNotice?: string
  /** Shown in place when the panel stays open. */
  readonly inPanelNotice?: string
  /** False whenever a follow-up was really delivered, whatever the GUI could do. */
  readonly treatAsFailure: boolean
}

/**
 * Decide the panel's follow-through for one disposition result.
 *
 * Pure so every branch is assertable without a DOM or a Host: the interesting
 * cases are exactly the ones that are awkward to reach through a component
 * (absent opener, queued-then-navigate, unreachable).
 *
 * Three rules this encodes, each from a review finding:
 *
 * - The navigation target comes from `dispatch.executionTarget`. The panel
 *   must not recompute it — which session runs a follow-up is a Host
 *   resolution decision, and guessing would reinstate the "always the main
 *   session" hardcoding design D3 removed.
 * - A success announcement must SURVIVE the panel closing, or navigating
 *   would swallow the `dispatched` vs `queued` distinction the spec requires
 *   the owner to see.
 * - A missing `sessionOpener` is not a failure. The follow-up was delivered;
 *   only the convenience of being taken there is unavailable.
 *
 * @param input - the receipt (absent for settle actions) and GUI capability.
 * @returns the follow-through plan.
 */
export function planAcceptFollowThrough(input: {
  readonly dispatch?: PetTodoDispatchReceipt
  readonly hasSessionOpener: boolean
}): AcceptFollowThrough {
  const receipt = input.dispatch
  // `done` / `drop` dispatch nothing, so there is nothing to announce.
  if (receipt === undefined) return { closeSettings: false, treatAsFailure: false }

  if (receipt.outcome === 'unreachable') {
    return {
      closeSettings: false,
      inPanelNotice: `受理失败：${receipt.reason ?? '目标不可达。'}`,
      treatAsFailure: true,
    }
  }

  const announcement = receipt.outcome === 'queued'
    ? '跟进任务已投递，目标会话正忙，已排队等待。'
    : '跟进任务已投递，目标会话已开始处理。'

  const target = receipt.executionTarget
  if (!input.hasSessionOpener || target === undefined) {
    // Delivered, but this shell cannot navigate. Say so in place; do not
    // report a delivered follow-up as a failed accept.
    return { closeSettings: false, inPanelNotice: announcement, treatAsFailure: false }
  }

  return {
    navigate: target,
    closeSettings: true,
    persistentNotice: announcement,
    treatAsFailure: false,
  }
}

/**
 * The locus surface: everything it shows, given a snapshot.
 *
 * Split from `LocusTab` so the presentation can be rendered and asserted
 * against a fixture snapshot, with no Host, no fetch and no effects.
 */
export function LocusSurface(props: {
  readonly snapshot: PetLocusManagementViewV20
  readonly busyKey?: string
  readonly error?: string
  readonly warning?: string
  /** What a completed action did (the Host receipt). */
  readonly notice?: string
  readonly onAction: LocusActionRunner
  /** Test seam: pre-seeded ledger groups render without a Host round-trip. */
  readonly initialTodoGroups?: readonly PetTodoLedgerGroup[]
  /** Test seam: start each session's todo block expanded. */
  readonly initialTodosOpen?: boolean
  /** Test seam: start every session's entries expanded. */
  readonly initialWorksExpanded?: boolean
  /** Test seam: start with this filter. */
  readonly initialFilter?: LocusFilter
  /** Test seam: start with these entry disclosures open (endpoint keys). */
  readonly initialOpenKeys?: readonly string[]
}): JSX.Element {
  const [reading, setReading] = useState<LocusReading>('work')
  const [filter, setFilter] = useState<LocusFilter>(props.initialFilter ?? DEFAULT_LOCUS_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openKeys, setOpenKeys] = useState<readonly string[]>(props.initialOpenKeys ?? [])
  const toggleOpen = useCallback((key: string) => {
    setOpenKeys(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key]))
  }, [])
  const filterRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!filterOpen) return undefined
    const onPointer = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (filterRef.current?.contains(target) === true) return
      setFilterOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
    }
  }, [filterOpen])

  const todos = useTodoLedger(props.initialTodoGroups)

  const [page, setPage] = useState(0)
  const [expandedWorks, setExpandedWorks] = useState<readonly string[]>([])
  const toggleWork = useCallback((workSessionId: string) => {
    setExpandedWorks(current => (current.includes(workSessionId)
      ? current.filter(id => id !== workSessionId)
      : [...current, workSessionId]))
  }, [])
  const listTopRef = useRef<HTMLDivElement | null>(null)

  const codes = useMemo(() => collectHandleCodes(props.snapshot), [props.snapshot])
  const filtered = useMemo(() => applyLocusFilter(props.snapshot, filter), [props.snapshot, filter])
  const visible = useMemo(() => applyQuery(filtered, codes, query), [filtered, codes, query])
  const counts = useMemo(() => countLocusFilterOptions(props.snapshot), [props.snapshot])
  const totals = useMemo(() => summarizeLocusView(applyLocusFilter(props.snapshot, SHOW_ALL_LOCUS_FILTER)), [props.snapshot])

  const pageCount = Math.max(1, Math.ceil(visible.works.length / WORKS_PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  useEffect(() => {
    if (safePage !== page) setPage(safePage)
  }, [safePage, page])
  const pagedWorks = visible.works.slice(safePage * WORKS_PER_PAGE, (safePage + 1) * WORKS_PER_PAGE)
  const goToPage = useCallback((next: number) => {
    setPage(next)
    listTopRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }, [])

  const updatedAt = props.snapshot.works
    .flatMap(work => work.chats.flatMap(chat => [chat.group, ...chat.topics]))
    .reduce((latest, entry) => (entry.updatedAt > latest ? entry.updatedAt : latest), 0)
  const now = Date.now()
  const empty = visible.works.length === 0

  return (
    <div className="dshpet-settings">
      <section className="dshpet-locus-head">
        <div className="dshpet-locus-lead">
          <div className="dshpet-locus-headline">
            <span className="dshpet-locus-title">关联</span>
            <span className="dshpet-locus-filter-anchor" ref={filterRef}>
              <button
                type="button"
                className="dshpet-jump"
                aria-pressed={filterOpen}
                aria-expanded={filterOpen}
                title="按入口状态筛选"
                onClick={() => setFilterOpen(current => !current)}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path
                    d="M1 2.2h10L7.2 6.6v3.6L4.8 11V6.6L1 2.2z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinejoin="round"
                  />
                </svg>
                {`入口：${entryStateFilterLabel(filter)}`}
              </button>
              {filterOpen ? <LocusFilterPanel filter={filter} counts={counts} onChange={setFilter} /> : null}
            </span>
          </div>
          <span className="dshpet-meta">
            {totals.entries} 个入口 · {totals.chats} 个飞书入口 · {totals.works} 个工作会话
            {updatedAt === 0 ? '' : ` · 状态更新 ${formatRelative(updatedAt, now)}`}
          </span>
        </div>
        <div className="dshpet-locus-tools">
          <div className="dshpet-subtabs" role="tablist" aria-label="读法">
            <button type="button" role="tab" aria-selected={reading === 'work'} className="dshpet-subtab" onClick={() => setReading('work')}>
              按工作会话
            </button>
            <button type="button" role="tab" aria-selected={reading === 'entry'} className="dshpet-subtab" onClick={() => setReading('entry')}>
              按入口
            </button>
          </div>
          <input
            className="dshpet-input dshpet-locus-search"
            value={query}
            placeholder="粘贴 id / 搜会话标题或短码"
            aria-label="搜索关联"
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      </section>

      <div ref={listTopRef} aria-hidden="true" />

      {reading === 'work' ? (
        <LocusPager page={safePage} pageCount={pageCount} total={visible.works.length} onGo={goToPage} position="top" />
      ) : null}

      {reading === 'work'
        ? pagedWorks.map(section => (
          <WorkSection
            key={section.work.sessionId}
            section={section}
            writeEnabled={props.snapshot.writeEnabled}
            codes={codes}
            busyKey={props.busyKey}
            onAction={props.onAction}
            openKeys={openKeys}
            onToggle={toggleOpen}
            todosByMain={todos.byParent}
            todoMeta={todos.meta}
            todoBusyId={todos.busyId}
            onTodoDispatch={todos.dispatch}
            expanded={props.initialWorksExpanded === true || expandedWorks.includes(section.work.sessionId)}
            onToggleExpanded={() => toggleWork(section.work.sessionId)}
            {...(props.initialTodosOpen === true ? { initialTodosOpen: true } : {})}
          />
        ))
        : groupByEntry(visible).map(item => (
          <ChatBlock
            key={item.section.key}
            section={item.section}
            work={item.work}
            reading="entry"
            writeEnabled={props.snapshot.writeEnabled}
            codes={codes}
            busyKey={props.busyKey}
            onAction={props.onAction}
            openKeys={openKeys}
            onToggle={toggleOpen}
          />
        ))}

      {reading === 'work' ? (
        <LocusPager page={safePage} pageCount={pageCount} total={visible.works.length} onGo={goToPage} position="bottom" />
      ) : null}

      {empty ? <p className="dshpet-empty">{emptyListText(query)}</p> : null}

      <p className="dshpet-item-hint dshpet-locus-nodelete">
        这里没有「删除」，是刻意的：停止只停止服务，保留会话与飞书资源。已停止或已失效的入口默认不在列表里，
        在筛选里勾上「已停止 / 已失效」即可看到；已失效的入口在下一条授权 @ 时自动重建，
        已停止的入口在飞书内对同一来源会话重新 /bind 即可重新启用。
      </p>

      {todos.error === undefined ? null : <p className="dshpet-error">读取待办失败：{todos.error}</p>}
      {todos.notice === undefined ? null : (
        <p
          className="dshpet-callout"
          data-tone={todos.notice.startsWith('受理失败') || todos.notice.startsWith('处置失败') ? 'warn' : 'ok'}
        >
          {todos.notice}
        </p>
      )}

      {props.notice === undefined ? null : <p className="dshpet-callout" data-tone="ok">{props.notice}</p>}
      {props.warning === undefined ? null : <p className="dshpet-callout" data-tone="warn">{props.warning}</p>}
      {props.error === undefined ? null : <p className="dshpet-error">{props.error}</p>}
    </div>
  )
}

/**
 * Shared-fact ledger todos, loaded once for the whole panel.
 *
 * Lives at panel level rather than inside each session block for two reasons:
 * one request instead of one per session, and a single place that re-reads
 * after a disposition so every block stays consistent.
 *
 * Fetches separately from the locus snapshot on purpose: a todo appears when a
 * child registers one, which is not a locus lifecycle event, so folding it
 * into that snapshot would either make the snapshot churn or make todos stale.
 */
function useTodoLedger(seed?: readonly PetTodoLedgerGroup[]): {
  readonly byParent: ReadonlyMap<string, readonly PetTodoView[]>
  /** Per-ledger collaboration availability and unroutable records (D10). */
  readonly meta: ReadonlyMap<string, PetTodoLedgerMeta>
  readonly error: string | undefined
  /** Disposition outcome shown in place when the panel stays open (D11). */
  readonly notice: string | undefined
  readonly busyId: string | undefined
  readonly dispatch: (itemId: string, action: PetTodoAction) => void
} {
  const [groups, setGroups] = useState<readonly PetTodoLedgerGroup[] | undefined>(seed)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busyId, setBusyId] = useState<string | undefined>(undefined)
  // In-place outcome text, used when the panel STAYS open (failure, or a
  // shell with no navigation seam). The navigating case announces instead.
  const [notice, setNotice] = useState<string | undefined>(undefined)

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await petApi.locusTodos()
      setGroups(result.ledgers)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    // A seed means a caller already supplied the data (tests); fetching would
    // overwrite it.
    if (seed !== undefined) return
    void load()
  }, [load, seed])

  const dispatch = useCallback((itemId: string, action: PetTodoAction): void => {
    setBusyId(itemId)
    setNotice(undefined)
    void (async () => {
      try {
        const result = await petApi.locusTodoAction({ itemId, action })
        // Re-read rather than patch locally: the Host owns transition
        // legality, so a rejected action must not leave an optimistic status
        // on screen (spec: Host 拒绝时状态不被乐观改写).
        await load()
        // The receipt is one-shot: it describes THIS call, so it is consumed
        // here and never read back off the reloaded row (design D6/D7/D9).
        const opener = sessionOpener
        const plan = planAcceptFollowThrough({
          ...(result.dispatch === undefined ? {} : { dispatch: result.dispatch }),
          hasSessionOpener: opener !== undefined,
        })
        if (plan.inPanelNotice !== undefined) setNotice(plan.inPanelNotice)
        if (plan.navigate !== undefined && opener !== undefined) {
          // Announce BEFORE closing: the panel is about to disappear, and the
          // dispatched/queued distinction must not disappear with it.
          if (plan.persistentNotice !== undefined) outcomeAnnouncer?.(plan.persistentNotice)
          opener({ kind: 'session', sessionId: plan.navigate.sessionId })
          if (plan.closeSettings) closeSettings?.()
        }
      } catch (cause) {
        // A rejected disposition is not a failure to READ the ledger: keep it
        // off the "读取待办失败" line, which describes the list fetch.
        setNotice(`处置失败：${cause instanceof Error ? cause.message : String(cause)}`)
      } finally {
        setBusyId(undefined)
      }
    })()
  }, [load])

  const byParent = useMemo(() => {
    const map = new Map<string, readonly PetTodoView[]>()
    for (const group of groups ?? []) map.set(group.parentSessionId, group.items)
    return map
  }, [groups])
  const meta = useMemo(() => {
    const map = new Map<string, PetTodoLedgerMeta>()
    for (const group of groups ?? []) {
      map.set(group.parentSessionId, {
        collabUnavailable: group.collab === 'unavailable',
        unroutable: group.unroutable ?? [],
      })
    }
    return map
  }, [groups])

  return { byParent, meta, error, notice, busyId, dispatch }
}

/**
 * The todos filed against one parent session, rendered inside that session's
 * own block.
 *
 * Collapsed by default and summarised in one line: a session that is working
 * normally should read as one line of reassurance, not a wall of cards. The
 * block disappears entirely when there is nothing filed — an always-present
 * empty shell would be noise on every session that never had a todo.
 */
function WorkTodos(props: {
  readonly items: readonly PetTodoView[]
  readonly parentSessionId: string
  readonly loci: readonly PetLocusEntryViewV20[]
  readonly busyId: string | undefined
  readonly disabled: boolean
  readonly onDispatch: (itemId: string, action: PetTodoAction) => void
  readonly meta?: PetTodoLedgerMeta
  readonly initialOpen?: boolean
}): JSX.Element | null {
  const [open, setOpen] = useState(props.initialOpen === true)
  const collabDown = props.meta?.collabUnavailable === true
  const unroutable = props.meta?.unroutable ?? []
  // "Nothing filed" is the only state that may render nothing: an unavailable
  // collaboration layer must never read as an empty ledger.
  if (props.items.length === 0 && !collabDown && unroutable.length === 0) return null

  const openCount = props.items.filter(item => item.status === 'open').length
  const byLocus = groupTodosByLocus(props.items as readonly TodoSnapshotItem[])

  return (
    <div className="dshpet-work-todos">
      <button
        type="button"
        className="dshpet-work-todos-head"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span className="dshpet-work-todos-mark" aria-hidden="true">▸</span>
        <span>待办</span>
        {/* The count carries the state; the label stays stable so the control
            keeps one accessible name. */}
        <span className="dshpet-work-todos-count" data-pending={openCount > 0 || collabDown ? 'true' : undefined}>
          {collabDown
            ? '协作层不可用'
            : openCount > 0
              ? `${String(openCount)} 条待处理`
              : `${String(props.items.length)} 条，都已处理`}
        </span>
      </button>
      {!open ? null : (
        <div className="dshpet-work-todos-body">
          {!collabDown ? null : (
            <p className="dshpet-todo-collab-down" role="status">
              协作层不可用：新的待办暂时读不到，也无法处置。旧版待办仍可查看。
            </p>
          )}
          {unroutable.length === 0 ? null : (
            <div className="dshpet-todo-unroutable">
              <span>{`${String(unroutable.length)} 条发给子会话的消息无法路由，没有转给任何子会话：`}</span>
              <ul className="dshpet-todo-unroutable-list">
                {unroutable.map(entry => (
                  <li key={entry.seq}>
                    {entry.subject === 'message' ? '消息' : '待办终态通知'}
                    {` #${String(entry.seq)}`}
                    {entry.at === undefined ? '' : ` · ${formatTodoTime(entry.at)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {[...byLocus.entries()].flatMap(([locusId, items]) => {
            const locus = props.loci.find(row => row.locusId === locusId)
            const session = resolveSessionJumpTarget(
              locus === undefined || locus.state === 'not-created' ? undefined : locus.sessionId,
              locus?.session?.availability ?? 'unknown',
            )
            return items.map(item => {
              // Doc todos jump to the inspected document URL carried on the loci.
              const jump = resolveFeishuJumpTarget(item, {
                docUrl: chatId => props.loci.find(row => row.endpoint.chatId === chatId && row.endpoint.docUrl !== undefined)?.endpoint.docUrl,
              })
              const busy = props.disabled || props.busyId === item.itemId
              return (
                <article
                  key={item.itemId}
                  className="dshpet-todo"
                  data-status={item.status}
                  data-legacy={item.legacy === true ? 'true' : undefined}
                >
                  <p className="dshpet-todo-summary">{item.summary}</p>
                  <div className="dshpet-todo-meta">
                    <span className="dshpet-status" data-tone={TODO_TONE[item.status]}>
                      {todoStatusLabel(item.status)}
                    </span>
                    {item.legacy !== true ? null : (
                      <span className="dshpet-todo-legacy" title="迁移到协作空间之前登记的待办，只读保留">旧版</span>
                    )}
                    <span className="dshpet-todo-meta-sep">·</span>
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {formatTodoTime(item.createdAt)}
                    </time>
                    <span className="dshpet-todo-meta-sep">·</span>
                    <span className="dshpet-todo-who" title={item.requestedBy}>
                      {item.requestedBy}
                    </span>
                  </div>
                  {item.detail.trim() === '' ? null : (
                    <details className="dshpet-todo-evidence">
                      <summary>登记时查到的证据</summary>
                      <div className="dshpet-todo-evidence-body">{item.detail}</div>
                    </details>
                  )}
                  <div className="dshpet-todo-actions">
                    <span className="dshpet-todo-routes">
                      {/* Jump back to where the request came from. A thread
                          todo opens its thread; a chat-level one opens the
                          chat and says so, rather than fabricating a thread
                          target it cannot prove. */}
                      <Jump
                        label={jump.kind === 'thread' ? '话题' : '群'}
                        title={todoFeishuTitle(jump)}
                        {...(todoFeishuLink(jump) === undefined
                          ? { disabled: true }
                          : { href: todoFeishuLink(jump)! })}
                      />
                      <Jump
                        label="会话"
                        title={session.kind === 'available'
                          ? '打开登记这条待办的子会话'
                          : session.reason}
                        disabled={sessionOpener === undefined || session.kind !== 'available'}
                        onClick={() => {
                          if (session.kind !== 'available') return
                          sessionOpener?.({
                            kind: 'subagent',
                            parentSessionId: props.parentSessionId,
                            childSessionId: session.sessionId,
                          })
                          closeSettings?.()
                        }}
                      />
                    </span>
                    {item.legacy !== true ? null : (
                      <span className="dshpet-todo-readonly">只读</span>
                    )}
                    {availableTodoActions(item.status, { legacy: item.legacy === true }).map(action => (
                      <button
                        key={action}
                        type="button"
                        className="dshpet-jump"
                        disabled={busy}
                        data-disabled={busy ? 'true' : undefined}
                        title={TODO_ACTION_HINTS[action]}
                        onClick={() => { props.onDispatch(item.itemId, action) }}
                      >
                        {TODO_ACTION_LABELS[action]}
                      </button>
                    ))}
                  </div>
                </article>
              )
            })
          })}
        </div>
      )}
    </div>
  )
}


/**
 * Status tone, reusing the sheet's existing `.dshpet-status` tokens rather
 * than inventing colours: `open` is the one that still wants attention,
 * `accepted` is in hand, and both terminal states are neutral history.
 */
const TODO_TONE: Record<PetTodoStatus, string | undefined> = {
  open: 'warn',
  accepted: 'enabled',
  done: undefined,
  dropped: undefined,
}

/** An action keeps the same verb the button promised, per the writing rules. */
const TODO_ACTION_LABELS: Record<PetTodoAction, string> = {
  accept: '受理',
  done: '完成',
  drop: '放弃',
}

/**
 * What each disposition actually does, stated in terms of the owner's own
 * workflow rather than the state machine's vocabulary.
 *
 * None of them sends anything to Feishu. `accept` is no longer a bare marker:
 * it dispatches a follow-up task to the resolved execution target and only
 * then records `accepted`, so a failed dispatch leaves the row untouched
 * (design D5). `done` and `drop` remain pure records and are terminal by
 * design, because a settled todo that could re-open would make the list
 * untrustworthy as a record of what is still owed.
 */
const TODO_ACTION_HINTS: Record<PetTodoAction, string> = {
  accept: '投递跟进任务并开始处理，随后转到执行目标会话；不发送任何飞书消息',
  done: '标记为已处理完，此后不可再改（终态）；不发送任何飞书消息',
  drop: '标记为不打算做，此后不可再改（终态）；不发送任何飞书消息',
}

/**
 * The Feishu deep link for one todo, reusing the exact formats this panel
 * already ships for locus rows (`chatAppLink` and the thread applink at
 * `LocusFamilyRow`) — not a second, unverified URL shape.
 *
 * `triggerMessageId` is deliberately NOT appended: neither applink accepts a
 * message selector, so adding one would be an invented parameter that
 * silently opens the wrong thing. The message id stays a durable fact for
 * correlation, not a link component.
 */
function todoFeishuLink(jump: ReturnType<typeof resolveFeishuJumpTarget>): string | undefined {
  if (jump.kind === 'doc') return jump.url
  return jump.kind === 'thread'
    ? `https://applink.feishu.cn/client/thread/open?threadId=${encodeURIComponent(jump.threadId)}`
    : chatAppLink(jump.chatId)
}

/** Says where the jump lands, and when it cannot, why. */
function todoFeishuTitle(jump: ReturnType<typeof resolveFeishuJumpTarget>): string {
  if (jump.kind === 'doc') {
    if (jump.url === undefined) return '文档元数据暂不可读，无法提供链接'
    return jump.commentId === undefined ? '打开提出这条请求的文档' : `打开提出这条请求的文档（评论 ${jump.commentId}）`
  }
  if (todoFeishuLink(jump) === undefined) return '这条待办没有可用的飞书链接'
  return jump.kind === 'thread'
    ? '打开提出这条请求的话题'
    : `打开提出这条请求的群（${jump.reason}）`
}

/**
 * Registration time, trimmed to what the owner actually scans by.
 *
 * `toLocaleString()` prints a full date plus seconds, which is noise on a row
 * whose job is "how long has this been waiting": today's items read as a clock
 * time, older ones drop the seconds and keep the date.
 */
function formatTodoTime(at: number): string {
  const when = new Date(at)
  const now = new Date()
  const sameDay = when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate()
  return sameDay
    ? `今天 ${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}`
    : `${when.getMonth() + 1}/${when.getDate()} ${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}`
}

/**
 * Unified locus management.
 *
 * Owns the Host conversation only, so the surface itself stays renderable
 * without one. An unavailable locus Host seam renders as an error, never
 * silently backed by legacy data.
 */
function LocusTab(): JSX.Element {
  const [snapshot, setSnapshot] = useState<PetLocusManagementViewV20 | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [busyKey, setBusyKey] = useState<string | undefined>(undefined)
  const actionInFlight = useRef(false)
  const load = useCallback(async (): Promise<PetLocusManagementViewV20> => requireLocusSnapshot(await petApi.locus()), [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await load())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [load])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runAction = useCallback<LocusActionRunner>(
    async (key, operation) => {
      if (actionInFlight.current) return false
      actionInFlight.current = true
      setBusyKey(key)
      setError(undefined)
      setNotice(undefined)
      try {
        const result = await operation()
        const receipt = (result as { receipt?: unknown } | undefined)?.receipt
        if (typeof receipt === 'string' && receipt.trim() !== '') setNotice(receipt)
        setSnapshot(await load())
        return true
      } catch (cause) {
        // A rejected Host action never changes the displayed snapshot. A stale
        // fence says so in the owner's terms; every other refusal shows the
        // Host's own deterministic reason.
        setError(locusActionErrorText(cause))
        return false
      } finally {
        actionInFlight.current = false
        setBusyKey(undefined)
      }
    },
    [load],
  )

  if (snapshot === undefined) {
    return (
      <div className="dshpet-settings">
        <Group title="Locus 管理">
          {error === undefined
            ? <p className="dshpet-item-hint">正在读取 Host 的统一 locus 管理快照…</p>
            : <p className="dshpet-error">{error}</p>}
          <p className="dshpet-item-hint">
            统一 locus 接口不可用时不会回退到旧 Task、Invocation 或普通飞书路由。
          </p>
        </Group>
      </div>
    )
  }
  return (
    <LocusSurface
      snapshot={snapshot}
      onAction={runAction}
      {...(busyKey === undefined ? {} : { busyKey })}
      {...(error === undefined ? {} : { error })}
      {...(notice === undefined ? {} : { notice })}
    />
  )
}

/** The owner-facing text of one refused locus action. Exported for its test. */
export function locusActionErrorText(cause: unknown): string {
  if ((cause as { code?: unknown } | undefined)?.code === 'LOCUS_CONFLICT') return LOCUS_FENCE_STALE_TEXT
  return cause instanceof Error ? cause.message : String(cause)
}
/**
 * Host directory picker, published by the client entry when the deployment
 * serves the `native` capability.
 *
 * Pet imports from a HOST path, so a browser file input would be wrong: it
 * yields the user's own machine. A remote deployment simply gets no picker
 * and keeps typing the path, which still works.
 */
let directoryPicker: (() => Promise<string | undefined>) | undefined

/** One directory level from the Host, for the in-app browser. */
export interface PetDirectoryListing {
  readonly path: string
  readonly entries: readonly { name: string; path: string }[]
  readonly crumbs: readonly { name: string; path: string }[]
}

let directoryLister:
  | ((path?: string) => Promise<PetDirectoryListing | undefined>)
  | undefined

/**
 * Publish the Host directory lister.
 *
 * Used when the deployment serves `browse` rather than `native`: a remote
 * Host has no OS picker to open, so the user navigates the Host filesystem
 * in-app instead.
 * @param lister - Lists one directory level, or `undefined` when unavailable.
 */
export function setDirectoryLister(
  lister: ((path?: string) => Promise<PetDirectoryListing | undefined>) | undefined,
): void {
  directoryLister = lister
}

/**
 * Publish the Host directory picker.
 * @param picker - Picker returning the chosen path, or `undefined` on cancel.
 */
export function setDirectoryPicker(
  picker: (() => Promise<string | undefined>) | undefined,
): void {
  directoryPicker = picker
}

/**
 * A navigation target for the native session shell.
 *
 * A locus child is a subagent Session, and the Host refuses to address one by
 * its bare session id: `validateAddress` rejects `origin === 'subagent'` with
 * `session/agent-busy`, because such a Session is owned by subagent routing.
 * Opening it needs its durable PARENT address, so the target carries that
 * parent explicitly instead of leaving the shell to rediscover it.
 */
export type PetSessionTarget =
  | { readonly kind: 'session'; readonly sessionId: string }
  | {
    readonly kind: 'subagent'
    readonly parentSessionId: string
    readonly childSessionId: string
  }

/**
 * Navigate to a native DSH session.
 *
 * Published by the client entry the same way the directory picker is: this
 * section is registered as a bare component in a slot and never receives the
 * client context, so the one shell capability it needs is handed in rather
 * than reached for.
 */
let sessionOpener: ((target: PetSessionTarget) => void) | undefined

/**
 * Publish the session navigator.
 * @param opener - Opens a navigation target, or `undefined` where unsupported.
 */
export function setSessionOpener(
  opener: ((target: PetSessionTarget) => void) | undefined,
): void {
  sessionOpener = opener
}

/**
 * Announce a short outcome that must outlive this panel.
 *
 * Exists because accepting a todo both navigates away and has an outcome the
 * owner still needs: `dispatched` versus `queued` is the difference between
 * "it started" and "it is behind other work", and an in-panel notice dies the
 * moment navigation closes the panel (design D11).
 *
 * Optional like every other shell seam here: a shell that publishes none
 * still gets a correct accept, it just reports the outcome in place instead.
 */
let outcomeAnnouncer: ((text: string) => void) | undefined

/**
 * Publish the outcome announcer.
 * @param announcer - Shows a shell-level notice, or `undefined` where unsupported.
 */
export function setOutcomeAnnouncer(announcer: ((text: string) => void) | undefined): void {
  outcomeAnnouncer = announcer
}

/**
 * Dismiss the settings overlay.
 *
 * Needed because navigating to a session from inside a modal panel otherwise
 * leaves that panel covering the destination. Published like the navigator:
 * the section never receives the client context.
 */
let closeSettings: (() => void) | undefined

/**
 * Publish the settings-overlay dismisser.
 * @param close - Closes the overlay, or `undefined` where unsupported.
 */
export function setSettingsCloser(close: (() => void) | undefined): void {
  closeSettings = close
}

/** Skills: install, enable/disable, shortcut visibility and projection status. */
function SkillsTab(): JSX.Element {
  const [state, setState] = useState<{
    revisions: PetSkillRevision[]
    selections: PetSkillSelection[]
    projection: PetProjectionEntry[]
  }>({ revisions: [], selections: [], projection: [] })
  const [path, setPath] = useState('')
  // Non-undefined while the in-app directory browser is open.
  const [browsing, setBrowsing] = useState<PetDirectoryListing | undefined>(undefined)
  const [preview, setPreview] = useState<Record<string, unknown> | undefined>(undefined)
  // Values for the parameters the inspected Skill declared, keyed by name.
  const [skillArgs, setSkillArgs] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      // Tell a mounted mascot the Skill set may have changed, so its menu
      // updates without a page reload.
      globalThis.dispatchEvent?.(new Event(PET_SKILLS_EVENT))
      // Normalize every list. Replacing state wholesale with the raw response
      // makes a missing field `undefined`, and the first `.length` read then
      // throws during render — the whole tab blanks out and its buttons stop
      // responding, with no visible error to explain why.
      const result = (await petApi.skills()) as unknown as Partial<{
        revisions: PetSkillRevision[]
        selections: PetSkillSelection[]
        projection: PetProjectionEntry[]
      }>
      setState({
        revisions: result.revisions ?? [],
        selections: result.selections ?? [],
        projection: result.projection ?? [],
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="dshpet-settings">
      {/* Open by default only while there is nothing installed: a new Pet has
          no capabilities and importing one is the whole task. Once Skills
          exist, the list below is what the user came for and this multi-step
          form is just noise until it is wanted again. */}
      <Group
        title="从本机导入"
        collapsible
        defaultOpen={state.revisions.length === 0}
        note="添加一个 Skill 目录"
      >
      <p className="dshpet-item-hint">
        填运行 <code className="dshpet-code">dsh web</code> 那台机器上的绝对路径，
        不是你当前浏览器所在的机器。会先只读检查并展示内容，确认后再加入；
        加入后不会自动启用，需要在下方手动启用。
      </p>
      <div className="dshpet-row">
        <input
          className="dshpet-input"
          value={path}
          placeholder="/absolute/path/on/the/host"
          onChange={event => setPath(event.target.value)}
        />
        <button
          type="button"
          className="dshpet-action"
          onClick={() => {
            setError(undefined)
            // Try the OS picker first; on a deployment that only serves
            // `browse` it resolves to nothing, so fall through to the in-app
            // browser rather than leaving the button apparently dead.
            void (async () => {
              const picked = await directoryPicker?.()
              if (picked !== undefined) {
                setPath(picked)
                return
              }
              // Open at whatever the field already holds, so a typed or
              // previously chosen path is where browsing starts. An
              // unreadable path is not an error here: fall back to the Host
              // default rather than refusing to open the browser.
              const typed = path.trim()
              const listing =
                (typed === '' ? undefined : await directoryLister?.(typed)) ??
                (await directoryLister?.())
              if (listing === undefined) {
                setError('此部署不支持目录选择，请直接填写 Host 上的绝对路径。')
                return
              }
              setBrowsing(listing)
            })()
          }}
        >
          浏览…
        </button>
      </div>
      {browsing !== undefined ? (
        <div className="dshpet-browser">
          <div className="dshpet-crumbs">
            {(browsing.crumbs ?? []).map(crumb => (
              <button
                key={crumb.path}
                type="button"
                className="dshpet-action dshpet-action-sm"
                onClick={() => {
                  void directoryLister?.(crumb.path).then(next => {
                    if (next === undefined) return
                    setBrowsing(next)
                    // Mirror the browsed location, so the field always shows
                    // what "Inspect" would actually read.
                    setPath(next.path)
                  })
                }}
              >
                {crumb.name === '' ? '/' : crumb.name}
              </button>
            ))}
          </div>
          <p className="dshpet-item-hint">
            <code className="dshpet-code">{browsing.path}</code>
          </p>
          <div className="dshpet-browser-list">
            {(browsing.entries ?? []).length === 0 ? (
              <p className="dshpet-empty">这个目录下没有子目录。</p>
            ) : (
              (browsing.entries ?? []).map(entry => (
                <button
                  key={entry.path}
                  type="button"
                  className="dshpet-action dshpet-browser-entry"
                  onClick={() => {
                    void directoryLister?.(entry.path).then(next => {
                      if (next === undefined) return
                    setBrowsing(next)
                    // Mirror the browsed location, so the field always shows
                    // what "Inspect" would actually read.
                    setPath(next.path)
                    })
                  }}
                >
                  <span className="dshpet-browser-icon" aria-hidden="true">
                    📁
                  </span>
                  <span className="dshpet-browser-name">{entry.name}</span>
                  <span className="dshpet-browser-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="dshpet-actions">
            <button
              type="button"
              className="dshpet-action dshpet-action-primary"
              onClick={() => {
                // Select the directory currently being viewed.
                setPath(browsing.path)
                setBrowsing(undefined)
              }}
            >
              选择当前目录
            </button>
            <button
              type="button"
              className="dshpet-action"
              onClick={() => setBrowsing(undefined)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="dshpet-action"
        onClick={() => {
          setError(undefined)
          // Step 1: read-only inspection. Nothing is copied yet.
          void petApi
            .inspectSkill(path)
            .then(next => {
              setPreview(next)
              setSkillArgs('')
            })
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
        }}
      >
        检查
      </button>

      {preview !== undefined ? (
        // The inspection result is a distinct object the user is being asked
        // to approve, so it gets a card rather than dissolving into the form
        // it was triggered from.
        <div className="dshpet-card">
          <div className="dshpet-card-head">
            <span className="dshpet-card-name">{String(preview['skillName'])}</span>
            <span className="dshpet-status">
              {String(preview['fileCount'])} 个文件 · {String(preview['totalBytes'])} 字节
            </span>
          </div>
          <p className="dshpet-item-hint">{String(preview['description'])}</p>
          <p className="dshpet-item-hint">
            将链接到 <code className="dshpet-code">{String(preview['canonicalSourcePath'])}</code>
          </p>
          <label className="dshpet-field">
            运行参数（可选）
            <input
              className="dshpet-input"
              value={skillArgs}
              placeholder="例如：clean"
              onChange={event => setSkillArgs(event.target.value)}
            />
          </label>
          <p className="dshpet-item-hint">
            调用时直接拼在 <code className="dshpet-code">/{String(preview['skillName'])}</code>{' '}
            后面，由 Skill 自己理解，Pet 不做解析。加入后仍可修改。
          </p>
          {/* A caution about what importing means, not an error: this is the
              trust decision the two-step flow exists to make deliberate. */}
          <p className="dshpet-callout" data-tone="warn">
            Skill 是会被 Agent 执行的指令内容，只加入你信任的目录。
            加入后 Pet 直接链接该目录，你之后对它的修改会立即生效。
          </p>
          <button
            type="button"
            className="dshpet-action dshpet-action-primary"
            onClick={() => {
              // Step 2: separately confirmed registration of the exact
              // directory the user was shown.
              void petApi
                .importSkill(path, skillArgs)
                .then(() => {
                  setPreview(undefined)
                  return refresh()
                })
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                )
            }}
          >
            确认加入
          </button>
        </div>
      ) : null}
      </Group>

      <Group title="已安装">
      <p className="dshpet-item-hint">
        加入的 Skill 直接链接到你给的目录，Pet 不做复制。
        因此你改动该目录会立即生效，无需重新加入；
        相应地，目录被删除或移走时该 Skill 会失效，对应能力将拒绝执行。
        「移除」只解除登记，不会删除你的目录。
      </p>
      {state.revisions.length === 0 ? (
        <p className="dshpet-empty">尚未加入任何 Skill。</p>
      ) : null}
      <div className="dshpet-cards">
      {state.revisions.map(revision => {
        const selection = state.selections.find(item => item.skillName === revision.skillName)
        const enabled = selection?.enabled === true
        const atCapacity =
          state.selections.filter(item => item.enabled === true).length >= WHEEL_CAPACITY

        return (
          // A card per Skill. These were bare rows divided only by a hairline,
          // so a handful of them read as one undifferentiated block and the
          // per-Skill actions looked like they belonged to the whole list.
          <div key={revision.skillName} className="dshpet-card">
            <div className="dshpet-card-head">
              <span className="dshpet-card-name">{revision.skillName}</span>
              <span className="dshpet-status" data-tone={enabled ? 'enabled' : undefined}>
                {enabled ? '已启用' : '未启用'}
              </span>
              {/* Enabled but hidden is easy to forget and hard to explain from
                  the wheel alone, so the card states it. */}
              {enabled && selection?.showAsShortcut === false ? (
                <span className="dshpet-status">已从菜单隐藏</span>
              ) : null}
            </div>
            <p className="dshpet-item-hint">
              <code className="dshpet-code">{revision.sourcePath}</code>
            </p>
            <StoredField
              label="运行参数"
              value={revision.arguments ?? ''}
              placeholder="例如：clean"
              emptyText="无"
              onSave={async next => {
                // Appended after the skill token on every dispatch; the Skill
                // itself interprets them.
                await petApi.mutateSkill({
                  skillName: revision.skillName,
                  action: 'arguments',
                  arguments: next,
                })
                await refresh()
              }}
            />
            <div className="dshpet-actions">
              <button
                type="button"
                className="dshpet-action"
                // The wheel holds 24; enabling past that would leave the Skill
                // enabled but invisible, which reads as a bug. The cap is a
                // display constraint only — it never changes what an already
                // enabled Skill may do.
                disabled={!enabled && atCapacity}
                title={
                  !enabled && atCapacity
                    ? `已达轮盘容量上限（${WHEEL_CAPACITY} 个），请先停用一个 Skill`
                    : undefined
                }
                onClick={() =>
                  void petApi
                    .mutateSkill({
                      skillName: revision.skillName,
                      action: enabled ? 'disable' : 'enable',
                    })
                    .then(refresh)
                }
              >
                {enabled ? '停用' : '启用'}
              </button>
              <button
                type="button"
                className="dshpet-action"
                onClick={() =>
                  void petApi
                    .mutateSkill({
                      skillName: revision.skillName,
                      action: 'shortcut',
                      showAsShortcut: !(selection?.showAsShortcut ?? true),
                    })
                    .then(refresh)
                }
              >
                {selection?.showAsShortcut === false ? '在菜单显示' : '从菜单隐藏'}
              </button>
              <button
                type="button"
                className="dshpet-action dshpet-action-danger"
                onClick={() => {
                  setError(undefined)
                  // Removes the registration only; the user's own directory is
                  // never touched, because Pet only ever held a link to it.
                  void petApi
                    .mutateSkill({ skillName: revision.skillName, action: 'remove' })
                    .then(refresh)
                    .catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                    )
                }}
              >
                移除
              </button>
            </div>
          </div>
        )
      })}
      </div>
      </Group>

      {/* Self-maintaining plumbing: folded while healthy, but forced open when
          a link is broken — a fault the user must act on cannot be allowed to
          hide behind a closed disclosure. */}
      <Group
        title="Skill 文件状态"
        collapsible
        defaultOpen={state.projection.length > 0}
        note={state.projection.length === 0 ? '正常' : `${state.projection.length} 个异常`}
      >
      <p className="dshpet-item-hint">
        已启用的 Skill 会以链接的形式出现在 Pet 工作区里，供执行会话读取。
        这些链接由 Pet 自己维护——正常情况下你不需要管它。
        如果链接被外部改动，或源目录被删除、移走，能力会拒绝执行，
        这时可以用下面的按钮重新生成。
      </p>
      {state.projection.length === 0 ? (
        <p className="dshpet-item-hint">当前一切正常。</p>
      ) : (
        <>
          <p className="dshpet-item-hint">
            以下 Skill 的链接与预期不符，相关能力已暂停：
          </p>
          {state.projection.map(entry => (
            <p key={entry.skillName} className="dshpet-error">
              {entry.skillName} — {entry.diagnostic ?? entry.status}
            </p>
          ))}
        </>
      )}
      <div className="dshpet-actions">
        <button
          type="button"
          className="dshpet-action"
          onClick={() => void petApi.rebuildProjection().then(refresh)}
        >
          重新生成 Skill 链接
        </button>
      </div>
      <p className="dshpet-item-hint">
        重新生成只修复链接本身。如果源目录已不存在或不再包含 SKILL.md，
        会保持拒绝状态——需要修好该目录，或移除后重新加入。
      </p>
      {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
      </Group>
    </div>
  )
}


/**
 * Mask a configured value for display.
 *
 * Display-layer only: the value is still stored and injected verbatim. This
 * guards against a shoulder-surf or a screenshot, NOT against anyone who can
 * read the machine — the panel says as much, so the masking is not mistaken
 * for credential protection.
 * @param value - The stored value.
 * @returns the masked rendering.
 */
function maskValue(value: string): string {
  if (value.length <= 5) return '•'.repeat(Math.max(value.length, 3))
  return `${value.slice(0, 5)}${'•'.repeat(Math.min(value.length - 5, 10))}`
}

/** One environment row: name, injected name, masked value and actions. */
function EnvRow(props: {
  readonly entry: PetEnvRecord
  readonly prefix: string
  /** Set when this workspace entry shadows a global one of the same key. */
  readonly overridesGlobal?: boolean
  readonly onRemove: () => Promise<void>
}): JSX.Element {
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <div className="dshpet-env-row">
      <div className="dshpet-env-key">
        <span className="dshpet-env-name">
          {props.entry.key}
          {props.overridesGlobal === true ? (
            <span className="dshpet-badge-override">覆盖全局</span>
          ) : null}
        </span>
        <span className="dshpet-env-inject">
          ${props.prefix}
          {props.entry.key}
        </span>
      </div>
      <span className="dshpet-env-value">
        <span className="dshpet-env-secret">
          {revealed ? props.entry.value : maskValue(props.entry.value)}
        </span>
        <button
          type="button"
          className="dshpet-reveal"
          onClick={() => setRevealed(current => !current)}
        >
          {revealed ? '隐藏' : '显示'}
        </button>
      </span>
      <div className="dshpet-actions">
        <button
          type="button"
          className="dshpet-action"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void props.onRemove().finally(() => setBusy(false))
          }}
        >
          删除
        </button>
      </div>
    </div>
  )
}

/** The add form shared by both scopes. */
function EnvAddRow(props: {
  readonly onAdd: (key: string, value: string) => Promise<void>
}): JSX.Element {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const submit = (): void => {
    setError(undefined)
    setBusy(true)
    void props
      .onAdd(key.trim(), value.trim())
      .then(() => {
        // Clear only on success, so a rejected write keeps what was typed.
        setKey('')
        setValue('')
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <div className="dshpet-row">
        <div className="dshpet-field">
          <span>变量名</span>
          <input
            className="dshpet-input"
            value={key}
            placeholder="CR_GROUP"
            onChange={event => setKey(event.target.value)}
          />
        </div>
        <div className="dshpet-field">
          <span>值</span>
          <input
            className="dshpet-input"
            value={value}
            placeholder="oc_xxxxxxxx"
            onChange={event => setValue(event.target.value)}
          />
        </div>
        <button type="button" className="dshpet-action" disabled={busy} onClick={submit}>
          添加
        </button>
      </div>
      {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
    </>
  )
}

/**
 * Environment: global and per-workspace values injected as `DSH_PET_*`.
 *
 * Two scopes, with the workspace one overriding a same-named global entry. The
 * effective view exists because that precedence is invisible otherwise: with
 * no gate on what a value can do, "which group does this project actually post
 * to" must be answerable at a glance.
 * @returns the rendered tab.
 */
function EnvironmentTab(): JSX.Element {
  const [entries, setEntries] = useState<readonly PetEnvRecord[]>([])
  const [workspaces, setWorkspaces] = useState<readonly PetWorkspaceChoice[]>([])
  const [globalScope, setGlobalScope] = useState('global')
  const [prefix, setPrefix] = useState('DSH_PET_')
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [manualId, setManualId] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      const data = await petApi.petEnv()
      setEntries(data.entries ?? [])
      setWorkspaces(data.workspaces ?? [])
      setGlobalScope(data.globalScope ?? 'global')
      setPrefix(data.prefix ?? 'DSH_PET_')
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const mutate = async (input: {
    scope: string
    key: string
    action: 'set' | 'remove'
    value?: string
  }): Promise<void> => {
    await petApi.mutatePetEnv(input)
    await refresh()
  }

  const globalEntries = entries.filter(entry => entry.scope === globalScope)
  const scope = selected ?? workspaces[0]?.id
  const workspaceEntries = scope === undefined ? [] : entries.filter(e => e.scope === scope)
  const globalKeys = new Set(globalEntries.map(entry => entry.key))

  // The effective set, computed the same way the Host does: global first, then
  // the workspace overriding same-named keys.
  const effective = new Map<string, { value: string; from: 'global' | 'workspace' }>()
  for (const entry of globalEntries) effective.set(entry.key, { value: entry.value, from: 'global' })
  for (const entry of workspaceEntries) {
    effective.set(entry.key, { value: entry.value, from: 'workspace' })
  }

  return (
    <div className="dshpet-settings">
      <Group title="全局">
        <p className="dshpet-item-hint">
          对<strong>所有</strong> Pet 任务生效，包括没有关联工作区的独立任务。
          下面工作区里的同名变量会覆盖这里的值。
        </p>
        {globalEntries.length === 0 ? (
          <p className="dshpet-empty">尚未配置全局变量。</p>
        ) : (
          <div className="dshpet-cards">
            {globalEntries.map(entry => (
              <EnvRow
                key={entry.key}
                entry={entry}
                prefix={prefix}
                onRemove={() => mutate({ scope: globalScope, key: entry.key, action: 'remove' })}
              />
            ))}
          </div>
        )}
        <EnvAddRow
          onAdd={(key, value) => mutate({ scope: globalScope, key, action: 'set', value })}
        />
        <p className="dshpet-item-hint">
          变量名需为大写蛇形（A-Z、数字、下划线），注入时自动加{' '}
          <code className="dshpet-code">{prefix}</code> 前缀。
        </p>
      </Group>

      <Group title="工作区">
        <p className="dshpet-item-hint">
          只对来源于所选工作区的任务生效，<strong>覆盖</strong>同名的全局变量。
        </p>
        <div className="dshpet-field">
          <span>工作区</span>
          <select
            className="dshpet-input"
            value={scope ?? ''}
            onChange={event => setSelected(event.target.value)}
          >
            {workspaces.length === 0 ? <option value="">（尚无可选工作区）</option> : null}
            {workspaces.map(item => (
              <option key={item.id} value={item.id}>
                {item.title ?? item.id}
                {item.path === undefined ? '' : ` — ${item.path}`}
              </option>
            ))}
          </select>
        </div>
        {/* The escape hatch for a workspace the Host has not listed. It is the
            exception, so it no longer sits between the picker and the values
            it applies to. */}
        <details className="dshpet-fold">
          <summary className="dshpet-fold-head">
            <span className="dshpet-fold-mark" aria-hidden="true">
              ›
            </span>
            <span className="dshpet-fold-title">或手工输入工作区 id</span>
          </summary>
          <div className="dshpet-fold-body">
            <div className="dshpet-row">
              <div className="dshpet-field">
                <input
                  className="dshpet-input"
                  value={manualId}
                  placeholder="尚未列出的 workspace id"
                  onChange={event => setManualId(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="dshpet-action"
                onClick={() => {
                  const trimmed = manualId.trim()
                  if (trimmed !== '') setSelected(trimmed)
                }}
              >
                使用
              </button>
            </div>
          </div>
        </details>

        {scope === undefined ? (
          <p className="dshpet-empty">先选择或填写一个工作区。</p>
        ) : (
          <>
            {workspaceEntries.length === 0 ? (
              <p className="dshpet-empty">该工作区尚未配置变量。</p>
            ) : (
              <div className="dshpet-cards">
                {workspaceEntries.map(entry => (
                  <EnvRow
                    key={entry.key}
                    entry={entry}
                    prefix={prefix}
                    overridesGlobal={globalKeys.has(entry.key)}
                    onRemove={() => mutate({ scope, key: entry.key, action: 'remove' })}
                  />
                ))}
              </div>
            )}
            <EnvAddRow onAdd={(key, value) => mutate({ scope, key, action: 'set', value })} />
          </>
        )}
      </Group>

      {scope === undefined ? null : (
        // Derived, read-only: nothing here is edited, it only answers "what
        // does this workspace actually see". Folded by default with the count
        // on the header, so the answer is one click away instead of doubling
        // the page height with rows already shown above.
        <Group
          title="生效结果"
          collapsible
          note={`${effective.size} 个变量`}
        >
          <p className="dshpet-item-hint">
            来源于该工作区的任务，其命令实际能读到的变量。
          </p>
          {effective.size === 0 ? (
            <p className="dshpet-empty">没有会被注入的变量。</p>
          ) : (
            [...effective.entries()].map(([key, resolved]) => (
              <div className="dshpet-env-row" key={`eff-${key}`}>
                <div className="dshpet-env-key">
                  <span className="dshpet-env-name">
                    ${prefix}
                    {key}
                  </span>
                  <span className="dshpet-env-inject">
                    {resolved.from === 'workspace' ? '来自工作区' : '来自全局'}
                  </span>
                </div>
                <span className="dshpet-env-value">
                  <span className="dshpet-env-secret">{maskValue(resolved.value)}</span>
                </span>
                <span />
              </div>
            ))
          )}
          {/* A shadowed global entry is listed too: hiding it makes the
              override invisible and the effective value hard to explain. */}
          {globalEntries
            .filter(entry => effective.get(entry.key)?.from === 'workspace')
            .map(entry => (
              <div className="dshpet-env-row dshpet-row-shadowed" key={`shadow-${entry.key}`}>
                <div className="dshpet-env-key">
                  <span className="dshpet-env-name">
                    ${prefix}
                    {entry.key}
                    <span className="dshpet-badge-shadowed">已被覆盖</span>
                  </span>
                  <span className="dshpet-env-inject">来自全局</span>
                </div>
                <span className="dshpet-env-value">
                  <span className="dshpet-env-secret">{maskValue(entry.value)}</span>
                </span>
                <span />
              </div>
            ))}
        </Group>
      )}

      <Group title="关于安全" collapsible note="值会进入子进程环境">
        {/* Stated as a caution rather than as body prose: it describes what
            these values can reach, which is the one thing on this tab a user
            must not skim past. */}
        <p className="dshpet-callout" data-tone="warn">
          这些值会进入 Pet 执行命令时的子进程环境，该会话里跑的任何命令都能读到。
          这里不是凭据保管处，请不要存放高敏 token；列表中的值默认打码只为避免
          共享屏幕时泄露，不改变存储与注入方式。
        </p>
        <p className="dshpet-item-hint">
          某个变量在全局与工作区都没有配置时，它不会存在于环境中；
          使用它的 Skill 应当自行停下来询问，而不是猜一个值。
        </p>
      </Group>
      {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
    </div>
  )
}

/**
 * One labelled diagnostic fact.
 *
 * Diagnostics previously dumped raw JSON, which is dense and hard to scan; a
 * label/value pair reads at a glance while still showing the exact value.
 * @param props - Label, value and whether to render the value monospaced.
 * @returns the rendered row.
 */
function Fact(props: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="dshpet-fact">
      <span className="dshpet-fact-key">{props.label}</span>
      <span className="dshpet-fact-value">
        {props.mono === true ? <code>{props.value}</code> : props.value}
      </span>
    </div>
  )
}

/** Diagnostics: lifecycle, paths, digests, drift and explicit repair. */
/** Human-readable connection phases. */
/**
 * An identity shown by name, with its open_id kept one interaction away.
 *
 * An `ou_…` string is unreadable, but it is still the value that matters when
 * someone needs to check or share it — so it lives in the tooltip and on the
 * clipboard rather than occupying the line.
 * @param props - The id, and the display name when one is known.
 * @returns the rendered chip.
 */
function IdentityChip(props: { id: string; name?: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="dshpet-identity"
      title={props.id}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(props.id)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
          .catch(() => undefined)
      }}
    >
      {props.name ?? props.id}
      <span className="dshpet-identity-hint">{copied ? '已复制' : '点击复制 ID'}</span>
    </button>
  )
}

export function shouldRefreshChannel(phase: PetChannelPhase): boolean {
  return phase === 'starting' || phase === 'reconnecting'
}

/**
 * Build the channel mutation used by the default-workspace selector.
 *
 * The empty option means "clear the default". It must be represented by an
 * omitted field: the Host route uses `undefined` to remove the persisted key,
 * while an empty string is still a present (and invalid) workspace id.
 * @param value - The selected workspace id, or the empty clear option.
 * @returns the exact mutation payload accepted by the Host route.
 */
export function defaultWorkspaceMutation(
  value: string,
): Parameters<typeof petApi.mutateChannel>[0] {
  const defaultWorkspaceId = value.trim()
  return defaultWorkspaceId === ''
    ? { action: 'set-default-workspace' }
    : { action: 'set-default-workspace', defaultWorkspaceId }
}

/** Treat an absent/malformed proof as unavailable; never infer readiness in Web. */
export function unifiedLocusReadiness(
  value: PetChannelView['unifiedLocus'] | undefined,
): PetUnifiedLocusReadiness {
  if (
    value?.defaultPermission === 'read' &&
    (value.childSession === 'verified' || value.childSession === 'unavailable') &&
    (value.readVerification === 'verified' || value.readVerification === 'unavailable')
  ) return value
  return {
    childSession: 'unavailable',
    defaultPermission: 'read',
    readVerification: 'unavailable',
    diagnostic: 'Host 未返回完整的统一子会话与默认只读核验证明。',
  }
}

/** Pairing also needs convergence while its one-time claim is in flight. */
export function shouldRefreshPairing(view: PetChannelView): boolean {
  const phase = view.pairing?.phase
  return (
    shouldRefreshChannel(view.connection.phase) ||
    phase === 'starting' ||
    phase === 'waiting' ||
    phase === 'claiming'
  )
}

/** Track a transitional Host state without relying on a change-feed edge. */
export function watchChannelTransition(
  load: () => Promise<PetChannelView>,
  apply: (view: PetChannelView) => void,
  delayMs = 750,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
  maxAttempts = 40,
  shouldContinue: (view: PetChannelView) => boolean = view =>
    shouldRefreshChannel(view.connection.phase),
): () => void {
  let stopped = false
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = (): void => {
    if (stopped || attempts >= maxAttempts) return
    timer = schedule(() => {
      attempts += 1
      void load()
        .then(next => {
          if (stopped) return
          apply(next)
          if (shouldContinue(next)) tick()
        })
        .catch(() => {
          if (!stopped) tick()
        })
    }, delayMs)
  }
  tick()
  return () => {
    stopped = true
    if (timer !== undefined) cancel(timer)
  }
}

const CHANNEL_PHASE_LABELS: Record<PetChannelPhase, string> = {
  stopped: '未启动',
  starting: '启动中',
  connected: '已连接',
  reconnecting: '重连中',
  down: '已断开',
}

/**
 * Channel: bot binding, admission and unified-locus readiness.
 *
 * Binding is the first thing here because nothing else can be configured
 * without an identity — an enabled channel with no bound bot could not tell
 * an `@us` from an `@someone-else`.
 * @returns the rendered tab.
 */
function ChannelTab(): JSX.Element {
  const [view, setView] = useState<PetChannelView | undefined>(undefined)
  const [workspaces, setWorkspaces] = useState<readonly PetWorkspaceChoice[]>([])
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [allowInput, setAllowInput] = useState('')
  const [pairNow, setPairNow] = useState(() => Date.now())
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setView(await petApi.channel())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
    void petApi
      .petEnv()
      .then(data => setWorkspaces(data.workspaces ?? []))
      .catch(() => undefined)
  }, [refresh])

  // While the user authorizes in a browser the Host learns nothing until the
  // CLI returns, so the view is polled until the flow settles.
  useEffect(() => {
    if (view?.binding?.phase !== 'awaiting-authorization') return undefined
    const timer = setInterval(() => void refresh(), 2000)
    return () => clearInterval(timer)
  }, [view?.binding?.phase, refresh])

  // The enable mutation legitimately returns `starting`; the ready marker may
  // arrive before this component can wait on the next change generation. Read
  // current state while transitional so that a missed edge still converges.
  useEffect(() => {
    if (view === undefined || !shouldRefreshPairing(view)) return undefined
    return watchChannelTransition(
      petApi.channel,
      setView,
      750,
      setTimeout,
      clearTimeout,
      440,
      shouldRefreshPairing,
    )
  }, [view?.connection.phase, view?.pairing?.phase])

  useEffect(() => {
    setCopyStatus('idle')
  }, [view?.pairing?.phase, view?.pairing?.phase === 'waiting' ? view.pairing.command : undefined])

  useEffect(() => {
    if (view?.pairing?.phase !== 'waiting' && view?.pairing?.phase !== 'claiming') return undefined
    setPairNow(Date.now())
    const timer = setInterval(() => setPairNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [view?.pairing?.phase, view?.pairing?.phase === 'waiting' ? view.pairing.expiresAt : undefined])

  const mutate = async (input: Parameters<typeof petApi.mutateChannel>[0]): Promise<void> => {
    try {
      setView(await petApi.mutateChannel(input))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      // Refresh blocker state without clearing the mutation error the user
      // still needs to read.
      void petApi.channel().then(setView).catch(() => undefined)
    }
  }

  const bind = async (input: Parameters<typeof petApi.bindBot>[0]): Promise<void> => {
    try {
      setView(await petApi.bindBot(input))
      // Cleared immediately: the secret has been handed to the Host and this
      // component must not keep a copy of it.
      setAppSecret('')
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setAppSecret('')
    }
  }

  // `dshpet-settings`, NOT `dshpet-panel-body`. Every settings rule is scoped
  // under `.dshpet-settings`, so this tab was rendering its inputs, buttons,
  // groups and lists completely unstyled — the reason it looked nothing like
  // the other four.
  if (view === undefined) {
    return (
      <div className="dshpet-settings">
        {error !== undefined ? <p className="dshpet-error">{error}</p> : <p>加载中…</p>}
      </div>
    )
  }

  const binding = view.binding
  const allowList = view.allowOpenIds
  const locusReadiness = unifiedLocusReadiness(view.unifiedLocus)
  const onboardingReady =
    view.onboarding.ready &&
    locusReadiness.childSession === 'verified' &&
    locusReadiness.readVerification === 'verified'
  const pairing = view.pairing
  const pairingExpiresAt =
    pairing?.phase === 'waiting' || pairing?.phase === 'claiming'
      ? pairing.expiresAt
      : undefined
  const pairingSeconds =
    pairingExpiresAt === undefined ? 0 : Math.max(0, Math.ceil((pairingExpiresAt - pairNow) / 1000))
  const pairingTime = `${Math.floor(pairingSeconds / 60)}:${String(pairingSeconds % 60).padStart(2, '0')}`
  const canPair =
    view.bot?.openId !== undefined &&
    !view.onboarding.blockers.some(blocker =>
      blocker.code === 'profile-unavailable' || blocker.code === 'bot-identity-unresolved',
    )
  const doneSteps = view.onboarding.steps.filter(step => step.complete).length

  return (
    <div className="dshpet-settings">
      <Group
        title="接入进度"
        note={`${doneSteps}/${view.onboarding.steps.length}`}
      >
        <ol className="dshpet-list">
          {view.onboarding.steps.map(step => (
            <li key={step.id} className="dshpet-item" data-complete={step.complete}>
              <span className="dshpet-step-mark" aria-hidden="true">
                {step.complete ? '✓' : '○'}
              </span>
              <span className="dshpet-item-text">{step.label}</span>
            </li>
          ))}
        </ol>
        {onboardingReady ? (
          <p className="dshpet-callout">配置与统一子会话能力均已就绪，可以启用飞书接入。</p>
        ) : (
          // A blocker is the thing standing between the user and a working
          // channel, so it reads as a warning rather than as another step.
          <ol className="dshpet-list">
            {view.onboarding.blockers.map(blocker => (
              <li key={blocker.code} className="dshpet-callout" data-tone="warn">
                <span>{blocker.message}</span>
                {blocker.missingScopes !== undefined && blocker.missingScopes.length > 0 ? (
                  <code className="dshpet-code">{blocker.missingScopes.join(', ')}</code>
                ) : null}
                {blocker.consoleUrl !== undefined ? (
                  <a href={blocker.consoleUrl} target="_blank" rel="noreferrer">
                    在飞书后台开通权限
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Group>
      <Group title="飞书 Bot">
        {view.bot === undefined ? (
          <>
            <p className="dshpet-item-hint">
              Pet 还没有连接飞书 Bot。连接后还需配置允许成员、自动主会话的默认工作区，
              并通过统一子会话/默认只读核验后启用接入。凭据由 lark-cli 保管，Pet 不会保存或显示 App Secret。
            </p>
            {binding?.phase === 'awaiting-authorization' ? (
              <p className="dshpet-item-hint">
                等待你在浏览器完成授权…
                {binding.verificationUrl !== undefined ? (
                  <>
                    {' '}
                    <a href={binding.verificationUrl} target="_blank" rel="noreferrer">
                      打开授权页面
                    </a>
                  </>
                ) : null}
                <button
                  type="button"
                  className="dshpet-action"
                  onClick={() => void bind({ action: 'cancel' })}
                >
                  取消
                </button>
              </p>
            ) : (
              <div className="dshpet-actions">
                <button
                  type="button"
                  className="dshpet-action dshpet-action-primary"
                  onClick={() => void bind({ action: 'create' })}
                >
                  创建新的 Bot
                </button>
              </div>
            )}
            {/* The secondary path. Presented flat, its two credential inputs
                competed with "create a new Bot" and made the tab open on a
                form most users never fill in. */}
            <details className="dshpet-fold">
              <summary className="dshpet-fold-head">
                <span className="dshpet-fold-mark" aria-hidden="true">
                  ›
                </span>
                <span className="dshpet-fold-title">连接已有 Bot</span>
              </summary>
              <div className="dshpet-fold-body">
                <div className="dshpet-field">
                  <label htmlFor="dshpet-channel-appid">App ID</label>
                  <input
                    className="dshpet-input"
                    id="dshpet-channel-appid"
                    value={appId}
                    placeholder="App ID（cli_…）"
                    onChange={event => setAppId(event.target.value)}
                  />
                </div>
                <div className="dshpet-field">
                  <label htmlFor="dshpet-channel-appsecret">App Secret</label>
                  <input
                    className="dshpet-input"
                    id="dshpet-channel-appsecret"
                    type="password"
                    value={appSecret}
                    placeholder="只转交给 lark-cli，不会被保存"
                    onChange={event => setAppSecret(event.target.value)}
                  />
                </div>
                <div className="dshpet-actions">
                  <button
                    type="button"
                    className="dshpet-action"
                    disabled={appId.trim() === '' || appSecret === ''}
                    onClick={() => void bind({ action: 'connect', appId, appSecret })}
                  >
                    连接
                  </button>
                </div>
              </div>
            </details>
          </>
        ) : (
          <>
            <dl className="dshpet-kv">
              <dt>Bot</dt>
              <dd>
                <IdentityChip
                  id={view.bot.appId}
                  {...(view.bot.name !== undefined ? { name: view.bot.name } : {})}
                />
              </dd>
              <dt>身份确认</dt>
              <dd>
                {view.bot.openId === undefined ? (
                  '尚未确认（请升级到受支持的 lark-cli 后重新连接 Bot）'
                ) : (
                  <IdentityChip id={view.bot.openId} name="已确认" />
                )}
              </dd>
            </dl>
            {view.onboarding.blockers.some(blocker =>
              blocker.code === 'profile-unavailable' || blocker.code === 'bot-identity-unresolved',
            ) ? (
              <>
                <div className="dshpet-field">
                  <label htmlFor="dshpet-channel-reconnect">App Secret</label>
                  <input
                    className="dshpet-input"
                    id="dshpet-channel-reconnect"
                    type="password"
                    value={appSecret}
                    placeholder="用于重建 dsh-pet 专属 profile，不会保存"
                    onChange={event => setAppSecret(event.target.value)}
                  />
                </div>
                <div className="dshpet-actions">
                  <button
                    type="button"
                    className="dshpet-action"
                    disabled={appSecret === ''}
                    onClick={() =>
                      void bind({ action: 'connect', appId: view.bot?.appId ?? '', appSecret })
                    }
                  >
                    重新连接专属 profile
                  </button>
                </div>
              </>
            ) : null}
          </>
        )}
        {binding?.phase === 'failed' ? (
          <p className="dshpet-callout" data-tone="danger">
            {binding.diagnostic ?? '绑定失败'}
          </p>
        ) : null}
      </Group>

      <Group title="允许触发的成员" note={`${allowList.length} 人`}>
        <p className="dshpet-item-hint">
          生成一次性配对码后，把完整命令私聊发送给 Bot。配对码是 5 分钟有效的 bearer
          凭证：第一个正确发送者会立即获得触发权限，请勿转发给无关人员。手动添加仅接受
          已确认的 open_id。默认 Q&A 新群的所有者来自 dsh-pet profile 实时核验的当前飞书用户，
          且必须已在 allowlist 中；列表顺序和浏览器输入都不能声明“本人”。Pet 不会把观察到的陌生发送者
          自动加入允许清单。
        </p>
        {pairing === undefined ? (
          <div className="dshpet-actions">
            <button
              type="button"
              className="dshpet-action dshpet-action-primary"
              disabled={!canPair}
              onClick={() => void mutate({ action: 'pair-start' })}
            >
              生成配对码
            </button>
          </div>
        ) : pairing.phase === 'starting' ? (
          <p className="dshpet-callout">正在连接飞书事件通道，连接完成后显示配对命令…</p>
        ) : pairing.phase === 'waiting' ? (
          <div className="dshpet-callout">
            <span>请在 {pairingTime} 内私聊 Bot 发送：</span>
            <code className="dshpet-code">{pairing.command}</code>
            <span className="dshpet-actions">
              <button
                type="button"
                className="dshpet-action"
                onClick={() => {
                  if (navigator.clipboard === undefined) {
                    setCopyStatus('failed')
                    return
                  }
                  void navigator.clipboard
                    .writeText(pairing.command)
                    .then(() => setCopyStatus('copied'))
                    .catch(() => setCopyStatus('failed'))
                }}
              >
                复制命令
              </button>
              <button type="button" className="dshpet-action" onClick={() => void mutate({ action: 'pair-start' })}>
                重新生成
              </button>
              <button type="button" className="dshpet-action" onClick={() => void mutate({ action: 'pair-cancel' })}>
                取消
              </button>
            </span>
            <span role="status">
              {copyStatus === 'copied' ? '已复制' : copyStatus === 'failed' ? '复制失败，请手动选择命令' : ''}
            </span>
          </div>
        ) : pairing.phase === 'claiming' ? (
          <p className="dshpet-callout">已匹配，正在安全写入允许成员…</p>
        ) : pairing.phase === 'succeeded' ? (
          <div className="dshpet-callout">
            <span>✓ 配对成功</span>
            <IdentityChip id={pairing.openId} {...(pairing.name === undefined ? {} : { name: pairing.name })} />
            <button type="button" className="dshpet-action" onClick={() => void mutate({ action: 'pair-start' })}>
              添加另一位成员
            </button>
          </div>
        ) : pairing.phase === 'expired' ? (
          <div className="dshpet-callout" data-tone="warn">
            <span>配对码已过期。</span>
            <button type="button" className="dshpet-action" onClick={() => void mutate({ action: 'pair-start' })}>
              重新生成
            </button>
          </div>
        ) : (
          <div className="dshpet-callout" data-tone="danger">
            <span>{pairing.diagnostic}</span>
            <button type="button" className="dshpet-action" onClick={() => void mutate({ action: 'pair-start' })}>
              重试
            </button>
          </div>
        )}
        <ul className="dshpet-list">
          {allowList.map(openId => (
            <li key={openId} className="dshpet-item">
              <IdentityChip
                id={openId}
                {...(view.knownNames[openId] !== undefined
                  ? { name: view.knownNames[openId] }
                  : {})}
              />
              <button
                type="button"
                className="dshpet-action"
                onClick={() =>
                  void mutate({
                    action: 'set-allowlist',
                    allowOpenIds: allowList.filter(entry => entry !== openId),
                  })
                }
              >
                移除
              </button>
            </li>
          ))}
        </ul>
        {allowList.length === 0 ? (
          <p className="dshpet-empty">清单为空，当前没有人可以触发。</p>
        ) : null}
        <details className="dshpet-fold">
          <summary className="dshpet-fold-head">
            <span className="dshpet-fold-mark" aria-hidden="true">›</span>
            <span className="dshpet-fold-title">高级：手动添加 open_id</span>
          </summary>
          <div className="dshpet-fold-body">
            <p className="dshpet-item-hint">仅填写已经确认的 ou_…；无法证明身份的值不会生效。</p>
            <div className="dshpet-row">
              <div className="dshpet-field">
                <input
                  className="dshpet-input"
                  aria-label="成员 open_id"
                  value={allowInput}
                  placeholder="ou_…"
                  onChange={event => setAllowInput(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="dshpet-action"
                disabled={allowInput.trim() === ''}
                onClick={() => {
                  void mutate({
                    action: 'set-allowlist',
                    allowOpenIds: [...allowList, allowInput.trim()],
                  }).then(() => setAllowInput(''))
                }}
              >
                添加
              </button>
            </div>
          </div>
        </details>
      </Group>

      <Group title="自动主会话默认工作区">
        <p className="dshpet-item-hint">
          仅用于 project 群首次建立协作时创建该群专属的默认主会话。每个群独立复用自己的主会话；
          此选择不是群级执行路由，也不会改写任何已有 locus 的 workspace 或主会话。
        </p>
        {/* Was a bare `<select>`: with no `dshpet-input` class it fell back to
            the browser's native control, which matched nothing else here. */}
        <div className="dshpet-field">
          <select
            className="dshpet-input"
            value={view.defaultWorkspaceId ?? ''}
            onChange={event =>
              void mutate(defaultWorkspaceMutation(event.target.value))
            }
          >
            <option value="">（未设置）</option>
            {workspaces.map(workspace => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.title ?? workspace.id}
              </option>
            ))}
          </select>
        </div>
      </Group>

      <Group title="统一子会话能力">
        <p className="dshpet-item-hint">
          所有新飞书工作必须进入当前 locus 的专属子会话；不会创建飞书 root executor、
          Pet Invocation 或 waiting-user 分支。新关联始终从只读开始，并以 Host 的实际策略回读为准。
        </p>
        <div className="dshpet-facts">
          <Fact
            label="专属子会话"
            value={locusReadiness.childSession === 'verified' ? '已核验' : '不可用'}
          />
          <Fact label="新关联默认权限" value="只读（read）" />
          <Fact
            label="只读策略回读"
            value={locusReadiness.readVerification === 'verified' ? '已核验' : '不可用'}
          />
        </div>
        {locusReadiness.diagnostic !== undefined ? (
          <p className="dshpet-callout" data-tone="warn">
            {locusReadiness.diagnostic}
          </p>
        ) : null}
      </Group>

      <Group title="启用与连接">
        <p className="dshpet-item-hint">
          完成以上步骤后启用。只有允许清单成员可初始化未建立的入口；已授权 locus 的群成员可在当前入口
          @Bot 提问。任何新飞书消息都只走统一主会话/locus/子会话流程。
        </p>
        <label className="dshpet-check">
          <input
            className="dshpet-input"
            type="checkbox"
            checked={view.enabled}
            disabled={!view.enabled && !onboardingReady}
            onChange={event => void mutate({ action: 'set-enabled', enabled: event.target.checked })}
          />
          启用飞书接入
        </label>
        {/* Connection state is a status, not prose: as a grey hint line it was
            indistinguishable from the explanatory text above it. */}
        <div className="dshpet-fact">
          <span className="dshpet-fact-key">连接状态</span>
          <span className="dshpet-fact-value" data-chip="true">
            <span
              className="dshpet-status"
              data-tone={
                view.connection.phase === 'connected'
                  ? 'enabled'
                  : view.connection.phase === 'down'
                    ? 'danger'
                    : view.connection.phase === 'stopped'
                      ? undefined
                      : 'warn'
              }
            >
              {!view.enabled && shouldRefreshPairing(view)
                ? `配对临时${CHANNEL_PHASE_LABELS[view.connection.phase]}`
                : CHANNEL_PHASE_LABELS[view.connection.phase]}
            </span>
            {view.connection.diagnostic !== undefined
              ? `（${view.connection.diagnostic}）`
              : ''}
          </span>
        </div>
      </Group>



      {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
    </div>
  )
}

/** Channel connection state, surfaced inside Diagnostics. */
function ChannelDiagnostics(): JSX.Element {
  const [view, setView] = useState<PetChannelView | undefined>(undefined)

  useEffect(() => {
    void petApi
      .channel()
      .then(setView)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (view === undefined || !shouldRefreshChannel(view.connection.phase)) return undefined
    return watchChannelTransition(petApi.channel, setView)
  }, [view?.connection.phase])

  const locusReadiness = unifiedLocusReadiness(view?.unifiedLocus)

  return (
    <Group title="飞书接入">
      {view === undefined ? (
        <p className="dshpet-item-hint">状态不可用。</p>
      ) : (
        <>
          <div className="dshpet-facts">
            <div className="dshpet-fact">
              <span className="dshpet-fact-key">连接</span>
              <span className="dshpet-fact-value" data-chip="true">
                <span
                  className="dshpet-status"
                  data-tone={
                    view.connection.phase === 'connected'
                      ? 'enabled'
                      : view.connection.phase === 'down'
                        ? 'danger'
                        : view.connection.phase === 'stopped'
                          ? undefined
                          : 'warn'
                  }
                >
                  {CHANNEL_PHASE_LABELS[view.connection.phase]}
                </span>
                {view.connection.diagnostic !== undefined
                  ? `（${view.connection.diagnostic}）`
                  : ''}
              </span>
            </div>
            <Fact
              label="统一子会话"
              value={locusReadiness.childSession === 'verified' ? '已核验' : '不可用'}
            />
            <Fact
              label="默认只读策略"
              value={locusReadiness.readVerification === 'verified' ? '已核验' : '不可用'}
            />
            <Fact label="已绑定 Bot" value={view.bot?.appId ?? '未绑定'} mono />
          </div>
          {view.connection.phase === 'down' ? (
            <div className="dshpet-actions">
              <button
                type="button"
                className="dshpet-action"
                onClick={() =>
                  void petApi
                    .mutateChannel({ action: 'reconnect' })
                    .then(setView)
                    .catch(() => undefined)
                }
              >
                重新连接
              </button>
            </div>
          ) : null}
        </>
      )}
    </Group>
  )
}

function DiagnosticsTab(): JSX.Element {
  const [data, setData] = useState<Record<string, unknown> | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setData(await petApi.diagnostics())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const workspace = data?.['workspace'] as
    | { ok?: boolean; problems?: readonly string[] }
    | undefined
  const lifecycle = data?.['lifecycle'] as
    | { phase?: string; diagnostic?: string }
    | undefined
  const paths = (data?.['paths'] ?? {}) as Record<string, unknown>
  const allowlist = (data?.['allowlist'] ?? []) as readonly { skillName: string }[]
  const drift = (data?.['drift'] ?? []) as readonly {
    skillName: string
    status: string
    diagnostic?: string
  }[]

  return (
    <div className="dshpet-settings">
      <Group title="运行状态">
        <div className="dshpet-facts">
          <Fact label="生命周期" value={lifecycle?.phase ?? '…'} />
          {lifecycle?.diagnostic !== undefined ? (
            <Fact label="诊断信息" value={lifecycle.diagnostic} />
          ) : null}
          <Fact
            label="已启用 Skill"
            value={
              allowlist.length === 0
                ? '无'
                : allowlist.map(entry => entry.skillName).join(', ')
            }
          />
          <Fact
            label="工作区文件"
            value={
              workspace?.ok === false
                ? (workspace.problems ?? []).join('；')
                : '正常'
            }
          />
          <Fact
            label="Skill 文件"
            value={
              drift.length === 0 ? '正常' : `${drift.length} 个链接异常`
            }
          />
        </div>
        {drift.length > 0 ? (
          <div className="dshpet-callout" data-tone="warn">
            {drift.map(entry => (
              <span key={entry.skillName}>
                {entry.skillName} — {entry.diagnostic ?? entry.status}
              </span>
            ))}
          </div>
        ) : null}
      </Group>

      {/* Absolute paths on disk: worth having, never worth reading first. They
          are the longest block on the tab and pushed the actions below the
          fold. */}
      <Group
        title="存储路径"
        collapsible
        note={`${Object.keys(paths).length} 条`}
      >
        <div className="dshpet-facts">
          {Object.entries(paths).map(([key, value]) => (
            <Fact key={key} label={key} value={String(value)} mono />
          ))}
        </div>
      </Group>

      <Group title="操作">
        <div className="dshpet-actions">
          <button
            type="button"
            className="dshpet-action"
            onClick={() => void petApi.rebuildProjection().then(refresh)}
          >
            重新生成 Skill 链接
          </button>
          {/* Was "Refresh": the only English control left on a Chinese page. */}
          <button type="button" className="dshpet-action" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
      </Group>

      <ChannelDiagnostics />
    </div>
  )
}
