// ohmydsh local manifest overlay — append-only customizations from an
// out-of-version-control file.
//
// Why this exists: the repository is public, but some customizations are not
// publishable (internal npm packages, internal collectors, fragments carrying
// machine-absolute paths). The previous workaround (`enabled: false` +
// `enabledEnv` + a gitignored `.env.local`) achieves "not enabled by default"
// but not "not published" — the public manifest still had to spell out the
// internal package name, registry and maintainer.
//
// The overlay is deliberately *append-only*. It may not declare top-level
// fields and may not override a public entry: allowing either would mean a
// file outside version control could silently retarget a reviewed spec,
// disable a reviewed customization, or move the pinned runtime — and would
// break the property that reading the public manifest tells you what the
// deployment is allowed to contain.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

/** Default overlay filename, resolved against the repository root. */
export const OVERLAY_FILENAME = 'dsh.yaml.local'

/** Env var that replaces (never augments) the default overlay path. */
export const OVERLAY_PATH_ENV = 'DSH_LOCAL_MANIFEST'

/**
 * The only top-level key an overlay may carry. Everything else is a deployment
 * fact that must stay publicly auditable: `dshVersion` is the single version
 * source, `autoUpdate` governs upgrades, `agentInstructions` is injected into
 * the agent prompt surface, `web` changes startup shape, and `dependencies`
 * backs the `deps` referential-integrity check — letting an overlay extend it
 * would make that rule's verdict depend on an unversioned file.
 */
const ALLOWED_TOP_LEVEL_KEYS = new Set(['customizations'])

/**
 * Resolve which overlay path is in effect.
 *
 * `DSH_LOCAL_MANIFEST` *replaces* the repository-root default rather than
 * stacking with it, so exactly one overlay can ever be live: the multi-machine
 * route (a private git repo pointed at by the env var) must not silently merge
 * with a stale repo-root file, and "where did this entry come from" stays a
 * single answer.
 *
 * @param {string} repo - repository root.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {{ file: string, source: 'env' | 'default' }}
 */
export function resolveOverlayPath(repo, env = process.env) {
  const override = env[OVERLAY_PATH_ENV]
  if (typeof override === 'string' && override.trim() !== '') {
    return { file: path.resolve(override.trim()), source: 'env' }
  }
  return { file: path.join(repo, OVERLAY_FILENAME), source: 'default' }
}

/**
 * Load the overlay's customization entries.
 *
 * A missing overlay is the normal case, not an error: without one, callers must
 * behave exactly as they did before this capability existed. A *present* but
 * unreadable or malformed overlay is a misconfiguration — `strict` callers
 * (the deployment surface) fail closed, while display-only callers degrade,
 * mirroring how `plugin-list` already tolerates an unreadable manifest.
 *
 * @param {object} [options]
 * @param {string} [options.repo] - repository root (default path resolution).
 * @param {Record<string, string | undefined>} [options.env] - environment.
 * @param {boolean} [options.strict] - throw instead of degrading on a bad overlay.
 * @returns {{ file: string, present: boolean, customizations: object[], error?: Error }}
 */
export function loadOverlayCustomizations({ repo, env = process.env, strict = true } = {}) {
  const { file } = resolveOverlayPath(repo, env)
  const empty = { file, present: false, customizations: [] }
  if (!existsSync(file)) return empty

  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    const wrapped = new Error(`local manifest overlay ${file}: failed to read — ${String(error?.message ?? error)}`)
    if (strict) throw wrapped
    return { ...empty, present: true, error: wrapped }
  }

  try {
    return { file, present: true, customizations: parseOverlay(raw, file) }
  } catch (error) {
    if (strict) throw error
    return { ...empty, present: true, error: /** @type {Error} */ (error) }
  }
}

/**
 * Parse and validate one overlay document.
 *
 * Errors name the overlay path and index entries by their position *within the
 * overlay*, never as `customizations[N]`: a reader told "customizations[12] is
 * invalid" would go looking for a twelfth entry in the public manifest that
 * does not exist.
 *
 * @param {string} content - the overlay file's text.
 * @param {string} file - absolute path, quoted in errors.
 * @returns {object[]} the overlay's customization entries, source-tagged.
 */
export function parseOverlay(content, file) {
  const label = `local manifest overlay ${file}`
  let doc
  try {
    doc = yaml.load(content)
  } catch (error) {
    throw new Error(`${label}: failed to parse — ${String(error?.message ?? error)}`)
  }
  // An empty overlay is legitimate (a placeholder kept in a private repo).
  if (doc === undefined || doc === null) return []
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`${label}: root must be a mapping with a "customizations" list`)
  }

  const offending = Object.keys(doc).filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key))
  if (offending.length > 0) {
    throw new Error(
      `${label}: may only declare "customizations" (found ${offending.join(', ')}). ` +
      'dshVersion, autoUpdate, web, agentInstructions and dependencies are deployment ' +
      'facts that must stay in the public manifest.',
    )
  }

  const list = doc.customizations
  if (list === undefined) return []
  if (!Array.isArray(list)) throw new Error(`${label}: customizations must be a list`)

  const seen = new Set()
  return list.map((item, index) => {
    const at = `${label} customizations[${index}]`
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`${at}: mapping required`)
    }
    if (typeof item.id !== 'string' || item.id === '') throw new Error(`${at}: valid string id required`)
    if (seen.has(item.id)) throw new Error(`${at}: duplicate id "${item.id}" within the overlay`)
    seen.add(item.id)
    // Source tag travels with the entry so downstream diagnostics can say which
    // file an entry came from without re-reading either manifest.
    return { ...item, overlaySource: file }
  })
}

/**
 * Merge overlay entries into a manifest document, in place of the caller
 * re-implementing the conflict rules.
 *
 * Append-only: a shared id is a hard error rather than an override, so the two
 * files stay orthogonal and can be read independently while debugging.
 *
 * @param {object} doc - the parsed public manifest (mutated).
 * @param {object[]} overlayItems - entries from {@link loadOverlayCustomizations}.
 * @param {string} file - overlay path, quoted in errors.
 * @returns {object} the same `doc`, with overlay entries appended.
 */
export function mergeOverlayCustomizations(doc, overlayItems, file) {
  if (overlayItems.length === 0) return doc
  const publicIds = new Set(
    (doc.customizations ?? [])
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
      .map((item) => item.id),
  )
  for (const item of overlayItems) {
    if (publicIds.has(item.id)) {
      throw new Error(
        `local manifest overlay ${file}: id "${item.id}" already exists in the public manifest. ` +
        'The overlay may only append customizations, never override one.',
      )
    }
  }
  doc.customizations = [...(doc.customizations ?? []), ...overlayItems]
  return doc
}

/**
 * Read the public manifest and return it with the overlay already merged.
 *
 * Every consumer of `customizations` must go through one merged view; a
 * consumer reading only the public manifest would produce a split state such as
 * "installed but absent from the startup list" or "installed but never checked
 * for updates".
 *
 * @param {object} options
 * @param {string} options.manifestPath - absolute path of the public manifest.
 * @param {string} options.repo - repository root (overlay default resolution).
 * @param {Record<string, string | undefined>} [options.env] - environment.
 * @param {boolean} [options.strict] - fail closed on a bad overlay.
 * @returns {{ doc: object, overlay: { file: string, present: boolean, error?: Error } }}
 */
export function loadManifestWithOverlay({ manifestPath, repo, env = process.env, strict = true }) {
  const doc = yaml.load(readFileSync(manifestPath, 'utf8'))
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error(`manifest ${manifestPath} is empty or not a YAML mapping`)
  }
  const overlay = loadOverlayCustomizations({ repo, env, strict })
  mergeOverlayCustomizations(doc, overlay.customizations, overlay.file)
  return { doc, overlay: { file: overlay.file, present: overlay.present, error: overlay.error } }
}
