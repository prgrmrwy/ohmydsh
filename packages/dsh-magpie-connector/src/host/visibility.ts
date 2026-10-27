import type { CatalogModel } from './catalog.js'
export function validateVisibility(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(ids => !Array.isArray(ids) || ids.some(id => typeof id !== 'string'))) throw new Error('Invalid visibleModels')
  return Object.fromEntries(Object.entries(value).map(([provider, ids]) => [provider, [...ids]]))
}
export function isVisible(model: CatalogModel, saved: Record<string, string[]>): boolean {
  return !Object.hasOwn(saved, model.provider) || saved[model.provider]!.includes(model.info.id)
}
export function visibleCatalog(models: CatalogModel[], saved: Record<string, string[]>) { return models.filter(m => isVisible(m, saved)) }
