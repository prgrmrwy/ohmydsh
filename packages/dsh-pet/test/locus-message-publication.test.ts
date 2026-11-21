import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { attestLocusComposition, LOCUS_SAFE_TOOL_NAMES } from '../src/host/locus/composition.js'
import { publishesLocusMessageTool } from '../src/host/locus/message-guidance.js'

const IM = { chatId: 'oc_0000000000000000000000000000001' }
const TOPIC = { chatId: 'oc_0000000000000000000000000000001', threadId: 'omt_00000001' }
const DOC = { chatId: 'doc:docx:Dx0000000000000000000000001' }

describe('pet_locus_message publication decision', () => {
  it('media unavailable: an IM child gets no pet_locus_message and still attests', () => {
    expect(publishesLocusMessageTool(IM, false)).toBe(false)
    expect(publishesLocusMessageTool(TOPIC, false)).toBe(false)
    // The published surface without the tool is still a reviewed surface.
    const visible = [...LOCUS_SAFE_TOOL_NAMES, 'pet_context', 'pet_locus_finish', 'pet_locus_chat_history']
    expect(attestLocusComposition(visible, 'read-only')).toEqual({ ok: true, leaks: [] })
  })

  it('publishes exactly for an IM entry with an available media port', () => {
    expect(publishesLocusMessageTool(IM, true)).toBe(true)
    expect(publishesLocusMessageTool(TOPIC, true)).toBe(true)
    expect(publishesLocusMessageTool(DOC, true)).toBe(false)
    expect(publishesLocusMessageTool(DOC, false)).toBe(false)
  })

  it('the Host assembles per-entry read tools only through the tested selection', async () => {
    // Complement to the runtime tests in locus-message-tool-runtime.test.ts: the
    // Host must not assemble these deps a second way beside the selection.
    const index = await readFile(resolve(__dirname, '..', 'src', 'index.ts'), 'utf8')
    expect(index.match(/selectLocusEntryReadTools\(/g)?.length).toBe(1)
    expect(index).not.toMatch(/locusMessage:|locusHistory:|locusDocContext:/)
    expect(index).toMatch(/messageToolAvailable: publishesLocusMessageTool\(/)
  })
})
