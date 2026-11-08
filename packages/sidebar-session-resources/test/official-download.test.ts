// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { Blob as NodeBlob } from 'node:buffer'
import { TextEncoder } from 'node:util'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { FileActions } from '@deepseek-ai/dsh-client-ui-file-actions/client'
import { downloadProducedFile } from '../src/client/open-produced.js'

/** Exercise the published download owner, including its MIME/filename policy. */
it('the official browser owner receives original bytes and keeps PDF/ZIP/unknown suffixes', async () => {
  let entry!: { apply: (ctx: unknown) => void }
  const disposers: (() => void)[] = []
  let actions!: FileActions
  const downloads: string[] = []
  const blobs: Blob[] = []
  const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
  runInNewContext(readFileSync(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-ui-file-actions/client')), 'utf8'), {
    window: { __ModuleLoader__: { load: (definition: { factory: (require: () => object) => typeof entry }) => { entry = definition.factory(() => ({})) } } },
    document,
    AbortController,
    TextEncoder,
    Blob: NodeBlob,
    URL: {
      createObjectURL: (blob: Blob) => { blobs.push(blob); return `blob:test-${blobs.length}` },
      revokeObjectURL: vi.fn(),
    },
  })
  entry.apply({
    provide: (_name: string, value: FileActions) => { actions = value },
    effect: (setup: () => () => void) => { disposers.push(setup()) },
    inject: vi.fn(),
  })
  vi.stubGlobal('Blob', NodeBlob)
  try {
    for (const name of ['报告 #100%.pdf', 'bundle.zip', 'unknown.custom']) {
      const bytes = new Uint8Array([0, 255, 128, 13, 10])
      const files = {
        stat: vi.fn(),
        readBytes: vi.fn().mockResolvedValue({ ok: true, value: { absolutePath: `/remote/${name}`, offset: 0, eof: true, data: bytes } }),
      }
      const result = await downloadProducedFile(files, actions, SessionId('session-a'), `/remote/${name}`, new AbortController().signal)
      expect(result).toEqual({ status: 'requested' })
      expect(downloads.at(-1)).toBe(name)
      expect(new Uint8Array(await blobs.at(-1)!.arrayBuffer())).toEqual(bytes)
    }
  } finally {
    for (const dispose of disposers) dispose()
    clicked.mockRestore()
  }
})

afterEach(() => { vi.unstubAllGlobals() })
