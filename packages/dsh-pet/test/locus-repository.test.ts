import { describe, expect, it } from 'vitest'
import {
  endpointFromKey,
  endpointKeyOf,
  LocusError,
  normalizeLocusEndpoint,
  type LocusEndpoint,
} from '../src/host/locus/aggregate.js'
import { LocusRepository } from '../src/host/locus/repository.js'

const CHAT = ' oc_project '
const THREAD_A = ' topic-a '
const THREAD_B = 'topic-b'

function endpoint(threadId?: string): LocusEndpoint {
  return threadId === undefined ? { chatId: CHAT } : { chatId: CHAT, threadId }
}

function locusInput(
  overrides: Partial<Parameters<LocusRepository['ensureLocus']>[0]> = {},
) {
  return {
    endpoint: endpoint(),
    parentSessionId: 'session-main',
    childSessionId: 'child-chat',
    workspaceId: 'workspace-main',
    source: 'auto' as const,
    ...overrides,
  }
}

describe('unified locus endpoint normalization', () => {
  it('normalizes chat and optional thread ids and keeps their keys distinct', () => {
    const chat = normalizeLocusEndpoint({ chatId: '  oc_chat  ', threadId: '   ' })
    const topic = normalizeLocusEndpoint({ chatId: ' oc_chat ', threadId: ' omt_thread ' })

    expect(chat.endpoint).toEqual({ chatId: 'oc_chat' })
    expect(topic.endpoint).toEqual({ chatId: 'oc_chat', threadId: 'omt_thread' })
    expect(chat.key).toBe('oc_chat')
    expect(topic.key).toBe(`oc_chat\u0000omt_thread`)
    expect(endpointFromKey(topic.key)).toEqual(topic.endpoint)
    expect(endpointKeyOf(chat.endpoint)).not.toBe(endpointKeyOf(topic.endpoint))
  })

  it('rejects missing ids and delimiter injection', () => {
    expect(() => normalizeLocusEndpoint({ chatId: ' ' })).toThrow(LocusError)
    expect(() => normalizeLocusEndpoint({ chatId: 'oc_chat\u0000other' })).toThrow(
      /may not contain NUL/,
    )
    expect(() => endpointFromKey('')).toThrow(LocusError)
  })
})

describe('LocusRepository aggregate and indexes', () => {
  it('ensures idempotently and maintains endpoint, parent, and child indexes', () => {
    const repository = new LocusRepository({ now: () => 100 })
    const first = repository.ensureLocus(locusInput())
    const repeated = repository.ensureLocus(
      locusInput({ endpoint: { chatId: 'oc_project' }, childSessionId: first.childSessionId }),
    )

    expect(repeated).toBe(first)
    expect(first.endpoint).toEqual({ chatId: 'oc_project' })
    expect(Object.isFrozen(first.endpoint)).toBe(true)
    expect(repository.size).toBe(1)
    expect(repository.getCurrent({ chatId: 'oc_project' })).toBe(first)
    expect(repository.listByParent('session-main')).toEqual([first])
    expect(repository.getByChild('child-chat')).toBe(first)
    expect(repository.indexSnapshot().endpointToCurrent.get('oc_project')).toBe(first.id)
  })

  it('allows one parent to fan out into independent topic children', () => {
    const repository = new LocusRepository()
    const group = repository.ensureLocus(locusInput({ id: 'group', childSessionId: 'child-group' }))
    const topicA = repository.ensureLocus(
      locusInput({
        id: 'topic-a',
        endpoint: endpoint(THREAD_A),
        parentLocusId: group.id,
        childSessionId: 'child-topic-a',
        source: 'inherited',
      }),
    )
    const topicB = repository.ensureLocus(
      locusInput({
        id: 'topic-b',
        endpoint: endpoint(THREAD_B),
        parentLocusId: group.id,
        childSessionId: 'child-topic-b',
        source: 'inherited',
      }),
    )

    expect(topicA.parentLocusId).toBe(group.id)
    expect(topicB.parentLocusId).toBe(group.id)
    expect(repository.listByParent('session-main').map(item => item.id)).toEqual([
      'group',
      'topic-a',
      'topic-b',
    ])
    expect(repository.getByChild('child-topic-a')).toBe(topicA)
    expect(repository.getByChild('child-topic-b')).toBe(topicB)
    expect(repository.getCurrent({ chatId: 'oc_project', threadId: THREAD_A.trim() })).toBe(topicA)
    expect(repository.getCurrent({ chatId: 'oc_project', threadId: THREAD_B })).toBe(topicB)
  })

  it('rejects a topic whose parent is another topic or another chat', () => {
    const repository = new LocusRepository()
    const group = repository.ensureLocus(locusInput({ id: 'group', childSessionId: 'child-group' }))
    const topic = repository.ensureLocus(
      locusInput({
        id: 'topic',
        endpoint: endpoint(THREAD_A),
        parentLocusId: group.id,
        childSessionId: 'child-topic',
        source: 'inherited',
      }),
    )

    expect(() =>
      repository.ensureLocus(
        locusInput({
          endpoint: endpoint('nested'),
          parentLocusId: topic.id,
          childSessionId: 'child-nested',
          source: 'inherited',
        }),
      ),
    ).toThrow(/topic locus as its parent/)
    expect(() =>
      repository.ensureLocus(
        locusInput({
          endpoint: { chatId: 'oc_other', threadId: 'thread' },
          parentLocusId: group.id,
          childSessionId: 'child-other',
          source: 'inherited',
        }),
      ),
    ).toThrow(/same chat/)
  })

  it('keeps the default Q&A pointer independent from issue/topic fan-out', () => {
    const repository = new LocusRepository()
    const qa = repository.ensureDefaultQa(
      locusInput({ id: 'qa', childSessionId: 'child-qa', source: 'auto' }),
    )
    const issue = repository.ensureLocus(
      locusInput({
        id: 'issue',
        endpoint: endpoint('issue'),
        parentLocusId: qa.id,
        childSessionId: 'child-issue',
        source: 'explicit',
      }),
    )

    expect(qa.source).toBe('qa-created')
    expect(repository.getDefaultQa('session-main')).toBe(qa)
    expect(repository.ensureDefaultQa(locusInput({ id: 'ignored', childSessionId: 'child-new' }))).toBe(qa)
    expect(repository.getCurrent(endpoint('issue'))).toBe(issue)
    expect(repository.getDefaultQa('session-main')).toBe(qa)
    expect(() => repository.setDefaultQa('session-main', issue.id)).toThrow(/already has default Q&A/)
  })

  it('separates stopped and invalid tombstones from never-created and requires explicit rebuild', () => {
    const repository = new LocusRepository()
    const stopped = repository.ensureLocus(locusInput({ id: 'stopped', childSessionId: 'child-stopped' }))
    repository.stopLocus(stopped.id)

    expect(repository.getCurrent(endpoint())?.state).toBe('stopped')
    expect(() => repository.ensureLocus(locusInput({ childSessionId: 'child-new' }))).toThrow(
      /stopped/,
    )
    const rebuilt = repository.rebuildLocus(
      locusInput({ id: 'rebuilt', childSessionId: 'child-rebuilt', source: 'auto' }),
    )
    expect(rebuilt.generation).toBe(2)
    expect(repository.getCurrent(endpoint())).toBe(rebuilt)
    expect(repository.getLocus(stopped.id)?.state).toBe('stopped')

    repository.retireLocus(rebuilt.id)
    expect(repository.getCurrent(endpoint())).toBeUndefined()
    expect(repository.listByEndpoint(endpoint()).map(item => item.state)).toEqual([
      'stopped',
      'retired',
    ])
    expect(() => repository.ensureLocus(locusInput({ id: 'fresh', childSessionId: 'child-fresh' }))).not.toThrow()

    const invalid = repository.ensureLocus(
      locusInput({ endpoint: { chatId: 'oc_invalid' }, id: 'invalid', childSessionId: 'child-invalid' }),
    )
    repository.invalidateLocus(invalid.id, 'parent unavailable')
    expect(repository.getCurrent({ chatId: 'oc_invalid' })?.state).toBe('invalid')
    expect(() =>
      repository.ensureLocus(
        locusInput({ endpoint: { chatId: 'oc_invalid' }, parentLocusId: undefined, childSessionId: 'child-invalid-new' }),
      ),
    ).toThrow(/invalid/)
    const repaired = repository.rebuildLocus(
      locusInput({ endpoint: { chatId: 'oc_invalid' }, id: 'repaired', childSessionId: 'child-repaired' }),
    )
    expect(repaired.generation).toBe(2)
    expect(repository.getCurrent({ chatId: 'oc_invalid' })).toBe(repaired)
  })

  it('replaces an idle automatic generation only through explicit replacement', () => {
    const repository = new LocusRepository()
    const automatic = repository.ensureLocus(locusInput({ id: 'auto', childSessionId: 'child-auto' }))

    expect(() =>
      repository.ensureLocus(
        locusInput({ source: 'explicit', childSessionId: 'child-explicit', parentSessionId: 'session-other', workspaceId: 'workspace-other' }),
      ),
    ).toThrow(/replacement/)

    const explicit = repository.replaceAutomaticWithExplicit(
      endpoint(),
      locusInput({
        id: 'explicit',
        source: 'explicit',
        childSessionId: 'child-explicit',
        parentSessionId: 'session-other',
        workspaceId: 'workspace-other',
      }),
    )

    expect(explicit.generation).toBe(2)
    expect(explicit.source).toBe('explicit')
    expect(explicit.permission).toEqual({ desired: 'read', effective: 'read' })
    expect(explicit.replacesLocusId).toBe(automatic.id)
    expect(repository.getCurrent(endpoint())).toBe(explicit)
    expect(repository.getLocus(automatic.id)?.state).toBe('retired')
    expect(repository.getByChild('child-auto')?.id).toBe(automatic.id)
    expect(repository.getByChild('child-auto')?.state).toBe('retired')

    expect(() =>
      repository.replaceAutomaticWithExplicit(
        endpoint(),
        locusInput({ source: 'explicit', childSessionId: 'child-third' }),
      ),
    ).toThrow(/explicit source/)
  })

  it('rejects replacement while busy and maintains immutable history', () => {
    const repository = new LocusRepository()
    const automatic = repository.ensureLocus(locusInput({ id: 'auto', childSessionId: 'child-auto' }))
    repository.markBusy(automatic.id)

    expect(() =>
      repository.replaceAutomaticWithExplicit(
        endpoint(),
        locusInput({ source: 'explicit', childSessionId: 'child-explicit' }),
      ),
    ).toThrow(/accepted work|busy/)
    expect(repository.getCurrent(endpoint())?.id).toBe(automatic.id)
    expect(repository.getCurrent(endpoint())?.busy).toBe(true)
    expect(repository.getLocus(automatic.id)?.state).toBe('active')

    repository.clearBusy(automatic.id)
    const replacement = repository.replaceAutomaticWithExplicit(
      endpoint(),
      locusInput({ source: 'explicit', childSessionId: 'child-explicit' }),
    )
    expect(repository.getLocus(automatic.id)?.state).toBe('retired')
    expect(repository.listByParent('session-main').map(item => item.id)).toEqual([
      automatic.id,
      replacement.id,
    ])
  })

  it('enforces parent workspace consistency and unique child ownership', () => {
    const repository = new LocusRepository()
    repository.ensureLocus(locusInput({ childSessionId: 'child-one' }))
    expect(() =>
      repository.ensureLocus(
        locusInput({
          endpoint: endpoint('other'),
          parentLocusId: repository.getCurrent(endpoint())!.id,
          childSessionId: 'child-two',
          workspaceId: 'workspace-other',
          source: 'inherited',
        }),
      ),
    ).toThrow(/belongs to workspace/)
    expect(() =>
      repository.ensureLocus(
        locusInput({
          endpoint: endpoint('other'),
          parentLocusId: repository.getCurrent(endpoint())!.id,
          childSessionId: 'child-one',
          source: 'inherited',
        }),
      ),
    ).toThrow(/already belongs/)
  })

  it('exposes consistent endpoint and parent discovery projections', () => {
    const repository = new LocusRepository()
    const first = repository.ensureLocus(locusInput({ id: 'first', childSessionId: 'child-first' }))
    const topic = repository.ensureLocus(
      locusInput({
        id: 'topic',
        endpoint: endpoint('topic'),
        parentLocusId: first.id,
        childSessionId: 'child-topic',
        source: 'inherited',
      }),
    )
    const endpointView = repository.discoverByEndpoint(endpoint('topic'))
    const parentView = repository.discoverByParent('session-main')
    const childView = repository.discoverByChild('child-topic')

    expect(endpointView.current).toBe(topic)
    expect(endpointView.history).toEqual([topic])
    expect(parentView.loci).toEqual([first, topic])
    expect(childView).toBe(topic)
    expect(parentView.loci).toContain(childView)
    expect(repository.indexSnapshot().childToLocus.get('child-topic')).toBe(topic.id)
  })

  it('rejects backward timestamps across lifecycle and permission fences', () => {
    const repository = new LocusRepository({ now: () => 10 })
    const locus = repository.ensureLocus(locusInput())
    expect(() => repository.markBusy(locus.id, 9)).toThrow(/monotonic/)
    expect(() => repository.setPermissionMode(locus.id, 'write', 'owner', 10, 9)).toThrow(/monotonic/)
    repository.markBusy(locus.id, 10)
    expect(() => repository.stopLocus(locus.id, 11)).toThrow(/busy/)
  })

  it('records verified permission changes separately from association creation', () => {
    const repository = new LocusRepository()
    const locus = repository.ensureLocus(locusInput())
    expect(locus.permission).toEqual({ desired: 'read', effective: 'read' })

    expect(() => repository.setPermissionMode(locus.id, 'write', 'owner', 10)).not.toThrow()
    expect(repository.getLocus(locus.id)?.permission).toEqual({
      desired: 'write',
      effective: 'write',
      grantedBy: 'owner',
      verifiedAt: 10,
    })
    repository.setPermissionMode(locus.id, 'read', 'owner', 20)
    expect(repository.getLocus(locus.id)?.permission.effective).toBe('read')

    repository.markBusy(locus.id)
    expect(() => repository.setPermissionMode(locus.id, 'write', 'owner', 30)).toThrow(/busy/)
  })
})
