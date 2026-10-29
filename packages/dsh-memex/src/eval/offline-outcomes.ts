import type { ItemJudgements } from './plan-scoring.js'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadFixedRound, type ModelRoute, type RoundItem } from './round.js'
import { loadSelection } from './selection.js'
import { readJudgement, readItemJudgement } from './judgement.js'
import { semanticOutcome } from './outcome.js'
import { readFrozenInput } from './freeze.js'
import type { EvidenceText } from './quotes.js'
import { isDeepStrictEqual } from 'node:util'
import { fixedProgramOutcome, loadProgramEvidence } from './program-evidence.js'

function optionalRaw(path: string): unknown {
  let fd: number
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid raw judgement artifact')
    return JSON.parse(readFileSync(fd, 'utf8')) as unknown
  } finally { closeSync(fd) }
}

function protocolMismatch(): never { throw new Error('Frozen judge protocol mismatch; raw results not attributable') }
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) return protocolMismatch()
  return value as Record<string, unknown>
}
// judge-v1 wire format, not the current prompt builder: prose is historical, bindings are not.
const v1Schema = {
  type: 'object', additionalProperties: false, required: ['verdict', 'reason', 'quotes'],
  properties: {
    verdict: { type: 'string', enum: ['yes', 'no', 'unknown'] }, reason: { type: 'string' },
    quotes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['source', 'quote'], properties: { source: { type: 'string' }, quote: { type: 'string' } } } },
  },
}
function validateProtocols(value: unknown, item: RoundItem, route: ModelRoute, answers: readonly EvidenceText[], writes: readonly EvidenceText[]): void {
  if (!Array.isArray(value) || value.length !== item.judgements.length) return protocolMismatch()
  const hasWrites = item.writebackApplicable && writes.length > 0
  const schema = hasWrites ? { ...v1Schema, required: [...v1Schema.required, 'writeback'], properties: { ...v1Schema.properties, writeback: v1Schema } } : v1Schema
  const evidence = [...answers.map(({ id, text }) => ({ id, text })), ...writes]
  if (new Set(evidence.map(source => source.id)).size !== evidence.length) return protocolMismatch()
  for (const [index, raw] of value.entries()) {
    const protocol = fields(raw, ['provider', 'model', 'effort', 'schema', 'prompt'])
    const { schema: actualSchema, prompt, ...actualRoute } = protocol
    if (!isDeepStrictEqual(actualRoute, route) || !isDeepStrictEqual(actualSchema, schema) || typeof prompt !== 'string') return protocolMismatch()
    let parsed: unknown
    try { parsed = JSON.parse(prompt) } catch { return protocolMismatch() }
    const input = fields(parsed, ['protocol', 'criterion', 'rubric', 'requiredFacts', 'evidence', 'evidenceLayout', ...(hasWrites ? ['writeback'] : [])])
    const partitioned = input.evidenceLayout === 'partitioned-v1'
    if ('evidenceLayout' in input && !partitioned) return protocolMismatch()
    if (input.protocol !== 'judge-v1' || input.criterion !== item.judgements[index]
      || typeof input.rubric !== 'string' || !input.rubric.trim()
      || !isDeepStrictEqual(input.requiredFacts, item.requiredFacts) || !isDeepStrictEqual(input.evidence, partitioned ? answers.map(({ id, text }) => ({ id, text })) : evidence)) return protocolMismatch()
    if (hasWrites) {
      const writeback = fields(input.writeback, ['applicable', 'sources', 'rubric', ...(partitioned ? ['evidence'] : [])])
      if (partitioned && !isDeepStrictEqual(writeback.evidence, writes)) return protocolMismatch()
      if (writeback.applicable !== true || !isDeepStrictEqual(writeback.sources, writes.map(source => source.id))
        || typeof writeback.rubric !== 'string' || !writeback.rubric.trim()) return protocolMismatch()
    }
  }
}
function protocolsPresent(directory: string): boolean {
  try {
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return protocolMismatch()
    return true
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

/** Read-only diagnostics; never starts judges or trusts outcome.json as provenance evidence. */
export function loadOfflineOutcomes(root: string, roundId: string): Record<string, ItemJudgements> {
  const round = loadFixedRound(root, roundId, 'report')
  return Object.fromEntries(round.items.map(item => {
    const directory = join(root, roundId, item.id)
    const observed = loadProgramEvidence(directory)
    const program = fixedProgramOutcome(item, observed)
    const protocolDirectory = join(directory, 'judge-protocols')
    if (!protocolsPresent(protocolDirectory)) return [item.id, { ...semanticOutcome(item, undefined), ...program }]
    const raw = [0, 1].map(index => optionalRaw(join(protocolDirectory, `${index}-raw.json`)))
    const selection = loadSelection(join(directory, 'selection'))
    const protocols = readFrozenInput(protocolDirectory)
    const writes = observed?.writes.filter(value => value.success && value.targetCorrect) ?? []
    validateProtocols(protocols, item, round.judge, selection.evidence, writes.map(value => ({ id: `${value.source}:write`, text: value.content })))
    if (raw.every(value => value === undefined)) return [item.id, { ...semanticOutcome(item, undefined), ...program }]
    const semantic = semanticOutcome(item, raw.map(value => readItemJudgement(value, selection.evidence)))
    if (item.writebackApplicable && writes.length && !observed?.writes.some(value => value.success && !value.targetCorrect)) {
      const sources = writes.map(value => ({ id: `${value.source}:write`, text: value.content }))
      program.W = ['yes', ...raw.map(value => readJudgement(value && typeof value === 'object' ? (value as Record<string, unknown>).writeback : undefined, sources).verdict)]
    }
    return [item.id, { ...semantic, ...program, endpoint: item.writebackApplicable ? [...semantic.endpoint, ...program.W] : semantic.endpoint }]
  }))
}
