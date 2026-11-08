import { describe, expect, it } from 'vitest'
import {
  LOCUS_ACTION_ROUTE,
  LOCUS_DEFAULT_QA_ROUTE,
  LOCUS_ROUTES,
  LOCUS_VIEW_ROUTE,
  PET_LOCUS_STATES_V20,
  ROUTES,
  type PetLocusActionRequestV20,
  type PetLocusManagementViewV20,
} from '../src/wire.js'

describe('unified locus wire contract', () => {
  it('declares only the v20 locus routes and keeps legacy routes unchanged', () => {
    // v20 (pet-locus-isomorphic-entries D10): every mutation goes through the
    // one action route; the per-action and discovery routes are removed.
    expect(LOCUS_ROUTES).toEqual({
      view: '/dsh-pet/api/locus',
      action: '/dsh-pet/api/locus-action',
      defaultQa: '/dsh-pet/api/locus-default-qa',
      todos: '/dsh-pet/api/locus-todos',
      todoAction: '/dsh-pet/api/locus-todo-action',
    })
    expect(LOCUS_VIEW_ROUTE).toBe(LOCUS_ROUTES.view)
    expect(LOCUS_ACTION_ROUTE).toBe(LOCUS_ROUTES.action)
    expect(LOCUS_DEFAULT_QA_ROUTE).toBe(LOCUS_ROUTES.defaultQa)
    expect(Object.values(ROUTES)).not.toContain(LOCUS_ROUTES.view)
  })

  it('serializes the v20 view without removed or secret fields', () => {
    const view: PetLocusManagementViewV20 = {
      generation: 3,
      writeEnabled: false,
      works: [{
        work: { sessionId: 'session-work', title: '干活', availability: 'archived' },
        chats: [{
          group: {
            locusId: 'locus-1', revision: 4, endpoint: { chatId: 'oc_chat' }, sessionId: 'session-child',
            session: { title: '子会话', availability: 'available' }, state: 'active', accessMode: 'read-only',
            inFlight: false, hasCurrentDelivery: false, createdAt: 1, updatedAt: 2,
          },
          topics: [{
            locusId: 'locus-2', revision: 1, endpoint: { chatId: 'oc_chat', threadId: 'omt_thread' }, sessionId: 'session-reserved',
            state: 'not-created', accessMode: 'read-only', inFlight: false, hasCurrentDelivery: false, createdAt: 1, updatedAt: 1,
          }],
          locusMain: { sessionId: 'session-main' },
          workspace: { workspaceId: 'ws-1' },
          reboundFrom: { sessionId: 'session-old' },
          defaultQa: true,
        }],
      }],
    }
    const json = JSON.parse(JSON.stringify(view)) as PetLocusManagementViewV20
    expect(json).toEqual(view)
    const text = JSON.stringify(view)
    for (const removed of ['parentLocusId', 'childComposition', 'toolTier', 'contextAnchor', 'permission', 'busy', 'replacesLocusId', 'childSessionId', 'token', 'secret']) {
      expect(text).not.toContain(removed)
    }
    expect(PET_LOCUS_STATES_V20).toEqual(['not-created', 'active', 'invalid', 'stopped'])
  })

  it('keeps v20 mutation actions discriminated and fenced by locusId + revision only', () => {
    const fence = { expectedLocusId: 'locus-1', expectedRevision: 4 }
    const actions: readonly PetLocusActionRequestV20[] = [
      { action: 'stop', endpoint: { chatId: 'oc_chat' }, ...fence },
      { action: 'access', endpoint: { chatId: 'oc_chat', threadId: 'omt_thread' }, accessMode: 'read-only', ...fence },
      { action: 'rebind', chatId: 'oc_chat', workSessionId: 'session-w1', ...fence },
    ]
    expect(actions.map(item => item.action)).toEqual(['stop', 'access', 'rebind'])
    const text = JSON.stringify(actions)
    for (const removed of ['expectedGeneration', 'expectedUpdatedAt', 'childSessionId', 'permission', 'parentSessionId']) {
      expect(text).not.toContain(removed)
    }
  })
})
