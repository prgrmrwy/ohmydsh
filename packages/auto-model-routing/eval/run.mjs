#!/usr/bin/env node
// Tier rubric regression (see README.md). Uses the built package (`npm run build` first) so the rubric and the
// `state` builder are exactly what the Host sends. Calls the real OpenRouter endpoint unless --base is given.
// Exit 0: every miss is in baseline.json; 1: a new miss outside knownMisses; 2: a request failed.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { TIER_QUESTIONS, rubricVersion } from '../lib/jev.js'
import { buildState } from '../lib/context.js'
import { userInput } from '../lib/input.js'

const { values } = parseArgs({ options: { base: { type: 'string', default: 'https://openrouter.ai' }, runs: { type: 'string', default: '3' }, only: { type: 'string' } } })
const runs = Math.max(1, Number.parseInt(values.runs, 10) || 3)
const key = process.env.OPENROUTER_API_KEY
if (!key) { console.error('OPENROUTER_API_KEY is not set'); process.exit(2) }
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
const cases = read('./cases.json').filter(c => !values.only || values.only.split(',').includes(c.id))
const known = new Set(read('./baseline.json').knownMisses)

/** Same path as the Host: the turn text goes through `userInput` (redact, cut), then `buildState`. */
export const stateFor = c => buildState({
  previous: c.prev, prevUser: c.prevUser, prevAssistant: c.prevAssistant,
  text: userInput([{ source: { kind: 'user' }, content: [{ type: 'text', text: c.text }] }]).text,
})

async function ask(state) {
  const response = await fetch(`${values.base}/api/alpha/decisions`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'ohmydsh auto-model-routing eval' },
    body: JSON.stringify({ model: 'typesafe/jev-1.13', state, questions: TIER_QUESTIONS }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const choice = (await response.json())?.answers?.tier?.choice
  if (typeof choice !== 'string') throw new Error('no choice in response')
  return choice
}

const misses = [], errors = [], fixed = []
for (const c of cases) {
  const votes = []
  try { for (let i = 0; i < runs; i++) votes.push(await ask(stateFor(c))) }
  catch (error) { errors.push(`${c.id}: ${error.message}`); continue }
  const counts = votes.reduce((map, v) => map.set(v, (map.get(v) ?? 0) + 1), new Map())
  const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const hit = c.exp.includes(majority)
  if (!hit) misses.push({ id: c.id, got: majority, exp: c.exp, votes })
  else if (known.has(c.id)) fixed.push(c.id)
}

const fresh = misses.filter(m => !known.has(m.id))
console.log(`rubric ${rubricVersion}: ${cases.length} cases × ${runs} runs; ${misses.length} misses (${fresh.length} new), ${errors.length} request errors`)
for (const m of misses) console.log(`${known.has(m.id) ? 'known miss' : 'NEW miss'} ${m.id}: got ${m.got}, expected ${m.exp.join('|')} (votes ${m.votes.join(',')})`)
for (const id of fixed) console.log(`known miss now passes: ${id}`)
for (const e of errors) console.log(`request error ${e}`)
process.exit(errors.length ? 2 : fresh.length ? 1 : 0)
