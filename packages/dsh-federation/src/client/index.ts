/** Disabled browser skeleton; contributes no slots until M2 activation. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export {
  Rc2WorkspaceNodeSection,
  createWorkspaceViewStore,
} from '../../.generated/workspace-embed/src/client/federation.ts'
export type {
  Rc2WorkspaceNodeSectionProps,
  SessionGroupBy,
  SessionOrderBy,
} from '../../.generated/workspace-embed/src/client/federation.ts'

export * from './activation.js'
import { applyFederationClient, type FederationClientOptions } from './entry.js'
import { createRuntimeBridge } from './runtime-bridge.js'
export * from './shell/index.js'

export const name = 'dsh-federation'
export const inject = ['slots', 'sessions', 'workspaces', 'connection']

export * from './bridge.js'
export * from './entry.js'
export * from './runtime-bridge.js'

/**
 * Browser entry. Federation contributes nothing until a federated bridge is
 * supplied and reports readiness, so a deployed-but-inactive package leaves the
 * official sidebar and hero picker exactly as they are.
 */
export function apply(ctx: ClientContext, config?: FederationClientOptions): void {
  // A caller-supplied bridge wins (tests, embedders). Otherwise build one from
  // the generic Connection channel so a YAML-loaded plugin can activate too:
  // without this the browser could never obtain node facts and would always
  // fall back to the official UI.
  const resolved = config?.bridge !== undefined ? config : { ...config, bridge: createRuntimeBridge(ctx) }
  const dispose = applyFederationClient(ctx, resolved)
  ctx.effect(() => dispose, 'dsh-federation: client activation')
}
