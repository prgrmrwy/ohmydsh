/**
 * Path comparison shared by the page model and the draft recomputation.
 *
 * Mirrors the Host's `normalizePath` / `pathSegmentMatches` for the cases a
 * settings page meets: absolute paths and `~/…` prefixes.
 *
 * @module dsh-memex/client/paths
 */

/** Expand a leading `~` using the Host's home directory and drop trailing slashes. */
export function expandPath(path: string, homeDir: string): string {
  const trimmed = path.trim()
  const expanded = trimmed === '~'
    ? homeDir
    : trimmed.startsWith('~/')
      ? `${homeDir.replace(/\/+$/, '')}/${trimmed.slice(2)}`
      : trimmed
  return expanded.length > 1 ? expanded.replace(/\/+$/, '') : expanded
}

/** Number of non-empty path segments; the resolver's depth measure. */
export function segmentCount(path: string): number {
  return path.split('/').filter(Boolean).length
}

/**
 * Whether `path` is `prefix` or lives under it — the Host's own rule.
 *
 * Compared segment-wise, so `/a/bc` is not under `/a/b`. Both sides are expanded
 * first: configured prefixes are usually written `~/…` while a workspace path is
 * always absolute, and comparing the two raw strings would match nothing.
 */
export function underPath(path: string, prefix: string, homeDir: string): boolean {
  const a = expandPath(path, homeDir)
  const b = expandPath(prefix, homeDir)
  if (b === '') return false
  return a === b || a.startsWith(`${b}/`)
}
