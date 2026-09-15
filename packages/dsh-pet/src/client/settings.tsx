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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_GLYPH,
  PET_ACCENT_EVENT,
  PET_APPEARANCE_EVENT,
  PET_SKILLS_EVENT,
  normalizeGlyph,
  PET_ACCENTS,
  PET_SIZES,
  PET_RING_STYLES,
  DEFAULT_RING_STYLE,
  type PetRingStyleId,
  resolveAccent,
  type PetAccentId,
  type PetSizeId,
} from './accent.js'
import { petApi, type PetConfig } from './api.js'
import {
  DEFAULT_LOCUS_FILTER,
  ENTRY_STATE_OPTIONS,
  PARENT_AVAILABILITY_LABELS,
  applyLocusFilter,
  applyQuery,
  collectHandleCodes,
  countLocusFilterOptions,
  endpointHandleId,
  endpointKey,
  entryDisplayName,
  endpointHandleLabel,
  familyHead,
  handleCode,
  handleLabel,
  isHostCurrent,
  locusSourceLabel,
  locusStateLabel,
  locusStateTone,
  sessionAvailabilityLabel,
  summarizeLocusView,
  type HandleCodes,
  type HiddenSummary,
  type LocusFamily,
  type LocusFamilyNode,
  type LocusFilter,
  type ParentAvailability,
  type WorkGroup,
} from './locus-view.js'
import { PET_EXECUTOR_PRESET, chatAppLink } from '../wire.js'
import { WHEEL_CAPACITY } from './wheel.js'
import type {
  PetEnvRecord,
  PetProjectionEntry,
  PetSkillRevision,
  PetChannelPhase,
  PetChannelView,
  PetLocusDiscoveryRequest,
  PetLocusDiscoveryView,
  PetLocusEndpointView,
  PetLocusManagementView,
  PetLocusPermissionMode,
  PetLocusState,
  PetLocusView,
  PetSkillSelection,
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
        <span className="dshpet-fact-key">{props.label}</span>
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
      <span className="dshpet-fact-key">{props.label}</span>
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
      })
      .catch((cause: unknown) => setError(String(cause)))
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
          桌宠配色。保存在本浏览器中，不影响其他设备。
        </p>
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

// ---------------------------------------------------------------------------
// Owner-facing locus management surface.
//
// One screen answers three questions: is this entry live, which work does it
// belong to, and may it write. Identifiers, provenance and lifecycle actions
// are one disclosure away — printing everything at equal weight is what made
// the previous layout four screens tall without answering any of them.
//
// Two rules this surface must not break:
//   - it invents nothing. Grouping and labels are derived here; current-ness,
//     session availability and permission all come from the Host snapshot.
//   - a rejected Host action never changes what is shown: the snapshot is
//     re-read after a successful call, never patched optimistically.
// ---------------------------------------------------------------------------

/** Which reading of the same associations is on screen. */
type LocusReading = 'work' | 'entry'

/** Owner-facing label for one permission mode. */
const LOCUS_PERMISSION_LABELS: Record<PetLocusPermissionMode, string> = {
  read: '只读',
  write: '可写',
}

/** The endpoint fields an action may carry; display facts are excluded. */
function locusEndpointInput(endpoint: PetLocusEndpointView): { chatId: string; threadId?: string } {
  return endpoint.threadId === undefined
    ? { chatId: endpoint.chatId }
    : { chatId: endpoint.chatId, threadId: endpoint.threadId }
}

/** Copy a value, tolerating every way a browser can refuse the clipboard. */
function copyValue(value: string): void {
  void globalThis.navigator?.clipboard?.writeText(value).catch(() => undefined)
}

/** `YYYY-MM-DD HH:mm` in the viewer's own timezone. */
function formatAbsolute(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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

/** `第 N 代` when an entry has been rebuilt, otherwise nothing to say. */
function generationLabel(family: LocusFamily): string | undefined {
  const head = familyHead(family)
  if (head === undefined) return undefined
  if (family.history.length === 0 && head.generation <= 1) return undefined
  return `第 ${head.generation} 代`
}

/**
 * A display alias that copies its full identifier.
 *
 * The code is what a human reads; the identifier is what every request needs,
 * so it travels with the code rather than replacing it.
 */
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
  const className = 'dshpet-jump'
  return (
    <button
      type="button"
      className={className}
      data-disabled={disabled}
      title={props.title}
      disabled={disabled}
      onClick={props.onClick}
    >
      {props.label} <span aria-hidden="true">↗</span>
    </button>
  )
}

/** Why a session jump is unavailable, or undefined when it is available. */
function sessionJumpBlock(
  availability: 'available' | 'archived' | 'missing' | undefined,
): string | undefined {
  if (availability === 'archived') return '会话已归档，无法打开'
  if (availability === 'missing') return '会话不可用，无法打开'
  return undefined
}

/** How one generation obtained its context, and its inquiry ledger. */
function ownerModeLabel(mode: string | undefined): string {
  if (mode === 'fork-prefix-v1') return '旧 fork 上下文'
  if (mode === 'independent-v1') return '独立上下文'
  return '未知'
}

/** Human label for one inquiry ledger status. */
function ownerInquiryStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: '排队中', executing: '执行中', answered: '已回答', 'result-delivered': '结果已续进',
    rejected: '已拒绝', unavailable: '不可用', cancelled: '已取消', 'needs-review': '待核查', unknown: '未知',
  }
  return labels[status] ?? '未知'
}

/**
 * Owner facts, shown exactly as far as the Host proved them.
 *
 * A missing projection is stated as missing. Rendering an empty ledger as "no
 * inquiries" would invent a fact the Host never asserted.
 */
function OwnerProjectionFacts(props: { readonly owner: PetLocusView['owner'] | undefined }): JSX.Element {
  const owner = props.owner
  if (owner === undefined) {
    return <span className="dshpet-meta">Host 未提供 owner 投影与询问台账的真实快照，面板不伪造询问记录</span>
  }
  const inquiry = owner.inquiry
  return (
    <span className="dshpet-owner-facts">
      <span className="dshpet-meta">上下文模式 {ownerModeLabel(owner.mode)}</span>
      {owner.publicContext === undefined ? null : (
        <span className="dshpet-meta">
          公共事实{' '}
          {owner.publicContext.status === 'authored'
            ? `r${owner.publicContext.revision ?? '?'} · ${owner.publicContext.writer ?? '来源未知'}`
            : '未知 / 未确认'}
        </span>
      )}
      {inquiry === undefined ? (
        <span className="dshpet-meta">询问台账：Host 未提供真实快照，不能伪造询问记录</span>
      ) : (
        <>
          <span className="dshpet-meta">
            询问派发{' '}
            {inquiry.dispatchCapability === 'available'
              ? '可用'
              : inquiry.dispatchCapability === 'unavailable' ? '不可用' : '未知'}
          </span>
          {inquiry.snapshotStatus === 'available' && inquiry.inquiries !== undefined
            ? inquiry.inquiries.length === 0
              ? <span className="dshpet-meta">当前没有在途询问</span>
              : inquiry.inquiries.map(row => (
                <span className="dshpet-meta" key={row.inquiryId ?? `${row.createdAt}:${row.status}`}>
                  询问 {ownerInquiryStatusLabel(row.status)} · {row.reason ?? '无诊断'}
                </span>
              ))
            : <span className="dshpet-meta">询问台账：Host 尚未提供可验证快照，当前显示未知</span>}
        </>
      )}
    </span>
  )
}

/** One entry's disclosure: identifiers, provenance, permission and actions. */
function LocusDetails(props: {
  readonly family: LocusFamily
  readonly codes: HandleCodes
  readonly busy: boolean
  readonly busyKey: string | undefined
  readonly onAction: (key: string, operation: () => Promise<unknown>) => void
}): JSX.Element | null {
  const head = familyHead(props.family)
  if (head === undefined) return null
  const locusCode = handleLabel('locus', props.codes.locus.get(head.locusId) ?? handleCode(head.locusId, 'locus'))
  const chatCode = endpointHandleLabel({ chatId: head.endpoint.chatId }, props.codes.endpoint.get(head.endpoint.chatId) ?? '')
  const parentCode = handleLabel('session', props.codes.session.get(head.main.sessionId) ?? '')
  const workspaceCode = handleLabel('workspace', props.codes.workspace.get(head.workspace.workspaceId) ?? '')
  const threadId = head.endpoint.threadId
  const threadCode = threadId === undefined
    ? undefined
    : endpointHandleLabel({ chatId: head.endpoint.chatId, threadId }, props.codes.endpoint.get(threadId) ?? '')
  const childSessionId = head.child.sessionId
  const childCode = childSessionId === undefined
    ? undefined
    : handleLabel('session', props.codes.session.get(childSessionId) ?? '')

  const endpoint = locusEndpointInput(head.endpoint)
  const fence = {
    locusId: head.locusId,
    expectedGeneration: head.generation,
    expectedLocusId: head.locusId,
    expectedUpdatedAt: head.state.updatedAt,
  }
  const run = (name: string, operation: () => Promise<unknown>): (() => void) => () =>
    props.onAction(`${head.locusId}:${name}`, operation)

  const blocked = props.busyKey !== undefined || props.busy
  const canManageCurrent = head.state.state === 'active'
  const canRebuild =
    head.state.state === 'invalid' || head.state.state === 'stopped' || head.state.state === 'retired'
  const canStop =
    head.state.state === 'provisioning' || head.state.state === 'active' || head.state.state === 'switching'
  const anchorUnconfirmed = head.contextAnchor?.status !== 'confirmed'
  const writable = head.permission.effective === 'write'
  const permissionDrift = head.permission.desired !== head.permission.effective

  return (
    <dl className="dshpet-locus-details">
      <dt>标识符</dt>
      <dd>
        <HandleChip value={head.locusId} code={locusCode} />
        <HandleChip value={head.endpoint.chatId} code={chatCode} />
        {threadId === undefined || threadCode === undefined ? null : (
          <HandleChip value={threadId} code={threadCode} />
        )}
        <HandleChip value={head.main.sessionId} code={parentCode} label="父" />
        {childSessionId === undefined || childCode === undefined ? null : (
          <HandleChip value={childSessionId} code={childCode} label="会话" />
        )}
        <HandleChip value={head.workspace.workspaceId} code={workspaceCode} />
      </dd>

      <dt>来源</dt>
      <dd>{locusSourceLabel(head.source)} · {formatAbsolute(head.state.createdAt)}</dd>

      <dt>权限</dt>
      <dd>
        {LOCUS_PERMISSION_LABELS[head.permission.effective]}
        {permissionDrift
          ? ` · 期望${LOCUS_PERMISSION_LABELS[head.permission.desired]}，实际${LOCUS_PERMISSION_LABELS[head.permission.effective]}，未生效`
          : ''}
        {head.permission.verifiedAt === undefined
          ? ' · 未核验'
          : ` · ${formatAbsolute(head.permission.verifiedAt)} 核验`}
      </dd>

      <dt>执行根</dt>
      <dd>
        {anchorUnconfirmed ? (
          <>
            <span className="dshpet-chip" data-tone="muted">未确认</span>
            提权到可写需要先确认执行根；路径展示不等于授权
          </>
        ) : (
          <>
            {head.contextAnchor?.executionRoot ?? head.workspace.executionRoot ?? '已确认'}
            {head.contextAnchor?.confirmedAt === undefined
              ? ''
              : ` · ${formatAbsolute(head.contextAnchor.confirmedAt)} 确认`}
          </>
        )}
      </dd>

      <dt>询问</dt>
      <dd>
        <OwnerProjectionFacts owner={head.owner} />
      </dd>

      <dt>操作</dt>
      <dd className="dshpet-locus-ops">
        <span className="dshpet-locus-perm" role="group" aria-label="文件权限">
          <button
            type="button"
            aria-pressed={!writable}
            disabled={blocked || !canManageCurrent || !writable}
            onClick={run('scope-read', () => petApi.locusScope({ action: 'scope', mode: 'read', ...fence }))}
          >
            只读
          </button>
          <button
            type="button"
            aria-pressed={writable}
            disabled={blocked || !canManageCurrent || writable}
            title={anchorUnconfirmed
              ? '需要先确认执行根，且与宿主实际回读的范围一致'
              : 'Host 必须先核验真实写入范围；核验失败会保持只读。'}
            onClick={run('scope-write', () => petApi.locusScope({ action: 'scope', mode: 'write', ...fence }))}
          >
            可写
          </button>
        </span>
        {canManageCurrent && anchorUnconfirmed ? (
          <button
            type="button"
            className="dshpet-action dshpet-action-sm"
            disabled={blocked}
            onClick={run('confirm-anchor', () =>
              petApi.locusConfirmAnchor({
                action: 'confirm-anchor',
                ...fence,
                endpoint,
                projectResources: [],
                constraints: [],
                existence: 'unknown',
              }),
            )}
          >
            确认执行根
          </button>
        ) : null}
        <button
          type="button"
          className="dshpet-action dshpet-action-sm"
          disabled={blocked || !canRebuild}
          title={canRebuild ? '重建为新一代，新代默认只读' : '只有失效、停止或退役的代次可以重建'}
          onClick={run('rebuild', () =>
            petApi.locusRebuild({
              action: 'rebuild',
              endpoint,
              parentSessionId: head.main.sessionId,
              ...(head.workspace.workspaceId === '' ? {} : { workspaceId: head.workspace.workspaceId }),
              ...(head.parentLocusId === undefined ? {} : { parentLocusId: head.parentLocusId }),
              ...(head.isDefaultQa ? { asDefaultQa: true } : {}),
              ...fence,
            }),
          )}
        >
          重建
        </button>
        <button
          type="button"
          className="dshpet-action dshpet-action-sm dshpet-action-danger"
          disabled={blocked || !canStop}
          title="停止服务并保留入口停止标记；历史与飞书资源保留，恢复用重建"
          onClick={run('stop', () => petApi.locusStop({ action: 'stop', endpoint, ...fence }))}
        >
          停止关联
        </button>
      </dd>
    </dl>
  )
}

/** The generations other than the current one, disclosed on demand. */
function GenerationRows(props: {
  readonly family: LocusFamily
  readonly codes: HandleCodes
  readonly open: boolean
  readonly onToggle: () => void
}): JSX.Element | null {
  const { family } = props
  if (family.history.length === 0) return null
  return (
    <div className="dshpet-locus-generations">
      <button
        type="button"
        className="dshpet-locus-history-toggle"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        历史 {family.history.length} 代 {props.open ? '▾' : '▸'}
      </button>
      {props.open
        ? family.history.map(locus => {
          const code = handleLabel('locus', props.codes.locus.get(locus.locusId) ?? handleCode(locus.locusId, 'locus'))
          const childSessionId = locus.child.sessionId
          const childCode = childSessionId === undefined
            ? undefined
            : handleLabel('session', props.codes.session.get(childSessionId) ?? '')
          const stateAt = locus.state.retiredAt ?? locus.state.stoppedAt ?? locus.state.updatedAt
          return (
            <div className="dshpet-locus-generation" key={locus.locusId}>
              <span className="dshpet-locus-generation-no">第 {locus.generation} 代</span>
              <span className="dshpet-locus-node" data-tone={locusStateTone(locus.state.state)} aria-hidden="true" />
              <span className="dshpet-meta">{locusStateLabel(locus.state.state)}</span>
              <span className="dshpet-meta">{formatAbsolute(stateAt)}</span>
              {childSessionId === undefined || childCode === undefined
                ? <span className="dshpet-meta">会话 —</span>
                : <HandleChip value={childSessionId} code={childCode} label="会话" />}
              <HandleChip value={locus.locusId} code={code} />
              <Jump
                label="会话"
                title={sessionJumpBlock(locus.child.availability) ?? '打开这一代的会话'}
                disabled={sessionOpener === undefined || childSessionId === undefined
                  || sessionJumpBlock(locus.child.availability) !== undefined}
                onClick={() => {
                  if (childSessionId === undefined) return
                  sessionOpener?.({ kind: 'subagent', parentSessionId: locus.main.sessionId, childSessionId })
                  closeSettings?.()
                }}
              />
            </div>
          )
        })
        : null}
    </div>
  )
}

/** One entry row: identity, state, the sessions behind it, and its exits. */
function LocusRow(props: {
  readonly family: LocusFamily
  readonly reading: LocusReading
  readonly codes: HandleCodes
  readonly busyKey: string | undefined
  readonly onAction: (key: string, operation: () => Promise<unknown>) => void
  readonly open: boolean
  readonly onToggle: () => void
  readonly historyOpen: boolean
  readonly onToggleHistory: () => void
  readonly nested: boolean
  /** The entry this one inherits its source from, when it is nested. */
  readonly inheritedFrom?: string
  /** How many entries share this row's parent session (reading B only). */
  readonly sharedEntryCount: number
}): JSX.Element | null {
  const head = familyHead(props.family)
  if (head === undefined) return null
  const endpoint = head.endpoint
  const endpointCode = props.codes.endpoint.get(endpointHandleId(endpoint)) ?? ''
  const display = entryDisplayName(endpoint, endpointCode)
  const current = isHostCurrent(props.family, head)
  const chatLink = chatAppLink(endpoint.chatId)
  const threadLink = endpoint.threadId === undefined
    ? undefined
    : `https://applink.feishu.cn/client/thread/open?threadId=${encodeURIComponent(endpoint.threadId)}`
  const feishuLink = threadLink ?? chatLink
  const childSessionId = head.child.sessionId
  const childCode = childSessionId === undefined
    ? undefined
    : handleLabel('session', props.codes.session.get(childSessionId) ?? '')
  const parentCode = handleLabel('session', props.codes.session.get(head.main.sessionId) ?? '')
  const parentBlock = sessionJumpBlock(head.main.availability)
  const childBlock = sessionJumpBlock(head.child.availability)
  // A subagent child is only addressable through its durable parent. With no
  // parent id there is nothing to address, and falling back to the child's bare
  // id would just reproduce the Host refusal as a confusing runtime error.
  const childAddressable = childSessionId !== undefined && head.main.sessionId.trim() !== ''
  const generation = generationLabel(props.family)
  const stateLine = `${locusStateLabel(head.state.state)} · ${LOCUS_PERMISSION_LABELS[head.permission.effective]}`

  return (
    <>
      <div className="dshpet-locus-row" data-nested={props.nested} data-open={props.open}>
        <span
          className="dshpet-locus-node"
          data-tone={locusStateTone(head.state.state)}
          data-current={current}
          aria-hidden="true"
        />
        <div className="dshpet-locus-row-body">
          <div className="dshpet-locus-row-line">
            {props.reading === 'entry'
              ? <HandleChip value={head.locusId} code={handleLabel('locus', props.codes.locus.get(head.locusId) ?? head.locusId)} />
              : (
                <span className="dshpet-locus-name" data-placeholder={display.isPlaceholder}>
                  {display.name}
                </span>
              )}
            {head.isDefaultQa ? <span className="dshpet-chip" data-tone="qa">默认 Q&amp;A</span> : null}
            {head.state.busy ? <span className="dshpet-chip" data-tone="busy">有在途工作</span> : null}
            {generation === undefined ? null : <span className="dshpet-meta">{generation}</span>}
            {props.inheritedFrom === undefined ? null : (
              <span className="dshpet-meta">继承自 {props.inheritedFrom}</span>
            )}
            {props.reading === 'entry' ? (
              <span className="dshpet-meta">
                {stateLine} · {locusSourceLabel(head.source)}
              </span>
            ) : null}
          </div>

          {props.reading === 'work' ? (
            <div className="dshpet-locus-row-line">
              <span className="dshpet-meta">{stateLine}</span>
              <span className="dshpet-meta dshpet-locus-session-title" title={head.child.title ?? undefined}>
                会话 {childSessionId === undefined ? '—' : head.child.title ?? '未命名'}
              </span>
              {childSessionId === undefined || childCode === undefined ? null : (
                <HandleChip value={childSessionId} code={childCode} />
              )}
            </div>
          ) : (
            <>
              <div className="dshpet-locus-row-line">
                <span className="dshpet-meta dshpet-locus-session-title" title={head.child.title ?? undefined}>
                  会话 {childSessionId === undefined ? '—' : head.child.title ?? '未命名'}
                </span>
                {childSessionId === undefined || childCode === undefined ? null : (
                  <HandleChip value={childSessionId} code={childCode} />
                )}
                {childSessionId === undefined
                  ? null
                  : <span className="dshpet-meta">{sessionAvailabilityLabel(head.child.availability)}</span>}
              </div>
              <div className="dshpet-locus-row-line">
                <span className="dshpet-meta">父会话 {head.main.title ?? '未命名会话'}</span>
                <HandleChip value={head.main.sessionId} code={parentCode} />
                <span className="dshpet-meta">
                  {sessionAvailabilityLabel(head.main.availability)} · 共享 {props.sharedEntryCount} 个入口
                </span>
              </div>
            </>
          )}
        </div>

        <div className="dshpet-locus-row-tail">
          {props.reading === 'entry' ? (
            <Jump
              label="父会话"
              title={parentBlock ?? '打开这份工作的父会话（可能被多个入口共享）'}
              disabled={sessionOpener === undefined || parentBlock !== undefined}
              onClick={() => {
                sessionOpener?.({ kind: 'session', sessionId: head.main.sessionId })
                closeSettings?.()
              }}
            />
          ) : null}
          <Jump
            label="会话"
            title={head.main.sessionId.trim() === ''
              ? '父会话标识缺失，无法定位这个子会话'
              : childBlock ?? '打开这个入口的会话'}
            disabled={sessionOpener === undefined || !childAddressable || childBlock !== undefined}
            onClick={() => {
              if (childSessionId === undefined) return
              sessionOpener?.({
                kind: 'subagent',
                parentSessionId: head.main.sessionId,
                childSessionId,
              })
              closeSettings?.()
            }}
          />
          <Jump
            label={endpoint.threadId === undefined ? '飞书' : '话题'}
            title={feishuLink === undefined
              ? '这个入口没有可用的飞书链接'
              : endpoint.threadId === undefined ? '在飞书中打开这个入口' : '在飞书中打开这个话题'}
            disabled={feishuLink === undefined}
            {...(feishuLink === undefined ? {} : { href: feishuLink })}
          />
          <button
            type="button"
            className="dshpet-locus-more"
            aria-expanded={props.open}
            onClick={props.onToggle}
          >
            {props.open ? '收起 ▾' : '更多 ▸'}
          </button>
        </div>
      </div>
      {props.open ? (
        <LocusDetails
          family={props.family}
          codes={props.codes}
          busy={head.state.busy}
          busyKey={props.busyKey}
          onAction={props.onAction}
        />
      ) : null}
      <GenerationRows
        family={props.family}
        codes={props.codes}
        open={props.historyOpen}
        onToggle={props.onToggleHistory}
      />
    </>
  )
}

/** One parent session and the entries that belong to it. */
function WorkSection(props: {
  readonly work: WorkGroup
  readonly reading: LocusReading
  readonly codes: HandleCodes
  readonly busyKey: string | undefined
  readonly onAction: (key: string, operation: () => Promise<unknown>) => void
  readonly openKeys: readonly string[]
  readonly onToggle: (key: string) => void
  readonly historyKeys: readonly string[]
  readonly onToggleHistory: (key: string) => void
  readonly sharedEntryCount: (parentSessionId: string) => number
  readonly hasDefaultQa: boolean
}): JSX.Element {
  const { work } = props
  const sessionId = work.parentSessionId
  const sessionCode = handleLabel('session', props.codes.session.get(sessionId) ?? '')
  const workspaceTitle = work.workspace?.title ?? work.workspace?.workspaceId ?? '未知工作区'
  const path = work.workspace?.path
  const parentBlock = sessionJumpBlock(work.session?.availability)
  const title = work.session?.title ?? '未命名会话'

  const labelOf = (family: LocusFamily): string => {
    const code = props.codes.endpoint.get(endpointHandleId(family.endpoint)) ?? ''
    return entryDisplayName(family.endpoint, code).name
  }

  const renderNode = (node: LocusFamilyNode, nested: boolean, parentLabel?: string): JSX.Element => (
    <Fragment key={node.family.key}>
      <LocusRow
        family={node.family}
        reading={props.reading}
        codes={props.codes}
        busyKey={props.busyKey}
        onAction={props.onAction}
        open={props.openKeys.includes(node.family.key)}
        onToggle={() => props.onToggle(node.family.key)}
        historyOpen={props.historyKeys.includes(node.family.key)}
        onToggleHistory={() => props.onToggleHistory(node.family.key)}
        nested={nested}
        {...(parentLabel === undefined ? {} : { inheritedFrom: parentLabel })}
        sharedEntryCount={props.sharedEntryCount(sessionId)}
      />
      {node.children.map(child => renderNode(child, true, labelOf(node.family)))}
    </Fragment>
  )

  return (
    <section className="dshpet-work">
      <div className="dshpet-work-head">
        <span className="dshpet-work-mark" aria-hidden="true" />
        {parentBlock === undefined && sessionOpener !== undefined ? (
          <button
            type="button"
            className="dshpet-work-name"
            title="打开父会话"
            onClick={() => {
              sessionOpener?.({ kind: 'session', sessionId })
              closeSettings?.()
            }}
          >
            {title} <span aria-hidden="true">↗</span>
          </button>
        ) : (
          <span className="dshpet-work-name" data-static="true" title={parentBlock ?? title}>{title}</span>
        )}
        <span className="dshpet-work-tail">
          <HandleChip value={sessionId} code={sessionCode} />
          <span className="dshpet-meta">{sessionAvailabilityLabel(work.session?.availability)}</span>
        </span>
      </div>
      <div className="dshpet-work-sub">
        <span>父会话 · 工作区 {workspaceTitle}</span>
        {path === undefined ? null : <code className="dshpet-code">{path}</code>}
      </div>
      {props.hasDefaultQa ? null : (
        <p className="dshpet-work-note">
          默认 Q&amp;A 尚未创建 —— 请在目标会话里用 Pet 轮盘的「答疑群」创建；设置页只做展示与导航，不提供创建入口。
        </p>
      )}
      <div className="dshpet-rail">{work.nodes.map(node => renderNode(node, false))}</div>
    </section>
  )
}

/** The filter panel. Every group states the condition it is applying. */
function LocusFilterPanel(props: {
  readonly filter: LocusFilter
  readonly parentCounts: ReadonlyMap<ParentAvailability, number>
  readonly entryCounts: ReadonlyMap<string, number>
  readonly onChange: (next: LocusFilter) => void
}): JSX.Element {
  const parentOptions: readonly ParentAvailability[] = ['available', 'archived', 'unverified']
  const toggleParent = (value: ParentAvailability): void => {
    const next = props.filter.parentAvailability.includes(value)
      ? props.filter.parentAvailability.filter(item => item !== value)
      : [...props.filter.parentAvailability, value]
    props.onChange({ ...props.filter, parentAvailability: next })
  }
  const toggleState = (states: readonly PetLocusState[]): void => {
    const on = states.every(state => props.filter.entryStates.includes(state))
    const next = on
      ? props.filter.entryStates.filter(state => !states.includes(state))
      : [...new Set([...props.filter.entryStates, ...states])]
    props.onChange({ ...props.filter, entryStates: next })
  }

  return (
    <div className="dshpet-locus-filter" role="dialog" aria-label="筛选">
      <span className="dshpet-locus-filter-cap">父会话状态</span>
      {parentOptions.map(option => {
        const count = props.parentCounts.get(option) ?? 0
        return (
          <label className="dshpet-locus-filter-row" key={option} data-empty={count === 0}>
            <input
              className="dshpet-input"
              type="checkbox"
              checked={props.filter.parentAvailability.includes(option)}
              onChange={() => toggleParent(option)}
            />
            {PARENT_AVAILABILITY_LABELS[option]}
            <span className="dshpet-locus-filter-count">{count}</span>
          </label>
        )
      })}
      <div className="dshpet-locus-filter-hr" aria-hidden="true" />
      <span className="dshpet-locus-filter-cap">入口状态</span>
      {ENTRY_STATE_OPTIONS.map(option => {
        const count = props.entryCounts.get(option.id) ?? 0
        return (
          <label className="dshpet-locus-filter-row" key={option.id} data-empty={count === 0}>
            <input
              className="dshpet-input"
              type="checkbox"
              checked={option.states.every(state => props.filter.entryStates.includes(state))}
              onChange={() => toggleState(option.states)}
            />
            {option.label}
            <span className="dshpet-locus-filter-count">{count}</span>
          </label>
        )
      })}
      <div className="dshpet-locus-filter-hr" aria-hidden="true" />
      <div className="dshpet-locus-filter-foot">
        <button
          type="button"
          className="dshpet-action dshpet-action-sm"
          onClick={() => props.onChange(DEFAULT_LOCUS_FILTER)}
        >
          重置默认
        </button>
        <span className="dshpet-meta">只影响显示</span>
      </div>
    </div>
  )
}

/**
 * What the filter removed, stated in the list rather than by an empty screen.
 *
 * An archived parent can still own active entries, so a silent removal would
 * read as "my entry disappeared" — the previous surface had no filter at all
 * precisely because hiding without saying so is worse than scrolling.
 */
function HiddenNote(props: {
  readonly hidden: HiddenSummary
  readonly onShow: () => void
}): JSX.Element | null {
  const { hidden } = props
  if (hidden.parentSessions === 0 && hidden.entries === 0) return null
  const reasons = hidden.parentReasons.map(reason => reason.label).join(' · ')
  const stateReasons = hidden.entryStates.map(item => `${item.label} ${item.entries}`).join(' · ')
  return (
    <div className="dshpet-locus-hidden">
      <button type="button" className="dshpet-jump" data-disabled="false" onClick={props.onShow}>
        显示全部 <span aria-hidden="true">▾</span>
      </button>
      <span className="dshpet-meta">
        {hidden.parentSessions === 0 ? '' : `已隐藏 ${hidden.parentSessions} 个父会话（${reasons}）`}
        {hidden.parentSessions !== 0 && hidden.entries !== 0 ? '，' : ''}
        {hidden.entries === 0 ? '' : `其下或本身共 ${hidden.entries} 个入口未显示`}
        {stateReasons === '' ? '' : `（按状态隐藏：${stateReasons}）`}
      </span>
    </div>
  )
}

/** One discovery result, rendered with the same information rules as a row. */
function DiscoveryCard(props: {
  readonly locus: PetLocusView
  readonly codes: HandleCodes
  readonly note?: string
}): JSX.Element {
  const { locus } = props
  const family: LocusFamily = {
    key: endpointKey(locus.endpoint),
    endpoint: locus.endpoint,
    current: locus,
    generations: [locus],
    history: [],
  }
  const rawCode = props.codes.endpoint.get(endpointHandleId(locus.endpoint)) ?? ''
  const code = endpointHandleLabel(locus.endpoint, rawCode)
  const display = entryDisplayName(locus.endpoint, rawCode)
  const childSessionId = locus.child.sessionId
  const childCode = childSessionId === undefined
    ? undefined
    : handleLabel('session', props.codes.session.get(childSessionId) ?? '')
  const parentCode = handleLabel('session', props.codes.session.get(locus.main.sessionId) ?? '')
  const chatLink = chatAppLink(locus.endpoint.chatId)
  const threadLink = locus.endpoint.threadId === undefined
    ? undefined
    : `https://applink.feishu.cn/client/thread/open?threadId=${encodeURIComponent(locus.endpoint.threadId)}`
  return (
    <div className="dshpet-locus-discovery-card">
      <div className="dshpet-locus-row-line">
        <span className="dshpet-locus-name" data-placeholder={display.isPlaceholder}>{display.name}</span>
        <span className="dshpet-meta">{display.role.label}级入口</span>
        {locus.isDefaultQa ? <span className="dshpet-chip" data-tone="qa">默认 Q&amp;A</span> : null}
        {props.note === undefined ? null : <span className="dshpet-meta">{props.note}</span>}
      </div>
      <div className="dshpet-locus-row-line">
        <span className="dshpet-meta">
          第 {locus.generation} 代 · {locusStateLabel(locus.state.state)} ·{' '}
          {LOCUS_PERMISSION_LABELS[locus.permission.effective]} · {locusSourceLabel(locus.source)}
        </span>
      </div>
      <div className="dshpet-locus-row-line">
        <span className="dshpet-meta">父会话 {locus.main.title ?? '未命名会话'}</span>
        <HandleChip value={locus.main.sessionId} code={parentCode} />
        <span className="dshpet-meta">{sessionAvailabilityLabel(locus.main.availability)}</span>
        <span className="dshpet-meta dshpet-locus-session-title" title={locus.child.title ?? undefined}>
          会话 {childSessionId === undefined ? '—' : locus.child.title ?? '未命名'}
        </span>
        {childSessionId === undefined || childCode === undefined ? null : (
          <HandleChip value={childSessionId} code={childCode} />
        )}
      </div>
      <div className="dshpet-locus-row-line">
        <Jump
          label={locus.endpoint.threadId === undefined ? '飞书' : '话题'}
          title="在飞书中打开这个入口"
          disabled={(threadLink ?? chatLink) === undefined}
          {...((threadLink ?? chatLink) === undefined ? {} : { href: (threadLink ?? chatLink) as string })}
        />
        <Jump
          label="会话"
          title={sessionJumpBlock(locus.child.availability) ?? '打开这个入口的会话'}
          disabled={sessionOpener === undefined || childSessionId === undefined
            || sessionJumpBlock(locus.child.availability) !== undefined}
          onClick={() => {
            if (childSessionId === undefined) return
            sessionOpener?.({ kind: 'subagent', parentSessionId: locus.main.sessionId, childSessionId })
            closeSettings?.()
          }}
        />
        <Jump
          label="父会话"
          title={sessionJumpBlock(locus.main.availability) ?? '打开父会话'}
          disabled={sessionOpener === undefined || sessionJumpBlock(locus.main.availability) !== undefined}
          onClick={() => {
            sessionOpener?.({ kind: 'session', sessionId: locus.main.sessionId })
            closeSettings?.()
          }}
        />
      </div>
      <span className="dshpet-meta">{family.key}</span>
    </div>
  )
}
function requireLocusSnapshot(value: unknown): PetLocusManagementView {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Host 返回的 locus 快照格式无效，已拒绝显示。')
  }
  const isRecord = (item: unknown): item is Record<string, unknown> =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
  const isNonEmptyString = (item: unknown): item is string => typeof item === 'string' && item.trim() !== ''
  const isFiniteNonNegative = (item: unknown): item is number =>
    typeof item === 'number' && Number.isSafeInteger(item) && item >= 0
  const isEndpoint = (item: unknown): boolean =>
    isRecord(item) && isNonEmptyString(item.chatId) &&
    (item.threadId === undefined || isNonEmptyString(item.threadId)) &&
    (item.chatType === undefined || item.chatType === 'p2p' || item.chatType === 'group') &&
    (item.chatName === undefined || typeof item.chatName === 'string')
  const isLocus = (item: unknown): item is PetLocusView => {
    if (!isRecord(item) || !isNonEmptyString(item.locusId) || typeof item.generation !== 'number' || !Number.isSafeInteger(item.generation) || item.generation < 1 || !isEndpoint(item.endpoint)) return false
    if (!isRecord(item.main) || !isNonEmptyString(item.main.sessionId) ||
        (item.main.title !== undefined && typeof item.main.title !== 'string') ||
        (item.main.source !== undefined && !['auto', 'inherited', 'explicit', 'qa-created'].includes(String(item.main.source))) ||
        (item.main.availability !== undefined && !['available', 'archived', 'missing'].includes(String(item.main.availability)))) return false
    if (!isRecord(item.child) || (item.child.sessionId !== undefined && !isNonEmptyString(item.child.sessionId)) ||
        (item.child.title !== undefined && typeof item.child.title !== 'string') ||
        (item.child.availability !== undefined && !['available', 'archived', 'missing'].includes(String(item.child.availability)))) return false
    if (!isRecord(item.workspace) || !isNonEmptyString(item.workspace.workspaceId) ||
        (item.workspace.title !== undefined && typeof item.workspace.title !== 'string') ||
        (item.workspace.path !== undefined && typeof item.workspace.path !== 'string') ||
        (item.workspace.executionRoot !== undefined && typeof item.workspace.executionRoot !== 'string')) return false
    if (item.contextAnchor !== undefined && (!isRecord(item.contextAnchor) ||
        !['confirmed', 'missing', 'unknown'].includes(String(item.contextAnchor.status)) ||
        (item.contextAnchor.executionRoot !== undefined && typeof item.contextAnchor.executionRoot !== 'string') ||
        (item.contextAnchor.constraints !== undefined && (!Array.isArray(item.contextAnchor.constraints) || !item.contextAnchor.constraints.every(value => typeof value === 'string'))) ||
        (item.contextAnchor.provenance !== undefined && typeof item.contextAnchor.provenance !== 'string') ||
        (item.contextAnchor.confirmedAt !== undefined && !isFiniteNonNegative(item.contextAnchor.confirmedAt)))) return false
    if (!isRecord(item.permission) || !['read', 'write'].includes(String(item.permission.desired)) || !['read', 'write'].includes(String(item.permission.effective)) ||
        (item.permission.verifiedAt !== undefined && !isFiniteNonNegative(item.permission.verifiedAt)) ||
        (item.permission.grantedBy !== undefined && !isNonEmptyString(item.permission.grantedBy)) ||
        (item.permission.effective === 'write' && (item.permission.desired !== 'write' || item.permission.verifiedAt === undefined))) return false
    if (!isRecord(item.state) || !['provisioning', 'active', 'switching', 'invalid', 'stopped', 'retired'].includes(String(item.state.state)) || typeof item.state.busy !== 'boolean') return false
    if (!isFiniteNonNegative(item.state.createdAt) || !isFiniteNonNegative(item.state.updatedAt) || item.state.updatedAt < item.state.createdAt ||
        (item.state.stoppedAt !== undefined && (!isFiniteNonNegative(item.state.stoppedAt) || item.state.stoppedAt > item.state.updatedAt)) ||
        (item.state.retiredAt !== undefined && (!isFiniteNonNegative(item.state.retiredAt) || item.state.retiredAt > item.state.updatedAt)) ||
        (['invalid', 'stopped', 'retired'].includes(String(item.state.state)) && item.state.busy)) return false
    return ['auto', 'inherited', 'explicit', 'qa-created'].includes(String(item.source)) &&
      (item.parentLocusId === undefined || isNonEmptyString(item.parentLocusId)) &&
      typeof item.isDefaultQa === 'boolean' && (item.defaultQa === undefined || item.defaultQa === item.isDefaultQa)
  }
  const candidate = value as Partial<PetLocusManagementView>
  const discovery = candidate.discovery
  if (!Array.isArray(candidate.loci) || !candidate.loci.every(isLocus) ||
      !Array.isArray(candidate.defaultQa) || !candidate.defaultQa.every(item =>
        isRecord(item) && isNonEmptyString(item.parentSessionId) &&
        (item.locus === undefined || (isLocus(item.locus) && item.locus.main.sessionId === item.parentSessionId))) ||
      !isFiniteNonNegative(candidate.generation) || !isRecord(discovery) ||
      !Array.isArray(discovery.byEndpoint) || !discovery.byEndpoint.every(item =>
        isRecord(item) && isEndpoint(item.endpoint) && Array.isArray(item.history) && item.history.every(isLocus) &&
        (item.current === undefined || (isLocus(item.current) && item.history.some(history => history.locusId === (item.current as { locusId: string }).locusId)))) ||
      !Array.isArray(discovery.byParent) || !discovery.byParent.every(item =>
        isRecord(item) && isNonEmptyString(item.parentSessionId) && Array.isArray(item.loci) && item.loci.every(isLocus) &&
        (item.defaultQa === undefined || isLocus(item.defaultQa))) ||
      !Array.isArray(discovery.byChild) || !discovery.byChild.every(item =>
        isRecord(item) && isNonEmptyString(item.childSessionId) && Array.isArray(item.history) && item.history.every(isLocus) &&
        item.history.every(history => history.child.sessionId === item.childSessionId) &&
        (item.locus === undefined || (isLocus(item.locus) && item.locus.child.sessionId === item.childSessionId)))) {
    throw new Error('Host 返回的 locus 快照不完整或字段无效，已拒绝显示。')
  }
  return value as PetLocusManagementView
}

/**
 * The folded manual lookup.
 *
 * Kept because the Host contract it exercises — one explicit index selector,
 * never a sibling enumeration — has to stay reachable. It is demoted to a
 * disclosure and takes a pasted identifier rather than asking the owner to
 * compose one from memory.
 */
function DiscoveryFold(props: {
  readonly codes: HandleCodes
  readonly disabled: boolean
  readonly run: (request: PetLocusDiscoveryRequest) => Promise<PetLocusDiscoveryView | undefined>
}): JSX.Element {
  const [selector, setSelector] = useState<'endpoint' | 'parent' | 'child'>('endpoint')
  const [chatId, setChatId] = useState('')
  const [threadId, setThreadId] = useState('')
  const [parentId, setParentId] = useState('')
  const [childId, setChildId] = useState('')
  const [result, setResult] = useState<PetLocusDiscoveryView | undefined>(undefined)
  const [hint, setHint] = useState<string | undefined>(undefined)

  const submit = (): void => {
    setHint(undefined)
    const request: PetLocusDiscoveryRequest | undefined =
      selector === 'endpoint'
        ? chatId.trim() === '' ? undefined : {
          endpoint: { chatId: chatId.trim(), ...(threadId.trim() === '' ? {} : { threadId: threadId.trim() }) },
        }
        : selector === 'parent'
          ? parentId.trim() === '' ? undefined : { parentSessionId: parentId.trim() }
          : childId.trim() === '' ? undefined : { childSessionId: childId.trim() }
    if (request === undefined) {
      setHint('请先粘贴一个完整标识；空查询不会发送。')
      return
    }
    void props.run(request).then(value => {
      if (value !== undefined) setResult(value)
    })
  }

  return (
    <details className="dshpet-locus-discovery">
      <summary className="dshpet-locus-discovery-head">
        <span className="dshpet-locus-discovery-mark" aria-hidden="true">›</span>
        <span>发现关联（按索引精确查询）</span>
        <span className="dshpet-meta">endpoint / 父会话 / 会话</span>
      </summary>
      <div className="dshpet-locus-discovery-body">
        <div className="dshpet-locus-discovery-controls">
          <div className="dshpet-subtabs" role="tablist" aria-label="查询索引">
            {(['endpoint', 'parent', 'child'] as const).map(value => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={selector === value}
                className="dshpet-subtab"
                onClick={() => setSelector(value)}
              >
                {value === 'endpoint' ? 'Endpoint' : value === 'parent' ? '父会话' : '会话'}
              </button>
            ))}
          </div>
          {selector === 'endpoint' ? (
            <>
              <input
                className="dshpet-input"
                value={chatId}
                placeholder="粘贴 oc_…"
                onChange={event => setChatId(event.target.value)}
              />
              <input
                className="dshpet-input"
                value={threadId}
                placeholder="粘贴 omt_…（可选）"
                onChange={event => setThreadId(event.target.value)}
              />
            </>
          ) : selector === 'parent' ? (
            <input
              className="dshpet-input"
              value={parentId}
              placeholder="粘贴 session-…"
              onChange={event => setParentId(event.target.value)}
            />
          ) : (
            <input
              className="dshpet-input"
              value={childId}
              placeholder="粘贴 session-…"
              onChange={event => setChildId(event.target.value)}
            />
          )}
          <button
            type="button"
            className="dshpet-action dshpet-action-sm dshpet-action-primary"
            disabled={props.disabled}
            onClick={submit}
          >
            查询
          </button>
        </div>
        {hint === undefined ? null : <p className="dshpet-item-hint">{hint}</p>}
        {result === undefined ? null : (
          <div className="dshpet-locus-discovery-results">
            {result.byEndpoint.map(item => (
              <div className="dshpet-locus-discovery-group" key={`endpoint:${endpointKey(item.endpoint)}`}>
                {item.current === undefined
                  ? <p className="dshpet-item-hint">该 endpoint 没有当前代；历史仍列在下方。</p>
                  : <DiscoveryCard locus={item.current} codes={props.codes} note={`历史 ${item.history.length} 代`} />}
              </div>
            ))}
            {result.byParent.map(item => (
              <div className="dshpet-locus-discovery-group" key={`parent:${item.parentSessionId}`}>
                <div className="dshpet-locus-row-line">
                  <span className="dshpet-meta">父会话</span>
                  <HandleChip
                    value={item.parentSessionId}
                    code={props.codes.session.get(item.parentSessionId) ?? item.parentSessionId}
                  />
                  <span className="dshpet-meta">
                    关联 {item.loci.length} 个入口 · 默认 Q&amp;A{' '}
                    {item.defaultQa === undefined ? '未设置' : '已设置'}
                  </span>
                </div>
                {item.loci.map(locus => (
                  <DiscoveryCard key={locus.locusId} locus={locus} codes={props.codes} />
                ))}
              </div>
            ))}
            {result.byChild.map(item => (
              <div className="dshpet-locus-discovery-group" key={`child:${item.childSessionId}`}>
                <div className="dshpet-locus-row-line">
                  <span className="dshpet-meta">会话</span>
                  <HandleChip
                    value={item.childSessionId}
                    code={props.codes.session.get(item.childSessionId) ?? item.childSessionId}
                  />
                  <span className="dshpet-meta">
                    {item.locus === undefined ? '没有活跃关联' : '唯一关联见下方'}
                  </span>
                </div>
                {item.locus === undefined ? null : <DiscoveryCard locus={item.locus} codes={props.codes} />}
              </div>
            ))}
            {result.byEndpoint.length === 0 && result.byParent.length === 0 && result.byChild.length === 0 ? (
              <p className="dshpet-empty">没有匹配的关联。</p>
            ) : null}
          </div>
        )}
      </div>
    </details>
  )
}

/**
 * The locus surface: everything it shows, given a snapshot.
 *
 * Split from `LocusTab` so the presentation can be rendered and asserted
 * against a fixture snapshot, with no Host, no fetch and no effects.
 */
export function LocusSurface(props: {
  readonly snapshot: PetLocusManagementView
  readonly busyKey?: string
  readonly error?: string
  readonly warning?: string
  readonly onAction: (key: string, operation: () => Promise<unknown>) => void
  readonly runQuery: (request: PetLocusDiscoveryRequest) => Promise<PetLocusDiscoveryView | undefined>
}): JSX.Element {
  const [reading, setReading] = useState<LocusReading>('work')
  const [filter, setFilter] = useState<LocusFilter>(DEFAULT_LOCUS_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openKeys, setOpenKeys] = useState<readonly string[]>([])
  const [historyKeys, setHistoryKeys] = useState<readonly string[]>([])

  const toggle = useCallback((setter: typeof setOpenKeys) => (key: string) => {
    setter(current => (current.includes(key) ? current.filter(item => item !== key) : [...current, key]))
  }, [])
  const filterRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!filterOpen) return undefined
    // Closing is by clicking anywhere else — the panel owns no dismiss button
    // and no key binding, so there is exactly one way to put it away.
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

  const toggleOpen = useMemo(() => toggle(setOpenKeys), [toggle])
  const toggleHistory = useMemo(() => toggle(setHistoryKeys), [toggle])

  const codes = useMemo(
    () => (props.snapshot === undefined ? undefined : collectHandleCodes(props.snapshot)),
    [props.snapshot],
  )
  const filtered = useMemo(
    () => (props.snapshot === undefined ? undefined : applyLocusFilter(props.snapshot, filter)),
    [props.snapshot, filter],
  )
  const visible = useMemo(
    () => (filtered === undefined || codes === undefined ? undefined : applyQuery(filtered, codes, query)),
    [filtered, codes, query],
  )
  const counts = useMemo(
    () => (props.snapshot === undefined ? undefined : countLocusFilterOptions(props.snapshot)),
    [props.snapshot],
  )
  const summary = useMemo(() => (visible === undefined ? undefined : summarizeLocusView(visible)), [visible])

  if (codes === undefined || visible === undefined || counts === undefined || summary === undefined) {
    return <div className="dshpet-settings" />
  }

  const defaultQaParents = new Set(
    props.snapshot.loci.filter(locus => locus.isDefaultQa).map(locus => locus.main.sessionId),
  )
  const sharedEntryCount = (parentSessionId: string): number =>
    visible.works.find(work => work.parentSessionId === parentSessionId)?.families.length ?? 0
  const updatedAt = props.snapshot.loci.reduce(
    (latest, locus) => (locus.state.updatedAt > latest ? locus.state.updatedAt : latest),
    0,
  )
  const now = Date.now()
  const empty = visible.works.length === 0 && visible.entries.length === 0

  return (
    <div className="dshpet-settings">
      <section className="dshpet-locus-head">
        <div className="dshpet-locus-headline">
          <span className="dshpet-locus-title">关联</span>
          <span className="dshpet-meta">
            {summary.entries} 个入口 · {summary.chats} 个飞书入口 · {summary.works} 个父会话
            {updatedAt === 0 ? '' : ` · 状态更新 ${formatRelative(updatedAt, now)}`}
          </span>
          <span className="dshpet-locus-headtail">
            <span className="dshpet-locus-filter-anchor" ref={filterRef}>
            <button
              type="button"
              className="dshpet-jump"
              aria-pressed={filterOpen}
              aria-expanded={filterOpen}
              title="按父会话状态与入口状态筛选"
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
              父会话：
              {filter.parentAvailability.length === 1 && filter.parentAvailability[0] !== undefined
                ? PARENT_AVAILABILITY_LABELS[filter.parentAvailability[0]]
                : `已选 ${filter.parentAvailability.length} 类`}
            </button>
            {filterOpen ? (
              <LocusFilterPanel
                filter={filter}
                parentCounts={counts.parent}
                entryCounts={counts.entry}
                onChange={setFilter}
              />
            ) : null}
            </span>
          </span>
        </div>
        <div className="dshpet-locus-tools">
          <div className="dshpet-subtabs" role="tablist" aria-label="读法">
            <button
              type="button"
              role="tab"
              aria-selected={reading === 'work'}
              className="dshpet-subtab"
              onClick={() => setReading('work')}
            >
              按工作
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reading === 'entry'}
              className="dshpet-subtab"
              onClick={() => setReading('entry')}
            >
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

      {reading === 'work'
        ? visible.works.map(work => (
          <WorkSection
            key={work.parentSessionId}
            work={work}
            reading={reading}
            codes={codes}
            busyKey={props.busyKey}
            onAction={props.onAction}
            openKeys={openKeys}
            onToggle={toggleOpen}
            historyKeys={historyKeys}
            onToggleHistory={toggleHistory}
            sharedEntryCount={sharedEntryCount}
            hasDefaultQa={defaultQaParents.has(work.parentSessionId)}
          />
        ))
        : visible.entries.map(group => {
          const head = group.chatFamily ?? group.families[0]
          const sessionId = head === undefined ? undefined : familyHead(head)?.main.sessionId
          return (
            <WorkSection
              key={group.key}
              work={{
                parentSessionId: group.key,
                ...(sessionId === undefined ? {} : { session: { sessionId } }),
                availability: 'available',
                nodes: group.families.map(family => ({ family, children: [] })),
                families: group.families,
              }}
              reading={reading}
              codes={codes}
              busyKey={props.busyKey}
              onAction={props.onAction}
              openKeys={openKeys}
              onToggle={toggleOpen}
              historyKeys={historyKeys}
              onToggleHistory={toggleHistory}
              sharedEntryCount={sharedEntryCount}
              hasDefaultQa
            />
          )
        })}

      {empty ? (
        <p className="dshpet-empty">
          {query.trim() === ''
            ? '当前筛选下没有关联。可以放宽筛选，或用下面的按索引查询。'
            : '没有匹配的关联。可以在下面的按索引查询里粘贴完整标识。'}
        </p>
      ) : null}

      <HiddenNote
        hidden={visible.hidden}
        onShow={() => setFilter({ parentAvailability: ['available', 'archived', 'unverified'], entryStates: [...DEFAULT_LOCUS_FILTER.entryStates] })}
      />

      <p className="dshpet-item-hint dshpet-locus-nodelete">
        这里没有「删除」，是刻意的：停止关联只停止服务，保留主/子会话历史与飞书资源 ——
        消息 → 代际 → 会话 → 轮次的诊断链必须可追溯，所以历史只会被聚合和折叠，不会被清掉。
      </p>

      <DiscoveryFold codes={codes} disabled={props.busyKey !== undefined} run={props.runQuery} />

      {props.warning === undefined ? null : <p className="dshpet-callout" data-tone="warn">{props.warning}</p>}
      {props.error === undefined ? null : <p className="dshpet-error">{props.error}</p>}
    </div>
  )
}

/**
 * Unified locus management.
 *
 * Deliberately separate from the ordinary Task/Invocation and legacy channel
 * tabs: an unavailable locus Host seam renders as an error, never silently
 * backed by legacy data. Owns the Host conversation only, so the surface
 * itself stays renderable without one.
 */
function LocusTab(): JSX.Element {
  const [snapshot, setSnapshot] = useState<PetLocusManagementView | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [warning, setWarning] = useState<string | undefined>(undefined)
  const [busyKey, setBusyKey] = useState<string | undefined>(undefined)
  const actionInFlight = useRef(false)
  const load = useCallback(async (): Promise<PetLocusManagementView> => {
    return requireLocusSnapshot(await petApi.locus())
  }, [])

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

  const runAction = useCallback(
    async (key: string, operation: () => Promise<unknown>): Promise<void> => {
      if (actionInFlight.current) return
      actionInFlight.current = true
      setBusyKey(key)
      setError(undefined)
      setWarning(undefined)
      try {
        const result = await operation()
        if (typeof result === 'object' && result !== null) {
          const warningText = (result as { warningText?: unknown }).warningText
          if (typeof warningText === 'string' && warningText.trim() !== '') setWarning(warningText)
        }
        setSnapshot(await load())
      } catch (cause) {
        // A rejected Host action never changes the displayed snapshot: no
        // optimistic permission, binding or lifecycle state.
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        actionInFlight.current = false
        setBusyKey(undefined)
      }
    },
    [load],
  )

  const runQuery = useCallback(
    async (request: PetLocusDiscoveryRequest): Promise<PetLocusDiscoveryView | undefined> => {
      if (actionInFlight.current) return undefined
      actionInFlight.current = true
      setBusyKey('discovery')
      setError(undefined)
      try {
        return await petApi.locusDiscovery(request)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return undefined
      } finally {
        actionInFlight.current = false
        setBusyKey(undefined)
      }
    },
    [],
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
      runQuery={runQuery}
      {...(busyKey === undefined ? {} : { busyKey })}
      {...(error === undefined ? {} : { error })}
      {...(warning === undefined ? {} : { warning })}
    />
  )
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
