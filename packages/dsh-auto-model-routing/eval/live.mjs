#!/usr/bin/env node
// Explicitly authorized, synthetic-only validation; never executes child models.
// Usage: npm run build && node eval/live.mjs [--preset <id>] <new-result-file>
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = argv.indexOf('--preset')
const presetId = flag >= 0 ? argv[flag + 1] : undefined
if (flag >= 0) argv.splice(flag, 2)
const output = argv[0]

// The runtime state builder and preset list come from the build, so eval sends exactly what AUTO sends.
const lib = new URL('../lib/', import.meta.url)
if (!existsSync(new URL('context.js', lib)) || !existsSync(new URL('presets/index.js', lib))) {
  console.error('lib/ is missing: run `npm run build` first; no paid calls made')
  process.exit(2)
}
const { buildState } = await import(new URL('context.js', lib).href)
const { PRESETS, DEFAULT_PRESET_ID } = await import(new URL('presets/index.js', lib).href)
const preset = PRESETS.find(p => p.id === (presetId ?? DEFAULT_PRESET_ID))
if (!preset) {
  console.error(`Unknown preset: ${presetId}; known: ${PRESETS.map(p => p.id).join(', ')}; no paid calls made`)
  process.exit(2)
}
const questions = preset.rubric
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)))
assert(output, 'Supply a new temporary result file; never overwrite prior paid-call evidence')
assert(!existsSync(output), 'Result file already exists; refusing duplicate paid execution')
// One bounded run covers one preset; repeated replays for stability are a separately authorized run.
assert(cases.length <= 20, 'More cases than the per-run call limit')
const key = process.env.OPENROUTER_API_KEY
assert(key, 'Supply OPENROUTER_API_KEY via the environment; no paid calls made')
const meta = await fetch('https://openrouter.ai/api/v1/models/typesafe/jev-1.13/endpoints', { signal: AbortSignal.timeout(20_000), redirect: 'error' })
assert(meta.ok, 'Cannot verify current pricing')
const endpoints = (await meta.json()).data?.endpoints
assert(endpoints?.length && endpoints.every(e => Number(e.pricing.prompt) <= 0.000000042 && Number(e.pricing.completion) === 0), 'Price unknown or above authorized bound')
// Reserve a deliberately generous 65536 input tokens/call, even though the whole JSON is <=8192 bytes.
const reserve = 65536 * 0.000000042
const report = { model: 'typesafe/jev-1.13', preset: preset.id, limitCalls: 20, limitUsd: 0.10, reservedUsd: 0, actualUsd: 0, calls: [] }
const save = () => writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 })
for (const c of cases) {
  assert(report.calls.length < 20 && report.reservedUsd + reserve <= 0.10, 'Budget exhausted')
  const execution = c.execution ?? 'delegated'
  const expected = { capability: c.capability, depth: c.depthFor?.[preset.id] ?? c.depth }
  const state = buildState({ text: c.task, execution: preset.context.includes('execution') ? execution : undefined })
  const body = JSON.stringify({ model: report.model, state, questions, provider: { allow_fallbacks: false, max_price: { prompt: '0.042', completion: '0' } } })
  assert(Buffer.byteLength(body) <= 8192, 'Input exceeds authorized 8KB')
  const entry = { id: c.id, split: c.split, execution, expected, status: 'attempted' }
  report.calls.push(entry); report.reservedUsd += reserve; save()
  const start = performance.now()
  try {
    const response = await fetch('https://openrouter.ai/api/alpha/decisions', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'ohmydsh bounded AUTO validation' }, body })
    assert(response.ok, `HTTP ${response.status}`)
    const result = await response.json()
    const capability = result.answers?.capability?.choice, depth = result.answers?.depth?.choice
    assert(Object.hasOwn(questions.capability.criteria, capability) && Object.hasOwn(questions.depth.criteria, depth), 'Invalid multidimensional response')
    const cost = result.usage?.cost
    assert(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && cost <= reserve, 'Missing/invalid/over-reserve usage cost; stop')
    report.actualUsd += cost
    Object.assign(entry, { status: 'ok', capability, depth, capabilityHit: expected.capability.includes(capability), depthHit: expected.depth.includes(depth), ms: Math.round(performance.now() - start), usage: result.usage, snapshot: result.model })
    save()
  } catch (error) {
    entry.status = 'failed'; entry.error = error.message; save(); throw error
  }
}
console.log(JSON.stringify(report, null, 2))
