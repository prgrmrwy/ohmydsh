import type { Address } from '../model/index.js'
const brand = Symbol('collab-principal')
export type Principal = ({ kind: 'agent' } & Address | { kind: 'provider'; providerId: string; on: Address } | { kind: 'internal'; purpose: 'breaker-reset' }) & { readonly [brand]: true }
export const principals = {
  agent: (address: Address): Principal => ({ kind: 'agent', ...address, [brand]: true }),
  provider: (providerId: string, on: Address): Principal => ({ kind: 'provider', providerId, on, [brand]: true }),
  internal: (purpose: 'breaker-reset'): Principal => ({ kind: 'internal', purpose, [brand]: true }),
}
export const isPrincipal = (value: Principal): boolean => value?.[brand] === true
export const authorization = {
  createSpace: 'create', invite: 'leader', join: 'invited', declineInvite: 'invited', leave: 'active', markGone: 'leader', transferLeader: 'leader', closeSpace: 'leader', createItem: 'active', reviseItem: 'active', ackItem: 'active', sendMessage: 'active', setStatus: 'active', advanceRequest: 'assignee', requestDecision: 'active', confirmDecision: 'human-provider', resetBreaker: 'internal',
} as const
export type CommandName = keyof typeof authorization
