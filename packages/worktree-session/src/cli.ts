#!/usr/bin/env node
import { realpathSync } from 'node:fs'
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

// npm installs `bin` targets as symlinks: Node resolves the ESM module to the
// realpath while process.argv[1] keeps the symlink path, so a plain URL
// comparison would never match and the CLI would exit 0 without running a
// single safety check. import.meta.main answers "was this module the entry
// point" directly; the realpath comparison covers runtimes without it. If
// neither can prove entry, run nothing — importing the module must stay
// side-effect free.
function isEntrypoint(argv1: string | undefined): boolean {
  const mainMarker = (import.meta as { main?: unknown }).main
  if (typeof mainMarker === 'boolean') return mainMarker
  if (!argv1) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href
  } catch {
    return false
  }
}

if (isEntrypoint(process.argv[1])) process.exitCode = await main()
