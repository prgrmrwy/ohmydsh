import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function freezeInput(round: string, input: unknown): void {
  const bytes = JSON.stringify(input, null, 2) + '\n'
  mkdirSync(round, { mode: 0o700 })
  durableWrite(join(round, 'input.json'), bytes)
  durableWrite(join(round, 'input.sha256'), digest(bytes) + '\n')
}

export function readFrozenInput(round: string): unknown {
  const bytes = readRegular(join(round, 'input.json'))
  const expected = readRegular(join(round, 'input.sha256')).toString().trim()
  if (!/^[a-f0-9]{64}$/.test(expected) || digest(bytes) !== expected) throw new Error('Frozen input hash mismatch')
  return JSON.parse(bytes.toString()) as unknown
}

function digest(bytes: string | Buffer): string { return createHash('sha256').update(bytes).digest('hex') }

export function durableWrite(path: string, content: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(fd, content); fsyncSync(fd) } finally { closeSync(fd) }
}

export function readRegular(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Invalid frozen file: ${path}`)
    return readFileSync(fd)
  } finally { closeSync(fd) }
}
