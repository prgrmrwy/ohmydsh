/**
 * Pet settings section: four stable tabs.
 *
 * General, Skills, Bindings and Diagnostics are a FIXED information
 * architecture — the overlay and Task panel deliberately do not duplicate
 * installation, binding editing or diagnostics.
 *
 * Provider credentials are owned by DSH provider/subscription plugins. This
 * page displays provider/model availability by id only and never reads,
 * persists or renders a token.
 */

import { useCallback, useEffect, useState } from 'react'
import { resetPosition } from './position.js'
import { petApi, type PetConfig } from './api.js'
import type { PetProjectionEntry, PetSkillRevision, PetSkillSelection } from '../wire.js'

/** The four stable tabs. */
export const PET_SETTINGS_TABS = ['general', 'skills', 'bindings', 'diagnostics'] as const

export type PetSettingsTab = (typeof PET_SETTINGS_TABS)[number]

/**
 * The Pet settings section.
 * @param props - Optionally the initially selected tab, for deep links.
 * @returns the rendered section.
 */
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
            {name[0]?.toUpperCase()}
            {name.slice(1)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`dshpet-panel-${tab}`} aria-labelledby={`dshpet-tab-${tab}`}>
        {tab === 'general' ? <GeneralTab /> : null}
        {tab === 'skills' ? <SkillsTab /> : null}
        {tab === 'bindings' ? <BindingsTab /> : null}
        {tab === 'diagnostics' ? <DiagnosticsTab /> : null}
      </div>
    </div>
  )
}

/** General: the followed model, appearance reset and default context policy. */
function GeneralTab(): JSX.Element {
  const [config, setConfig] = useState<PetConfig | undefined>(undefined)
  const [preset, setPreset] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  // The model is read-only here: Pet follows DSH's default selection, so
  // there is no Pet-owned draft to edit or save.
  useEffect(() => {
    void petApi
      .config()
      .then(value => {
        setConfig(value)
        setPreset(value.agentPreset ?? '')
      })
      .catch((cause: unknown) => setError(String(cause)))
  }, [])

  return (
    <div className="dshpet-settings">
      <section className="dshpet-group">
        <h3 className="dshpet-group-title">Agent</h3>
        <p className="dshpet-item-hint">
          Pet executors follow DSH&apos;s default model. Change it in
          Settings &rarr; 模型, and Pet picks it up on the next Invocation &mdash;
          no Pet-side setting to keep in sync.
        </p>
        <p className="dshpet-item-hint">
          Currently: <code>{config?.providerId ?? '…'}</code>
          {config?.modelId !== undefined ? <> / <code>{config.modelId}</code></> : null}
        </p>
        {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
      </section>

      <section className="dshpet-group">
        <h3 className="dshpet-group-title">Agent preset</h3>
        <p className="dshpet-item-hint">
          Optional DSH Agent preset for Pet executors. Leave empty to use the
          default composition. The preset selects the executor&apos;s tools and
          instructions; the model still follows DSH.
        </p>
        <label className="dshpet-field">
          Preset name
          <input
            className="dshpet-input"
            value={preset}
            placeholder="(default composition)"
            onChange={event => setPreset(event.target.value)}
          />
        </label>
        <div className="dshpet-actions">
          <button
            type="button"
            className="dshpet-action"
            onClick={() => {
              setError(undefined)
              void petApi
                .updateConfig({ agentPreset: preset.trim() })
                .then(next => {
                  setConfig(next)
                  setPreset(next.agentPreset ?? '')
                })
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                )
            }}
          >
            Save preset
          </button>
        </div>
      </section>

      <section className="dshpet-group">
        <h3 className="dshpet-group-title">Appearance</h3>
      <button
        type="button"
        className="dshpet-action"
        onClick={() => {
          resetPosition()
        }}
      >
        Reset Pet position
      </button>
      </section>

      <section className="dshpet-group">
        <h3 className="dshpet-group-title">New tasks</h3>
      <p className="dshpet-item-hint">
        Which source a new Task starts with. <code>none</code> starts unattached,
        so an optional-context capability runs independently unless you pick a source.
      </p>
      <label className="dshpet-field">
        Default context policy
        <select className="dshpet-input"
          value={config?.defaultContextPolicy ?? 'current-session'}
          onChange={event => {
            const next = event.target.value === 'none' ? 'none' : 'current-session'
            setError(undefined)
            void petApi
              .updateConfig({ defaultContextPolicy: next })
              .then(setConfig)
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
          }}
        >
          <option value="current-session">current-session</option>
          <option value="none">none</option>
        </select>
      </label>
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
  const [preview, setPreview] = useState<Record<string, unknown> | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setState(
        (await petApi.skills()) as unknown as {
          revisions: PetSkillRevision[]
          selections: PetSkillSelection[]
          projection: PetProjectionEntry[]
        },
      )
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
      <h3 className="dshpet-group-title">Import from this machine</h3>
      <p className="dshpet-item-hint">
        Absolute path on the Host running <code>dsh web</code> — not this browser&apos;s machine.
      </p>
      <div className="dshpet-row">
        <input
          className="dshpet-input"
          value={path}
          placeholder="/absolute/path/on/the/host"
          onChange={event => setPath(event.target.value)}
        />
        {directoryPicker !== undefined ? (
          <button
            type="button"
            className="dshpet-action"
            onClick={() => {
              const pick = directoryPicker
              if (pick === undefined) return
              setError(undefined)
              void pick()
                .then(picked => {
                  // Cancellation returns nothing; keep what the user typed.
                  if (picked !== undefined) setPath(picked)
                })
                .catch((cause: unknown) =>
                  setError(cause instanceof Error ? cause.message : String(cause)),
                )
            }}
          >
            Browse…
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="dshpet-action"
        onClick={() => {
          setError(undefined)
          // Step 1: read-only inspection. Nothing is copied yet.
          void petApi
            .inspectSkill(path)
            .then(setPreview)
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
        }}
      >
        Inspect
      </button>

      {preview !== undefined ? (
        <div>
          <p>
            <strong>{String(preview['skillName'])}</strong> — {String(preview['description'])}
          </p>
          <p className="dshpet-item-hint">
            {String(preview['fileCount'])} files, {String(preview['totalBytes'])} bytes
          </p>
          <p className="dshpet-item-hint">Digest: {String(preview['digest'])}</p>
          <p className="dshpet-error">
            A Skill is trusted executable instruction content. Only import bundles you trust.
          </p>
          <button
            type="button"
            className="dshpet-action"
            onClick={() => {
              // Step 2: separately confirmed install, pinned to the exact
              // digest the user was shown.
              void petApi
                .importSkill(path, String(preview['digest']))
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
      <h3 className="dshpet-group-title">Installed</h3>
      {state.revisions.length === 0 ? <p className="dshpet-empty">No Skills installed.</p> : null}
      {state.revisions.map(revision => {
        const selection = state.selections.find(item => item.skillName === revision.skillName)
        const enabled = selection?.enabledDigest === revision.digest
        return (
          <div key={`${revision.skillName}@${revision.digest}`} className="dshpet-task">
            <strong>{revision.skillName}</strong>{' '}
            <span className="dshpet-status">{enabled ? 'enabled' : 'installed'}</span>
            {enabled && selection?.upgradeAvailableDigest !== undefined ? (
              <span className="dshpet-status" style={{ marginLeft: 4 }}>
                upgrade available
              </span>
            ) : null}
            <p className="dshpet-item-hint">
              {revision.provenance.kind} · {revision.digest.slice(0, 19)}…
            </p>
            <div className="dshpet-actions">
              <button
                type="button"
                className="dshpet-action"
                onClick={() =>
                  void petApi
                    .mutateSkill({
                      skillName: revision.skillName,
                      action: enabled ? 'disable' : 'enable',
                      digest: revision.digest,
                    })
                    .then(refresh)
                }
              >
                {enabled ? 'Disable' : 'Enable'}
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
                {selection?.showAsShortcut === false ? 'Show in menu' : 'Hide from menu'}
              </button>
              {enabled && selection?.upgradeAvailableDigest !== undefined ? (
                <button
                  type="button"
                  className="dshpet-action"
                  onClick={() => {
                    setError(undefined)
                    // Explicit and user-applied: a packaged upgrade is never
                    // adopted silently, and queued work keeps its fixed digest.
                    void petApi
                      .mutateSkill({
                        skillName: revision.skillName,
                        action: 'upgrade',
                        digest: selection.upgradeAvailableDigest!,
                      })
                      .then(refresh)
                      .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : String(cause)),
                      )
                  }}
                >
                  Upgrade
                </button>
              ) : null}
              <button
                type="button"
                className="dshpet-action"
                onClick={() => {
                  setError(undefined)
                  // Uninstall disables the Skill first, then collects only
                  // revisions no live Task or queued Invocation references.
                  void petApi
                    .mutateSkill({ skillName: revision.skillName, action: 'uninstall' })
                    .then(refresh)
                    .catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : String(cause)),
                    )
                }}
              >
                Uninstall
              </button>
            </div>
          </div>
        )
      })}
      </section>

      <section className="dshpet-group">
      <h3 className="dshpet-group-title">Projection</h3>
      {state.projection.length === 0 ? (
        <p className="dshpet-item-hint">No drift detected.</p>
      ) : (
        state.projection.map(entry => (
          <p key={entry.skillName} className="dshpet-error">
            {entry.skillName}: {entry.status} — {entry.diagnostic}
          </p>
        ))
      )}
      <button
        type="button"
        className="dshpet-action"
        onClick={() => void petApi.rebuildProjection().then(refresh)}
      >
        Rebuild projection
      </button>
      {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
      </section>
    </div>
  )
}

/** Bindings: trusted destinations for bounded side effects. */
function BindingsTab(): JSX.Element {
  const [draft, setDraft] = useState({ workspaceId: '', business: '', crGroupId: '' })
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  // Read-only until the user opts into editing, so a stored destination is
  // visible without exposing it to an accidental keystroke.
  const [editing, setEditing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const result = await petApi.bindings()
      const first = result.bindings[0]
      if (first !== undefined) {
        setDraft({
          workspaceId: first.workspaceId,
          business: first.business ?? '',
          crGroupId: first.crGroupId ?? '',
        })
      }
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
      <h3 className="dshpet-group-title">Workspace bindings</h3>
      <p className="dshpet-item-hint">
        Side-effect destinations come from these trusted bindings. The model can never supply a
        raw destination.
      </p>
      {editing ? (
        <>
          <label className="dshpet-field">
            Workspace id
            <input
              className="dshpet-input"
              value={draft.workspaceId}
              onChange={event => setDraft({ ...draft, workspaceId: event.target.value })}
            />
          </label>
          <label className="dshpet-field">
            Business
            <input
              className="dshpet-input"
              value={draft.business}
              onChange={event => setDraft({ ...draft, business: event.target.value })}
            />
          </label>
          <label className="dshpet-field">
            CR group id
            <input
              className="dshpet-input"
              value={draft.crGroupId}
              onChange={event => setDraft({ ...draft, crGroupId: event.target.value })}
            />
          </label>
          <div className="dshpet-row">
            <button
              type="button"
              className="dshpet-action"
              onClick={() => {
                setError(undefined)
                setSaved(false)
                void petApi
                  .updateBinding({ ...draft })
                  .then(() => {
                    setSaved(true)
                    // Return to read-only only on success; a rejected write
                    // keeps the form open with the input preserved so the
                    // user can correct the invalid field.
                    setEditing(false)
                    return refresh()
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                  )
              }}
            >
              Save binding
            </button>
            <button
              type="button"
              className="dshpet-action"
              onClick={() => {
                setError(undefined)
                setEditing(false)
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="dshpet-fact">
            <span className="dshpet-fact-key">Workspace id</span>
            <span className="dshpet-readonly" data-empty={draft.workspaceId === ''}>
              {draft.workspaceId === '' ? 'not set' : draft.workspaceId}
            </span>
          </div>
          <div className="dshpet-fact">
            <span className="dshpet-fact-key">Business</span>
            <span className="dshpet-readonly" data-empty={draft.business === ''}>
              {draft.business === '' ? 'not set' : draft.business}
            </span>
          </div>
          <div className="dshpet-fact">
            <span className="dshpet-fact-key">CR group id</span>
            <span className="dshpet-readonly" data-empty={draft.crGroupId === ''}>
              {draft.crGroupId === '' ? 'not set' : draft.crGroupId}
            </span>
          </div>
          <button
            type="button"
            className="dshpet-action"
            onClick={() => {
              setSaved(false)
              setEditing(true)
            }}
          >
            Edit
          </button>
        </>
      )}
      {saved ? <span className="dshpet-item-hint"> Saved.</span> : null}
      {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
      </section>
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
        <h3 className="dshpet-group-title">Status</h3>
        <div className="dshpet-facts">
          <Fact label="Lifecycle" value={lifecycle?.phase ?? '…'} />
          {lifecycle?.diagnostic !== undefined ? (
            <Fact label="Diagnostic" value={lifecycle.diagnostic} />
          ) : null}
          <Fact
            label="Enabled skills"
            value={
              allowlist.length === 0
                ? 'none'
                : allowlist.map(entry => entry.skillName).join(', ')
            }
          />
          <Fact
            label="Projection"
            value={
              drift.length === 0
                ? 'in sync'
                : `${drift.length} entr${drift.length === 1 ? 'y' : 'ies'} drifted`
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
        <h3 className="dshpet-group-title">Storage</h3>
        <div className="dshpet-facts">
          {Object.entries(paths).map(([key, value]) => (
            <Fact key={key} label={key} value={String(value)} mono />
          ))}
        </div>
      </section>

      <section className="dshpet-group">
        <h3 className="dshpet-group-title">Actions</h3>
        <div className="dshpet-actions">
          <button
            type="button"
            className="dshpet-action"
            onClick={() => void petApi.rebuildProjection().then(refresh)}
          >
            Rebuild projection
          </button>
          <button type="button" className="dshpet-action" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {error !== undefined ? <p className="dshpet-error">{error}</p> : null}
      </section>

      <section className="dshpet-group">
      <h3 className="dshpet-group-title">Channels</h3>
      <p className="dshpet-item-hint">
        Channel bindings and external replies are not part of this phase. Future channel secrets
        will be stored as protected references and never displayed.
      </p>
      </section>
    </div>
  )
}
