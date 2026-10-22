#!/usr/bin/env node
// Read-only report over judgements.jsonl (design D13): per rubric version, how the labels compare with Jev.
// Zero dependencies; never reads message text, never touches the network, never writes.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const TIERS = ['simple', 'standard', 'complex', 'escalated']
const { values } = parseArgs({ options: { file: { type: 'string' }, json: { type: 'boolean' } } })
const home = process.env.DSH_HOME ?? resolve(homedir(), '.dsh')
const file = values.file ?? resolve(home, 'state/auto-model-routing/judgements.jsonl')

let text = ''
try { text = readFileSync(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }

// Fold by (sessionId, turn): the last judgement line and the last label line win; bad lines are skipped.
const turns = new Map()
for (const raw of text.split('\n')) {
  if (!raw.trim()) continue
  let line
  try { line = JSON.parse(raw) } catch { continue }
  if (typeof line?.sessionId !== 'string' || !Number.isInteger(line.turn)) continue
  const key = `${line.sessionId}\0${line.turn}`
  const entry = turns.get(key) ?? { sessionId: line.sessionId, turn: line.turn }
  if (TIERS.includes(line.tier) && typeof line.rubricVersion === 'string') Object.assign(entry, { tier: line.tier, rubricVersion: line.rubricVersion })
  if (TIERS.includes(line.label)) entry.label = line.label
  turns.set(key, entry)
}

const versions = {}
const mismatches = []
for (const entry of turns.values()) {
  if (!entry.tier || !entry.label) continue
  const row = versions[entry.rubricVersion] ??= { labeled: 0, agree: 0, over: 0, under: 0 }
  row.labeled++
  const diff = TIERS.indexOf(entry.tier) - TIERS.indexOf(entry.label)
  if (diff === 0) { row.agree++; continue }
  if (diff > 0) row.over++; else row.under++
  mismatches.push({ sessionId: entry.sessionId, turn: entry.turn, rubricVersion: entry.rubricVersion, tier: entry.tier, label: entry.label })
}

if (values.json) {
  console.log(JSON.stringify({ versions, mismatches }, null, 2))
} else {
  console.log(`file: ${file}`)
  for (const [version, row] of Object.entries(versions)) console.log(`rubric ${version}: labeled ${row.labeled}, agree ${row.agree}, judged higher ${row.over}, judged lower ${row.under}`)
  if (!Object.keys(versions).length) console.log('no labeled turns yet')
  for (const m of mismatches) console.log(`  ${m.sessionId} turn ${m.turn} [${m.rubricVersion}]: Jev ${m.tier}, label ${m.label}`)
}
