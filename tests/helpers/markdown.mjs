// Shared markdown / git helpers for repository documentation-governance tests.
//
// Everything that inspects text is a pure function over strings so negative
// scenarios can feed synthetic fixtures without touching the working tree.
// Only `trackedFiles` / `indexEntry` talk to git.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/

/** Blank the content of fenced code blocks (fence lines included) while keeping line numbers. */
export function blankFencedBlocks(text) {
  const lines = text.split('\n')
  let fence = null
  return lines
    .map((line) => {
      if (fence) {
        const close = line.match(FENCE_OPEN)
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length && line.trim() === close[1]) fence = null
        return ''
      }
      const open = line.match(FENCE_OPEN)
      if (open) {
        fence = open[1]
        return ''
      }
      return line
    })
    .join('\n')
}

/** Remove fenced blocks and inline code spans, preserving line numbers. */
export function stripCode(text) {
  return blankFencedBlocks(text).replace(/(`+)[^`\n]*?\1/g, '')
}

/** `<!-- section: key -->` anchors outside fences, with 1-based lines. */
export function sectionAnchors(text) {
  const anchors = []
  blankFencedBlocks(text)
    .split('\n')
    .forEach((line, index) => {
      const match = line.match(/^\s*<!--\s*section:\s*([A-Za-z0-9_-]+)\s*-->\s*$/)
      if (match) anchors.push({ key: match[1], line: index + 1 })
    })
  return anchors
}

/** Level-2 headings (outside fences) whose next non-blank line is not a section anchor. */
export function h2WithoutAnchor(text) {
  const lines = blankFencedBlocks(text).split('\n')
  const missing = []
  lines.forEach((line, index) => {
    if (!/^##\s+\S/.test(line)) return
    let next = index + 1
    while (next < lines.length && lines[next].trim() === '') next += 1
    const hasAnchor = next < lines.length && /^\s*<!--\s*section:\s*[A-Za-z0-9_-]+\s*-->\s*$/.test(lines[next])
    if (!hasAnchor) missing.push({ line: index + 1, heading: line.trim() })
  })
  return missing
}

/** Inline links, images and reference definitions outside code, as `{ line, target }`. */
export function extractLinks(text) {
  const links = []
  stripCode(text)
    .split('\n')
    .forEach((line, index) => {
      const lineNo = index + 1
      for (const match of line.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
        const raw = match[1]
        links.push({ line: lineNo, target: raw.startsWith('<') ? raw.slice(1, -1) : raw })
      }
      for (const match of line.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
        links.push({ line: lineNo, target: match[1] })
      }
      const ref = line.match(/^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/)
      if (ref) links.push({ line: lineNo, target: ref[1].startsWith('<') ? ref[1].slice(1, -1) : ref[1] })
    })
  return links
}

/**
 * Resolve a link found in `fromFile` to a repo-relative posix path (no anchor,
 * no query). External URLs and anchor-only links return null. A target that
 * escapes the repository keeps its leading `../`.
 */
export function resolveLinkTarget(fromFile, target) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('//')) return null
  const clean = target.split('#')[0].split('?')[0]
  if (clean === '') return null
  let decoded = clean
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    // keep the raw text when it is not valid percent-encoding
  }
  if (decoded.startsWith('/')) return path.posix.normalize(decoded.slice(1))
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), decoded))
}

/** True when `target` is a tracked file or the parent directory of one. */
export function isTrackedPathOrDir(files, target) {
  const normalized = path.posix.normalize(target).replace(/\/$/, '')
  if (normalized === '' || normalized === '.' || normalized.startsWith('..')) return false
  return files.some((file) => file === normalized || file.startsWith(`${normalized}/`))
}

/** Share of CJK unified ideographs among non-whitespace code points, ignoring code and link targets. */
export function cjkRatio(text) {
  const prose = stripCode(text).replace(/\]\([^)]*\)/g, ']')
  let total = 0
  let cjk = 0
  for (const char of prose) {
    if (/\s/u.test(char)) continue
    total += 1
    const cp = char.codePointAt(0)
    if (cp >= 0x4e00 && cp <= 0x9fff) cjk += 1
  }
  return total === 0 ? 0 : cjk / total
}

/** Text before the first level-two heading outside fences (the whole text when there is none). */
export function beforeFirstH2(text) {
  const lines = text.split('\n')
  const blanked = blankFencedBlocks(text).split('\n')
  const at = blanked.findIndex((line) => /^##\s/.test(line))
  return at === -1 ? text : lines.slice(0, at).join('\n')
}

/** First level-one heading outside fences, or null. */
export function firstH1(text) {
  for (const line of blankFencedBlocks(text).split('\n')) {
    const match = line.match(/^#\s+(.+?)\s*#*\s*$/)
    if (match) return match[1]
  }
  return null
}

function git(args, cwd = REPO) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout
}

/** `git ls-files` for the repository (or `cwd`). */
export function trackedFiles(cwd = REPO) {
  return git(['ls-files'], cwd).split('\n').filter(Boolean)
}

/** Index mode and blob text of a tracked path, or null when it is not in the index. */
export function indexEntry(file, cwd = REPO) {
  const staged = git(['ls-files', '-s', '--', file], cwd).trim()
  if (!staged) return null
  const [mode, hash] = staged.split(/\s+/)
  return { mode, hash, blob: git(['cat-file', 'blob', hash], cwd) }
}

/**
 * Body of the section introduced by `<!-- section: key -->`: every line after the
 * anchor up to (not including) the next level-2 heading outside fences, or the end
 * of the text. Returns null when the anchor is absent.
 */
export function sectionBody(text, key) {
  const lines = text.split('\n')
  const blanked = blankFencedBlocks(text).split('\n')
  const anchor = new RegExp(`^\\s*<!--\\s*section:\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-->\\s*$`)
  const start = blanked.findIndex((line) => anchor.test(line))
  if (start === -1) return null
  let end = blanked.findIndex((line, index) => index > start && /^##\s/.test(line))
  if (end === -1) end = lines.length
  return lines.slice(start + 1, end).join('\n')
}

/**
 * The fenced code block that immediately follows `<!-- fixture: name -->`.
 * Returns `{ line, info, content }` (1-based marker line, fence info string, block text)
 * or null when the marker is missing, is not directly followed by a fence, or the fence never closes.
 */
export function fixtureBlock(text, name) {
  const lines = text.split('\n')
  const blanked = blankFencedBlocks(text).split('\n')
  const marker = new RegExp(`^\\s*<!--\\s*fixture:\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-->\\s*$`)
  const at = blanked.findIndex((line) => marker.test(line))
  if (at === -1) return null
  let open = at + 1
  while (open < lines.length && lines[open].trim() === '') open += 1
  const opener = lines[open]?.match(FENCE_OPEN)
  if (!opener) return null
  const fence = opener[1]
  const info = lines[open].trim().slice(fence.length).trim()
  const body = []
  for (let i = open + 1; i < lines.length; i += 1) {
    const close = lines[i].match(FENCE_OPEN)
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length && lines[i].trim() === close[1]) {
      return { line: at + 1, info, content: body.join('\n') }
    }
    body.push(lines[i])
  }
  return null
}

/** First position where two section-key sequences differ, `{ index, left, right }`, or null when equal. */
export function anchorSequenceDiff(left, right) {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return { index, left: left[index] ?? null, right: right[index] ?? null }
  }
  return null
}
