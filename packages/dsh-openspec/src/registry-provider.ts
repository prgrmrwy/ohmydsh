type GenerationProvider = {
  list(): Promise<Array<{ name: string; description: string }>>
  get(candidate: { name?: string }, lookup: { cwd?: string; scope?: object }): Promise<{ content: string } | undefined>
}

const POLICY = { modelInvocable: true, userInvocable: true } as const

/** Adapts the generation-backed provider to the real SkillRegistry provider contract (full SkillDefinition results). */
export function createRegistryProvider(generations: GenerationProvider, hooks: { beforeList?: () => Promise<void> } = {}) {
  return {
    name: 'dsh-openspec',
    list: async (_options: unknown) => {
      await hooks.beforeList?.()
      return (await generations.list()).map(item => ({
        name: item.name, description: item.description, invocation: POLICY,
        source: 'bundled', provider: 'dsh-openspec', rank: 700, locator: item.name,
      }))
    },
    get: async (candidate: { name: string; description: string }, options: { cwd?: string; scope?: object }) => {
      const loaded = await generations.get({ name: candidate.name }, options)
      if (!loaded) return undefined
      return { name: candidate.name, description: candidate.description, invocation: POLICY, source: 'bundled', provider: 'dsh-openspec', content: loaded.content }
    },
  }
}
