/** TIER-PROMPT-1: a prompt rendered before the wake that applies a tier must not claim the old tier binds. */
import { expect, it } from 'vitest'
import { renderLocusDeliveryPrompt, locusDeliveryPromptContext } from '../src/host/locus/context.js'

const record = {
  id: 'entry', generation: 2, endpoint: { chatId: 'chat' }, parentSessionId: 'main', childSessionId: 'child',
  workspaceId: 'ws', state: 'active', childComposition: 'tier3',
  permission: { desired: 'read', effective: 'read' }, toolTier: { desired: 'shell', effective: 'safe' },
} as never
const message = { messageId: 'm', senderOpenId: 'ou', text: 'run it' } as never

it.each(['first', 'subsequent'] as const)('pending tier defers to the verified tool surface (%s)', position => {
  const text = renderLocusDeliveryPrompt(locusDeliveryPromptContext({ record, message }), { position })
  expect(text).toContain('可能已在本次唤醒时应用')
  expect(text).toContain('pet_context')
  expect(text).not.toContain('生效前仍按当前')
})
