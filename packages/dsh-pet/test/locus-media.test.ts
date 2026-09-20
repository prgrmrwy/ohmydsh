import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { rm } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  createLocusMediaPort,
  detectImageMediaType,
  parseSingleMessageResources,
  sweepMediaSpool,
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

/**
 * A stand-in for the official CLI's path mode.
 *
 * It writes the name it was given through a temp file plus rename, exactly as
 * the real `FileIO().Save` does, so the spool sweeper is exercised against the
 * two entries one download can legitimately create.
 */
async function fakeCli(): Promise<{ root: string; spool: string; binary: string; started: string; escaped: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-spool-downloader-'))
  const spool = join(root, 'media-spool')
  await mkdir(spool)
  const binary = join(root, 'fake-lark-cli.mjs')
  const started = join(root, 'started')
  const escaped = join(root, 'escaped')
  await writeFile(binary, `#!/usr/bin/env node
import { renameSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
const value = flag => args[args.indexOf(flag) + 1]
const root = dirname(fileURLToPath(import.meta.url))
if (!args.includes('+messages-resources-download')) process.exit(90)
if (args.includes('--output-fd')) process.exit(91)
const output = value('--output')
if (typeof output !== 'string' || !output.startsWith('./')) process.exit(92)
const target = resolve(process.cwd(), output)
const key = value('--file-key')
const write = (data) => {
  const temp = target + '.tmp-' + process.pid
  writeFileSync(temp, data)
  renameSync(temp, target)
}
if (key === 'img_exit') process.exit(3)
if (key === 'img_slow' || key === 'img_abort' || key === 'img_timeout') {
  write(Buffer.from([0x89, 0x50]))
  // The real CLI saves atomically and does not promise a predictable temp
  // name, so the call must own its whole directory to prove cleanup.
  writeFileSync(join(process.cwd(), 'unpredictable-temp-name'), 'partial')
  spawn(process.execPath, ['-e', ${JSON.stringify("setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'escaped'), 350)")}, join(root, 'escaped')], { stdio: 'ignore' })
  setInterval(() => {}, 1000)
} else if (key === 'img_over') {
  // Grow past any limit the caller can pass and never exit: only the spool
  // measurement can stop this.
  const chunk = Buffer.alloc(64, 7)
  const timer = setInterval(() => { write(Buffer.concat(Array.from({ length: 4096 }, () => chunk))) }, 5)
  setInterval(() => {}, 1000)
  timer.unref?.()
} else {
  writeFileSync(join(root, 'started'), key)
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,key === 'img_b' ? 2 : 1])
  if (key === 'img_badname') {
    const other = target.replace(/\\.bin$/, '.png')
    writeFileSync(other, png)
    process.stdout.write(JSON.stringify({ ok: true, data: { saved_path: other, size_bytes: png.length } }))
    process.exit(0)
  }
  const data = key === 'img_fake' ? Buffer.from([1,2,3]) : png
  write(data)
  process.stdout.write(JSON.stringify({
    ok: true,
    data: { saved_path: target, size_bytes: key === 'img_badreceipt' ? data.length + 1 : data.length },
  }))
}
`, { mode: 0o700 })
  return { root, spool, binary, started, escaped }
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

function downloader(binary: string, spoolRoot: string) {
  return { binary, pinnedVersion: '1.0.94' as const, spoolRoot }
}

describe('Host-owned locus media through the guarded spool', () => {
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

  it('is unavailable with zero side effects when the pinned CLI is absent or unpinned', async () => {
    const runner = vi.fn<LarkCliRunner>(async () => { throw new Error('must not run') })
    const { store, saveImages } = attachments()
    const fenceBeforeSave = vi.fn(async () => true)
    for (const download of [
      undefined,
      { binary: '', pinnedVersion: '1.0.94' as const, spoolRoot: '/tmp/spool' },
      { binary: 'lark-cli', pinnedVersion: '1.0.94' as const, spoolRoot: '  ' },
      { binary: 'lark-cli', pinnedVersion: '1.0.93' as never, spoolRoot: '/tmp/spool' },
    ]) {
      const port = createLocusMediaPort({ attachments: store, runner, ...(download === undefined ? {} : { download }) })
      expect(port.available).toBe(false)
      expect(port.diagnostic).toBe('pinned-cli-media-download-unavailable')
      await expect(port.admitCurrentImage({
        messageId: 'host-fixed-message',
        signal: new AbortController().signal,
        fenceBeforeSave,
      })).resolves.toEqual({
        kind: 'unavailable',
        reason: 'pinned-cli-media-download-unavailable',
        content: [],
      })
    }
    expect(runner).not.toHaveBeenCalled()
    expect(saveImages).not.toHaveBeenCalled()
    expect(fenceBeforeSave).not.toHaveBeenCalled()
  })

  it('downloads multiple images in occurrence order and leaves the spool empty', async () => {
    const fake = await fakeCli()
    const { store, saveImages } = attachments()
    const port = createLocusMediaPort({
      attachments: store,
      download: downloader(fake.binary, fake.spool),
      runner: mget('![Image](img_b) ![Image](img_a)'),
    })
    try {
      const result = await port.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true,
      })
      expect(result.kind).toBe('ready')
      expect(result.content.map(block => block.type)).toEqual(['image', 'image'])
      expect(saveImages).toHaveBeenCalledTimes(1)
      expect(saveImages.mock.calls[0]?.[0]?.map(item => item.data.at(-1))).toEqual([2, 1])
      expect(readdirSync(fake.spool)).toEqual([])
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it('kills the whole process group and leaves nothing when the download grows past the limit', async () => {
    const fake = await fakeCli()
    const { store, saveImages } = attachments(limits({ maxImageBytes: 64, maxMessageImageBytes: 64 }))
    const port = createLocusMediaPort({
      attachments: store,
      download: downloader(fake.binary, fake.spool),
      runner: mget('![Image](img_over)'),
      timeoutMs: 5_000,
    })
    try {
      const result = await port.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true,
      })
      expect(result.kind).toBe('unavailable')
      expect(saveImages).not.toHaveBeenCalled()
      expect(readdirSync(fake.spool)).toEqual([])
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it('abort kills the downloader, its descendants, and every spool entry', async () => {
    const fake = await fakeCli()
    const { store, saveImages } = attachments()
    const controller = new AbortController()
    const port = createLocusMediaPort({
      attachments: store,
      download: downloader(fake.binary, fake.spool),
      runner: mget('![Image](img_abort)'),
      timeoutMs: 3_000,
    })
    try {
      const pending = port.admitCurrentImage({ messageId: 'om_a', signal: controller.signal, fenceBeforeSave: async () => true })
      for (let index = 0; index < 100; index += 1) {
        try { await access(join(fake.spool, 'x')); break } catch { await delay(5) }
        if (readdirSync(fake.spool).length > 0) break
      }
      controller.abort()
      await expect(pending).resolves.toMatchObject({ kind: 'unavailable', reason: 'aborted' })
      await delay(450)
      await expect(access(fake.escaped)).rejects.toBeDefined()
      expect(readdirSync(fake.spool)).toEqual([])
      expect(saveImages).not.toHaveBeenCalled()
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it('timeout kills the downloader, its descendants, and every spool entry', async () => {
    const fake = await fakeCli()
    const { store, saveImages } = attachments()
    const port = createLocusMediaPort({
      attachments: store,
      download: downloader(fake.binary, fake.spool),
      runner: mget('![Image](img_timeout)'),
      timeoutMs: 60,
    })
    try {
      await expect(port.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true,
      })).resolves.toMatchObject({ kind: 'unavailable', reason: 'timeout' })
      await delay(450)
      await expect(access(fake.escaped)).rejects.toBeDefined()
      expect(readdirSync(fake.spool)).toEqual([])
      expect(saveImages).not.toHaveBeenCalled()
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it('refuses a receipt whose size or file name disagrees with what Pet asked for', async () => {
    const fake = await fakeCli()
    for (const key of ['img_badreceipt', 'img_badname']) {
      const { store, saveImages } = attachments()
      const port = createLocusMediaPort({
        attachments: store,
        download: downloader(fake.binary, fake.spool),
        runner: mget(`![Image](${key})`),
      })
      expect((await port.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true,
      })).kind, key).toBe('unavailable')
      expect(saveImages, key).not.toHaveBeenCalled()
      expect(readdirSync(fake.spool), key).toEqual([])
    }
    await rm(fake.root, { recursive: true, force: true })
  })

  it('refuses a non-zero CLI exit and a fake MIME without saving', async () => {
    const fake = await fakeCli()
    try {
      const exitAttachments = attachments()
      const exitPort = createLocusMediaPort({
        attachments: exitAttachments.store,
        download: downloader(fake.binary, fake.spool),
        runner: mget('![Image](img_exit)'),
      })
      expect((await exitPort.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true,
      })).kind).toBe('unavailable')
      expect(exitAttachments.saveImages).not.toHaveBeenCalled()

      const mimeAttachments = attachments()
      const mime = createLocusMediaPort({
        attachments: mimeAttachments.store,
        download: downloader(fake.binary, fake.spool),
        runner: mget('![Image](img_fake)'),
      })
      expect((await mime.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true,
      })).kind).toBe('unavailable')
      expect(mimeAttachments.saveImages).not.toHaveBeenCalled()

      const staleAttachments = attachments()
      const stale = createLocusMediaPort({
        attachments: staleAttachments.store,
        download: downloader(fake.binary, fake.spool),
        runner: mget('![Image](img_a)'),
      })
      expect((await stale.admitCurrentImage({
        messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => false,
      })).reason).toBe('stale-delivery')
      expect(staleAttachments.saveImages).not.toHaveBeenCalled()
      expect(readdirSync(fake.spool)).toEqual([])
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it('keeps two concurrent downloads from deleting each other', async () => {
    const fake = await fakeCli()
    const { store, saveImages } = attachments()
    const port = createLocusMediaPort({
      attachments: store,
      download: downloader(fake.binary, fake.spool),
      runner: mget('![Image](img_a)'),
    })
    try {
      const results = await Promise.all([
        port.admitCurrentImage({ messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true }),
        port.admitCurrentImage({ messageId: 'om_a', signal: new AbortController().signal, fenceBeforeSave: async () => true }),
      ])
      expect(results.map(result => result.kind)).toEqual(['ready', 'ready'])
      expect(saveImages).toHaveBeenCalledTimes(2)
      expect(readdirSync(fake.spool)).toEqual([])
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it('sweeps crash debris out of the spool at startup', async () => {
    const fake = await fakeCli()
    try {
      await writeFile(join(fake.spool, 'deadbeef.bin'), 'leftover')
      await writeFile(join(fake.spool, 'deadbeef.bin.tmp-1'), 'leftover-temp')
      expect(await sweepMediaSpool(fake.spool)).toBe(2)
      expect(readdirSync(fake.spool)).toEqual([])
      expect(await sweepMediaSpool(fake.spool)).toBe(0)
      expect(await sweepMediaSpool(join(fake.root, 'absent'))).toBe(0)
    } finally {
      await rm(fake.root, { recursive: true, force: true })
    }
  })

  it('writes only through the guarded spool, never through an invented path', async () => {
    const source = await readFile(new URL('../src/host/channel/media.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('cacheRoot')
    expect(source).not.toContain('mkdtemp')
    expect(source).not.toContain('--output-fd')
    expect(source).not.toContain('tmpdir')
    expect(source).toContain("'--output'")
    // Each call owns a directory, so cleanup cannot depend on guessing the
    // CLI's temp-file name.
    expect(source).toContain('mkdirSync(dir, { recursive: true, mode: 0o700 })')
    expect(source).toContain('cwd: dir')
    expect(source).toContain('rmSync(dir, { recursive: true, force: true })')
  })
})
