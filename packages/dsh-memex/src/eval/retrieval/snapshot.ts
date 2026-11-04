/*
 * Retrieval runner API: prepareSnapshot reads and validates source data wholly in
 * memory (files, card slugs, excluded slugs, manifest/hash, safe nestedSlugs and
 * distractor hashes). Call it before gold validation. materializeSnapshot writes
 * only after every input check has passed. verifySnapshot checks listed hashes
 * and rejects any unlisted file; assertDeclaredHash gates execution before search.
 */
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync, readdirSync, lstatSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { assertUniqueSlugs, readLibraryFiles } from './fs-boundary.js'

export interface SnapshotEntry { path: string; sha256: string }
export interface DistractorCard { slug: string; content: string }
export interface PreparedSnapshot {
  files: Map<string, Buffer>
  excludedSlugs: string[]
  manifest: SnapshotEntry[]
  manifestHash: string
  nestedSlugs?: boolean
  distractors: Array<{ slug: string; sha256: string }>
  slugs: string[]
}
export interface PrepareSnapshotOptions {
  sourceRoot: string
  distractors?: readonly DistractorCard[]
  excludeCategories?: readonly string[]
  excludePrefixes?: readonly string[]
}
const DEFAULT_CATEGORIES = ['handoff', 'eval']
const DEFAULT_PREFIXES = ['probe-', 'handoff-', 'memex-retrieval-probe-']
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
function slugFromPath(path: string, nestedSlugs: boolean): string {
  const pathSlug = path.slice('cards/'.length, -'.md'.length)
  return nestedSlugs ? pathSlug : pathSlug.split('/').at(-1)!
}

// Match the kernel slug validator while retaining goldset/path safety constraints.
export function isSafeKernelSlug(slug: string): boolean {
  const trimmed = slug.trim()
  return trimmed.length > 0 && !/[:*?"<>|]/.test(slug) && !slug.includes('\0')
    && !slug.startsWith('/') && !slug.endsWith('/') && !slug.includes('//') && !slug.includes('\\')
    && !slug.includes('..') && !slug.split('/').some(part => part === '' || part === '.' || part === '..')
}

// Decode only plain or quoted YAML strings; unsupported structures fail closed.
function categoryScalar(raw: string, path: string): string {
  const source = raw.trim()
  const value = /^((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'))(?:\s+#.*)?$/.exec(source)?.[1] ?? source.replace(/\s+#.*$/, '').trimEnd()
  const fail = (): never => { throw new Error(`cannot safely parse category in ${path}: unsupported YAML scalar`) }
  if (!value) return fail()
  if (value[0] === '"') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === 'string') return parsed
    } catch { /* Unsupported YAML escapes fail closed. */ }
    return fail()
  }
  if (value[0] === "'") {
    if (value.at(-1) !== "'" || !/^(?:[^']|'')*$/.test(value.slice(1, -1))) return fail()
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if ('[]{}|>&*!?'.includes(value[0]!) || /^(?:[-+]?(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d+)?|~|null|true|false|\.inf|\.nan)$/i.test(value)) return fail()
  return value
}

function category(bytes: Buffer, path: string): string | undefined {
  const text = bytes.toString('utf8')
  if (!/^---\r?\n/.test(text)) return undefined
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error(`cannot safely parse category in ${path}: malformed frontmatter`)
  const lines = match[1]!.split(/\r?\n/)
  const first = lines.find(line => line.trim() && !line.trimStart().startsWith('#'))
  if (!first) return undefined
  const firstContent = first.trimStart()[0]
  if (firstContent === '{' || firstContent === '[') throw new Error(`cannot safely parse category in ${path}: flow frontmatter is unsupported`)
  const rootIndent = first.length - first.trimStart().length
  let found: string | undefined
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const pair = /^(\s*)(?:"((?:\\.|[^"\\])*)"|'((?:''|[^'])*)'|([^:]+)):\s*(.*?)\s*$/.exec(line)
    if (!pair || pair[1]!.length !== rootIndent) continue
    let key: string
    if (pair[2] !== undefined) {
      try { key = JSON.parse(`"${pair[2]}"`) as string } catch { throw new Error(`cannot safely parse category in ${path}: invalid quoted key`) }
    } else key = pair[3] !== undefined ? pair[3].replace(/''/g, "'") : pair[4]!.trim()
    if (key === '<<') throw new Error(`cannot safely parse category in ${path}: YAML merge key is unsupported`)
    if (key !== 'category') continue
    if (found !== undefined) throw new Error(`cannot safely parse category in ${path}: duplicate category key`)
    found = categoryScalar(pair[5]!, path)
  }
  return found
}
function safeConfig(bytes: Buffer | undefined): { content?: Buffer; nestedSlugs?: boolean } {
  if (!bytes) return {}
  let parsed: unknown
  try { parsed = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('.memexrc is not valid JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('.memexrc must be a JSON object')
  const nested = (parsed as Record<string, unknown>).nestedSlugs
  if (nested !== undefined && typeof nested !== 'boolean') throw new Error('.memexrc nestedSlugs must be boolean')
  if (nested === undefined) return { content: Buffer.from('{}\n') }
  return { content: Buffer.from(JSON.stringify({ nestedSlugs: nested }) + '\n'), nestedSlugs: nested }
}
function safePath(path: string): void {
  if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`unsafe snapshot path: ${path}`)
}

export function prepareSnapshot(options: PrepareSnapshotOptions): PreparedSnapshot {
  const raw = readLibraryFiles(options.sourceRoot)
  const config = safeConfig(raw.get('.memexrc'))
  const nestedSlugs = config.nestedSlugs ?? false
  const categories = new Set([...DEFAULT_CATEGORIES, ...(options.excludeCategories ?? [])])
  const prefixes = [...DEFAULT_PREFIXES, ...(options.excludePrefixes ?? [])]
  const files = new Map<string, Buffer>()
  const excludedSlugs: string[] = []
  const slugs: string[] = []
  const allSourceSlugs: string[] = []
  for (const [path, bytes] of raw) {
    if (path === '.memexrc') continue
    if (!path.startsWith('cards/') || !path.endsWith('.md')) { files.set(path, bytes); continue }
    const slug = slugFromPath(path, nestedSlugs)
    allSourceSlugs.push(slug)
    if (categories.has(category(bytes, path) ?? '') || prefixes.some(prefix => slug.startsWith(prefix))) { excludedSlugs.push(slug); continue }
    files.set(path, bytes)
    slugs.push(slug)
  }
  if (config.content) files.set('.memexrc', config.content)
  const distractors = [...(options.distractors ?? [])]
  assertUniqueSlugs(allSourceSlugs, distractors.map(item => nestedSlugs ? item.slug : item.slug.split('/').at(-1)!))
  for (const item of distractors) {
    if (!isSafeKernelSlug(item.slug)) throw new Error(`invalid distractor slug: ${item.slug}`)
    const path = `cards/${item.slug}.md`
    files.set(path, Buffer.from(item.content))
    slugs.push(nestedSlugs ? item.slug : item.slug.split('/').at(-1)!)
  }
  const comparePath = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
  const manifest = [...files].map(([path, bytes]) => ({ path, sha256: sha256(bytes) })).sort((a, b) => comparePath(a.path, b.path))
  const manifestHash = sha256(manifest.map(item => `${item.path}\0${item.sha256}\n`).join(''))
  const distractorEntries = distractors.map(item => ({ slug: nestedSlugs ? item.slug : item.slug.split('/').at(-1)!, sha256: sha256(item.content) }))
  return { files, excludedSlugs: excludedSlugs.sort(comparePath), manifest, manifestHash, nestedSlugs, distractors: distractorEntries, slugs: slugs.sort(comparePath) }
}

export function materializeSnapshot(snapshotRoot: string, prepared: PreparedSnapshot): void {
  mkdirSync(snapshotRoot, { mode: 0o700 })
  chmodSync(snapshotRoot, 0o700)
  for (const [path, bytes] of prepared.files) {
    safePath(path)
    const destination = join(snapshotRoot, path)
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    for (let dir = dirname(destination); dir !== snapshotRoot; dir = dirname(dir)) chmodSync(dir, 0o700)
    writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 })
    chmodSync(destination, 0o600)
  }
}

export function verifySnapshot(snapshotRoot: string, manifest: readonly SnapshotEntry[]): { valid: boolean; differences: string[] } {
  const expected = new Map(manifest.map(item => [item.path, item.sha256]))
  const differences: string[] = []
  const seen = new Set<string>()
  const walk = (directory: string, prefix = ''): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix ? `${prefix}/${name}` : name
      const absolute = join(directory, name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) { differences.push(path); continue }
      if (stat.isDirectory()) walk(absolute, path)
      else if (!stat.isFile() || stat.nlink !== 1) differences.push(path)
      else {
        seen.add(path)
        const hash = sha256(readFileSync(absolute))
        if (expected.get(path) !== hash) differences.push(path)
      }
    }
  }
  walk(snapshotRoot)
  for (const path of expected.keys()) if (!seen.has(path)) differences.push(path)
  return { valid: differences.length === 0, differences: [...new Set(differences)].sort() }
}

export function assertDeclaredHash(expected: string | undefined, actual: string): void {
  if (expected === undefined) return
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) throw new Error(`declared snapshot hash ${expected} does not match actual hash ${actual}`)
}
