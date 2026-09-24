import { describe, expect, it } from 'vitest'
import { INTENT_TRIAGE_GUIDANCE, intentTriageGuidanceCoversRequiredPoints } from '../src/host/ledger/prompt.js'

describe('INTENT_TRIAGE_GUIDANCE (tasks 6.1/6.3/6.5)', () => {
  it('passes its structural coverage check', () => {
    expect(intentTriageGuidanceCoversRequiredPoints(INTENT_TRIAGE_GUIDANCE)).toBe(true)
  })

  it('defines all four intent classes and leaves content classification to the child', () => {
    for (const intent of ['INFORMATION EXCHANGE', 'WORK REQUEST', 'REFERENCE-ONLY', 'AMBIGUOUS']) {
      expect(INTENT_TRIAGE_GUIDANCE).toContain(intent)
    }
    expect(INTENT_TRIAGE_GUIDANCE).toContain('the Host does not classify message content')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('never grants or removes file-write capability')
  })

  it('treats a no-action contact/associated-party mention as reference-only', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('introduced as a contact')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('mentioned as an associated party')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('with no request for this bot to answer or act')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('“if you have questions, contact this bot”')
  })

  it('does not infer reference-only solely from another bot mention', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain(
      'do not classify a message as reference-only merely because it also mentions another bot',
    )
    expect(INTENT_TRIAGE_GUIDANCE).toContain('complete text and structured addressing facts')
  })

  it('settles reference-only immediately with finish(no-reply), without wait, todo, or body', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('Immediately settle the Delivery')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('`pet_locus_finish` with outcome `no-reply`')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('non-empty audit reason')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('Send no business reply')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('do not call `pet_locus_wait`')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('do not register a todo')
  })

  it('keeps the existing work-request order: track, then finish the same request', () => {
    const trackAt = INTENT_TRIAGE_GUIDANCE.indexOf('call `pet_locus_track`')
    const finishAt = INTENT_TRIAGE_GUIDANCE.indexOf(
      'then finish that Delivery by calling `pet_locus_finish` with outcome `reply`',
    )
    expect(trackAt).toBeGreaterThan(-1)
    expect(finishAt).toBeGreaterThan(trackAt)
    expect(INTENT_TRIAGE_GUIDANCE).toContain('Registering a todo never itself finishes a Delivery')
  })

  it('clarifies through finish(reply), which terminates the ambiguous Delivery', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain(
      'Ask one short clarifying question by calling `pet_locus_finish` with outcome `reply`',
    )
    expect(INTENT_TRIAGE_GUIDANCE).toContain('TERMINATES the current Delivery')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('ordinary assistant reply is not sent to Feishu')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('must not be used to keep the current Delivery open')
    expect(INTENT_TRIAGE_GUIDANCE).not.toContain('WITHOUT calling')
    expect(INTENT_TRIAGE_GUIDANCE).not.toContain('continues this SAME conversation and Delivery')
  })

  it('treats a later qualifying at/reply as a new Delivery on the same persistent child history', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('a NEW Delivery in the normal FIFO queue')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('SAME persistent child')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('existing conversation history')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('never reopen the earlier Delivery')
  })

  it('does not invent todo/current/timer behavior when no follow-up arrives', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('If no later qualifying message arrives')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('do not create a todo')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('do not retain a current Delivery')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('do not assume a timeout or scheduled model turn will occur')
    expect(INTENT_TRIAGE_GUIDANCE).not.toContain('none arrives before you must act')
    expect(INTENT_TRIAGE_GUIDANCE).not.toContain('treat it as a WORK REQUEST')
  })

  it('rejects incomplete guidance rather than accepting token tool-name assertions', () => {
    expect(intentTriageGuidanceCoversRequiredPoints('some unrelated text')).toBe(false)
    expect(intentTriageGuidanceCoversRequiredPoints('mentions pet_locus_finish only')).toBe(false)
    expect(intentTriageGuidanceCoversRequiredPoints(
      'INFORMATION EXCHANGE WORK REQUEST REFERENCE-ONLY AMBIGUOUS pet_locus_finish pet_locus_track',
    )).toBe(false)
  })
})
