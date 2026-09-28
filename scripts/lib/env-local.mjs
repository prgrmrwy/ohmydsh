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
