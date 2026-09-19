import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  createLocusMediaPort,
  detectImageMediaType,
  parseSingleMessageResources,
  type LarkCliRunner,
} from '../src/host/channel/media.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])

function limits(overrides: Partial<Record<'maxImageBytes' | 'maxImagesPerMessage' | 'maxMessageImageBytes', number>> = {}) {
  return {
    maxImageBytes: overrides.maxImageBytes ?? 4096,
    maxImagesPerMessage: overrides.maxImagesPerMessage ?? 4,
    maxMessageImageBytes: overrides.maxMessageImageBytes ?? 8192,
    maxImagePixels: 1_000_000,
    maxImageDimension: 1_000,
    mediaTypes: ['image/png'] as const,
  }
}

function mget(content: string): LarkCliRunner {
  return vi.fn(async (_binary, args) => {
    expect(args).toContain('+messages-mget')
    return { stdout: JSON.stringify({
      ok: true,
      data: { messages: [{ message_id: 'om_a', msg_type: 'post', content }] },
    }) }
  })
}

async function fakeDownloader(): Promise<{ root: string; binary: string; started: string; escaped: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-fd-downloader-'))
  const binary = join(root, 'fake-downloader.mjs')
  const started = join(root, 'started')
  const escaped = join(root, 'escaped')
  await writeFile(binary, `#!/usr/bin/env node
import { closeSync, writeFileSync, writeSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
const value = flag => args[args.indexOf(flag) + 1]
if (!args.includes('+messages-resources-download')) process.exit(90)
if (value('--output-fd') !== '3') process.exit(91)
const max = Number(value('--max-bytes'))
if (!Number.isSafeInteger(max) || max < 1) process.exit(92)
const key = value('--file-key')
const root = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(root, 'started'), key)
if (key === 'img_abort' || key === 'img_timeout') {
  spawn(process.execPath, ['-e', ${JSON.stringify("setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'escaped'), 350)")}, join(root, 'escaped')], { stdio: 'ignore' })
  setInterval(() => {}, 1000)
} else {
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,key === 'img_b' ? 2 : 1])
  const data = key === 'img_over' ? Buffer.alloc(max + 1, 1) : key === 'img_fake' ? Buffer.from([1,2,3]) : png
  writeSync(3, data)
  closeSync(3)
  process.stdout.write(JSON.stringify({ output_fd: 3, size_bytes: key === 'img_badreceipt' ? data.length + 1 : data.length, content_type: 'image/png' }))
}
`, { mode: 0o700 })
  await chmod(binary, 0o700)
  return { root, binary, started, escaped }
}

function attachments(imageLimits = limits()) {
  const saveImages = vi.fn(async (items: readonly { data: Uint8Array; mediaType: string }[]) =>
    items.map((item, index) => ({
      attachmentId: `attachment-${String(index)}` as never,
      mediaType: item.mediaType,
      bytes: item.data.byteLength,
      width: 1,
      height: 1,
    })))
  return { saveImages, store: { imageLimits, saveImages } as never }
}

describe('Host-owned locus media over patched inherited fd', () => {
  it('parses exactly one returned message and preserves unique image occurrence order', () => {
    expect(parseSingleMessageResources({
      ok: true,
      data: { messages: [{ message_id: 'om_a', msg_type: 'post', content: '![Image](img_b) x ![Image](img_a) ![Image](img_b)' }] },
    }, 'om_a').imageKeys).toEqual(['img_b', 'img_a'])
    expect(() => parseSingleMessageResources({ ok: true, data: { messages: [] } }, 'om_a')).toThrow('mget-message-not-unique')
    expect(() => parseSingleMessageResources({ ok: true, data: { messages: [{ message_id: 'om_b', content: '' }] } }, 'om_a')).toThrow('mget-message-mismatch')
  })

  it('keeps bounded non-image metadata without downloading it', () => {
    const parsed = parseSingleMessageResources({
      ok: true,
      data: { messages: [{ message_id: 'om_a', msg_type: 'post', content: '<file key="file_report" name="report.pdf"/>' }] },
    }, 'om_a')
    expect(parsed.imageKeys).toEqual([])
    expect(parsed.unsupported).toEqual([{ kind: 'file', name: 'report.pdf' }])
  })

  it('uses magic bytes rather than names or declared MIME', () => {
    expect(detectImageMediaType(PNG)).toBe('image/png')
    expect(detectImageMediaType(new Uint8Array([1, 2, 3]))).toBeUndefined()
  })

  it('is unavailable with zero side effects when the compat binary capability is absent', async () => {
    const runner = vi.fn<LarkCliRunner>(async () => { throw new Error('must not run') })
    const { store, saveImages } = attachments()
    const fenceBeforeSave = vi.fn(async () => true)
    const port = createLocusMediaPort({ attachments: store, runner })

    expect(port.available).toBe(false)
    expect(port.diagnostic).toBe('bounded-fd-media-download-unavailable')
    await expect(port.admitCurrentImage({
      messageId: 'host-fixed-message',
      signal: new AbortController().signal,
      fenceBeforeSave,
    })).resolves.toEqual({
      kind: 'unavailable',
      reason: 'bounded-fd-media-download-unavailable',
      content: [],
    })
    expect(runner).not.toHaveBeenCalled()
    expect(saveImages).not.toHaveBeenCalled()
    expect(fenceBeforeSave).not.toHaveBeenCalled()
  })

  it.runIf(process.platform !== 'win32')('uses real fd 3 downloads and batch-saves multiple images in occurrence order', async () => {
    const fake = await fakeDownloader()
    const { store, saveImages } = attachments()
    const port = createLocusMediaPort({
      attachments: store,
      download: { binary: fake.binary, supportsBoundedFdDownload: true, upstreamVersion: '1.0.94' },
      runner: mget('![Image](img_b) ![Image](img_a)'),
    })
    try {
      const result = await port.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true,
      })
      expect(result.kind).toBe('ready')
      expect(result.content.map(block => block.type)).toEqual(['image', 'image'])
      expect(saveImages).toHaveBeenCalledTimes(1)
      const saved = saveImages.mock.calls[0]?.[0]
      expect(saved?.map(item => item.data.at(-1))).toEqual([2, 1])
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')('kills the entire downloader process group immediately on fd over-limit', async () => {
    const fake = await fakeDownloader()
    const { store, saveImages } = attachments(limits({ maxImageBytes: 32, maxMessageImageBytes: 32 }))
    const port = createLocusMediaPort({
      attachments: store,
      download: { binary: fake.binary, supportsBoundedFdDownload: true, upstreamVersion: '1.0.94' },
      runner: mget('![Image](img_over)'),
    })
    try {
      const result = await port.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true,
      })
      expect(result.kind).toBe('unavailable')
      expect(saveImages).not.toHaveBeenCalled()
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')('abort kills the downloader and descendants and never saves', async () => {
    const fake = await fakeDownloader()
    const { store, saveImages } = attachments()
    const controller = new AbortController()
    const port = createLocusMediaPort({
      attachments: store,
      download: { binary: fake.binary, supportsBoundedFdDownload: true, upstreamVersion: '1.0.94' },
      runner: mget('![Image](img_abort)'),
      timeoutMs: 2_000,
    })
    try {
      const pending = port.admitCurrentImage({ messageId: 'om_a', signal: controller.signal, fenceBeforeSave: async () => true })
      for (let index = 0; index < 100; index += 1) {
        try { await access(fake.started); break } catch { await delay(5) }
      }
      controller.abort()
      await expect(pending).resolves.toMatchObject({ kind: 'unavailable', reason: 'aborted' })
      await delay(450)
      await expect(access(fake.escaped)).rejects.toBeDefined()
      expect(saveImages).not.toHaveBeenCalled()
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')('timeout kills the downloader and descendants and never saves', async () => {
    const fake = await fakeDownloader()
    const { store, saveImages } = attachments()
    const port = createLocusMediaPort({
      attachments: store,
      download: { binary: fake.binary, supportsBoundedFdDownload: true, upstreamVersion: '1.0.94' },
      runner: mget('![Image](img_timeout)'),
      timeoutMs: 50,
    })
    try {
      await expect(port.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true,
      })).resolves.toMatchObject({ kind: 'unavailable', reason: 'timeout' })
      await delay(450)
      await expect(access(fake.escaped)).rejects.toBeDefined()
      expect(saveImages).not.toHaveBeenCalled()
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')('rejects a stdout receipt whose size disagrees with fd 3 bytes', async () => {
    const fake = await fakeDownloader()
    const { store, saveImages } = attachments()
    const port = createLocusMediaPort({
      attachments: store,
      download: { binary: fake.binary, supportsBoundedFdDownload: true, upstreamVersion: '1.0.94' },
      runner: mget('![Image](img_badreceipt)'),
    })
    try {
      expect((await port.admitCurrentImage({ messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true })).kind).toBe('unavailable')
      expect(saveImages).not.toHaveBeenCalled()
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform !== 'win32')('rejects fake MIME and stale current without saving', async () => {
    const fake = await fakeDownloader()
    try {
      const mimeAttachments = attachments()
      const mime = createLocusMediaPort({
        attachments: mimeAttachments.store,
        download: { binary: fake.binary, supportsBoundedFdDownload: true, upstreamVersion: '1.0.94' },
        runner: mget('![Image](img_fake)'),
      })
      expect((await mime.admitCurrentImage({ messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true })).kind).toBe('unavailable')
      expect(mimeAttachments.saveImages).not.toHaveBeenCalled()

      const staleAttachments = attachments()
      const stale = createLocusMediaPort({
        attachments: staleAttachments.store,
        download: { binary: fake.binary, supportsBoundedFdDownload: true, upstreamVersion: '1.0.94' },
        runner: mget('![Image](img_a)'),
      })
      expect((await stale.admitCurrentImage({ messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => false })).reason).toBe('stale-delivery')
      expect(staleAttachments.saveImages).not.toHaveBeenCalled()
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it('contains no named cache, output path, or cross-agent readable file seam', async () => {
    const source = await readFile(new URL('../src/host/channel/media.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('cacheRoot')
    expect(source).not.toContain('mkdtemp')
    expect(source).not.toContain("'--output'")
    expect(source).toContain("'--output-fd', '3'")
  })
})
