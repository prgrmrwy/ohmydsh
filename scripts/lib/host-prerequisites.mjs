// Host runtime prerequisites: the machine-local things a customization needs in
// order to work at all, declared in `dsh.yaml`.
//
// The motivating case is dsh-memex's storage kernel (`@touchskyer/memex`): a
// global npm install that `dsh build` never materializes, that the personal
// sync list does not carry, and that the memory libraries themselves do not
// contain. Every environment rebuild (second machine, second unix account,
// fresh DSH home, restored library) therefore loses it while keeping the
// libraries — the failure surfaces as "memory silently cannot recall or write".
//
// Two consumers need these declarations: sync validates them (a manifest defect
// must fail the build), and the launcher provisions them before start. The
// parsing/validation lives here so both read the same shape. Sync MUST NOT
// install anything: provisioning is a launcher-time, machine-local action.

/** An npm package name, optionally scoped (`@scope/name`). */
export const NPM_PACKAGE_RE = /^(@[^/@]+\/[^/@]+|[^/@]+)$/

/**
 * An exact version: `1.2.3`, plus optional prerelease/build metadata.
 * Ranges, tags and `latest` are rejected on purpose — a host prerequisite is a
 * pin, and "whatever is newest" is exactly the drift this field exists to stop.
 */
export const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** Kinds the launcher knows how to provision. */
export const HOST_PREREQUISITE_KINDS = Object.freeze(['npm-global'])

/**
 * Validate one entry's `hostPrerequisites` and return the normalized list.
 *
 * @param item - a manifest customization entry.
 * @param label - how to name the entry in error messages.
 * @returns the normalized declarations, or `undefined` when the field is absent.
 * @throws Error on any malformed field; unknown kinds are refused rather than ignored.
 */
export function parseHostPrerequisites(item, label) {
  if (item?.hostPrerequisites === undefined) return undefined
  if (item.type !== 'package') throw new Error(`${label}: hostPrerequisites is only valid on type package`)
  if (!Array.isArray(item.hostPrerequisites) || item.hostPrerequisites.length === 0) {
    throw new Error(`${label}: hostPrerequisites must be a non-empty list`)
  }
  const seen = new Set()
  return item.hostPrerequisites.map((entry, index) => {
    const at = `${label}.hostPrerequisites[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error(`${at}: mapping required`)
    if (!HOST_PREREQUISITE_KINDS.includes(entry.kind)) {
      throw new Error(`${at}: unsupported kind ${JSON.stringify(entry.kind)} (supported: ${HOST_PREREQUISITE_KINDS.join(', ')})`)
    }
    if (typeof entry.package !== 'string' || !NPM_PACKAGE_RE.test(entry.package)) {
      throw new Error(`${at}: valid npm package name required`)
    }
    if (typeof entry.version !== 'string' || !EXACT_VERSION_RE.test(entry.version)) {
      throw new Error(`${at}: version must be an exact version like "1.2.3" (got ${JSON.stringify(entry.version)})`)
    }
    if (entry.registry !== undefined && (typeof entry.registry !== 'string' || !/^https?:\/\/\S+$/.test(entry.registry))) {
      throw new Error(`${at}: registry must be an http(s) URL`)
    }
    const key = `${entry.kind}:${entry.package}`
    if (seen.has(key)) throw new Error(`${at}: duplicate prerequisite ${entry.package} on this entry`)
    seen.add(key)
    return {
      kind: entry.kind,
      package: entry.package,
      version: entry.version,
      ...(entry.registry !== undefined ? { registry: entry.registry } : {}),
    }
  })
}

/**
 * Reject the same `(kind, package)` being pinned by two entries.
 *
 * Two owners would make the provisioner choose a version, and a machine holding
 * two pinned versions of one global CLI is not a state either consumer can
 * reason about. Refuse at load time instead.
 *
 * @param declarations - flat `{ id, kind, package }` records from every entry.
 * @throws Error naming both owners.
 */
export function assertUniquePrerequisites(declarations) {
  const owners = new Map()
  for (const declaration of declarations) {
    const key = `${declaration.kind}:${declaration.package}`
    const owner = owners.get(key)
    if (owner !== undefined) {
      throw new Error(`manifest: ${declaration.package} is declared as a host prerequisite by both "${owner}" and "${declaration.id}"`)
    }
    owners.set(key, declaration.id)
  }
}

/**
 * Every prerequisite an entry declares, tagged with its owner.
 * @param item - a normalized manifest customization entry.
 * @returns flat declarations.
 */
export function declarationsOf(item) {
  return (item.hostPrerequisites ?? []).map((entry) => ({ id: item.id, ...entry }))
}
