import { MagpieSettings } from './SettingsPage.js'
import { SpeedSelect, createModelWatcher, createSpeedLoader, createSpeedSetter, type ModelDirectories } from './SpeedSelect.js'
import { createFetchApi, type Api } from './api.js'
import { registerMagpieSettingsNavIcon } from './settings-nav-icon.js'

/**
 * Web half of dsh-magpie-connector. Talks to the host only through the three D10
 * resources (`/api/dsh-magpie-connector/{settings,cards,speed}`), same-origin fetch as
 * dsh-magpie-connect does (the shell's connection authenticates the page).
 * Types are kept minimal on purpose: no dsh-client-* type packages needed.
 */
interface SlotRegistration { name: string; id: string; order: number; label?: () => string; inject?: (sessionId: string) => unknown }
interface ClientContext {
  slots: { inject(name: string, register: () => unknown): void; register(registration: SlotRegistration, component: unknown): unknown }
  get(name: string): unknown
  effect(run: () => () => void, label: string): unknown
}

export const name = 'dsh-magpie-connector/client'
export const inject = ['slots']

export function apply(ctx: ClientContext, api: Api = createFetchApi()): void {
  const label = () => 'Magpie'
  ctx.effect(() => registerMagpieSettingsNavIcon(label), 'dsh-magpie-connector: settings nav icon')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'dsh-magpie-connector', order: 13,
    label,
    inject: () => ({ api }),
  }, MagpieSettings))
  // Current model comes from ui-model-selection's `modelDirectories`, resolved lazily
  // per read so registration order never matters (same as subscriptions' Speed).
  const models = () => ctx.get('modelDirectories') as ModelDirectories | undefined
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'dsh-magpie-connector-speed', order: 1,
    inject: (sessionId: string) => ({ loadSpeed: createSpeedLoader(api, models, sessionId), setSpeed: createSpeedSetter(api, sessionId), watchModel: createModelWatcher(models, sessionId) }),
  }, SpeedSelect))
}
