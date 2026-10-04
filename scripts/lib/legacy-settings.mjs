// Seed runtime-owned profile rows for plugins whose live settings moved into
// their own Config in DSH 0.2.0.
//
// DSH 0.2.0 removed `$DSH_HOME/settings.yaml`: live plugin values now live in
// the plugin's Cordis Config, persisted as override rows in the profile
// `cordis.patch.yml`, written by the config editor. Two facts about that writer
// (dsh-config-editor 0.2.0-rc.2 `edit()`) shape this module:
//
// 1. A form save rewrites the LAST same-id override row in place and stores the
//    entry's complete config there: ordinary fields as composed at write time
//    plus every volatile field. If the only such row is sync's generated one,
//    the save lands inside sync's region and the next sync silently reverts it.
// 2. The loader composes override rows by whole-key replacement, so a runtime
//    row below the region replaces the region row's config entirely.
//
// Upstream also imports the old document once at first boot
// (settings `importLegacyDocument`), but it renames the file first and a
// section the plugin rejects is only logged — not fail-closed for a section
// whose loss re-routes memory into another library.
//
// So, for each section listed here and only on a 0.2+ runtime, sync seeds ONE
// runtime-owned row below its region when none exists yet: config = the keys
// sync renders for that row (e.g. org hosts) overlaid by the legacy settings
// section. From then on the runtime owns the row (sync never rewrites it), form
// saves edit it, and upstream's own import merges identical values onto it.
// Unreadable input fails the run instead of being skipped.
import yaml from 'js-yaml'

/** Settings sections sync seeds, keyed by section → profile entry id/name and its live keys. */
export const MIGRATED_SECTIONS = Object.freeze({
  'dsh-memex': { id: 'dsh-memex', name: 'dsh-memex', keys: ['autoDerive', 'scopes', 'bindings', 'workspaces'] },
})

/** Whether a DSH version string is 0.2 or later (settings.yaml retired). */
export function settingsLiveInProfile(dshVersion) {
  const match = /^(\d+)\.(\d+)\./.exec(String(dshVersion))
  if (match === null) return false
  const [major, minor] = [Number(match[1]), Number(match[2])]
  return major > 0 || minor >= 2
}

function isOverrideRowWithConfig(row, id) {
  return row !== null && typeof row === 'object' && !Array.isArray(row) && row.insert === undefined && row.id === id && Object.hasOwn(row, 'config')
}

/**
 * Plan the runtime-owned rows to seed.
 *
 * @param {object} input
 * @param {string|undefined} input.settingsText - `$DSH_HOME/settings.yaml` content, or undefined when absent.
 * @param {readonly unknown[]} input.runtimeRows - parsed rows outside sync's generated region.
 * @param {(id: string) => object|undefined} input.generatedConfig - config sync renders for an id, if any.
 * @param {readonly string[]} [input.extraIds] - further row ids sync renders with mergeConfig.
 * @returns {{ rows: object[], seeded: string[] }}
 * @throws when the settings document or a seeded section is unreadable.
 */
export function planSeedRows({ settingsText, runtimeRows, generatedConfig, extraIds = [] }) {
  let doc
  if (settingsText !== undefined) {
    try {
      doc = yaml.load(settingsText)
    } catch (error) {
      throw new Error(`settings.yaml is not valid YAML (${String(error.message).split('\n')[0]}); refusing to migrate plugin settings`)
    }
    if (doc !== null && doc !== undefined && (typeof doc !== 'object' || Array.isArray(doc))) {
      throw new Error('settings.yaml top level is not a mapping; refusing to migrate plugin settings')
    }
  }
  const result = { rows: [], seeded: [] }
  // Every row sync renders with mergeConfig also gets a runtime-owned twin, so
  // a form save never lands in the generated region; legacy sections add values.
  const targets = Object.entries(MIGRATED_SECTIONS)
  for (const id of extraIds) {
    if (!targets.some(([, target]) => target.id === id)) targets.push([undefined, { id, name: undefined, keys: [] }])
  }
  for (const [section, target] of targets) {
    if (runtimeRows.some((row) => isOverrideRowWithConfig(row, target.id))) continue
    let legacy = {}
    if (section !== undefined && doc !== null && doc !== undefined && Object.hasOwn(doc, section)) {
      const value = doc[section]
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`settings.yaml section ${section} is not a mapping; refusing to migrate it`)
      }
      const unknown = Object.keys(value).filter((key) => !target.keys.includes(key))
      if (unknown.length > 0) throw new Error(`settings.yaml section ${section} has keys this migration does not know: ${unknown.join(', ')}`)
      legacy = value
    }
    const generated = generatedConfig(target.id)
    // Nothing to carry and nothing sync renders for this row: no seed needed,
    // the first form save simply appends a fresh row below the region.
    if (generated === undefined && Object.keys(legacy).length === 0) continue
    result.rows.push({ id: target.id, ...(target.name === undefined ? {} : { name: target.name }), config: { ...(generated ?? {}), ...legacy } })
    result.seeded.push(target.id)
  }
  return result
}

/**
 * Keep sync-declared keys current inside the runtime-owned rows, seeding a row
 * when none exists. Edits go through the `yaml` Document API with the same
 * `!!js` handling as the DSH config editor, so comments, ordering and
 * expressions of everything else in the runtime region are preserved.
 *
 * @param {object} input
 * @param {string} input.text - the runtime-owned part of the profile patch ('' when empty).
 * @param {readonly {id: string, name?: string, config: object}[]} input.owned - rows sync owns keys of.
 * @param {readonly object[]} input.seeds - rows to append when the runtime has none for that id.
 * @param {typeof import('yaml')} input.YAML - the `yaml` module (injected so callers control resolution).
 * @returns {{ text: string, changed: string[] }}
 */
export function reconcileOwnedKeys({ text, owned, seeds, YAML }) {
  const { isMap, isSeq, parseDocument, Scalar, visit } = YAML
  const document = parseDocument(text.trim() === '' ? '[]\n' : text, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value) => ({ __jsExpr: value }) }],
  })
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('profile patch rows outside the generated region are not a YAML sequence')
  document.contents.flow = false
  const changed = []
  const lastRow = (id) => document.contents.items.findLastIndex((item, index) => isMap(item) && document.getIn([index, 'id']) === id && !item.has('insert'))
  for (const seed of seeds) {
    if (lastRow(seed.id) >= 0 && document.hasIn([lastRow(seed.id), 'config'])) continue
    document.add(document.createNode(seed))
    changed.push(`seed ${seed.id}`)
  }
  for (const row of owned) {
    const index = lastRow(row.id)
    if (index < 0 || !document.hasIn([index, 'config'])) continue
    for (const [key, value] of Object.entries(row.config)) {
      const current = document.getIn([index, 'config', key])
      const plain = current !== null && typeof current === 'object' && typeof current.toJSON === 'function' ? current.toJSON() : current
      if (JSON.stringify(plain) === JSON.stringify(value)) continue
      document.setIn([index, 'config', key], document.createNode(value))
      changed.push(`${row.id}.${key}`)
    }
  }
  if (changed.length === 0) return { text, changed }
  visit(document, { Map(_key, node) {
    if (node.items.length !== 1 || typeof node.get('__jsExpr') !== 'string') return undefined
    const expression = new Scalar(node.get('__jsExpr'))
    expression.tag = 'tag:yaml.org,2002:js'
    return expression
  } })
  return { text: String(document), changed }
}
