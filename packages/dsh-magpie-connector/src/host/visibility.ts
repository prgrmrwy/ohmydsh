import type { CatalogModel } from './catalog.js'
export function validateVisibility(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(ids => !Array.isArray(ids) || ids.some(id => typeof id !== 'string'))) throw new Error('Invalid visibleModels')
  return Object.fromEntries(Object.entries(value).map(([provider, ids]) => [provider, [...ids]]))
}
export function isVisible(model: CatalogModel, saved: Record<string, string[]>): boolean {
  return !Object.hasOwn(saved, model.provider) || saved[model.provider]!.includes(model.info.id)
}
export function visibleCatalog(models: CatalogModel[], saved: Record<string, string[]>) { return models.filter(m => isVisible(m, saved)) }

/**
 * One-time upgrade of pre-0.7 visibility: routing entries used to be shown or hidden by their vendor's
 * key. While `routing` has no saved choice and some vendor key still lists routing ids, rebuild the
 * `routing` list from what the old keys meant (vendor following = visible, else listed = visible) and
 * drop those ids from the vendor lists. Returns undefined when there is nothing to migrate.
 */
export function migrateRoutingVisibility(models: CatalogModel[], saved: Record<string, string[]>): Record<string, string[]> | undefined {
  if (Object.hasOwn(saved, 'routing')) return undefined
  const routing = models.filter(m => m.legacyVisibility !== undefined)
  if (!routing.some(m => Object.hasOwn(saved, m.legacyVisibility!) && saved[m.legacyVisibility!]!.includes(m.info.id))) return undefined
  const ids = new Set(routing.map(m => m.info.id))
  const next = Object.fromEntries(Object.entries(saved).map(([key, list]) => [key, list.filter(id => !ids.has(id))]))
  next.routing = routing.filter(m => !Object.hasOwn(saved, m.legacyVisibility!) || saved[m.legacyVisibility!]!.includes(m.info.id)).map(m => m.info.id)
  return next
}
