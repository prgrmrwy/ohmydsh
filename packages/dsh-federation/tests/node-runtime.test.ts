import { describe, expect, it, vi } from 'vitest'
import { NodeProjectionRuntime, type NodeBaseline } from '../src/client/node-runtime.js'
import { encodeSessionId, encodeWorkspaceId, parseNodeId, type NativeSessionId, type NativeWorkspaceId } from '../src/core/index.js'

const vmA = parseNodeId('vm-a')
const vmB = parseNodeId('vm-b')

const sid = (node: typeof vmA, native: string) => encodeSessionId({ nodeId: node, nativeId: native as NativeSessionId })
const wid = (node: typeof vmA, native: string) => encodeWorkspaceId({ nodeId: node, nativeId: native as NativeWorkspaceId })

/** Both nodes deliberately use the SAME native ids and titles. */
function baseline(node: typeof vmA): NodeBaseline {
  return {
    workspaces: [{
      workspaceId: wid(node, 'shared'),
      path: '/shared/project',
      title: 'shared-workspace',
      sessionIds: [sid(node, 'shared')],
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:01.000Z',
    }],
    sessions: [{
      id: sid(node, 'shared'),
      displayTitle: 'shared-session',
      cwd: '/shared/project',
      running: false,
      blank: false,
      updatedAt: 1000,
    }],
    archivedSessionIds: [],
  }
}

describe('per-node browser projection', () => {
  it('exposes exactly the two store shapes the official subtree reads', () => {
    const runtime = new NodeProjectionRuntime(vmA)
    expect(runtime.ready).toBe(false)
    expect(runtime.workspacesState.phase).toBe('loading')
    runtime.installBaseline(baseline(vmA))
    expect(runtime.ready).toBe(true)
    expect(runtime.sessionsState.phase).toBe('ready')
    expect(runtime.sessionsState.ids).toEqual([sid(vmA, 'shared')])
    expect(runtime.workspacesState.items[0]!.sessionIds).toEqual([sid(vmA, 'shared')])
    expect(runtime.workspacesState.recentWorkspaceId).toBe(wid(vmA, 'shared'))
    expect(runtime.workspacesState.error).toBeNull()
  })

  it('never lets another node\'s frame mutate this projection, even with identical native ids', () => {
    const a = new NodeProjectionRuntime(vmA)
    const b = new NodeProjectionRuntime(vmB)
    a.installBaseline(baseline(vmA))
    b.installBaseline(baseline(vmB))

    // A status frame for vm-b must be refused by vm-a and accepted by vm-b.
    const frame = { type: 'host/session-status' as const, sessionId: sid(vmB, 'shared'), running: true }
    expect(a.accept(frame)).toBe(false)
    expect(b.accept(frame)).toBe(true)
    expect(a.sessionsState.byId[sid(vmA, 'shared')]!.running).toBe(false)
    expect(b.sessionsState.byId[sid(vmB, 'shared')]!.running).toBe(true)

    // Same for workspace removal.
    expect(a.accept({ type: 'host/workspace-removed', workspaceId: wid(vmB, 'shared') })).toBe(false)
    expect(a.workspacesState.items).toHaveLength(1)
  })

  it('applies title projections under higher-seq-wins', () => {
    const runtime = new NodeProjectionRuntime(vmA)
    runtime.installBaseline(baseline(vmA))
    const session = sid(vmA, 'shared')

    runtime.accept({ type: 'session/projection', sessionId: session, key: 'title', value: 'newer', seq: 8 })
    expect(runtime.sessionsState.byId[session]!.displayTitle).toBe('newer')

    // A late lower-seq frame must not overwrite.
    runtime.accept({ type: 'session/projection', sessionId: session, key: 'title', value: 'stale', seq: 3 })
    expect(runtime.sessionsState.byId[session]!.displayTitle).toBe('newer')

    runtime.accept({ type: 'session/projection', sessionId: session, key: 'title', value: 'newest', seq: 12 })
    expect(runtime.sessionsState.byId[session]!.displayTitle).toBe('newest')

    // Non-title keys and non-string values are ignored rather than trusted.
    expect(runtime.accept({ type: 'session/projection', sessionId: session, key: 'other', value: 'x', seq: 99 })).toBe(false)
    expect(runtime.accept({ type: 'session/projection', sessionId: session, key: 'title', value: 42, seq: 99 })).toBe(false)
    expect(runtime.sessionsState.byId[session]!.displayTitle).toBe('newest')
  })

  it('treats an archive frame as authoritative only for its own node slice', () => {
    const runtime = new NodeProjectionRuntime(vmA)
    runtime.installBaseline(baseline(vmA))
    runtime.accept({
      type: 'host/archived-sessions-changed',
      archivedSessionIds: [sid(vmA, 'shared'), sid(vmB, 'shared')],
    })
    expect(runtime.workspacesState.archivedSessionIds).toEqual([sid(vmA, 'shared')])
  })

  it('adds, replaces and removes workspaces from host frames', () => {
    const runtime = new NodeProjectionRuntime(vmA)
    runtime.installBaseline(baseline(vmA))
    const added = {
      workspaceId: wid(vmA, 'second'), path: '/second', title: 'second',
      sessionIds: [], createdAt: 'x', updatedAt: 'y',
    }
    runtime.accept({ type: 'host/workspace-changed', workspace: added })
    expect(runtime.workspacesState.items).toHaveLength(2)

    runtime.accept({ type: 'host/workspace-changed', workspace: { ...added, title: 'renamed' } })
    expect(runtime.workspacesState.items).toHaveLength(2)
    expect(runtime.workspacesState.items.find(item => item.workspaceId === added.workspaceId)!.title).toBe('renamed')

    runtime.accept({ type: 'host/workspace-removed', workspaceId: added.workspaceId })
    expect(runtime.workspacesState.items).toHaveLength(1)
  })

  it('drops a removed session and clears it from current', () => {
    const runtime = new NodeProjectionRuntime(vmA)
    runtime.installBaseline(baseline(vmA))
    const session = sid(vmA, 'shared')
    runtime.setCurrent(session)
    expect(runtime.sessionsState.current).toBe(session)
    runtime.accept({ type: 'host/session-removed', sessionId: session })
    expect(runtime.sessionsState.ids).toEqual([])
    expect(runtime.sessionsState.current).toBeUndefined()
  })

  it('refuses a current id that is foreign or unknown', () => {
    const runtime = new NodeProjectionRuntime(vmA)
    runtime.installBaseline(baseline(vmA))
    runtime.setCurrent(sid(vmB, 'shared'))
    expect(runtime.sessionsState.current).toBeUndefined()
    runtime.setCurrent(sid(vmA, 'never-seen'))
    expect(runtime.sessionsState.current).toBeUndefined()
  })

  it('notifies subscribers and keeps the stale tree on invalidate', () => {
    const runtime = new NodeProjectionRuntime(vmA)
    const listener = vi.fn()
    const stop = runtime.subscribe(listener)
    runtime.installBaseline(baseline(vmA))
    expect(listener).toHaveBeenCalled()

    runtime.invalidate()
    expect(runtime.ready).toBe(false)
    // A disconnected node keeps its last known tree as a read-only skeleton.
    expect(runtime.workspacesState.items).toHaveLength(1)
    expect(runtime.sessionsState.ids).toHaveLength(1)

    stop()
    const before = listener.mock.calls.length
    runtime.accept({ type: 'host/session-status', sessionId: sid(vmA, 'shared'), running: true })
    expect(listener.mock.calls.length).toBe(before)
  })

  it('ignores unknown frame types instead of throwing', () => {
    const runtime = new NodeProjectionRuntime(vmA)
    runtime.installBaseline(baseline(vmA))
    expect(runtime.accept({ type: 'host/remote-event', event: 'x', args: [] })).toBe(false)
    expect(runtime.accept({ type: 'stream/error', error: {} })).toBe(false)
  })
})
