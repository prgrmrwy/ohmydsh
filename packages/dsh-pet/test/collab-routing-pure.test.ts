/**
 * Pure stamp / D5 routing / D4 visibility rules (`src/host/collab/routing.ts`)
 * and D1 naming (`src/host/collab/naming.ts`). No storage, no dsh-collab.
 */
import { describe, expect, it } from 'vitest'
import {
  locusIdentity, locusSpaceId, locusSpaceName, locusSpacePurpose, mentionedLocusNames,
  parentOfPetAddress, petAddress,
} from '../src/host/collab/naming.js'
import {
  isVisibleToLocus, locusStamp, lookupFrom, mentionedLocus, nearestStamp, routeToLocus, stampLocusId,
} from '../src/host/collab/routing.js'
import type { CollabItem, CollabMessage, CollabRecordAt } from '../src/host/collab/types.js'

const A = locusIdentity('oc-alpha')
const B = locusIdentity('oc-beta')
const LOCI = [A, B]

function item(id: string, author: string, extra: Partial<CollabItem> = {}): CollabItem {
  return { id, author, kind: 'request', title: 't', body: 'b', revision: 1, ...extra }
}
function message(id: number, actor: string, to: string, extra: Partial<CollabMessage> = {}): CollabMessage {
  return { id: String(id), actor, to, body: '', needsReply: true, ...extra }
}
const asItem = (value: CollabItem): CollabRecordAt => ({ kind: 'item', item: value })
const asMessage = (value: CollabMessage): CollabRecordAt => ({ kind: 'message', message: value })

describe('naming (D1)', () => {
  it('space id, address and opaque names are deterministic and recomputable', () => {
    expect(locusSpaceId('main-1')).toMatch(/^pet-locus-[0-9a-f]{16}$/)
    expect(locusSpaceId('main-1')).toBe(locusSpaceId('main-1'))
    expect(locusSpaceId('main-1')).not.toBe(locusSpaceId('main-2'))
    expect(petAddress('main-1')).toBe('pet:main-1')
    expect(parentOfPetAddress('pet:main-1')).toBe('main-1')
    expect(parentOfPetAddress('pet:')).toBeUndefined()
    expect(parentOfPetAddress('loc:1')).toBeUndefined()
    expect(A).toMatch(/^locus-[0-9a-f]{16}$/)
    expect(locusIdentity('oc-alpha')).toBe(A)
    expect(locusIdentity('oc-alpha\u0000omt-1')).not.toBe(A)
  })

  it('purpose fits 200 characters and keeps the "open 的待办等用户决定" sentence', () => {
    const short = locusSpacePurpose('研发主会话')
    expect(short.startsWith('研发主会话 的 Locus：')).toBe(true)
    expect(short).toContain('open 的待办等用户决定何时开工')
    const long = locusSpacePurpose('长'.repeat(500))
    expect([...long].length).toBeLessThanOrEqual(200)
    expect(long).toContain('open 的待办等用户决定何时开工')
    expect(locusSpacePurpose(undefined).startsWith('主会话 的 Locus')).toBe(true)
    expect([...locusSpaceName('x'.repeat(500))].length).toBeLessThanOrEqual(70)
  })

  it('finds only whole 16-hex identities', () => {
    expect(mentionedLocusNames('ask locus-0a1b2c3d4e5f6a7b and locus-0a1b2c3d4e5f6a7b again')).toEqual(['locus-0a1b2c3d4e5f6a7b'])
    expect(mentionedLocusNames('xlocus-0a1b2c3d4e5f6a7b locus-0a1b2c3d4e5f6a7b9 locus-0A1B2C3D4E5F6A7B locus-0a1b2c3d')).toEqual([])
  })
})

describe('stamps', () => {
  it('reads only a well-formed { pet: { locusId } }', () => {
    expect(stampLocusId(locusStamp(A))).toBe(A)
    for (const bad of [undefined, null, [], {}, { pet: null }, { pet: { locusId: '' } }, { pet: { locusId: 3 } }]) {
      expect(stampLocusId(bad)).toBeUndefined()
    }
  })
})

describe('routing (D5)', () => {
  // Ra (seq 5, stamp A); Rb (seq 7, stamp B, ref 5); M (seq 9) main → pet, ref 7.
  const Ra = asItem(item('ra', 'pet', { ext: locusStamp(A) }))
  const Rb = asMessage(message(7, 'pet', 'main', { ref: 5, ext: locusStamp(B) }))
  const lookup = lookupFrom([[5, Ra], [7, Rb]])

  it('a reply follows ref to the NEAREST stamp, not the oldest', () => {
    const M = asMessage(message(9, 'main', 'pet', { ref: 7 }))
    expect(routeToLocus(M, lookup, LOCI)).toEqual({ kind: 'locus', locusId: B, via: 'ref' })
    expect(nearestStamp(M, lookup)).toBe(B)
  })

  it('ref beats a body mention', () => {
    const M = asMessage(message(9, 'main', 'pet', { ref: 7, body: `please ${A}` }))
    expect(routeToLocus(M, lookup, LOCI)).toMatchObject({ locusId: B, via: 'ref' })
  })

  it('a body mention of exactly one own locus routes there', () => {
    const M = asMessage(message(9, 'main', 'pet', { body: `转给 ${B} 处理` }))
    expect(routeToLocus(M, lookupFrom([]), LOCI)).toEqual({ kind: 'locus', locusId: B, via: 'mention' })
  })

  it('zero, several or foreign mentions are unroutable — never a guess', () => {
    for (const body of ['no name', `${A} ${B}`, locusIdentity('someone-elses')]) {
      const M = asMessage(message(9, 'main', 'pet', { body }))
      expect(routeToLocus(M, lookupFrom([]), LOCI)).toEqual({ kind: 'unroutable' })
    }
    expect(mentionedLocus(A, [A, A])).toBe(A)
  })

  it('a dangling or non-decreasing ref chain yields no stamp', () => {
    const dangling = asMessage(message(9, 'main', 'pet', { ref: 4 }))
    expect(routeToLocus(dangling, lookup, LOCI)).toEqual({ kind: 'unroutable' })
    const loop = lookupFrom([[3, asMessage(message(3, 'main', 'pet', { ref: 3 }))]])
    expect(nearestStamp(asMessage(message(9, 'main', 'pet', { ref: 3 })), loop)).toBeUndefined()
  })

  it('a request terminal notice routes by its own stamp, and never by mention', () => {
    expect(routeToLocus(Ra, lookup, LOCI)).toEqual({ kind: 'locus', locusId: A, via: 'ref' })
    const unstamped = asItem(item('rx', 'pet', { body: A }))
    expect(routeToLocus(unstamped, lookup, LOCI)).toEqual({ kind: 'unroutable' })
  })

  it('a child message mention never routes (only main → pet uses rule 2)', () => {
    const M = asMessage(message(9, 'pet', 'main', { body: B }))
    expect(routeToLocus(M, lookupFrom([]), LOCI)).toEqual({ kind: 'unroutable' })
  })
})

describe('visibility (D4)', () => {
  const lookup = lookupFrom([
    [5, asItem(item('ra', 'pet', { ext: locusStamp(A) }))],
    [7, asItem(item('rb', 'pet', { ext: locusStamp(B) }))],
  ])
  const sees = (stamp: unknown, subject: Parameters<typeof isVisibleToLocus>[1]) => isVisibleToLocus(stamp, subject, lookup, LOCI)

  it('items: main\'s and own are visible; a sibling\'s is not, even after main revises it', () => {
    expect(sees(locusStamp(A), { kind: 'item', item: item('i0', 'main') })).toBe(true)
    expect(sees(locusStamp(A), { kind: 'item', item: item('ra', 'pet', { ext: locusStamp(A) }) })).toBe(true)
    expect(sees(locusStamp(A), { kind: 'item', item: item('rb', 'pet', { ext: locusStamp(B), revision: 4 }) })).toBe(false)
  })

  it('messages: own; main → pet routed to exactly me; never an unroutable one or a sibling\'s', () => {
    expect(sees(locusStamp(A), { kind: 'message', message: message(8, 'pet', 'main', { ext: locusStamp(A) }) })).toBe(true)
    expect(sees(locusStamp(A), { kind: 'message', message: message(8, 'pet', 'main', { ext: locusStamp(B) }) })).toBe(false)
    expect(sees(locusStamp(A), { kind: 'message', message: message(9, 'main', 'pet', { ref: 5 }) })).toBe(true)
    expect(sees(locusStamp(B), { kind: 'message', message: message(9, 'main', 'pet', { ref: 5 }) })).toBe(false)
    const unroutable = message(9, 'main', 'pet', { body: 'hello' })
    expect(sees(locusStamp(A), { kind: 'message', message: unroutable })).toBe(false)
    expect(sees(locusStamp(B), { kind: 'message', message: unroutable })).toBe(false)
    // main talking to someone else is not addressed to any child
    expect(sees(locusStamp(A), { kind: 'message', message: message(9, 'main', 'other', { ref: 5 }) })).toBe(false)
  })

  it('status text: only main\'s', () => {
    expect(sees(locusStamp(A), { kind: 'statusText', name: 'main' })).toBe(true)
    expect(sees(locusStamp(A), { kind: 'statusText', name: 'pet' })).toBe(false)
  })

  it('a malformed stamp sees nothing', () => {
    expect(sees({}, { kind: 'item', item: item('i0', 'main') })).toBe(false)
  })
})
