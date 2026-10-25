export const DECISION_SERVICES = {
  openrouter: { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13', credential: 'OPENROUTER_API_KEY' },
  typesafe: { label: 'TypeSafe 官方', endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', credential: 'TYPESAFE_API_KEY' },
  concentrate: { label: 'Concentrate', endpoint: 'https://api.concentrate.ai/v1/systemone', model: 'jev-1.13.0', credential: 'CONCENTRATE_API_KEY' },
  custom: { label: '自定义 System One', endpoint: '', model: 'jev-1.13.0', credential: 'AUTO_DECISION_CUSTOM_API_KEY' },
} as const
export type DecisionProvider = keyof typeof DECISION_SERVICES
export interface DecisionConfig { provider: DecisionProvider; model?: string | undefined; endpoint?: string | undefined }
export function validDecisionEndpoint(value: string): boolean {
  try {
    const u = new URL(value)
    return !u.username && !u.password && !u.search && !u.hash && (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)))
  } catch { return false }
}
export function resolveDecisionService(config?: DecisionConfig) {
  const provider = config?.provider ?? 'openrouter'
  const preset = DECISION_SERVICES[provider]
  if (!preset) throw new Error('Unknown decision service')
  const endpoint = provider === 'custom' ? config?.endpoint ?? '' : preset.endpoint
  if (!validDecisionEndpoint(endpoint)) throw new Error('Invalid decision endpoint')
  const model = config?.model ?? preset.model
  if (!/^[A-Za-z0-9._:/~-]{1,128}$/.test(model)) throw new Error('Invalid decision model')
  return { provider, endpoint, model, credential: preset.credential }
}
