import { describe, expect, it } from 'vitest'
import { INTENT_TRIAGE_GUIDANCE, intentTriageGuidanceCoversRequiredPoints } from '../src/host/ledger/prompt.js'

describe('INTENT_TRIAGE_GUIDANCE (tasks 6.3/6.4)', () => {
  it('passes its own structural coverage check', () => {
    expect(intentTriageGuidanceCoversRequiredPoints(INTENT_TRIAGE_GUIDANCE)).toBe(true)
  })

  it('spec: 判定由子会话自身做出, Host 不做内容分类 — states the Host does not classify content', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('the Host does not classify message content')
  })

  it('spec: 误判 MUST NOT 导致越权 — explicitly states misjudging never grants/removes write capability', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('it never')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('grants or removes file-write capability')
  })

  it('spec: 要求干活登记待办，再以 reply 回执受理事实 — states finish happens AFTER registering, on the SAME delivery', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('call `pet_locus_track`')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('finish the SAME Delivery with `pet_locus_finish`')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('registering a todo never itself finishes the Delivery')
  })

  it('spec: 至多澄清一次 — states clarification happens ONCE and the next message continues the SAME Delivery', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('ONCE')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('continues this SAME conversation and Delivery')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('do not ask a second clarifying question')
  })

  it('spec: 澄清 MUST NOT 消耗或结算 current Delivery — states the clarifying turn ends WITHOUT calling either finishing tool', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('ending your turn WITHOUT calling `pet_locus_finish` or `pet_locus_track`')
  })

  it('spec: 未得到可判定答复时 SHALL 登记待办而非当作信息交换 — states the fallback explicitly', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('treat it as a WORK REQUEST and register a todo')
    expect(INTENT_TRIAGE_GUIDANCE).toContain('rather than silently treating it as information exchange')
  })

  it('design finding: "至多一次" is stated as a prompt-discipline (checking own turns), not a claim about a new Host-tracked flag', () => {
    expect(INTENT_TRIAGE_GUIDANCE).toContain('check your own recent turns first')
  })

  it('coverage check correctly rejects text missing a required invariant', () => {
    expect(intentTriageGuidanceCoversRequiredPoints('some unrelated text')).toBe(false)
    expect(intentTriageGuidanceCoversRequiredPoints('mentions pet_locus_finish only')).toBe(false)
  })
})
