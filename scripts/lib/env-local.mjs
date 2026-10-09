// Read deployment-deciding variables from the repository's `.env.local`.
//
// Why this exists: only `bin/dsh` sources `.env.local`. A bare
// `node scripts/sync.mjs` therefore ran without `DSH_LOCAL_MANIFEST`, saw no
// overlay, and uninstalled every overlay package as "removed from the manifest"
// — exiting 0. The same checkout and the same `.env.local` must deploy the same
// set of customizations regardless of the entry point.
//
// Deliberately narrow (spec: manifest 消费脚本自行读取 .env.local 中决定部署内容的变量):
//   - only an explicit allow-list of names is read (`DSH_LOCAL_MANIFEST` plus the
//     manifest's `enabledEnv` names) — `DSH_HOME` & co. decide *where*, not
//     *what*, and stay owned by `bin/dsh`;
//   - the caller's environment wins, including an empty string (tests rely on
//     `DSH_LOCAL_MANIFEST=''` / a nonexistent path to isolate from the overlay);
//   - values are parsed literally, never through a shell. An allow-listed value
//     that only a shell could resolve (`$HOME/...`, backticks, `~`) is refused
//     rather than guessed, so it can never silently point somewhere else.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const ENV_LOCAL_FILENAME = '.env.local'

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/

/**
 * Parse `.env.local` text into assignments. Lines that are not simple
 * assignments (functions, conditionals, …) are skipped: the file stays valid
 * bash, and only allow-listed names are ever consulted.
 *
 * @param {string} text
 * @returns {{ name: string, value?: string, line: number, problem?: string }[]}
 */
export function parseEnvLocal(text) {
  const out = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    if (/^\s*(#|$)/.test(raw)) return
    const match = LINE.exec(raw)
    if (!match) return
    const [, name, rest] = match
    out.push({ name, line, ...parseValue(rest) })
  })
  return out
}

/** @returns {{ value?: string, problem?: string }} */
function parseValue(rest) {
  const s = rest.trimStart()
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1)
    if (end < 0) return { problem: 'unterminated single quote' }
    return trailingOk(s.slice(end + 1)) ? { value: s.slice(1, end) } : { problem: 'unsupported text after closing quote' }
  }
  if (s.startsWith('"')) {
    let value = ''
    for (let i = 1; i < s.length; i++) {
      const c = s[i]
      if (c === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) { value += s[++i]; continue }
      if (c === '$' || c === '`') return { problem: 'shell expansion ($ or backtick) is not supported' }
      if (c === '"') {
        return trailingOk(s.slice(i + 1)) ? { value } : { problem: 'unsupported text after closing quote' }
      }
      value += c
    }
    return { problem: 'unterminated double quote' }
  }
  // Unquoted: an inline comment starts at whitespace + '#'.
  const value = s.replace(/\s+#.*$/, '').trim()
  if (/[$`]/.test(value)) return { problem: 'shell expansion ($ or backtick) is not supported' }
  if (value.startsWith('~')) return { problem: 'tilde expansion is not supported' }
  if (/["'\\]/.test(value)) return { problem: 'quotes or escapes inside an unquoted value are not supported' }
  if (/\s/.test(value)) return { problem: 'unquoted whitespace is not supported' }
  return { value }
}

const trailingOk = (tail) => /^\s*(#.*)?$/.test(tail)

/**
 * Fill allow-listed names from `<repo>/.env.local` into `env` when the caller
 * has not set them.
 *
 * @param {object} options
 * @param {string} options.repo - repository root holding `.env.local`.
 * @param {Iterable<string>} options.names - allow-listed variable names.
 * @param {Record<string, string | undefined>} [options.env] - mutated in place.
 * @param {boolean} [options.strict] - throw on an unresolvable value (deployment
 *   surfaces); otherwise report it in `errors` and leave the variable unset.
 * @returns {{ file: string, applied: string[], errors: string[] }}
 */
export function applyEnvLocal({ repo, names, env = process.env, strict = true }) {
  const file = path.join(repo, ENV_LOCAL_FILENAME)
  const result = { file, applied: [], errors: [] }
  const wanted = new Set([...names].filter((name) => env[name] === undefined))
  if (wanted.size === 0 || !existsSync(file)) return result

  // Last assignment wins, as with `source`.
  const last = new Map()
  for (const entry of parseEnvLocal(readFileSync(file, 'utf8'))) {
    if (wanted.has(entry.name)) last.set(entry.name, entry)
  }
  for (const [name, entry] of last) {
    if (entry.problem !== undefined) {
      // Never echo the value: it may be a machine-private path.
      const message = `${file}:${entry.line}: ${name} cannot be read literally (${entry.problem}); ` +
        'use an absolute path or a single-quoted literal value'
      if (strict) throw new Error(message)
      result.errors.push(message)
      continue
    }
    env[name] = entry.value
    result.applied.push(name)
  }
  return result
}

/**
 * Collect every `enabledEnv` name declared in a (merged) manifest document.
 *
 * @param {object} doc
 * @returns {string[]}
 */
export function enabledEnvNames(doc) {
  const names = new Set()
  for (const item of Array.isArray(doc?.customizations) ? doc.customizations : []) {
    if (item && typeof item === 'object' && typeof item.enabledEnv === 'string' && item.enabledEnv !== '') {
      names.add(item.enabledEnv)
    }
  }
  return [...names]
}

// The `enabledEnv` switch semantics: which spellings count as on/off, and what
// "this customization is in effect on this machine" means.
//
// They live here because `.env.local` is where those values come from, and
// because two consumers now ask the question — sync (which materializes) and
// the launcher's host-prerequisite self-heal (which installs machine-local
// prerequisites). A second copy would let them disagree: sync would install a
// package for an entry the healer refuses to treat as enabled, or the reverse.
//
// Recognized spellings are `1/true/yes/on` and `0/false/no/off`, case-insensitive
// and trimmed. Anything else (blank, misspelled, absent) is NOT an override: it
// falls back to the manifest, so a typo can never silently flip a switch on.
export const ENV_BOOL_TRUE = new Set(['1', 'true', 'yes', 'on'])
export const ENV_BOOL_FALSE = new Set(['0', 'false', 'no', 'off'])

/**
 * Resolve a boolean env override.
 * @param raw - the environment value, if any.
 * @returns true/false for a recognized spelling, `undefined` otherwise.
 */
export function resolveEnabledOverride(raw) {
  if (raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  if (value === '') return undefined
  if (ENV_BOOL_TRUE.has(value)) return true
  if (ENV_BOOL_FALSE.has(value)) return false
  return undefined
}

/**
 * Is this manifest entry in effect here and now?
 *
 * A malformed `enabledEnv` name throws: it is a manifest defect to fix, not to
 * guess around. Sync reports it as a load error; the launcher's self-heal
 * reports it as a diagnostic for that entry and keeps going (a manifest typo
 * must not block starting DSH).
 *
 * @param item - a manifest customization entry.
 * @param env - the environment holding the override (defaults to `process.env`).
 * @param label - how to name the entry in an error message (defaults to its id).
 * @returns whether the entry is enabled.
 * @throws Error when `enabledEnv` is not an uppercase `DSH_`-prefixed name.
 */
export function isCustomizationEnabled(item, env = process.env, label = undefined) {
  const name = label ?? item?.id ?? 'customization'
  let enabled = item?.enabled !== false
  if (item?.enabledEnv === undefined) return enabled
  if (typeof item.enabledEnv !== 'string' || !/^DSH_[A-Z0-9_]+$/.test(item.enabledEnv)) {
    const suggestion = String(item?.id ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    throw new Error(`${name}: enabledEnv must be an uppercase DSH_-prefixed env var name (e.g. DSH_${suggestion})`)
  }
  const override = resolveEnabledOverride(env[item.enabledEnv])
  if (override !== undefined) enabled = override
  return enabled
}
