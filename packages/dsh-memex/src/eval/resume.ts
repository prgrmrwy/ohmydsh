export interface ResumeState { frozenGeneration: string; generation: string; healthy: boolean; pending: number; unreleased?: readonly string[] }
export async function requireSameHostResume(state: ResumeState, proveRelease: () => Promise<void>): Promise<void> {
  if (!state.generation || state.frozenGeneration !== state.generation) throw new Error('Host generation changed; release recovery unproven')
  if (state.unreleased?.length) throw new Error(`Known unreleased resources block resume; inspect manually: ${state.unreleased.join(', ')}`)
  if (!state.healthy || state.pending !== 0) throw new Error('Resource tracking unhealthy or pending activity; resume refused')
  await proveRelease()
}
