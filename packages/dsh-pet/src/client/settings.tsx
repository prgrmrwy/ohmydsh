/**
 * Pet settings section: five stable tabs.
 *
 * General, Skills and Diagnostics.
 * architecture — the overlay and Task panel deliberately do not duplicate
 * installation, binding editing or diagnostics.
 *
 * Provider credentials are owned by DSH provider/subscription plugins. This
 * page displays provider/model availability by id only and never reads,
 * persists or renders a token.
 */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
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
import { PET_EXECUTOR_PRESET, chatAppLink, routeGroupOf } from '../wire.js'
import { WHEEL_CAPACITY } from './wheel.js'
import type {
  PetEnvRecord,
  PetProjectionEntry,
  PetSkillRevision,
  PetChannelPhase,
  PetChannelView,
  PetRouteGroup,
  PetSkillSelection,
  PetWorkspaceChoice,
} from '../wire.js'

/** The five stable tabs. */
export const PET_SETTINGS_TABS = ['general', 'skills', 'env', 'channel', 'diagnostics'] as const

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
 * Navigate to a native DSH session.
 *
 * Published by the client entry the same way the directory picker is: this
 * section is registered as a bare component in a slot and never receives the
 * client context, so the one shell capability it needs is handed in rather
 * than reached for.
 */
let sessionOpener: ((sessionId: string) => void) | undefined

/**
 * Publish the session navigator.
 * @param opener - Opens a session by id, or `undefined` where unsupported.
 */
export function setSessionOpener(opener: ((sessionId: string) => void) | undefined): void {
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

/** Track a transitional Host state without relying on a change-feed edge. */
export function watchChannelTransition(
  load: () => Promise<PetChannelView>,
  apply: (view: PetChannelView) => void,
  delayMs = 750,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
  maxAttempts = 40,
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
          if (shouldRefreshChannel(next.connection.phase)) tick()
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

/** Route groups, in the order the settings page offers them. */
const ROUTE_GROUPS = ['qa', 'workspace', 'direct'] as const

const ROUTE_GROUP_LABELS: Record<PetRouteGroup, string> = {
  qa: '答疑群',
  workspace: '工作区群',
  direct: '单聊',
}

/**
 * What an empty group means, stated per group.
 *
 * A shared "no routes" line would be unhelpful here: each group is empty for
 * its own reason, and only one of them is something the user can act on.
 */
const ROUTE_GROUP_EMPTY: Record<PetRouteGroup, string> = {
  qa: '还没有答疑群。从浮层轮盘的「答疑群」可以基于当前会话创建一个。',
  workspace: '还没有群聊绑定。有人在群里 @Bot 后会自动出现一行。',
  direct: '还没有单聊。allowlist 中的成员与 Bot 单聊即可触发，无需 @。',
}

const CHANNEL_PHASE_LABELS: Record<PetChannelPhase, string> = {
  stopped: '未启动',
  starting: '启动中',
  connected: '已连接',
  reconnecting: '重连中',
  down: '已断开',
}

/**
 * Channel: bot binding, admission, routing.
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
  // No default group is chosen here: an unset tab means "follow the data", so
  // the section opens on a group that actually has routes rather than on an
  // empty one. An explicit click pins the choice.
  const [routeTab, setRouteTab] = useState<PetRouteGroup | undefined>(undefined)
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
    if (view === undefined || !shouldRefreshChannel(view.connection.phase)) return undefined
    return watchChannelTransition(petApi.channel, setView)
  }, [view?.connection.phase])

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
  const doneSteps = view.onboarding.steps.filter(step => step.complete).length
  // Fall back to the first group that has any routes, so a deployment using
  // only QA groups (or only direct chats) does not open on an empty list and
  // read as "no routes at all".
  const activeRouteTab =
    routeTab ??
    ROUTE_GROUPS.find(group => view.routes.some(item => routeGroupOf(item) === group)) ??
    'qa'
  const visibleRoutes = view.routes.filter(item => routeGroupOf(item) === activeRouteTab)

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
        {view.onboarding.ready ? (
          <p className="dshpet-callout">配置已就绪，可以启用飞书接入。</p>
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
              Pet 还没有连接飞书 Bot。连接后还需配置允许成员、默认工作区并启用接入。
              凭据由 lark-cli 保管，Pet 不会保存或显示 App Secret。
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
          填写已确认的 open_id（ou_ 开头）。可从目标群的群主/管理员信息或组织查询中取得；
          Pet 不会把观察到的陌生发送者自动加入允许清单。留空表示没有人可以触发。
        </p>
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
        <div className="dshpet-row">
          <div className="dshpet-field">
            <input
              className="dshpet-input"
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
      </Group>

      <Group title="默认工作区">
        <p className="dshpet-item-hint">
          没有单独绑定过的会话，都会在这个工作区里创建会话。
        </p>
        {/* Was a bare `<select>`: with no `dshpet-input` class it fell back to
            the browser's native control, which matched nothing else here. */}
        <div className="dshpet-field">
          <select
            className="dshpet-input"
            value={view.defaultWorkspaceId ?? ''}
            onChange={event =>
              void mutate({
                action: 'set-default-workspace',
                defaultWorkspaceId: event.target.value,
              })
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

      <Group title="启用与连接">
        <p className="dshpet-item-hint">
          完成以上步骤后启用。只有允许清单中的成员可以触发，其他人的消息在飞书侧静默忽略。
        </p>
        <label className="dshpet-check">
          <input
            className="dshpet-input"
            type="checkbox"
            checked={view.enabled}
            disabled={!view.enabled && !view.onboarding.ready}
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
              {CHANNEL_PHASE_LABELS[view.connection.phase]}
            </span>
            {view.connection.diagnostic !== undefined
              ? `（${view.connection.diagnostic}）`
              : ''}
          </span>
        </div>
      </Group>

      <Group title="会话路由" note={`${view.routes.length} 个会话`}>
        {view.routes.length === 0 ? (
          <p className="dshpet-item-hint">
            还没有会话记录。第一次有人在群里 @Bot（或单聊发消息）后，这里会自动出现一行。
          </p>
        ) : (
          <>
            {/* Three groups, because `kind` and `chatType` are independent
                axes and neither alone partitions the list: a QA group routes
                to a fork child, a workspace group and a p2p conversation both
                route to a workspace but behave differently (a group needs an
                @mention, a direct chat triggers on every message and is the
                only kind Pet replies to in text). */}
            <div className="dshpet-subtabs" role="tablist" aria-label="会话路由分类">
              {ROUTE_GROUPS.map(group => {
                const count = view.routes.filter(
                  item => routeGroupOf(item) === group,
                ).length
                return (
                  <button
                    key={group}
                    type="button"
                    role="tab"
                    aria-selected={activeRouteTab === group}
                    className="dshpet-subtab"
                    onClick={() => setRouteTab(group)}
                  >
                    {ROUTE_GROUP_LABELS[group]}
                    <span className="dshpet-subtab-count">{count}</span>
                  </button>
                )
              })}
            </div>
            {visibleRoutes.length === 0 ? (
              <p className="dshpet-empty">{ROUTE_GROUP_EMPTY[activeRouteTab]}</p>
            ) : (
              // A card per chat. As flex rows, the name, the kind, the
              // workspace picker and Remove all sat on one line at the same
              // weight, so a handful of routes read as an unparseable wall.
              <ul className="dshpet-cards">
                {visibleRoutes.map(route => {
                  const invalidated =
                    route.kind === 'qa' && route.qaInvalidatedAt !== undefined
                  const appLink = chatAppLink(route.chatId)
                  // Which session this chat leads to. For a QA group that is
                  // the PARENT it was forked from — the conversation the group
                  // was opened onto, and the one worth reading. For any other
                  // route it is the executor of its active Task, which exists
                  // only once a message has actually raised work; until then
                  // the button does not appear rather than leading nowhere.
                  const sessionTarget =
                    route.kind === 'qa'
                      ? route.qaParentSessionId
                      : route.activeExecutorSessionId
                  return (
                    <li key={route.chatId} className="dshpet-card">
                      <div className="dshpet-card-head">
                        <span className="dshpet-card-name">
                          {route.chatName ?? route.chatId}
                        </span>
                        {/* The kind is already the selected tab, so only the
                            facts the tab does NOT imply are worth a pill. */}
                        {route.kind !== 'qa' ? (
                          <span className="dshpet-status">
                            {route.boundBy === 'auto' ? '自动绑定' : '手动绑定'}
                          </span>
                        ) : null}
                        {invalidated ? (
                          <span className="dshpet-status" data-tone="danger">
                            已失效
                          </span>
                        ) : null}
                        <div className="dshpet-card-tail">
                          {/*
                            A generic AppLink, built from the chat id Pet
                            already holds. Deliberately not the share link
                            from `im chats link`: that is a write call needing
                            membership (and owner/admin rights when sharing is
                            restricted), it burns a validity period, and its
                            API refuses p2p conversations outright — so it
                            could not serve this row at all.
                          */}
                          {appLink !== undefined ? (
                            <a
                              className="dshpet-action dshpet-action-sm"
                              href={appLink}
                              target="_blank"
                              rel="noreferrer"
                              title="在飞书中打开"
                            >
                              打开飞书
                            </a>
                          ) : null}
                          {/*
                            The other half of "where does this chat lead":
                            Lark on one side, the DSH session on the other. A
                            QA group is served by a fork child, so opening the
                            PARENT is what lets the user read the conversation
                            the group inherited. Only rendered when the id is
                            known and the shell published a navigator.
                          */}
                          {sessionTarget !== undefined && sessionOpener !== undefined ? (
                            // Disabled when the session is archived: the shell
                            // silently lands on the home page for an archived
                            // id, so a live-looking button would quietly do
                            // the wrong thing. The reason rides the label and
                            // the tooltip rather than needing a click to
                            // discover.
                            <button
                              type="button"
                              className="dshpet-action dshpet-action-sm"
                              disabled={route.sessionArchived === true}
                              title={
                                route.sessionArchived === true
                                  ? `会话 ${sessionTarget} 已归档，无法打开`
                                  : `打开会话 ${sessionTarget}`
                              }
                              onClick={() => {
                                if (route.sessionArchived === true) return
                                sessionOpener?.(sessionTarget)
                                // Leaving the modal settings panel open would
                                // park the user in front of the panel they
                                // just navigated out from.
                                closeSettings?.()
                              }}
                            >
                              {route.sessionArchived === true ? '会话已归档' : '打开会话'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="dshpet-action dshpet-action-sm dshpet-action-danger"
                            onClick={() =>
                              void mutate({ action: 'remove-chat', chatId: route.chatId })
                            }
                          >
                            移除
                          </button>
                        </div>
                      </div>
                      {/*
                        A qa group routes to its fork child, not to a
                        workspace. Offering the picker would imply it can be
                        re-pointed, which would discard the child holding the
                        inherited context — the Host refuses that anyway, so
                        the UI must not suggest it.
                      */}
                      {route.kind === 'qa' ? (
                        <>
                          {/*
                            The raw session id used to be printed here; "打开
                            会话" now reaches it directly, so the line states
                            only what the button cannot: whether Pet owns this
                            group. A bound group is one Pet joined, not one it
                            built — it is neither creator nor owner and can
                            manage nothing there, which prevents the
                            reasonable-but-wrong assumption that Pet could
                            rename or clean it up.
                          */}
                          <p className="dshpet-item-hint">
                            {route.qaParentSessionId === undefined
                              ? '绑定会话未知'
                              : '已绑定到一个会话'}
                            {route.qaOrigin === 'bound' ? '（绑定既有群，Pet 非群主）' : ''}
                          </p>
                          {invalidated ? (
                            <p className="dshpet-callout" data-tone="warn">
                              {route.qaInvalidatedReason ?? '源会话不可用'}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <div className="dshpet-field">
                          <span>工作区</span>
                          {/* Was a bare `<select>`, rendering as a native
                              control amid styled ones. */}
                          <select
                            className="dshpet-input"
                            value={route.workspaceId ?? ''}
                            onChange={event =>
                              void mutate({
                                action: 'rebind-chat',
                                chatId: route.chatId,
                                workspaceId: event.target.value,
                              })
                            }
                          >
                            {workspaces.map(workspace => (
                              <option key={workspace.id} value={workspace.id}>
                                {workspace.title ?? workspace.id}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
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
            <Fact label="排队中的调用" value={String(view.connection.queueDepth)} />
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
