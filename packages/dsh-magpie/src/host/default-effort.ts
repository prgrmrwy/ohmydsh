import type { CatalogModel } from './catalog.js'
export function updateDefaultEffort(saved: Record<string,string>, input: unknown, catalog: CatalogModel[]): Record<string,string> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['model','effort'].includes(k))) throw new Error('Invalid defaultEffort')
  const {model,effort} = input as {model?: unknown; effort?: unknown}
  if (typeof model !== 'string' || !model || (effort !== null && (typeof effort !== 'string' || !catalog.find(m => m.info.id === model)?.efforts.includes(effort)))) throw new Error('Invalid default effort')
  const next = {...saved}
  if (effort === null) delete next[model]; else next[model] = effort as string
  return next
}
export function withDefaultEffort(model: CatalogModel, saved: Record<string,string>): CatalogModel['info'] {
  const info = {...model.info}
  if (info.reasoning) {
    const {defaultEffort: _ignored, ...reasoning} = info.reasoning
    const effort = Object.hasOwn(saved, model.info.id) ? saved[model.info.id] : undefined
    info.reasoning = {...reasoning, ...(effort !== undefined && model.efforts.includes(effort) ? {defaultEffort: effort as never} : {})}
  }
  return info
}
