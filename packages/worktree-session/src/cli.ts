#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { wsClean, wsPromote, wsStatus } from './host/maintenance.js'
import { wireError } from './host/errors.js'

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command = 'status', ...rest] = argv
  const dryRun = rest.includes('--dry-run')
  const path = resolve(rest.find(value => value !== '--dry-run') ?? process.cwd())
  try {
    const result = command === 'status'
      ? await wsStatus(path)
      : command === 'promote'
        ? await wsPromote(path)
        : command === 'clean'
          ? await wsClean(path, { dryRun })
          : undefined
    if (result === undefined) throw new Error('Usage: dsh-ws status [path] | promote [path] | clean [--dry-run] [path]')
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: wireError(error) }, null, 2)}\n`)
    return 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main()
