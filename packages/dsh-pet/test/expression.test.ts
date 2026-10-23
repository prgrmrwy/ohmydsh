/**
 * Mascot expression validation and file store.
 *
 * The validator is the only thing between an owner-pasted JSON graph and the
 * renderer, so these tests pin the security boundary (resource references,
 * precomp expansion, cycles) as well as the file lifecycle (atomic replace,
 * backup, corrupt read). Real temporary directories are used: the store's job
 * is filesystem semantics, not an in-memory abstraction of them.
 */

import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  EXPRESSION_BACKUP,
  EXPRESSION_FILE,
  readExpression,
  removeExpression,
  saveExpression,
  validateLottieSource,
} from '../src/host/expression.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from '../src/host/paths.js'
import { PetError } from '../src/host/errors.js'
import { MAX_EXPRESSION_LAYERS } from '../src/wire.js'

let paths: PetPaths

beforeEach(async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'pet-expression-'))
  paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
})

/** Minimal valid Lottie source; overrides are merged into the root object. */
function source(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: '5.7.0',
    w: 100,
    h: 100,
    layers: [{ ty: 4, shapes: [] }],
    ...overrides,
  })
}

/** Assert `text` is rejected as an expression (not as a request error). */
function expectRejected(text: string): void {
  try {
    validateLottieSource(text)
  } catch (error) {
    expect(error).toBeInstanceOf(PetError)
    expect((error as PetError).code).toBe('INVALID_EXPRESSION')
    return
  }
  throw new Error('expected INVALID_EXPRESSION')
}

/** A valid 1x1 PNG data URI. */
const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('single-file persistence', () => {
  it('saves the source and reads it back verbatim', async () => {
    const text = source()
    const saved = await saveExpression(paths, text)

    expect(saved.bytes).toBe(Buffer.byteLength(text, 'utf8'))
    expect(await readFile(path.join(paths.expressionsRoot, EXPRESSION_FILE), 'utf8')).toBe(text)

    const view = await readExpression(paths)
    expect(view).toMatchObject({ state: 'ok', content: text, bytes: saved.bytes })
  })

  it('reads none when no expression exists', async () => {
    await expect(readExpression(paths)).resolves.toEqual({ state: 'none' })
  })

  it('keeps leading and trailing whitespace byte for byte', async () => {
    const text = `\n  ${source()}  \n`
    await saveExpression(paths, text)
    const view = await readExpression(paths)
    expect(view.state).toBe('ok')
    if (view.state !== 'ok') return
    expect(view.content).toBe(text)
    expect(view.bytes).toBe(Buffer.byteLength(text, 'utf8'))
  })

  it('replaces the active source without creating a backup', async () => {
    await saveExpression(paths, source())
    const next = source({ w: 128, h: 128 })
    await saveExpression(paths, next)

    const view = await readExpression(paths)
    expect(view.state === 'ok' ? view.content : undefined).toBe(next)
    await expect(stat(path.join(paths.expressionsRoot, EXPRESSION_BACKUP))).rejects.toThrow()
  })

  it('removes to a backup and stays idempotent', async () => {
    const text = source()
    await saveExpression(paths, text)

    await removeExpression(paths)
    await removeExpression(paths)

    const backup = await readFile(path.join(paths.expressionsRoot, EXPRESSION_BACKUP), 'utf8')
    expect(backup).toBe(text)
    await expect(readExpression(paths)).resolves.toEqual({ state: 'none' })
  })

  it('reports corrupt instead of throwing for broken or oversized files', async () => {
    const active = path.join(paths.expressionsRoot, EXPRESSION_FILE)
    await writeFile(active, '{not json', 'utf8')
    const broken = await readExpression(paths)
    expect(broken.state).toBe('corrupt')

    await writeFile(active, 'x'.repeat(513 * 1024), 'utf8')
    const oversized = await readExpression(paths)
    expect(oversized.state).toBe('corrupt')
    if (oversized.state !== 'corrupt') return
    expect(oversized.diagnostic).toMatch(/上限/)
  })
})

describe('JSON and composition shape', () => {
  it('accepts a minimal valid composition', () => {
    expect(() => validateLottieSource(source())).not.toThrow()
  })

  it('rejects invalid JSON, non-object roots and missing v', () => {
    expectRejected('{')
    expectRejected('[]')
    expectRejected(JSON.stringify({ w: 1, h: 1, layers: [{ ty: 4 }] }))
  })

  it('rejects missing layers and layers without a numeric type', () => {
    expectRejected(JSON.stringify({ v: '5.0.0', w: 1, h: 1 }))
    expectRejected(JSON.stringify({ v: '5.0.0', w: 1, h: 1, layers: [] }))
    expectRejected(JSON.stringify({ v: '5.0.0', w: 1, h: 1, layers: [{}] }))
    expectRejected(JSON.stringify({ v: '5.0.0', w: 1, h: 1, layers: [{ ty: '4' }] }))
  })

  it('rejects unusable declared dimensions', () => {
    for (const w of [0, -1, 2049, '100']) {
      expectRejected(source({ w }))
    }
  })

  it('rejects a source that cannot survive a UTF-8 round trip', () => {
    // A lone surrogate is replaced by U+FFFD when encoded, so the stored bytes
    // could never equal what the owner pasted.
    expectRejected(`{"v":"5.0.0","w":1,"h":1,"layers":[{"ty":4}],"x":"\ud800"}`)
  })

  it('rejects non-array assets and non-object entries', () => {
    expectRejected(source({ assets: {} }))
    expectRejected(source({ assets: [42] }))
    expectRejected(source({ assets: [{ p: '' }] }))
  })
})

describe('resource references', () => {
  it('rejects remote, protocol-relative, relative and non-string asset references', () => {
    for (const p of ['https://evil.example/x.png', '//evil.example/x.png', '../x.png', 42, ['x']]) {
      expectRejected(source({ assets: [{ id: 'image_0', p, u: '' }] }))
    }
  })

  it('allows only decodable embedded bitmap data URIs', () => {
    expect(() =>
      validateLottieSource(source({ assets: [{ id: 'image_0', p: PNG_DATA_URI, u: '' }] })),
    ).not.toThrow()

    expectRejected(
      source({
        assets: [
          {
            id: 'image_0',
            p: 'data:image/svg+xml;base64,PHN2Zy8+',
            u: '',
          },
        ],
      }),
    )
    expectRejected(source({ assets: [{ id: 'image_0', p: 'data:image/png;base64,', u: '' }] }))
    expectRejected(
      source({
        assets: [
          {
            id: 'image_0',
            // Valid base64 but GIF magic bytes under a PNG MIME type.
            p: 'data:image/png;base64,R0lGODlhAQABAAAAACw=',
            u: '',
          },
        ],
      }),
    )
  })

  it('rejects remote fonts and unsafe font families', () => {
    expectRejected(source({ fonts: { list: [{ fFamily: 'Safe', fPath: 'https://evil/x.woff2' }] } }))
    expectRejected(source({ fonts: { list: [{ fFamily: 'x";}body{color:red}' }] } }))
    expect(() => validateLottieSource(source({ fonts: { list: [{ fFamily: 'Noto Sans' }] } }))).not.toThrow()
  })
})

describe('precomp expansion', () => {
  /** Build a chain where each precomp references the next twice. */
  function exponential(): { assets: unknown[]; layers: unknown[] } {
    const assets = []
    const chain = 20
    for (let index = 0; index < chain; index += 1) {
      assets.push({
        id: `c${index}`,
        w: 100,
        h: 100,
        layers:
          index === chain - 1
            ? [{ ty: 0 }]
            : [
                { ty: 0, refId: `c${index + 1}` },
                { ty: 0, refId: `c${index + 1}` },
              ],
      })
    }
    return { assets, layers: [{ ty: 0, refId: 'c0' }] }
  }

  it('counts nested precomp layers and dimensions recursively', () => {
    const ok = source({
      layers: [{ ty: 0, refId: 'c0' }],
      assets: [
        { id: 'c0', w: 200, h: 200, layers: [{ ty: 4 }, { ty: 0, refId: 'c1' }] },
        { id: 'c1', w: 100, h: 100, layers: [{ ty: 4 }] },
      ],
    })
    expect(() => validateLottieSource(ok)).not.toThrow()

    const tooWide = source({
      layers: [{ ty: 0, refId: 'c0' }],
      assets: [{ id: 'c0', w: 4096, h: 100, layers: [{ ty: 4 }] }],
    })
    expectRejected(tooWide)
  })

  it('expands refId precomps and rejects cycles or exponential blowup', () => {
    const blowup = exponential()
    expect(blowup).toBeDefined()
    expectRejected(source({ assets: blowup.assets, layers: blowup.layers }))

    const cyclic = source({
      layers: [{ ty: 0, refId: 'a' }],
      assets: [
        { id: 'a', w: 10, h: 10, layers: [{ ty: 0, refId: 'b' }] },
        { id: 'b', w: 10, h: 10, layers: [{ ty: 0, refId: 'a' }] },
      ],
    })
    expectRejected(cyclic)

    const unknownRef = source({ layers: [{ ty: 0, refId: 'missing' }] })
    expectRejected(unknownRef)
  })

  it('rejects precomp reference chains deeper than the cap', () => {
    const assets: unknown[] = []
    for (let index = 0; index < 33; index += 1) {
      assets.push({
        id: `d${index}`,
        w: 100,
        h: 100,
        layers: index === 32 ? [{ ty: 4 }] : [{ ty: 0, refId: `d${index + 1}` }],
      })
    }
    expectRejected(source({ layers: [{ ty: 0, refId: 'd0' }], assets }))
  })

  it('resolves refId by layer type and rejects type mismatches', () => {
    // Image layer referencing an embedded bitmap asset is the supported shape.
    const imageLayer = source({
      layers: [{ ty: 2, refId: 'image_0' }],
      assets: [{ id: 'image_0', p: PNG_DATA_URI, u: '' }],
    })
    expect(() => validateLottieSource(imageLayer)).not.toThrow()

    // A precomp layer may not point at an image asset …
    expectRejected(
      source({
        layers: [{ ty: 0, refId: 'image_0' }],
        assets: [{ id: 'image_0', p: PNG_DATA_URI, u: '' }],
      }),
    )
    // … and an image layer may not point at a precomp.
    expectRejected(
      source({
        layers: [{ ty: 2, refId: 'c0' }],
        assets: [{ id: 'c0', w: 10, h: 10, layers: [{ ty: 4 }] }],
      }),
    )
    // Only precomp/image layer types may carry a refId at all.
    expectRejected(
      source({
        layers: [{ ty: 4, refId: 'c0' }],
        assets: [{ id: 'c0', w: 10, h: 10, layers: [{ ty: 4 }] }],
      }),
    )
  })

  it('accepts a valid two-layer precomp', () => {
    expect(() =>
      validateLottieSource(
        source({
          layers: [{ ty: 0, refId: 'c0' }],
          assets: [{ id: 'c0', w: 100, h: 100, layers: [{ ty: 4 }, { ty: 4 }] }],
        }),
      ),
    ).not.toThrow()
  })

  it('rejects more layers than the cap can render', () => {
    const layers = Array.from({ length: MAX_EXPRESSION_LAYERS + 1 }, () => ({ ty: 4 }))
    expectRejected(source({ layers }))
  })
})
