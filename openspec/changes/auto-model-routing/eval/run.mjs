#!/usr/bin/env node
// Regression runner for the Jev tier rubric (design D4). Calls the real OpenRouter
// decisions endpoint, so every run costs a little (about $0.00002 per request).
//
//   OPENROUTER_API_KEY=... node run.mjs [--runs 2] [--rubric rubric.json] [set.json ...]
//
// Defaults to the three sets in this directory. The state layout below mirrors the
// spec ("Jev 判断档位"); keep the two in step when either changes.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const [, value] = args.splice(i, 2); return value }
const runs = Number(flag('--runs', '2'))
const rubric = JSON.parse(readFileSync(flag('--rubric', join(here, 'rubric.json')), 'utf8'))
const sets = args.length ? args : ['synthetic-tune.json', 'synthetic-holdout.json', 'session-derived.json'].map(f => join(here, f))
const key = process.env.OPENROUTER_API_KEY
if (!key) { console.error('OPENROUTER_API_KEY is not set'); process.exit(2) }

const order = ['simple', 'standard', 'complex', 'escalated']
const above = tier => order[Math.min(order.indexOf(tier) + 1, order.length - 1)]
const NOTE = 'Earlier conversation is shown so you can tell what the new message asks for. Rate the work the assistant must do next in response to the new message, not the earlier work.'

export function state(c) {
  const head = c.prev ? `Previous user-turn tier: ${c.prev} (one tier above: ${above(c.prev)})` : 'Previous user-turn tier: none'
  const parts = []
  if (c.prevUser) parts.push(`Previous user message (truncated):\n${c.prevUser.slice(0, 500)}`)
  if (c.prevAssistant) parts.push(`Previous assistant reply (last part):\n${c.prevAssistant.slice(-1200)}`)
  if (!parts.length) return `${head}\nUser message:\n${c.text}`
  return `${head}\n${NOTE}\n${parts.join('\n')}\nNew user message:\n${c.text}`
}

async function judge(c) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'typesafe/jev-1.13', state: state(c), questions: rubric.questions }),
      })
      const body = await response.json()
      if (body.answers?.tier) return body.answers.tier
    } catch {}
  }
  return undefined
}

let failed = 0
for (const file of sets) {
  const cases = JSON.parse(readFileSync(file, 'utf8'))
  const jobs = cases.flatMap(c => Array.from({ length: runs }, () => c))
  const results = new Map()
  let next = 0
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < jobs.length) {
      const c = jobs[next++]
      const answer = await judge(c)
      results.set(c, [...(results.get(c) ?? []), answer?.choice])
    }
  }))
  let ok = 0, over = 0, under = 0, flips = 0
  const misses = []
  for (const c of cases) {
    const picks = results.get(c) ?? []
    if (new Set(picks).size > 1) flips++
    for (const pick of picks) {
      if (c.exp.includes(pick)) ok++
      else if (order.indexOf(pick) > Math.max(...c.exp.map(e => order.indexOf(e)))) over++
      else under++
    }
    if (!picks.every(p => c.exp.includes(p))) misses.push(`${c.id} expected ${c.exp.join('/')} got ${picks.join(',')}`)
  }
  const total = cases.length * runs
  console.log(`${file.split('/').pop()} [${rubric.version}]: ${ok}/${total} match, ${over} over, ${under} under, ${flips} unstable`)
  for (const m of misses) console.log(`  ${m}`)
  failed += total - ok
}
process.exitCode = failed ? 1 : 0
