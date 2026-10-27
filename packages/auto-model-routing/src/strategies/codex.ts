import type { FamilyStrategy } from './types.js'

/** GPT family; the id stays `codex` (the local transport name). */
export const codex = {
  id: 'codex',
  label: 'GPT',
  modelPrefixes: ['gpt-'],
  transports: { codex: '', 'dsh-magpie-connect': 'codex/', 'dsh-magpie-connector': 'codex/' },
  effortStarts: { 'gpt-6.1-sol': 'medium', 'gpt-6-luna': 'high', 'gpt-6-astra': 'low' },
  childModels: { bounded: 'gpt-6-luna', analytical: 'gpt-6.1-sol', frontier: 'gpt-6.1-sol' },
} as const satisfies FamilyStrategy
