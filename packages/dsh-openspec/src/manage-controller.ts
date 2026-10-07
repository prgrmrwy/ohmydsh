import { validStableTarget } from './upgrade-transaction.js'

export type ManagementResult = { status: 'ok' | 'blocked' | 'failed'; target?: string; activation?: 'live' | 'pending-reload'; reason?: string; details?: unknown }
export type ManagementActions = {
  transact: (target: string, consent: { approved: boolean }) => Promise<ManagementResult>
  refreshProject: () => Promise<unknown>
}
export function createManagementController(actions: ManagementActions) {
  return {
    async upgrade(target: string, consent: { approved: boolean }): Promise<ManagementResult> {
      if (!consent.approved) return { status: 'blocked', reason: 'explicit-approval-required' }
      if (!validStableTarget(target)) return { status: 'blocked', reason: 'invalid-stable-version' }
      return actions.transact(target, consent)
    },
    async rollback(target: string, consent: { approved: boolean }): Promise<ManagementResult> {
      if (!consent.approved) return { status: 'blocked', reason: 'explicit-approval-required' }
      if (!validStableTarget(target)) return { status: 'blocked', reason: 'invalid-stable-version' }
      return actions.transact(target, consent)
    },
    async refreshProject(consent: { approved: boolean }) {
      if (!consent.approved) return { status: 'blocked', reason: 'explicit-project-refresh-approval-required' }
      await actions.refreshProject()
      return { status: 'ok' }
    },
  }
}
