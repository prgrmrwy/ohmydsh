import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('library enumeration skips eval libraries but explicit --lib remains an explicit choice', () => {
  const home = mkdtempSync(join(tmpdir(), 'eval-report-wrapper-'))
  const bin = join(home, 'bin'); mkdirSync(bin)
  writeFileSync(join(bin, 'dsh-memex-recall-report'), '#!/bin/bash\nprintf "CALL:%s\\n" "$*"\n', { mode: 0o700 })
  for (const lib of ['personal', 'eval-123-repo']) mkdirSync(join(home, '.dsh-memex', lib, 'cards'), { recursive: true })
  const script = resolve('../../skills/memex-recall-report/scripts/report.sh')
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }
  const output = execFileSync('bash', [script], { env, encoding: 'utf8' })
  expect(output).toContain('personal')
  expect(output).not.toContain('eval-123-repo')
  const explicit = execFileSync('bash', [script, '--lib', join(home, '.dsh-memex/eval-123-repo')], { env, encoding: 'utf8' })
  expect(explicit).toContain('eval-123-repo')
})
