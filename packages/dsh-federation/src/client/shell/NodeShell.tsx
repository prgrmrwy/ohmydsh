import { Fragment, createElement, type ReactNode } from 'react'
import { Rc2WorkspaceNodeSection, type Rc2WorkspaceNodeSectionProps } from '../../../.generated/workspace-embed/src/client/federation.ts'
import { nodeSectionKey, overlayNamespaceOf } from './node-binding.ts'
import type { NodeRow } from './node-row.ts'
import type { SessionGroupBy, SessionOrderBy } from './view-controls.ts'

/**
 * Everything one mounted node contributes to the official subtree. The
 * federated shell owns node rows and global controls; this bundle carries the
 * node-scoped runtime hooks, store, actions and Host facts the official section
 * consumes unchanged.
 */
export interface NodeSectionBinding extends Pick<
  Rc2WorkspaceNodeSectionProps,
  | 'useSessions'
  | 'useWorkspaces'
  | 'useStore'
  | 'actions'
  | 'startSession'
  | 'open'
  | 'renameSession'
  | 'forkSession'
  | 'renameWorkspace'
  | 'deleteWorkspace'
  | 'insertWorkspaceBefore'
  | 'archiveSession'
  | 'insertSessionBefore'
  | 't'
> {
  readonly row: NodeRow
  /** Node host account home; official rows abbreviate paths against it. */
  readonly home?: string | undefined
}

export interface FederatedNodeShellProps {
  readonly bindings: readonly NodeSectionBinding[]
  readonly groupBy: SessionGroupBy
  readonly orderBy: SessionOrderBy
  /** One caller-owned render instant shared by every node's relative times. */
  readonly now: number
  /** Federated shell chrome: node header row, status, counts, collapse control. */
  renderNodeHeader(row: NodeRow): ReactNode
  /** Optional read-only skeleton for a stale or offline node. */
  renderSkeleton?(row: NodeRow): ReactNode
}

/**
 * Renders one official rc.2 Workspace/Session subtree per node.
 *
 * Each node gets a stable React key, its own view store, its own dialog/portal
 * namespace and its own action bindings, so expansion, selection, drag state and
 * overlays never leak between nodes. The federated shell contributes only the
 * node chrome around each section.
 */
export function FederatedNodeShell({
  bindings,
  groupBy,
  orderBy,
  now,
  renderNodeHeader,
  renderSkeleton,
}: FederatedNodeShellProps) {
  return createElement(Fragment, null, ...bindings.map(binding => {
    const { row, home, ...section } = binding
    const body = row.showsSkeleton && renderSkeleton !== undefined
      ? renderSkeleton(row)
      : row.expandable
        ? createElement(Rc2WorkspaceNodeSection, {
          ...section,
          nodeKey: nodeSectionKey(row.nodeId),
          overlayNamespace: overlayNamespaceOf(row.nodeId),
          groupBy,
          orderBy,
          home,
          now,
        })
        : null
    return createElement(Fragment, { key: nodeSectionKey(row.nodeId) }, renderNodeHeader(row), body)
  }))
}
