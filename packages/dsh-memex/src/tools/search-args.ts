import { segmentQuery } from './query-segment.js'

export const MAX_SEARCH_RESULTS = 50
export const SEMANTIC_SEARCH_DISABLED = '语义检索当前未启用：尚未定义并验证向量来源与库访问权限边界；请使用默认关键词检索。'

/**
 * kernelQuery(query: string, semantic?: boolean): string
 * All keyword entry points share Han bigrams. A future enabled semantic path
 * must preserve the original text; today's plugin rejects it before routing.
 */
export function kernelQuery(query: string, semantic?: boolean): string {
  return semantic === true ? query : segmentQuery(query)
}

/**
 * searchArgs(args: { query?: string; limit?: number; list?: boolean; semantic?: boolean }): string[]
 * Pure keyword CLI arguments shared by the plugin and offline evaluation; no
 * routing, kernel invocation or telemetry. Semantic requests are not enabled.
 */
export function searchArgs(args: { query?: string; limit?: number; list?: boolean; semantic?: boolean }): string[] {
  if (args.semantic === true) throw new TypeError(SEMANTIC_SEARCH_DISABLED)
  const result = ['search', '--limit', String(Math.min(Math.max(Math.trunc(args.limit ?? 10), 1), MAX_SEARCH_RESULTS))]
  if (args.list === true) result.push('--list')
  if (args.query !== undefined && args.query !== '') result.push('--', kernelQuery(args.query))
  return result
}
