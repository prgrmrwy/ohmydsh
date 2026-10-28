import type { ModelRoute } from './round.js'
export interface TestedSessionPort {
  create(id: string): Promise<void>; rename(id: string, title: string): Promise<void>; setManual(id: string): Promise<void>;
  selectModel(id: string, route: ModelRoute): Promise<void>;
  inspect(id: string): Promise<{ title: string; userPinned: boolean; mode: string; route: ModelRoute }>;
  prompt(id: string, text: string, turn?: string): Promise<void>;
}
export interface ExecutionInput { sessionId: string; title: string; route: ModelRoute; prompt: string; followUp?: string }
export async function executeFixedItem(port: TestedSessionPort, input: ExecutionInput): Promise<void> {
  await port.create(input.sessionId)
  await port.rename(input.sessionId, input.title)
  await port.setManual(input.sessionId)
  await port.selectModel(input.sessionId, input.route)
  const verify = async () => {
    const observed = await port.inspect(input.sessionId)
    if (observed.title !== input.title || !observed.userPinned || observed.mode !== 'MANUAL'
      || observed.route.provider !== input.route.provider || observed.route.model !== input.route.model || observed.route.effort !== input.route.effort) {
      throw new Error('Test session readback mismatch; question not sent')
    }
  }
  await verify()
  await port.prompt(input.sessionId, input.prompt, 'initial')
  if (input.followUp !== undefined) {
    await verify()
    await port.prompt(input.sessionId, input.followUp, 'follow-up')
  }
}
