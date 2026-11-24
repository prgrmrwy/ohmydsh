/**
 * Streaming HTML injection (design D6).
 *
 * The inline script goes right after the leading BOM, whitespace, doctype and
 * comments and before whatever follows (tag or text), so it is the first element
 * of the implicit <head> and runs before every page script, including scripts
 * written before <html>/<head>. Only HTML *lexing* of that prefix is needed, not
 * a parser; comments end exactly where the HTML tokenizer ends them. If the content
 * ends after the skippable prefix the script is appended there; if it ends INSIDE an
 * unterminated comment/doctype the script goes before that token (never into it).
 *
 * Streaming: bytes are forwarded as soon as the insertion point is known; only an
 * unfinished leading token (partial `<!--`, doctype, comment) is held back.
 */
import { Transform } from 'node:stream'
import type { TransformCallback } from 'node:stream'

/** Hold back at most this much of an unterminated leading token; beyond it insert before that token. */
export const MAX_HELD_BYTES = 256 * 1024

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const isSpace = (byte: number): boolean => byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d

/**
 * End (exclusive) of the comment whose `<!--` starts at `start`, following the HTML tokenizer:
 * `<!-->` and `<!--->` close it at once (abrupt closing of an empty comment), otherwise the first
 * `-->` or `--!>` does. -1 when the comment is not (yet) closed in `buf`.
 */
function endOfComment(buf: Buffer, start: number): number {
  const at = start + 4
  if (at >= buf.length) return -1
  if (buf[at] === 0x3e /* > */) return at + 1
  if (buf[at] === 0x2d /* - */) {
    if (at + 1 >= buf.length) return -1
    if (buf[at + 1] === 0x3e) return at + 2
  }
  const plain = buf.indexOf('-->', at, 'latin1')
  const bang = buf.indexOf('--!>', at, 'latin1')
  if (plain === -1 && bang === -1) return -1
  return plain !== -1 && (bang === -1 || plain < bang) ? plain + 3 : bang + 4
}

export type Scan =
  /** Insert at `index`. */
  | { kind: 'insert'; index: number }
  /** Undecided; everything before `safe` is final skippable prefix and may be emitted now. */
  | { kind: 'more'; safe: number }

/**
 * Locate the insertion point in `buf` (the not-yet-decided stream start).
 * @param final - no more bytes will follow.
 */
export function scanInsertionPoint(buf: Buffer, final: boolean): Scan {
  let i = 0
  if (buf.length >= 3 && buf.subarray(0, 3).equals(BOM)) i = 3
  else if (!final && buf.length < 3 && BOM.subarray(0, buf.length).equals(buf)) return { kind: 'more', safe: 0 }
  for (;;) {
    while (i < buf.length && isSpace(buf[i] as number)) i += 1
    if (i >= buf.length) return final ? { kind: 'insert', index: buf.length } : { kind: 'more', safe: i }
    if (buf[i] !== 0x3c /* < */) return { kind: 'insert', index: i }
    const head = buf.subarray(i, i + 9).toString('latin1').toLowerCase()
    if (head.startsWith('<!--')) {
      const end = endOfComment(buf, i)
      // Unterminated at EOF: the browser swallows the rest as comment, so insert BEFORE the token, never inside it.
      if (end === -1) return final ? { kind: 'insert', index: i } : { kind: 'more', safe: i }
      i = end
      continue
    }
    if (head === '<!doctype') {
      const end = buf.indexOf(0x3e /* > */, i + 9)
      if (end === -1) return final ? { kind: 'insert', index: i } : { kind: 'more', safe: i }
      i = end + 1
      continue
    }
    // A token that might still become `<!--` or `<!doctype`: wait for more bytes.
    if (!final && head.length < 9 && ('<!doctype'.startsWith(head) || '<!--'.startsWith(head))) return { kind: 'more', safe: i }
    return { kind: 'insert', index: i }
  }
}

/** Insert `markup` into a complete document (used for synthesized pages). */
export function injectIntoDocument(html: Buffer, markup: Buffer): Buffer {
  const scan = scanInsertionPoint(html, true)
  const index = scan.kind === 'insert' ? scan.index : html.length
  return Buffer.concat([html.subarray(0, index), markup, html.subarray(index)])
}

export class HtmlInjector extends Transform {
  private held: Buffer = Buffer.alloc(0)
  private decided = false

  constructor(private readonly markup: Buffer) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (this.decided) {
      callback(null, chunk)
      return
    }
    this.held = this.held.length === 0 ? chunk : Buffer.concat([this.held, chunk])
    const scan = scanInsertionPoint(this.held, false)
    if (scan.kind === 'insert') {
      this.finish(scan.index)
    } else if (this.held.length > MAX_HELD_BYTES) {
      this.finish(scan.safe)
    } else if (scan.safe > 0) {
      this.push(this.held.subarray(0, scan.safe))
      this.held = this.held.subarray(scan.safe)
    }
    callback()
  }

  override _flush(callback: TransformCallback): void {
    if (!this.decided) {
      const scan = scanInsertionPoint(this.held, true)
      this.finish(scan.kind === 'insert' ? scan.index : this.held.length)
    }
    callback()
  }

  private finish(index: number): void {
    this.decided = true
    this.push(this.held.subarray(0, index))
    this.push(this.markup)
    this.push(this.held.subarray(index))
    this.held = Buffer.alloc(0)
  }
}
