import { principals, type CollabEvent, type CommandContext, type Member, type MemberStatus } from '../../src/index.js'
import { FakeProvider } from './fake-provider.js'
import { defaultMembers, member, seedRecord, worldFrom } from './world.js'

export const yes = () => true
/** A member admitted by an integrator channel, as a replayed log would hold it. */
export const managed = (name: string, address: string, joinSeq: number, status: MemberStatus = 'active', channel = 'pet-locus'): Member => ({ ...member(name, address, 'agent', status, joinSeq), binding: { channel, address, supports: { wake: true, confirm: false } }, managedBy: channel })
export const managerAllowed = (channel: string): CollabEvent => ({ type: 'manager/allowed', actor: 'aily', channel })

/**
 * The default world plus three more providers: managed P (`pet-locus`, claims
 * `loc:*`), managed Q (`other-loc`, claims `oth:*`) and ordinary S
 * (`dsh-session`, claims `s:*`). `allowed` channels are granted in the seed.
 * Every managed-channel or manager context carries a passing guard unless a
 * test passes `null`.
 */
export async function managedWorld(opts: { members?: Member[]; allowed?: string[]; extra?: CollabEvent[] } = {}) {
  const P = new FakeProvider('PL', 'pet-locus', 'loc:'); P.managed = true
  const Q = new FakeProvider('QL', 'other-loc', 'oth:'); Q.managed = true
  const S = new FakeProvider('S', 'dsh-session', 's:')
  const members = opts.members ?? defaultMembers()
  const w = await worldFrom([seedRecord(members, [...(opts.allowed ?? []).map(managerAllowed), ...(opts.extra ?? [])])], members, [P, Q, S])
  let id = 0
  const guarded = <T extends object>(ctx: T, guard: (() => boolean) | null): T & { guard?: () => boolean } => guard ? { ...ctx, guard } : ctx
  return Object.assign(w, {
    P, Q, S,
    /** Manager principal of provider `providerId` (default P). */
    mgr: (cmdId = `mgr-${++id}`, providerId = 'PL', guard: (() => boolean) | null = yes): CommandContext => guarded({ spaceId: 's', cmdId, principal: principals.manager(providerId) }, guard),
    /** Agent principal at a raw address (default channel `pet-locus`). */
    at: (address: string, cmdId = `at-${++id}`, channel = 'pet-locus', guard: (() => boolean) | null = yes): CommandContext => guarded({ spaceId: 's', cmdId, principal: principals.agent({ channel, address }) }, guard),
    /** Overview through host-index, which needs no member or guard. */
    state: () => w.service.overview(w.host()),
  })
}
export type ManagedWorld = Awaited<ReturnType<typeof managedWorld>>
