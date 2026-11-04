import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { parseSearch } from '../run/parse.js'
import { readFrozenInput } from './freeze.js'

export type TargetRankDiagnostic = { status: 'recalled'; bestRank: number } | { status: 'not-recalled' | 'unknown' | 'N/A' }
interface Library { scope: string; home: string }
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function library(value: unknown): Library | undefined {
  const route = object(value)
  return route && typeof route.scope === 'string' && route.scope.trim() && typeof route.home === 'string' && route.home.trim()
    ? { scope: route.scope, home: route.home } : undefined
}

/** selftest-v1 uses the plugin's JSON envelope and the pinned keyword formatter. */
function v1Slugs(tool: string, text: string, own: Library): string[] | undefined {
  try {
    const result = object(JSON.parse(text)), current = library(result?.current)
    if (!result || current?.scope !== own.scope || current.home !== own.home) return undefined
    if (tool === 'memex_search') {
      if (!Array.isArray(result.hits)) return undefined
      const hits = result.hits.map(object)
      if (hits.some(hit => !hit || typeof hit.scope !== 'string' || !hit.scope.trim() || typeof hit.slug !== 'string' || !hit.slug.trim())) return undefined
      // A failed current-library search does not prove an empty result.
      if (Array.isArray(result.failures) && result.failures.some(value => object(value)?.scope === own.scope)) return undefined
      return hits.filter(hit => hit!.scope === own.scope).map(hit => hit!.slug as string)
    }
    if (result.mode !== 'search' || typeof result.content !== 'string') return undefined
    return result.content === 'No cards found.' ? [] : parseSearch(result.content).map(hit => hit.slug)
  } catch { return undefined }
}

export function diagnoseTargetRank(version: string, condition: 'mem' | 'nomem', target: string | undefined, own: unknown, evidence: unknown): TargetRankDiagnostic {
  if (condition === 'nomem') return { status: 'N/A' }
  const current = library(own)
  if (version !== 'selftest-v1' || !target || !current || !Array.isArray(evidence)) return { status: 'unknown' }
  let bestRank = Infinity, known = 0, unknown = false
  for (const raw of evidence) {
    const record = object(raw)
    if (!record || typeof record.tool !== 'string') { unknown = true; continue }
    if (record.tool !== 'memex_search' && record.tool !== 'memex_recall') continue
    const slugs = typeof record.text === 'string' ? v1Slugs(record.tool, record.text, current) : undefined
    if (slugs === undefined) { unknown = true; continue }
    known++
    const rank = slugs.indexOf(target) + 1
    if (rank) bestRank = Math.min(bestRank, rank)
  }
  return Number.isFinite(bestRank) ? { status: 'recalled', bestRank }
    : known > 0 && !unknown ? { status: 'not-recalled' } : { status: 'unknown' }
}

/** Missing or damaged diagnostic evidence stays unknown; it never changes scoring. */
export function loadTargetRank(directory: string, version: string, condition: 'mem' | 'nomem', target: string | undefined): TargetRankDiagnostic {
  if (condition === 'nomem') return { status: 'N/A' }
  try {
    for (const name of ['attempt', 'collected-tool-results']) {
      const stat = lstatSync(join(directory, name))
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { status: 'unknown' }
    }
    const attempt = object(object(readFrozenInput(join(directory, 'attempt')))?.attempt)
    if (attempt?.condition !== condition) return { status: 'unknown' }
    return diagnoseTargetRank(version, condition, target, attempt, readFrozenInput(join(directory, 'collected-tool-results')))
  } catch { return { status: 'unknown' } }
}
