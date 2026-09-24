import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseList, parseSearch } from '../src/run/parse.js'
import { runKernel } from '../src/run/kernel.js'
import { KernelError } from '../src/run/types.js'

function library(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-memex-run-'))
  mkdirSync(join(home, 'cards'))
  return home
}

describe('kernel runner', () => {
  it('rejects a missing cards directory before spawning', async () => {
    await expect(runKernel(['search', 'x'], { home: '/tmp/dsh-memex-missing-library' })).rejects.toMatchObject({ code: 'missing' })
  })

  it('rejects when the pinned memex executable is missing', async () => {
    await expect(runKernel(['search', 'x'], { home: library(), executable: '/tmp/no-such-memex-bin' })).rejects.toMatchObject({ code: 'missing' })
  })

  it('times out without retrying the process', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'dsh-memex-bin-'))
    const script = join(bin, 'memex')
    writeFileSync(script, '#!/bin/sh\nsleep 2\n')
    chmodSync(script, 0o755)
    await expect(runKernel(['search', 'x'], { home: library(), timeoutMs: 20, executable: script })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('passes MEMEX_HOME and captures exit/stdout/stderr', async () => {
    const home = library()
    writeFileSync(join(home, 'cards', 'sample.md'), '---\ntitle: Sample\ncreated: 2026-09-18\nsource: retro\n---\nalpha beta\n')
    const result = await runKernel(['search', 'alpha'], { home })
    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('## sample')
  })
})

describe('memex output parser', () => {
  it('parses search blocks and match metadata', () => {
    expect(parseSearch('## retry-backoff\nBackoff\nBody\n> Matched: slug:backoff\n')).toEqual([
      { slug: 'retry-backoff', title: 'Backoff', summary: 'Body', matched: 'slug:backoff' },
    ])
  })
  it('treats empty search output as no hits', () => expect(parseSearch('')).toEqual([]))
  it('parses the two-column list format', () => expect(parseList('one  One title\ntwo  Two title\n')).toEqual([
    { slug: 'one', title: 'One title' }, { slug: 'two', title: 'Two title' },
  ]))
  it('fails closed on unknown output', () => expect(() => parseSearch('not a block')).toThrow(KernelError))
})
