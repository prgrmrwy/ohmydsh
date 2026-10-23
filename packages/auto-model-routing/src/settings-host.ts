import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { DEFAULT_SETTINGS, SettingsStore, SettingsValidationError } from './settings.js'
import type { RoutingCatalog } from './settings-contract.js'
import rubric from './rubric.json' with { type: 'json' }

const keyRef = credentialRef('OPENROUTER_API_KEY')
interface AllowlistService { current(): { enabled: boolean; allowedModels: { provider: string; model: string }[] } }

/** Only the fixed credential reference and public catalog metadata cross this adapter. */
export function settingsHost(ctx: Context, store: SettingsStore) {
  const environment = launchEnvironmentOf(ctx)
  const credentials = () => ctx.get('credentials')
  const catalog = async (): Promise<RoutingCatalog> => {
    const models = (await Promise.all(ctx.llm.listProviders().filter(p => p.id === 'claude' || p.id === 'codex').map(async provider => {
      try {
        return await Promise.all((await ctx.llm.listModels(provider.id)).map(async model => {
          try {
            const info = await ctx.llm.resolveModelInfo(provider.id, model.id)
            return { provider: provider.id, model: model.id, name: model.name, reasoningEfforts: (info.reasoning?.efforts ?? []).map(e => String(e.id)) }
          } catch { return undefined }
        })).then(entries => entries.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined))
      } catch { return [] }
    }))).flat()
    // The optional provider is owned by dsh-tool-subagent, not this package.
    const service = ctx.get('subagentModelSelection' as never) as AllowlistService | undefined
    try {
      if (service) {
        const current = service.current()
        return { models, childAllowlist: { status: current.enabled ? 'enabled' : 'disabled', allowedModels: current.allowedModels.filter(r => r.provider === 'claude' || r.provider === 'codex') } }
      }
    } catch { /* An unavailable policy must never broaden the allowed routes. */ }
    return { models, childAllowlist: { status: 'unavailable', allowedModels: [] } }
  }
  const keyStatus = async () => {
    const service = credentials()
    if (service) {
      try { return { ...await service.describe(keyRef), available: true } }
      catch { return { configured: false, writable: false, available: false } }
    }
    return { configured: Boolean(environment.get('OPENROUTER_API_KEY')?.value), writable: false, available: false }
  }
  const read = async () => {
    const current = await catalog()
    const result = store.read(current)
    return { settings: result.settings, defaults: DEFAULT_SETTINGS, configStatus: result.status, issues: result.issues, key: await keyStatus(), ...current, criteria: rubric.tier.criteria }
  }
  const endpoint = async (operation: 'settings' | 'saveSettings' | 'setKey', body: unknown): Promise<Response> => {
    if (operation === 'settings') return Response.json(await read())
    if (operation === 'saveSettings') {
      try { store.save(body, await catalog()); return Response.json(await read()) }
      catch (error) {
        if (error instanceof SettingsValidationError) return Response.json({ error: error.message, issues: error.issues }, { status: 400 })
        return Response.json({ error: '无法保存自动模型路由设置' }, { status: 500 })
      }
    }
    const service = credentials()
    if (!service) return Response.json({ error: '凭据服务不可用' }, { status: 503 })
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).length !== 1 || !('value' in body)) return Response.json({ error: '无效的凭据请求' }, { status: 400 })
    const value = body.value
    if (value !== null && (typeof value !== 'string' || !value || value.length > 512 || /\s/.test(value))) return Response.json({ error: 'API key 必须为不含空白的非空字符串，且不超过 512 字符' }, { status: 400 })
    try {
      if (!(await service.describe(keyRef)).writable) return Response.json({ error: '该 key 来自启动环境，需先从启动环境移除并重启才能在此管理' }, { status: 409 })
      if (value === null) await service.unset(keyRef)
      else await service.set(keyRef, value as string)
      return Response.json({ key: await keyStatus() })
    } catch { return Response.json({ error: '无法更新 API key；请检查凭据服务与只读来源' }, { status: 500 }) }
  }
  return {
    catalog, read, endpoint,
    credential: async (name: string) => {
      const service = credentials()
      return service ? service.resolve(keyRef) : environment.get(name)
    },
  }
}
