import { describe, expect, it, vi } from 'vitest'
import {
  encodeSessionId,
  parseNodeId,
  type FederatedSessionId,
  type NativeSessionId,
  type NodeCapability,
} from '../src/core/index.js'
import {
  ProviderIconCoordinator,
  WORKSPACE_ROW_MENU_SLOT,
  extensionActionsFor,
  offersExtensionAction,
  renderRowMenuEntries,
  resolveProviderBadge,
  workspaceRowMenuOwnerProps,
  type RowMenuEntry,
} from '../src/client/shell/index.js'

const local = parseNodeId('this-mac')
const vmA = parseNodeId('vm-a')
const sessionLocal = encodeSessionId({ nodeId: local, nativeId: 'shared' as NativeSessionId })
const sessionRemote = encodeSessionId({ nodeId: vmA, nativeId: 'shared' as NativeSessionId })

describe('workspace row-menu seam (8.1, 8.2)', () => {
  it('declares the exact slot name third-party plugins already target', () => {
    expect(WORKSPACE_ROW_MENU_SLOT).toBe('sidebar.workspaces.row-menu')
  })

  it('passes a real cwd only for This Mac and hides local-editor rows for remote nodes', () => {
    const localOwner = workspaceRowMenuOwnerProps({
      nodeId: local, localNodeId: local, workspaceTitle: 'Local', workspacePath: '/local/project', closeMenu: () => {},
    })
    expect(localOwner).toMatchObject({ cwd: '/local/project', label: 'Local' })

    const remoteOwner = workspaceRowMenuOwnerProps({
      nodeId: vmA, localNodeId: local, workspaceTitle: 'Remote', workspacePath: '/remote/project', closeMenu: () => {},
    })
    // The real dsh-open-in-vscode row returns null when cwd is undefined.
    expect(remoteOwner.cwd).toBeUndefined()
    expect(remoteOwner.label).toBe('Remote')
  })

  it('keeps registration order and isolates one failing occupant from the rest', () => {
    const closeMenu = vi.fn()
    const owner = workspaceRowMenuOwnerProps({
      nodeId: local, localNodeId: local, workspaceTitle: 'Local', workspacePath: '/local', closeMenu,
    })
    const entries: RowMenuEntry[] = [
      { registrant: 'official:rename', render: () => 'rename' },
      { registrant: 'official:delete', render: () => 'delete' },
      { registrant: 'third-party:boom', render: () => { throw new Error('occupant crashed') } },
      { registrant: 'dsh-open-in-vscode', render: props => `open:${props.cwd}` },
    ]
    const outcome = renderRowMenuEntries(entries, owner)
    expect(outcome.rendered.map(row => row.registrant)).toEqual(['official:rename', 'official:delete', 'dsh-open-in-vscode'])
    expect(outcome.rendered.at(-1)!.node).toBe('open:/local')
    expect(outcome.failed.map(row => row.registrant)).toEqual(['third-party:boom'])
    owner.onClose()
    expect(closeMenu).toHaveBeenCalledTimes(1)
  })
})

describe('provider icon renderer (8.3, 8.4)', () => {
  const sources = {
    selected: (id: FederatedSessionId) => (id === sessionLocal ? { provider: 'anthropic', model: 'claude' } : undefined),
    projected: (id: FederatedSessionId) => (id === sessionRemote ? { provider: 'grok', model: 'grok-4' } : undefined),
  }

  it('prefers the live selector value and falls back to the host projection', () => {
    expect(resolveProviderBadge(sessionLocal, local, sources)).toMatchObject({ provider: 'anthropic', source: 'selector' })
    expect(resolveProviderBadge(sessionRemote, vmA, sources)).toMatchObject({ provider: 'grok', source: 'projection' })
    expect(resolveProviderBadge(encodeSessionId({ nodeId: vmA, nativeId: 'unknown' as NativeSessionId }), vmA, sources)).toBeUndefined()
  })

  it('stops DOM injection while federated and restores it on fallback, with no double badge', () => {
    const control = { start: vi.fn(), stop: vi.fn() }
    const coordinator = new ProviderIconCoordinator(control)
    coordinator.setFederated(false)
    expect(coordinator.domObserverRunning).toBe(true)
    expect(coordinator.rowRendererActive).toBe(false)

    coordinator.setFederated(true)
    expect(coordinator.domObserverRunning).toBe(false)
    expect(coordinator.rowRendererActive).toBe(true)
    // Exactly one renderer is ever active, so no duplicate logo can appear.
    expect(coordinator.rowRendererActive !== coordinator.domObserverRunning).toBe(true)

    coordinator.setFederated(true)
    expect(control.stop).toHaveBeenCalledTimes(1)

    coordinator.setFederated(false)
    expect(coordinator.domObserverRunning).toBe(true)
    expect(control.start).toHaveBeenCalledTimes(2)
    coordinator.dispose()
    expect(coordinator.domObserverRunning).toBe(false)
  })
})

describe('per-node extension actions (8.5, 8.6)', () => {
  const none = new Set<NodeCapability>()
  it('keeps central-machine editor actions on This Mac only', () => {
    expect(offersExtensionAction('open-in-editor', { nodeId: local, localNodeId: local, capabilities: none })).toBe(true)
    expect(offersExtensionAction('open-in-editor', { nodeId: vmA, localNodeId: local, capabilities: none })).toBe(false)
  })

  it('offers remote unarchive and worktree actions only when that node proved the protocol', () => {
    expect(offersExtensionAction('unarchive', { nodeId: vmA, localNodeId: local, capabilities: none })).toBe(false)
    expect(offersExtensionAction('unarchive', { nodeId: vmA, localNodeId: local, capabilities: new Set<NodeCapability>(['extension.unarchive']) })).toBe(true)
    expect(offersExtensionAction('worktree-session', { nodeId: vmA, localNodeId: local, capabilities: none })).toBe(false)
    expect(offersExtensionAction('worktree-session', { nodeId: vmA, localNodeId: local, capabilities: new Set<NodeCapability>(['extension.worktree']) })).toBe(true)
  })

  it('lists This Mac equivalence and conservative remote defaults', () => {
    expect(extensionActionsFor({ nodeId: local, localNodeId: local, capabilities: none }))
      .toEqual(['open-in-editor', 'unarchive', 'worktree-session'])
    expect(extensionActionsFor({ nodeId: vmA, localNodeId: local, capabilities: none })).toEqual([])
    expect(extensionActionsFor({ nodeId: vmA, localNodeId: local, capabilities: new Set<NodeCapability>(['extension.unarchive']) }))
      .toEqual(['unarchive'])
  })
})
