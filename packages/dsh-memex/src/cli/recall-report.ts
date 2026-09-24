#!/usr/bin/env node
/**
 * dsh-memex-recall-report — read this machine's recall telemetry.
 *
 *   dsh-memex-recall-report [--days 14] [--lib ~/.dsh-memex/personal] [--scope personal]
 *
 * Read-only: it lists telemetry files and card file names, and writes nothing.
 * Telemetry is per machine, so this ships with the plugin and runs wherever the
 * plugin is deployed rather than living in one machine's scratch directory.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildReport, parseRecords, renderReport, type StoredRecord } from '../telemetry/report.js'
import { telemetryDir } from '../telemetry/sink.js'

const USAGE = 'Usage: dsh-memex-recall-report [--days <n>] [--lib <library path>] [--scope <scope name>]'
const TELEMETRY_FILE = /^recall-\d{4}-\d{2}\.ndjson$/

export interface CliIo {
  readonly env: NodeJS.ProcessEnv
  readonly now: Date
  readonly out: (text: string) => void
  readonly err: (text: string) => void
}

function expandHome(path: string): string {
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}

interface Options {
  readonly days: number
  readonly lib: string
  readonly scope: string | undefined
}

function parseArgs(argv: readonly string[]): Options | string {
  let days = 14
  let lib = join(homedir(), '.dsh-memex', 'personal')
  let scope: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--help' || flag === '-h') return USAGE
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) return `Missing value for ${flag}\n${USAGE}`
    i += 1
    if (flag === '--days') {
      const n = Number(value)
      if (!Number.isInteger(n) || n <= 0) return `--days must be a positive integer, got ${value}`
      days = n
    } else if (flag === '--lib') {
      lib = resolve(expandHome(value))
    } else if (flag === '--scope') {
      scope = value
    } else {
      return `Unknown option ${flag}\n${USAGE}`
    }
  }
  return { days, lib, scope }
}

export function main(argv: readonly string[], io: CliIo): number {
  const parsed = parseArgs(argv)
  if (typeof parsed === 'string') {
    const isHelp = parsed === USAGE
    ;(isHelp ? io.out : io.err)(`${parsed}\n`)
    return isHelp ? 0 : 2
  }

  const dir = telemetryDir(io.env)
  if (!existsSync(dir)) {
    io.out(`No telemetry yet at ${dir}\nRun some searches first; records appear after the next recall.\n`)
    return 0
  }

  const records: StoredRecord[] = []
  let corrupt = 0
  for (const file of readdirSync(dir).filter(f => TELEMETRY_FILE.test(f)).sort()) {
    const parsedFile = parseRecords(readFileSync(join(dir, file), 'utf8'))
    records.push(...parsedFile.records)
    corrupt += parsedFile.corrupt
  }

  const cardsDir = join(parsed.lib, 'cards')
  if (!existsSync(cardsDir)) {
    io.err(`No cards directory at ${cardsDir}\n`)
    return 2
  }
  const cards = readdirSync(cardsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -3))
    .sort()

  const report = buildReport({
    records,
    corruptLines: corrupt,
    scope: parsed.scope ?? basename(parsed.lib),
    cards,
    days: parsed.days,
    now: io.now,
  })
  if (report.recalls === 0) {
    io.out(`No recalls in the last ${parsed.days} days.\n`)
    return 0
  }
  io.out(renderReport(report, parsed.lib))
  return 0
}

// npm installs `bin` targets as symlinks: the module resolves to its realpath
// while argv[1] keeps the link path, so a plain URL comparison never matches
// and the command would silently do nothing. Importing must stay side-effect
// free, so run only when entry is proven.
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

if (isEntrypoint(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2), {
    env: process.env,
    now: new Date(),
    out: text => process.stdout.write(text),
    err: text => process.stderr.write(text),
  })
}
