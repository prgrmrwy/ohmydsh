/**
 * Pet settings section: four stable tabs.
 *
 * General, Skills and Diagnostics.
 * architecture — the overlay and Task panel deliberately do not duplicate
 * installation, binding editing or diagnostics.
 *
 * Provider credentials are owned by DSH provider/subscription plugins. This
 * page displays provider/model availability by id only and never reads,
 * persists or renders a token.
 */

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
import { PET_EXECUTOR_PRESET } from '../wire.js'
import { WHEEL_CAPACITY } from './wheel.js'
import type { PetProjectionEntry, PetSkillRevision, PetSkillSelection } from '../wire.js'

/** The four stable tabs. */
export const PET_SETTINGS_TABS = ['general', 'skills', 'diagnostics'] as const

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
  diagnostics: '诊断',
}

export function PetSettingsSection(props: { initialTab?: PetSettingsTab } = {}): JSX.Element {
  const [tab, setTab] = useState<PetSettingsTab>(props.initialTab ?? 'general')

  return (
    <div className="dshpet-settings">
      <div className="dshpet-tabs" role="tablist" aria-label="Pet settings">
        {PET_SETTINGS_TABS.map(name => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`dshpet-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`dshpet-panel-${name}`}
            className="dshpet-tab"
            onClick={() => setTab(name)}
          >
            {TAB_LABELS[name]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`dshpet-panel-${tab}`} aria-labelledby={`dshpet-tab-${tab}`}>
        {tab === 'general' ? <GeneralTab /> : null}
        {tab === 'skills' ? <SkillsTab /> : null}
        {tab === 'diagnostics' ? <诊断信息sTab /> : null}
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
      <section className="dshpet-group">
        <h3 className="dshpet-group-title">模型</h3>
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
      </section>

      <section className="dshpet-group">
        <h3 className="dshpet-group-title">Agent 预设</h3>
        <p className="dshpet-item-hint">
          Agent 预设决定执行会话装载哪些插件与工具。默认使用
          <strong>「Pet 执行会话」</strong>——它与官方 standard 的唯一差别是
          不加载本地 Skill 发现，因此只有你在 Pet 里启用的 Skill 对执行会话可见。
        </p>
        <p className="dshpet-error">
          改成 standard 等其它预设会让全局安装的 Skill 也对执行会话可见，
          相当于放宽授权范围。除非你明确需要，否则保持默认。
        </p>
        <p className="dshpet-item-hint">
          Pet 自己的上下文由常驻指令和每次调用的任务信封提供：告诉执行会话它是 Pet
          任务会话、一个会话会串行承载多次调用、以及本次调用的来源与快照。
          这些始终生效，与这里选什么预设无关。
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
      </section>

      <section className="dshpet-group">
        <h3 className="dshpet-group-title">外观</h3>
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
        <p className="dshpet-item-hint">
          能力轮盘的圆环底色跟随上面的配色，由内向外逐圈变淡。
          「默认」配色本身是白色，任何档位下圆环都靠描边区分。
        </p>
      </section>

      <section className="dshpet-group">
        <h3 className="dshpet-group-title">新建任务</h3>
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
      </section>
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
      <section className="dshpet-group">
      <h3 className="dshpet-group-title">从本机导入</h3>
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
        <div>
          <p>
            <strong>{String(preview['skillName'])}</strong> — {String(preview['description'])}
          </p>
          <p className="dshpet-item-hint">
            {String(preview['fileCount'])} 个文件，{String(preview['totalBytes'])} 字节
          </p>
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
          <p className="dshpet-error">
            Skill 是会被 Agent 执行的指令内容，只加入你信任的目录。
            加入后 Pet 直接链接该目录，你之后对它的修改会立即生效。
          </p>
          <button
            type="button"
            className="dshpet-action"
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
            Confirm import
          </button>
        </div>
      ) : null}
      </section>

      <section className="dshpet-group">
      <h3 className="dshpet-group-title">已安装</h3>
      <p className="dshpet-item-hint">
        加入的 Skill 直接链接到你给的目录，Pet 不做复制。
        因此你改动该目录会立即生效，无需重新加入；
        相应地，目录被删除或移走时该 Skill 会失效，对应能力将拒绝执行。
        「移除」只解除登记，不会删除你的目录。
      </p>
      {state.revisions.length === 0 ? (
        <p className="dshpet-empty">尚未加入任何 Skill。</p>
      ) : null}
      {state.revisions.map(revision => {
        const selection = state.selections.find(item => item.skillName === revision.skillName)
        const enabled = selection?.enabled === true
        const atCapacity =
          state.selections.filter(item => item.enabled === true).length >= WHEEL_CAPACITY

        return (
          <div key={revision.skillName} className="dshpet-task">
            <div className="dshpet-task-head">
              <strong className="dshpet-task-name">{revision.skillName}</strong>
              <span className="dshpet-status" data-tone={enabled ? 'enabled' : undefined}>
                {enabled ? '已启用' : '未启用'}
              </span>
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
      </section>

      <section className="dshpet-group">
      <h3 className="dshpet-group-title">Skill 文件状态</h3>
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
      </section>
    </div>
  )
}


/**
 * One labelled diagnostic fact.
 *
 * 诊断信息s previously dumped raw JSON, which is dense and hard to scan; a
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

/** 诊断信息s: lifecycle, paths, digests, drift and explicit repair. */
function 诊断信息sTab(): JSX.Element {
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
      <section className="dshpet-group">
        <h3 className="dshpet-group-title">运行状态</h3>
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
          <div className="dshpet-facts">
            {drift.map(entry => (
              <Fact
                key={entry.skillName}
                label={entry.skillName}
                value={entry.diagnostic ?? entry.status}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="dshpet-group">
        <h3 className="dshpet-group-title">存储路径</h3>
        <div className="dshpet-facts">
          {Object.entries(paths).map(([key, value]) => (
            <Fact key={key} label={key} value={String(value)} mono />
          ))}
        </div>
      </section>

      <section className="dshpet-group">
        <h3 className="dshpet-group-title">操作</h3>
        <div className="dshpet-actions">
          <button
            type="button"
            className="dshpet-action"
            onClick={() => void petApi.rebuildProjection().then(refresh)}
          >
            重新生成 Skill 链接
          </button>
          <button type="button" className="dshpet-action" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
      </section>

      <section className="dshpet-group">
      <h3 className="dshpet-group-title">渠道</h3>
      <p className="dshpet-item-hint">
        Channel bindings and external replies are not part of this phase. Future channel secrets
        will be stored as protected references and never displayed.
      </p>
      </section>
    </div>
  )
}
