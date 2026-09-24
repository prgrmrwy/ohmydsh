import { describe, expect, it } from 'vitest'
import {
  historicalUnknownAddressing,
  projectDeliveryAddressing,
} from '../src/host/locus/addressing.js'

describe('locus addressing projection', () => {
  it('classifies ordered event occurrences from self identity and chat bot membership', () => {
    const projection = projectDeliveryAddressing({
      selfOpenId: 'ou_self',
      mentions: [
        { id: 'ou_human', key: '@_user_1', name: 'Human' },
        { id: 'ou_self', key: '@_user_2', name: 'Pet' },
        { id: 'ou_bot', key: '@_user_3', name: 'Other Bot' },
        { id: 'ou_missing', key: '@_user_4', name: 'Unknown Person' },
      ],
      chatBots: [{ openId: 'ou_self' }, { openId: 'ou_bot' }],
    })

    expect(projection).toMatchObject({ status: 'known', selfMentioned: true, otherBotCount: 1, orderKnown: true })
    expect(projection.occurrences.map(({ kind, displayName }) => ({ kind, displayName }))).toEqual([
      { kind: 'human', displayName: 'Human' },
      { kind: 'self-bot', displayName: 'Pet' },
      { kind: 'other-bot', displayName: 'Other Bot' },
      { kind: 'human', displayName: 'Unknown Person' },
    ])
  })

  it('keeps non-self occurrences unknown when async membership proof is unavailable', () => {
    const projection = projectDeliveryAddressing({
      selfOpenId: 'ou_self',
      mentions: [{ id: 'ou_self', name: 'Pet' }, { id: 'ou_other', name: 'Could Be Anyone' }],
    })
    expect(projection.status).toBe('unknown')
    expect(projection.occurrences.map(occurrence => occurrence.kind)).toEqual(['self-bot', 'unknown'])
  })

  it('uses an explicit unknown/empty projection for historical rows', () => {
    expect(historicalUnknownAddressing()).toEqual({
      status: 'unknown', occurrences: [], selfMentioned: false, otherBotCount: 0, orderKnown: false,
    })
  })
})
