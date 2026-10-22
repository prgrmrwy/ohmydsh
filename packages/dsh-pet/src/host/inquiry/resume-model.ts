/**
 * Model a cold-resumed inquiry Agent should keep running on.
 *
 * `agents.resume` routes requests by the passed `agentOptions`, not by the
 * session's history, so passing the Host default silently switched a resumed
 * main session to whatever the user selected most recently. Mirror the native
 * session controller (`selectionFor`): a pending explicit pick, else the last
 * model the session actually used, else the Host default for a session that
 * never ran a request.
 */
export interface ResumeModel { readonly provider: string; readonly model: string }

export function resumeModelFor(
  projected: unknown,
  hostDefault: ResumeModel,
): ResumeModel {
  const state = projected as { pending?: unknown; next?: unknown; lastUsed?: unknown } | undefined
  for (const candidate of [state?.pending, state?.next, state?.lastUsed]) {
    const value = candidate as { provider?: unknown; model?: unknown } | null | undefined
    if (typeof value?.provider === 'string' && value.provider !== '' &&
        typeof value.model === 'string' && value.model !== '') {
      return { provider: value.provider, model: value.model }
    }
  }
  return hostDefault
}
