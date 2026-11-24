import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { HtmlInjector, MAX_HELD_BYTES, injectIntoDocument, scanInsertionPoint } from '../src/host/html-inject.js'

/**
 * Regression for implementation-review M1: the injection point scanner must end a leading comment exactly
 * where the HTML tokenizer does (`-->`, `--!>`, and the abrupt closes `<!-->` / `<!--->`), otherwise page
 * scripts run before the injected one. Extra (non-ledger) tests of the spec's HTML 注入 requirement.
 */

const MARKUP = `<script>(window.__order = window.__order || []).push('inject')</script>`
const PAGE = `<script>(window.__order = window.__order || []).push('page')</script>`

/** Leading comment forms the HTML tokenizer terminates, with the number of chars they occupy. */
const COMMENTS: Array<[label: string, comment: string]> = [
  ['normal', '<!-- ok -->'],
  ['abrupt close <!-->', '<!-->'],
  ['abrupt close <!--->', '<!--->'],
  ['empty <!---->', '<!---->'],
  ['bang end --!>', '<!-- x --!>'],
  ['bang then normal end', '<!-- a --!-->'],
  ['triple dash end --->', '<!-- a --->'],
  ['markup inside', '<!-- <script>no</script> <!-- nested --> '.trimEnd()],
  ['markup inside, bang end', '<!-- <script>no</script> --!>'],
]

/** Execution order of inline scripts when the browser-grade parser (jsdom/parse5) loads `html`. */
function executionOrder(html: string): string[] {
  const dom = new JSDOM(html, { runScripts: 'dangerously' })
  return (dom.window as unknown as { __order?: string[] }).__order ?? []
}

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8')
const inject = (html: string): string => injectIntoDocument(bytes(html), bytes(MARKUP)).toString('utf8')

describe('scanInsertionPoint: comment termination follows the HTML tokenizer', () => {
  it.each(COMMENTS)('%s', (_label, comment) => {
    const doc = `<!doctype html>${comment}<html><head></head>${PAGE}</html>`
    const at = scanInsertionPoint(bytes(doc), true)
    expect(at).toEqual({ kind: 'insert', index: `<!doctype html>${comment}`.length })
  })

  it.each(COMMENTS)('%s: injected script runs before the page script in a real HTML parser', (_label, comment) => {
    // Positive control for the oracle itself: the parser agrees the comment ended (page script ran, once).
    expect(executionOrder(`${comment}${PAGE}`)).toEqual(['page'])
    expect(executionOrder(inject(`${comment}${PAGE}`))).toEqual(['inject', 'page'])
    expect(executionOrder(inject(`<!doctype html>${comment}${PAGE}`))).toEqual(['inject', 'page'])
    expect(executionOrder(inject(`\uFEFF \n${comment}\n${PAGE}`))).toEqual(['inject', 'page'])
  })

  it('an unterminated comment: injected script is placed BEFORE it, not swallowed by it', () => {
    const doc = `<!doctype html><!-- never closed ${PAGE}`
    expect(scanInsertionPoint(bytes(doc), true)).toEqual({ kind: 'insert', index: '<!doctype html>'.length })
    // The comment swallows the page script in the browser too; the injected one must still run.
    expect(executionOrder(inject(doc))).toEqual(['inject'])
    // Also the abrupt-close lookalikes that are NOT terminators yet while streaming.
    expect(scanInsertionPoint(bytes('<!--'), false)).toEqual({ kind: 'more', safe: 0 })
    expect(scanInsertionPoint(bytes('<!---'), false)).toEqual({ kind: 'more', safe: 0 })
    expect(scanInsertionPoint(bytes('<!-- x --!'), false)).toEqual({ kind: 'more', safe: 0 })
  })

  it('an unterminated doctype is also never appended inside itself', () => {
    expect(scanInsertionPoint(bytes('<!doctype html'), true)).toEqual({ kind: 'insert', index: 0 })
  })

  it('comment-lookalikes that are not leading comments do not move the insertion point', () => {
    expect(scanInsertionPoint(bytes('<!x><p>'), true)).toEqual({ kind: 'insert', index: 0 })
    expect(scanInsertionPoint(bytes('<!-- a --> <b><!-->'), true)).toEqual({ kind: 'insert', index: '<!-- a --> '.length })
  })
})

describe('HtmlInjector (streaming) equals the one-shot result at every chunk boundary — for inputs below the 256 KiB hold limit', () => {
  // Scope: the equality holds only while no leading token needs more than MAX_HELD_BYTES of buffering. Beyond
  // that the bounded fallback legitimately inserts earlier than a one-shot pass would; see the next describe.
  const docs = [
    ...COMMENTS.map(([, comment]) => `<!doctype html>${comment}<html>${PAGE}</html>`),
    ...COMMENTS.map(([, comment]) => `\uFEFF ${comment} ${PAGE}`),
    '<!doctype html><!-- never closed',
    '<!doctype html',
    '<!doctype html> <!-- a --> ',
    'plain text',
    '',
  ]

  async function stream(doc: string, split: number[]): Promise<string> {
    const injector = new HtmlInjector(bytes(MARKUP))
    const out: Buffer[] = []
    injector.on('data', (chunk: Buffer) => out.push(chunk))
    const whole = bytes(doc)
    let from = 0
    for (const at of [...split, whole.length]) {
      if (at > from) injector.write(whole.subarray(from, at))
      from = at
    }
    await new Promise<void>((resolve) => { injector.on('end', () => resolve()); injector.end() })
    return Buffer.concat(out).toString('utf8')
  }

  it.each(docs.map((doc, i) => [i, doc] as const))('doc #%i', async (_i, doc) => {
    expect(bytes(doc).length).toBeLessThan(MAX_HELD_BYTES)
    const expected = inject(doc)
    const length = bytes(doc).length
    for (let cut = 0; cut <= length; cut++) expect(await stream(doc, [cut])).toBe(expected)
    // One byte per chunk.
    expect(await stream(doc, Array.from({ length }, (_, k) => k + 1))).toBe(expected)
  })
})

describe('bounded fallback: an unterminated leading comment is buffered at most 256 KiB (extra)', () => {
  const REST = `-->${PAGE}`

  /** Feed `prefix` in one write; return what was emitted before any further input, and the final output. */
  async function feed(prefix: string): Promise<{ early: string; final: string }> {
    const injector = new HtmlInjector(bytes(MARKUP))
    const out: Buffer[] = []
    injector.on('data', (chunk: Buffer) => out.push(chunk))
    injector.write(bytes(prefix))
    await new Promise((resolve) => setImmediate(resolve))
    const early = Buffer.concat(out).toString('utf8')
    await new Promise<void>((resolve) => { injector.on('end', () => resolve()); injector.end(bytes(REST)) })
    return { early, final: Buffer.concat(out).toString('utf8') }
  }

  // Held bytes after the write are exactly the prefix length (the comment start `<!--` is not skippable until closed).
  it.each([
    ['MAX - 1', MAX_HELD_BYTES - 1, false],
    ['MAX', MAX_HELD_BYTES, false],
    ['MAX + 1', MAX_HELD_BYTES + 1, true],
  ])('%s bytes held: fallback fires only above the limit', async (_label, size, fires) => {
    const prefix = `<!--${'x'.repeat(size - 4)}`
    expect(bytes(prefix).length).toBe(size)
    const { early, final } = await feed(prefix)
    if (fires) {
      // Emitted while the comment is still unfinished, injected script BEFORE `<!--`.
      expect(early.startsWith(MARKUP)).toBe(true)
      expect(early.slice(MARKUP.length, MARKUP.length + 4)).toBe('<!--')
      expect(final).toBe(`${MARKUP}${prefix}${REST}`)
    } else {
      // Still undecided: nothing emitted yet (the comment may still turn out to end).
      expect(early).toBe('')
      // Once the comment closes the injection lands AFTER it, right before the page script.
      expect(final).toBe(`${prefix}-->${MARKUP}${PAGE}`)
    }
  })

  it('above the limit the streamed and the one-shot byte positions differ, yet both run the injection first', async () => {
    const prefix = `<!--${'x'.repeat(MAX_HELD_BYTES)}`
    const oneShot = inject(`${prefix}${REST}`) // knows the comment closes: injection right before the page script
    const { final: streamed } = await feed(prefix)
    expect(oneShot.indexOf(MARKUP)).toBeGreaterThan(MAX_HELD_BYTES)
    expect(streamed.indexOf(MARKUP)).toBe(0)
    expect(streamed).not.toBe(oneShot)
    expect(executionOrder(oneShot)).toEqual(['inject', 'page'])
    expect(executionOrder(streamed)).toEqual(['inject', 'page'])
  })

  it('an over-limit comment that never closes before EOF, arriving in chunks: early output, one injection, body intact, injection runs (extra)', async () => {
    const body = `<!--${'x'.repeat(300_000)}${PAGE} still no end`
    const whole = bytes(body)
    const CHUNK = 100_000 // arrives 100 k, 200 k, then 300 k: the third chunk takes the held bytes past 256 KiB
    const injector = new HtmlInjector(bytes(MARKUP))
    const out: Buffer[] = []
    injector.on('data', (chunk: Buffer) => out.push(chunk))
    const emitted = (): string => Buffer.concat(out).toString('utf8')
    const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

    injector.write(whole.subarray(0, CHUNK))
    await tick()
    expect(emitted()).toBe('') // 100 k held: still undecided
    injector.write(whole.subarray(CHUNK, 2 * CHUNK))
    await tick()
    expect(emitted()).toBe('') // 200 k held: below the limit
    injector.write(whole.subarray(2 * CHUNK, 3 * CHUNK))
    await tick()
    // The chunk that crossed the limit produced output at once — no waiting for EOF — and it starts with the injection.
    expect(Buffer.byteLength(emitted())).toBeGreaterThan(0)
    expect(emitted().startsWith(MARKUP)).toBe(true)
    expect(emitted().slice(MARKUP.length, MARKUP.length + 4)).toBe('<!--')
    // Everything after that streams straight through, chunk by chunk.
    const before = Buffer.byteLength(emitted())
    injector.write(whole.subarray(3 * CHUNK))
    await tick()
    expect(Buffer.byteLength(emitted())).toBeGreaterThan(before)
    await new Promise<void>((resolve) => { injector.on('end', () => resolve()); injector.end() })

    const final = emitted()
    expect(final.split(MARKUP)).toHaveLength(2) // injected exactly once
    expect(final.startsWith(MARKUP)).toBe(true)
    expect(final.slice(MARKUP.length)).toBe(body) // comment body byte-for-byte, nothing appended at EOF
    // A browser-grade parser runs the injection (it sits before `<!--`); the page script is inside the comment.
    expect(executionOrder(final)).toEqual(['inject'])
  })
})
