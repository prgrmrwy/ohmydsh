import type { FamilyStrategy } from './types.js'

export const claude = {
  id: 'claude',
  label: 'Claude',
  modelPrefixes: ['claude-'],
  transports: { claude: '', 'dsh-magpie-connect': 'claude/', 'dsh-magpie-connector': 'claude/' },
  effortStarts: { 'claude-opus-5-5': 'medium', 'claude-sonnet-5-5': 'medium', 'claude-haiku-5-5': 'medium', 'claude-fable-5-1': 'high' },
  childModels: { bounded: 'claude-haiku-5-5', analytical: 'claude-sonnet-5-5', frontier: 'claude-opus-5-5' },
} as const satisfies FamilyStrategy
