#!/usr/bin/env node
/**
 * Create and integrity-check a consistent SQLite snapshot before a unified
 * locus cutover. This script never stops or starts the channel: the operator
 * must first quiesce the old consumer as documented in the runbook.
 */
import { constants } from 'node:fs'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

function arg(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
function fail(message) {
  console.error(message)
  process.exitCode = 1
}

const home = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
const source = path.resolve(arg('--database') ?? path.join(home, 'plugins', 'dsh-pet', 'state.sqlite'))
const destination = path.resolve(arg('--output') ?? `${source}.pre-locus-${new Date().toISOString().replaceAll(':', '-')}.bak`)
const temporary = `${destination}.partial-${process.pid}`

try {
  await access(source, constants.R_OK)
  await mkdir(path.dirname(destination), { recursive: true })
  await rm(temporary, { force: true })
  const live = new DatabaseSync(source, { readOnly: true })
  try {
    await backup(live, temporary)
  } finally {
    live.close()
  }
  const snapshot = new DatabaseSync(temporary, { readOnly: true })
  try {
    const integrity = snapshot.prepare('PRAGMA integrity_check').all()
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      throw new Error(`snapshot integrity check failed: ${JSON.stringify(integrity)}`)
    }
  } finally {
    snapshot.close()
  }
  await rename(temporary, destination)
  console.log(JSON.stringify({ ok: true, source, snapshot: destination, integrity: 'ok' }))
} catch (error) {
  await rm(temporary, { force: true }).catch(() => undefined)
  fail(`cutover backup failed: ${error instanceof Error ? error.message : String(error)}`)
}
