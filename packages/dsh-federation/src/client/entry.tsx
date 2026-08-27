import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createWorkspaceViewStore } from '../../.generated/workspace-embed/src/client/federation.ts'
import { ClientActivationController } from './activation.ts'
import { FederatedNodeShell, type NodeSectionBinding } from './shell/NodeShell.tsx'
import { FederatedHeroPicker } from './shell/hero-picker.ts'
import { deriveNodeRow, orderNodeRows } from './shell/node-row.ts'
import { bindNodeActions, nodeSectionKey } from './shell/node-binding.ts'
import type { NodeId } from '../core/types.ts'

/**
 * Slots federation shadows. The official entries register at the default
 * priority, so a lower number wins while federation is active and the official
 * entry resumes the moment federation abdicates.
 */
const FEDERATION_PRIORITY = -1
const SIDEBAR_SLOT = 'sidebar.workspaces'
const HERO_SLOT = 'conversation.hero.workspace'

/** The node facts the shell needs; supplied by the federated runtime bridge. */
export interface FederationClientBridge {
  /** Registered nodes in central persisted order. */
  nodes(): readonly {
    readonly nodeId: NodeId
    readonly displayName: string
    readonly kind: 'local' | 'remote'
    readonly enabled: boolean
    readonly order: number
    readonly state: Parameters<typeof deriveNodeRow>[0]['state']
    readonly compatibility: 'SUPPORTED' | 'EXPERIMENTAL' | 'INCOMPATIBLE'
    readonly runningSessionCount: number
    readonly pendingInteractionCount: number
    readonly outcomeUnknownCount: number
    readonly home?: string
  }[]
  /** Per-node runtime hooks and Host operations, already node-scoped. */
  bindingFor(nodeId: NodeId): Omit<NodeSectionBinding, 'row' | 'home'> | undefined
  /** True once the bridge has a usable baseline for every enabled node. */
  ready(): boolean
}

export interface FederationClientOptions {
  /** Federated runtime bridge; absent means "stay official". */
  readonly bridge?: FederationClientBridge
  readonly clientId?: string
  readonly timeoutMs?: number
  /** Bounded retries while the bridge is still settling. */
  readonly maxActivationAttempts?: number
  readonly retryMs?: number
}

/**
 * Composes the federated sidebar/hero surfaces for ONE browser.
 *
 * Nothing is registered until the bridge reports readiness, and any failure
 * disposes only this browser's contributions — the official entries remain the
 * winners, and neither the Host nor another tab is affected.
 */
export function applyFederationClient(ctx: ClientContext, options: FederationClientOptions = {}): () => void {
  const bridge = options.bridge
  if (bridge === undefined) return () => {}

  const stores = new Map<string, ReturnType<ReturnType<typeof createWorkspaceViewStore>['create']>>()
  const storeFor = (nodeId: NodeId) => {
    const key = nodeSectionKey(nodeId)
    const existing = stores.get(key)
    if (existing !== undefined) return existing
    const created = createWorkspaceViewStore().create(key)
    stores.set(key, created)
    return created
  }

  const renderShell = () => {
    const rows = orderNodeRows(bridge.nodes().map(node => deriveNodeRow(node)))
    const bindings: NodeSectionBinding[] = []
    for (const row of rows) {
      const bound = bridge.bindingFor(row.nodeId)
      if (bound === undefined) continue
      const home = bridge.nodes().find(node => node.nodeId === row.nodeId)?.home
      bindings.push({
        ...bound,
        row,
        ...(home === undefined ? {} : { home }),
        // Each node keeps its own view store so expansion, selection and drag
        // state never leak between nodes.
        useStore: bound.useStore ?? (selector => selector(storeFor(row.nodeId).getSnapshot())),
        actions: bound.actions ?? storeFor(row.nodeId).actions,
      })
    }
    return { rows, bindings }
  }

  const Sidebar = () => {
    const { bindings } = renderShell()
    return createElement(FederatedNodeShell, {
      bindings,
      groupBy: 'workspace',
      orderBy: 'manual',
      now: Date.now(),
      renderNodeHeader: row => createElement('div', {
        key: `${nodeSectionKey(row.nodeId)}:header`,
        'data-federation-node': row.nodeId,
        'data-federation-node-status': row.status,
      },
      row.displayName,
      row.outcomeUnknownCount > 0
        ? createElement('span', {
          role: 'status',
          'data-federation-outcome-unknown': row.outcomeUnknownCount,
          title: 'Remote write outcome is unknown; review the remote session before retrying.',
        }, ` · ${row.outcomeUnknownCount} outcome unknown — manual review required`)
        : null,
      ),
    })
  }

  /**
   * Federated hero picker: Node → Workspace selection for New Session.
   *
   * It shares the sidebar's ownership rules through `FederatedHeroPicker`, so a
   * blank session is reused instead of creating a second one, and a non-writable
   * node is never offered as a creation target.
   */
  const Hero = () => {
    const { rows, bindings } = renderShell()
    const picker = new FederatedHeroPicker({
      nodes: rows.map(row => ({
        nodeId: row.nodeId,
        displayName: row.displayName,
        writable: row.writable,
        directoryMode: row.kind === 'local' ? 'native' : 'browse',
      })),
      workspaces: bindings.flatMap(binding => {
        const state = binding.useWorkspaces(candidate => candidate) as unknown as {
          items?: readonly { workspaceId: string; title: string; path: string }[]
        }
        return (state.items ?? []).map(item => ({
          workspaceId: item.workspaceId as never,
          nodeId: binding.row.nodeId,
          title: item.title,
          path: item.path,
        }))
      }),
      blankSessions: bindings.flatMap(binding => {
        const state = binding.useSessions(candidate => candidate) as unknown as {
          byId?: Record<string, { blank?: boolean }>
        }
        return Object.entries(state.byId ?? {})
          .filter(([, summary]) => summary.blank === true)
          .map(([sessionId]) => ({ sessionId: sessionId as never, nodeId: binding.row.nodeId }))
      }),
    })

    return createElement('div', { 'data-federation-hero-picker': 'true' },
      ...picker.selectableNodes().map(node => createElement('div', {
        key: `${nodeSectionKey(node.nodeId)}:pick`,
        'data-federation-picker-node': node.nodeId,
        'data-federation-directory-mode': node.directoryMode,
      }, ...picker.workspacesOf(node.nodeId).map(workspace => createElement('button', {
        key: workspace.workspaceId,
        type: 'button',
        'data-federation-picker-workspace': workspace.workspaceId,
        onClick: () => {
          const outcome = picker.choose(workspace.workspaceId)
          const binding = bindings.find(candidate => candidate.row.nodeId === node.nodeId)
          if (outcome.kind === 'reuse-blank') binding?.open(outcome.sessionId)
          else if (outcome.kind === 'create-session') binding?.startSession(outcome.workspaceId)
        },
      }, workspace.title)))),
    )
  }

  const controller = new ClientActivationController({
    clientId: options.clientId ?? 'browser',
    slots: {
      register: (descriptor, component) => ctx.slots.register(descriptor as never, component as never),
      onEntryError: listener => ctx.slots.onEntryError((slotName: string, entry: { component: unknown }, error: unknown, info: { abdicated?: boolean; abdicate?: boolean }) =>
        listener(slotName, entry.component, error, { abdicated: info.abdicated ?? info.abdicate === true })),
    },
    contributions: [
      { slot: SIDEBAR_SLOT, priority: FEDERATION_PRIORITY, component: Sidebar },
      { slot: HERO_SLOT, priority: FEDERATION_PRIORITY, component: Hero },
    ],
    // The Host owns process-wide activation; a browser may only shadow slots
    // once its own bridge has a baseline.
    isHostReady: () => bridge.ready(),
    prepare: async () => {
      if (!bridge.ready()) throw new Error('dsh-federation: the federated bridge is not ready')
      const rows = bridge.nodes()
      if (rows.length === 0) throw new Error('dsh-federation: no nodes to render')
      for (const row of rows) {
        if (row.enabled && bridge.bindingFor(row.nodeId) === undefined) {
          throw new Error(`dsh-federation: node ${row.nodeId} has no runtime binding`)
        }
      }
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  // The bridge becomes ready asynchronously (it must ask the Host for the node
  // set), so a single activation attempt would permanently miss the window.
  // Re-attempt while the bridge reports readiness and this client is not yet
  // federated; a fallback caused by a crash or timeout is NOT retried, because
  // that decision belongs to this browser for its lifetime.
  let attempts = 0
  const maxAttempts = options.maxActivationAttempts ?? 40
  const retryMs = options.retryMs ?? 50
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const tryActivate = () => {
    if (stopped) return
    if (controller.state === 'CLIENT_FEDERATED' || controller.state === 'CLIENT_FALLBACK') return
    if (attempts++ >= maxAttempts) return
    if (!bridge.ready()) {
      timer = setTimeout(tryActivate, retryMs)
      return
    }
    void controller.activate().then(result => {
      // A failed *preparation* (bridge not settled yet) may be retried; an
      // abdication or timeout has already committed this client to official.
      if (!stopped && result.state === 'CLIENT_FALLBACK' && bridge.ready() === false) {
        timer = setTimeout(tryActivate, retryMs)
      }
    })
  }
  tryActivate()

  return () => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    controller.dispose()
  }
}
