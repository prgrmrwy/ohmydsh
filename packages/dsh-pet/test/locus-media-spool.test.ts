/**
 * CLI runner and spool safety (change `locus-read-referenced-chats`, tasks 2.x; R22, R23).
 *
 * Real child processes are spawned for the size, disk and cleanup cases, so
 * process-group termination and directory removal are exercised, not asserted
 * from source text.
 */

import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  runLarkEnvelope,
  withSpoolDownload,
  type LarkCliRunner,
} from '../src/host/channel/media.js'

const realRun = promisify(execFile) as unknown as LarkCliRunner
const signal = (): AbortSignal => new AbortController().signal

function failingRunner(failure: { stdout?: string; stderr?: string; code?: number | string }): LarkCliRunner {
  return async () => {
    throw Object.assign(new Error('Command failed'), {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    })
  }
}

const failureEnvelope = (code: number): string =>
  JSON.stringify({ ok: false, error: { type: 'api_error', code, message: 'redacted' } })

describe('failure envelopes on stderr or stdout (D4)', () => {
  for (const code of [99991672, 10077, 230002]) {
    it(`maps ${String(code)} identically from stderr-only and stdout forms`, async () => {
      const fromStderr = await runLarkEnvelope(
        failingRunner({ stdout: '', stderr: `progress line\n${failureEnvelope(code)}\n` }),
        'lark-cli', [], { signal: signal(), timeoutMs: 1000 },
      )
      const fromStdout = await runLarkEnvelope(
        failingRunner({ stdout: failureEnvelope(code), stderr: '' }),
        'lark-cli', [], { signal: signal(), timeoutMs: 1000 },
      )
      expect(fromStderr).toEqual({ kind: 'failed', reason: 'platform-error', platformCode: code })
      expect(fromStdout).toEqual(fromStderr)
    })
  }

  it('takes the last parseable JSON document of stderr and falls back to stderr only when stdout has none', async () => {
    const result = await runLarkEnvelope(
      failingRunner({ stdout: 'not json', stderr: `${failureEnvelope(10077)}\n${failureEnvelope(99991672)}\n` }),
      'lark-cli', [], { signal: signal(), timeoutMs: 1000 },
    )
    expect(result).toEqual({ kind: 'failed', reason: 'platform-error', platformCode: 99991672 })
  })

  it('a failure without any parseable envelope is cli-failed, not empty content', async () => {
    const result = await runLarkEnvelope(
      failingRunner({ stdout: '', stderr: 'boom' }), 'lark-cli', [], { signal: signal(), timeoutMs: 1000 },
    )
    expect(result).toEqual({ kind: 'failed', reason: 'cli-failed' })
  })

  it('ENOSPC output is disk-low', async () => {
    const result = await runLarkEnvelope(
      failingRunner({ stderr: 'write /x: No space left on device' }), 'lark-cli', [], { signal: signal(), timeoutMs: 1000 },
    )
    expect(result).toEqual({ kind: 'failed', reason: 'disk-low' })
  })
})

async function printingCli(bytes: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-envelope-cli-'))
  const binary = join(root, 'fake-lark-cli.mjs')
  await writeFile(binary, `#!/usr/bin/env node
const filler = 'x'.repeat(${String(Math.max(0, bytes - 40))})
process.stdout.write(JSON.stringify({ ok: true, data: { filler } }))
`, { mode: 0o700 })
  await chmod(binary, 0o700)
  return binary
}

describe('large envelopes', () => {
  it('3 MiB synthetic merge envelope is read completely', async () => {
    const binary = await printingCli(3 * 1024 * 1024)
    const result = await runLarkEnvelope(realRun, binary, [], { signal: signal(), timeoutMs: 20_000 })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.bytes).toBeGreaterThan(3 * 1024 * 1024 - 100)
      expect((result.envelope['data'] as { filler: string }).filler.length).toBeGreaterThan(3 * 1024 * 1024 - 100)
    }
  })

  it('envelope above maxBuffer is envelope-too-large with the byte count, not empty', async () => {
    const binary = await printingCli(5000)
    const result = await runLarkEnvelope(realRun, binary, [], { signal: signal(), timeoutMs: 20_000, maxBufferBytes: 1000 })
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') {
      expect(result.reason).toBe('envelope-too-large')
      expect(result.bytes).toBeGreaterThanOrEqual(1000)
    }
  })

  it('the default maxBuffer is 128 MiB', async () => {
    let seen: number | undefined
    await runLarkEnvelope(async (_binary, _args, options) => {
      seen = (options as { maxBuffer?: number }).maxBuffer
      return { stdout: JSON.stringify({ ok: true, data: {} }) }
    }, 'lark-cli', [], { signal: signal(), timeoutMs: 1000 })
    expect(seen).toBe(128 * 1024 * 1024)
  })
})

/** A `lark-cli` stand-in in path mode: behaviour by file key. */
async function spoolCli(): Promise<{ spool: string; binary: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-spool-safety-'))
  const spool = join(root, 'media-spool')
  await mkdir(spool)
  const binary = join(root, 'fake-lark-cli.mjs')
  await writeFile(binary, `#!/usr/bin/env node
import { renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const args = process.argv.slice(2)
const value = flag => args[args.indexOf(flag) + 1]
const target = resolve(process.cwd(), value('--output'))
const key = value('--file-key')
const write = data => { writeFileSync(target + '.tmp', data); renameSync(target + '.tmp', target) }
if (key === 'file_enospc') {
  process.stderr.write('write ' + target + ': No space left on device\\n')
  process.exit(1)
}
if (key === 'file_hang') {
  write(Buffer.from([1, 2, 3]))
  setInterval(() => {}, 1000)
} else {
  const data = Buffer.alloc(16, 0x41)
  write(data)
  process.stdout.write(JSON.stringify({ ok: true, data: { saved_path: target, size_bytes: data.length } }))
}
`, { mode: 0o700 })
  await chmod(binary, 0o700)
  return { spool, binary }
}

const downloadInput = (cli: { spool: string; binary: string }, key: string, extra: Record<string, unknown> = {}) => ({
  binary: cli.binary,
  spoolRoot: cli.spool,
  args: ['im', '+messages-resources-download', '--file-key', key],
  maxBytes: 1024,
  timeoutMs: 20_000,
  signal: signal(),
  diskReserveBytes: 512,
  ...extra,
})

describe('statfs watchdog', () => {
  it('low free space during download kills the group, deletes the directory, records disk-low', async () => {
    const cli = await spoolCli()
    let calls = 0
    await expect(withSpoolDownload(
      downloadInput(cli, 'file_hang', { freeBytes: async () => (++calls < 3 ? 10_000 : 100) }),
      async () => 'unreachable',
    )).rejects.toThrow('disk-low')
    expect(readdirSync(cli.spool)).toEqual([])
  })

  it('frame-extraction phase is monitored, not only the download', async () => {
    const cli = await spoolCli()
    let extracting = false
    let aborted = false
    await expect(withSpoolDownload(
      // The volume only fills once extraction has started: the download itself was fine.
      downloadInput(cli, 'file_ok', { freeBytes: async () => (extracting ? 100 : 10_000) }),
      async (_file, phaseSignal) => {
        extracting = true
        await new Promise<void>(resolve => {
          phaseSignal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true })
        })
        return 'frames'
      },
    )).rejects.toThrow('disk-low')
    expect(aborted).toBe(true)
    expect(readdirSync(cli.spool)).toEqual([])
  })

  it('two concurrent calls each stop and clean on shared low free space', async () => {
    const cli = await spoolCli()
    let calls = 0
    const free = async (): Promise<number> => (++calls < 4 ? 10_000 : 100)
    const results = await Promise.allSettled([
      withSpoolDownload(downloadInput(cli, 'file_hang', { freeBytes: free }), async () => 'x'),
      withSpoolDownload(downloadInput(cli, 'file_hang', { freeBytes: free }), async () => 'x'),
    ])
    expect(results.map(item => item.status)).toEqual(['rejected', 'rejected'])
    for (const item of results) {
      expect(item.status === 'rejected' && (item.reason as Error).message).toBe('disk-low')
    }
    expect(readdirSync(cli.spool)).toEqual([])
  })

  it('ENOSPC output is disk-low and the directory is deleted', async () => {
    const cli = await spoolCli()
    await expect(withSpoolDownload(
      downloadInput(cli, 'file_enospc', { freeBytes: async () => 10_000 }), async () => 'x',
    )).rejects.toThrow('disk-low')
    expect(readdirSync(cli.spool)).toEqual([])
  })

  it('cancel and page deadline leave the spool empty', async () => {
    const cli = await spoolCli()
    const cancel = new AbortController()
    const pending = withSpoolDownload(
      downloadInput(cli, 'file_hang', { signal: cancel.signal, freeBytes: async () => 10_000 }), async () => 'x',
    )
    setTimeout(() => cancel.abort(), 200)
    await expect(pending).rejects.toThrow('download-aborted')
    expect(readdirSync(cli.spool)).toEqual([])

    await expect(withSpoolDownload(
      downloadInput(cli, 'file_hang', { timeoutMs: 300, freeBytes: async () => 10_000 }), async () => 'x',
    )).rejects.toThrow('download-timeout')
    expect(readdirSync(cli.spool)).toEqual([])
  })
})
