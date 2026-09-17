import { describe, expect, it } from 'vitest'
import { lookupParentTranscript, type ParentLookupDeps } from '../src/host/ledger/parent-lookup.js'
import type { LedgerCaller } from '../src/host/ledger/caller.js'

function caller(overrides: Partial<LedgerCaller> = {}): LedgerCaller {
  return {
    childSessionId: 'child-1',
    parentSessionId: 'main-1',
    locusId: 'locus-1',
    generation: 2,
    endpoint: { chatId: 'oc-project' },
    ...overrides,
  }
}

function userMessage(text: string) {
  return { type: 'user/message', data: { content: [{ type: 'text', text }] } }
}
function assistantMessage(text: string) {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }
}

describe('task 4.2 — the DEFINING structural test: this module has NO way to activate the parent Agent', () => {
  it('the parent-lookup module source contains zero CALLS that could deliver work to a live Agent', async () => {
    // This is design D3's dividing line: a read path that "asks the parent
    // something" has already become a write path. Rather than only trusting
    // runtime behavior, assert on the SOURCE — the same structural check
    // task 1.2 established for the existing `management.ts` consumption path.
    //
    // We check for the CALL PATTERN (`.followup(`, `queuePrompt(`, ...), not
    // the bare word — this file's own doc comments name those exact
    // forbidden calls to explain why they are absent, so a bare-word check
    // would trip on its own documentation.
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      new URL('../src/host/ledger/parent-lookup.ts', import.meta.url),
      'utf8',
    )
    for (const forbiddenCall of ['.followup(', 'queuePrompt(', 'resolveAgent(', '.sendMessage(', 'agent.inject(', 'ctx.agents.']) {
      expect(source).not.toContain(forbiddenCall)
    }
    // Confirm the ONLY capability this module depends on is a cold inspect —
    // no `Agent`, no `Session` write handle, nothing that resumes execution.
    expect(source).toContain('inspect: ((sessionId: string) => Promise<{')
    expect(source).not.toContain('import type { Agent')
    expect(source).not.toContain("from '@deepseek-ai/dsh-agent'")
  })
})

describe('lookupParentTranscript', () => {
  it('returns the folded transcript when inspect succeeds with content', async () => {
    const deps: ParentLookupDeps = {
      inspect: async () => ({ events: [userMessage('上次约定的执行根是什么'), assistantMessage('是 /repo/x')] }),
    }
    const result = await lookupParentTranscript(caller(), deps)
    expect(result).toEqual({
      ok: true,
      transcript: [
        { role: 'user', text: '上次约定的执行根是什么' },
        { role: 'assistant', text: '是 /repo/x' },
      ],
    })
  })

  it('calls inspect with EXACTLY the resolved parentSessionId — never a model-suppliable value, because there is none to supply', async () => {
    let calledWith: string | undefined
    const deps: ParentLookupDeps = {
      inspect: async (sessionId: string) => { calledWith = sessionId; return { events: [] } },
    }
    await lookupParentTranscript(caller({ parentSessionId: 'main-specific' }), deps)
    expect(calledWith).toBe('main-specific')
  })

  it('reports unavailable when the Host has no inspect capability at all — never guesses, never falls back to asking', async () => {
    const result = await lookupParentTranscript(caller(), { inspect: undefined })
    expect(result).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('reports unavailable when inspect throws (e.g. corrupt/unreadable log)', async () => {
    const deps: ParentLookupDeps = { inspect: async () => { throw new Error('unreadable') } }
    const result = await lookupParentTranscript(caller(), deps)
    expect(result).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('reports unavailable when inspect resolves with no events field at all', async () => {
    const deps: ParentLookupDeps = { inspect: async () => ({}) }
    const result = await lookupParentTranscript(caller(), deps)
    expect(result).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('reports empty (distinct from unavailable) when events exist but contain no readable user/assistant text', async () => {
    const deps: ParentLookupDeps = {
      inspect: async () => ({ events: [{ type: 'turn/start', data: { turn: 1 } }, { type: 'tool/call', data: {} }] }),
    }
    const result = await lookupParentTranscript(caller(), deps)
    expect(result).toEqual({ ok: false, reason: 'empty' })
  })

  it('ignores non-message event types entirely (tool/call, tool/result, request/header, turn/start, turn/end)', async () => {
    const deps: ParentLookupDeps = {
      inspect: async () => ({
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          { type: 'tool/call', data: { name: 'bash', arguments: 'secret command' } },
          { type: 'tool/result', data: { message: { content: 'secret output' } } },
          userMessage('visible question'),
          { type: 'turn/end', data: { turn: 1, reason: 'completed' } },
        ],
      }),
    }
    const result = await lookupParentTranscript(caller(), deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.transcript).toEqual([{ role: 'user', text: 'visible question' }])
      // Explicitly confirm tool-call arguments/results never leak through.
      expect(JSON.stringify(result.transcript)).not.toContain('secret')
    }
  })

  it('bounds the transcript to the most recent lines rather than dumping unbounded history (B037 over-retrieval mitigation)', async () => {
    const events = Array.from({ length: 500 }, (_, i) => userMessage(`message-${i}`))
    const deps: ParentLookupDeps = { inspect: async () => ({ events }) }
    const result = await lookupParentTranscript(caller(), deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.transcript.length).toBeLessThanOrEqual(200)
      // Keeps the MOST RECENT lines, not the oldest.
      expect(result.transcript.at(-1)?.text).toBe('message-499')
    }
  })

  it('truncates an individual line rather than returning an unbounded string', async () => {
    const deps: ParentLookupDeps = { inspect: async () => ({ events: [userMessage('x'.repeat(10_000))] }) }
    const result = await lookupParentTranscript(caller(), deps)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.transcript[0]!.text.length).toBeLessThanOrEqual(4_000)
  })

  it('handles a plain-string content field, not only an array of parts', async () => {
    const deps: ParentLookupDeps = {
      inspect: async () => ({ events: [{ type: 'user/message', data: { content: 'plain string question' } }] }),
    }
    const result = await lookupParentTranscript(caller(), deps)
    expect(result).toEqual({ ok: true, transcript: [{ role: 'user', text: 'plain string question' }] })
  })

  it('task 4.4: concurrent lookups from multiple child callers do not interfere — no shared mutable state, no serialization', async () => {
    // Each call gets its OWN inspect result keyed by which parentSessionId it
    // was actually invoked with — proving concurrent calls neither race on
    // shared state nor accidentally cross-deliver one caller's transcript to
    // another's result.
    const perParent: Record<string, readonly unknown[]> = {
      'main-a': [userMessage('question from A-side history')],
      'main-b': [userMessage('question from B-side history')],
      'main-c': [userMessage('question from C-side history')],
    }
    let concurrentCalls = 0
    let maxObservedConcurrency = 0
    const deps: ParentLookupDeps = {
      inspect: async (sessionId: string) => {
        concurrentCalls += 1
        maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrentCalls)
        // Yield without any lock/queue — if the implementation serialized
        // calls internally, this would not actually overlap.
        await new Promise(resolve => setTimeout(resolve, 5))
        concurrentCalls -= 1
        return { events: perParent[sessionId] ?? [] }
      },
    }
    const [a, b, c] = await Promise.all([
      lookupParentTranscript(caller({ parentSessionId: 'main-a' }), deps),
      lookupParentTranscript(caller({ parentSessionId: 'main-b' }), deps),
      lookupParentTranscript(caller({ parentSessionId: 'main-c' }), deps),
    ])
    expect(maxObservedConcurrency).toBeGreaterThan(1)
    expect(a).toEqual({ ok: true, transcript: [{ role: 'user', text: 'question from A-side history' }] })
    expect(b).toEqual({ ok: true, transcript: [{ role: 'user', text: 'question from B-side history' }] })
    expect(c).toEqual({ ok: true, transcript: [{ role: 'user', text: 'question from C-side history' }] })
  })
})
